import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const RenderingStates = { INITIAL: 0, RUNNING: 1, PAUSED: 2, FINISHED: 3 } as const;

/** Per-test draw log: [pageId, timestampMs] */
const drawLog: Array<{ id: number; t: number }> = [];

class FakePDFPageView {
	readonly id: number;
	renderingState: number = RenderingStates.INITIAL;
	height = 792;
	div: HTMLDivElement;
	/** Simulated render latency in ms (set per-test via the global below) */
	drawDelayMs = 0;

	constructor(options: { id: number }) {
		this.id = options.id;
		this.div = document.createElement('div');
		this.div.scrollIntoView = vi.fn(); // happy-dom stub
	}

	setPdfPage() {}

	async draw() {
		if (this.drawDelayMs > 0) await new Promise((r) => setTimeout(r, this.drawDelayMs));
		drawLog.push({ id: this.id, t: performance.now() });
		this.renderingState = RenderingStates.FINISHED;
	}

	update() {}
	destroy() {}
	updateBoundingBoxes() {}
	setDrawMode() {}
}

let perPageDrawDelayMs = 0;

vi.mock('./PDFPageView.js', () => ({
	RenderingStates,
	PDFPageView: class extends FakePDFPageView {
		constructor(options: { id: number }) {
			super(options);
			this.drawDelayMs = perPageDrawDelayMs;
		}
	}
}));

vi.mock('./SimpleLinkService.js', () => ({
	SimpleLinkService: class {
		setDocument() {}
		setViewer() {}
	}
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLElement {
	const el = document.createElement('div');
	vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
		width: 612,
		height: 800,
		top: 0,
		left: 0,
		bottom: 800,
		right: 612,
		x: 0,
		y: 0,
		toJSON: () => {}
	} as DOMRect);
	return el;
}

function makeFakeDoc(numPages: number) {
	return {
		numPages,
		getPage: async (i: number) => ({
			getViewport: () => ({
				width: 612,
				height: 792,
				transform: [],
				scale: 1,
				rotation: 0,
				viewBox: [0, 0, 612, 792],
				offsetX: 0,
				offsetY: 0
			}),
			rotate: 0,
			ref: { num: i, gen: 0 }
		})
	};
}

async function setup(numPages: number) {
	const { PDFViewerCore } = await import('./PDFViewerCore.js');
	const container = makeContainer();
	const viewer = new PDFViewerCore({ container });
	await viewer.setDocument(makeFakeDoc(numPages) as any);
	return viewer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	drawLog.length = 0;
	perPageDrawDelayMs = 0;
	vi.resetModules();
});

describe('PDFViewerCore – priority-queue jump-to-page', () => {
	it('draws jump target before lower-priority pages in the queue', async () => {
		// 50 pages; only the first few are "visible" on load (container height=800, page=792)
		// Pages after the visible window start in INITIAL state and sit in the queue.
		// After scrollToPage(30), page 30 must be drawn before pages that were ahead of it
		// in the pre-existing queue.

		perPageDrawDelayMs = 0; // instant draw so we capture order precisely
		const viewer = await setup(50);

		// Let initial render settle (pages 0-2 visible + prerender buffer)
		await new Promise((r) => setTimeout(r, 20));
		drawLog.length = 0; // reset — we only care about draws after the jump

		viewer.scrollToPage(30);
		await new Promise((r) => setTimeout(r, 50));

		// Page 30 must have been drawn
		const targetDraw = drawLog.find((e) => e.id === 30);
		expect(targetDraw).toBeDefined();

		// Page 30 should be the very first draw after the jump
		expect(drawLog[0].id).toBe(30);
	});

	it('isRendering is reset even when page.draw() throws', async () => {
		const { PDFViewerCore } = await import('./PDFViewerCore.js');
		const container = makeContainer();
		const viewer = new PDFViewerCore({ container });
		await viewer.setDocument(makeFakeDoc(5) as any);

		// Let initial render settle so isRendering is false before we start
		await vi.waitFor(() => {
			expect((viewer as any).isRendering).toBe(false);
		});

		const core = viewer as any;

		// Reset one page to INITIAL with a draw() that always throws
		core.pages[2].renderingState = RenderingStates.INITIAL;
		core.pages[2].draw = async () => {
			throw new Error('render failure');
		};

		core.isRendering = false;
		core.renderingQueue.clear();
		core.renderingQueue.add(2);
		await core.processRenderingQueue();

		expect(core.isRendering).toBe(false);
	});
});

describe('PDFViewerCore – queue clear on jump', () => {
	it('re-prioritizes target even when it was already queued from an earlier load', async () => {
		// Reproduces the no-clear race: when a page is already sitting in the queue
		// (e.g. from an earlier jump or preload), a second jump to that page must
		// still draw it first. Without renderingQueue.clear(), Set.add(existing) is a
		// no-op and the target stays buried behind earlier entries.

		perPageDrawDelayMs = 0;
		const viewer = await setup(50);
		const core = viewer as any;

		// Wait for all rendering to settle
		await vi.waitFor(() => expect(core.isRendering).toBe(false));

		// Simulate stale queue: reset pages 2-9 and page 39 (target) to INITIAL.
		// Page 39 sits at position 8 in the queue — behind 7 other pages.
		const staleIndices = [2, 3, 4, 5, 6, 7, 8, 9, 39];
		for (const idx of staleIndices) core.pages[idx].renderingState = RenderingStates.INITIAL;
		core.renderingQueue.clear();
		for (const idx of staleIndices) core.renderingQueue.add(idx); // target is last
		core.isRendering = false;
		drawLog.length = 0;

		// Jump to page 40 (index 39) — target is buried at position 8 in the old queue
		viewer.scrollToPage(40);
		await new Promise((r) => setTimeout(r, 20));

		// With queue clear: target is drawn first
		expect(drawLog[0].id).toBe(40);
	});
});

describe('PDFViewerCore – renderVersion interrupt', () => {
	it('second jump cancels the first render pass and draws the new target next', async () => {
		// Page draw takes 20 ms. Jump to page 20, then immediately jump to page 40
		// while page 20 is still rendering. After page 20 finishes, the loop should
		// detect the version mismatch, break, and restart with page 40 as the new target.

		perPageDrawDelayMs = 20;
		const viewer = await setup(50);

		await new Promise((r) => setTimeout(r, 40)); // let initial render settle
		drawLog.length = 0;

		viewer.scrollToPage(20); // first jump — starts drawing page 20 (takes 20 ms)

		// Kick the second jump before page 20 finishes
		await new Promise((r) => setTimeout(r, 5));
		viewer.scrollToPage(40); // second jump — should interrupt after page 20 completes

		await vi.waitFor(
			() => {
				expect(drawLog.some((e) => e.id === 40)).toBe(true);
			},
			{ timeout: 2000, interval: 5 }
		);

		const page20idx = drawLog.findIndex((e) => e.id === 20);
		const page40idx = drawLog.findIndex((e) => e.id === 40);

		// Page 40 must appear right after page 20 (at most 1 other page between them)
		expect(page20idx).toBeGreaterThanOrEqual(0);
		expect(page40idx).toBeGreaterThan(page20idx);
		expect(page40idx - page20idx).toBeLessThanOrEqual(2);
	});
});

describe('PDFViewerCore – jump-to-page performance benchmark', () => {
	it('target page renders in O(1) pages, not O(N) pages', async () => {
		// Simulate real rendering cost: 5 ms per page.
		// Without the priority queue, jumping to page 40 in a 50-page PDF would
		// require rendering ~37 preceding pages first → ~185 ms.
		// With the priority queue the target renders immediately → ~5 ms.

		perPageDrawDelayMs = 5;
		const viewer = await setup(50);

		// Let the initial visible-window render complete
		await new Promise((r) => setTimeout(r, 40));
		drawLog.length = 0;

		const t0 = performance.now();
		viewer.scrollToPage(40);

		// Poll until page 40 appears in drawLog
		await vi.waitFor(
			() => {
				expect(drawLog.some((e) => e.id === 40)).toBe(true);
			},
			{ timeout: 2000, interval: 5 }
		);

		const elapsed = performance.now() - t0;

		console.log(`\n[benchmark] time to first draw of jump target (page 40 / 50):`);
		console.log(`  elapsed: ${elapsed.toFixed(1)} ms`);
		console.log(`  pages drawn before target: ${drawLog.findIndex((e) => e.id === 40)}`);

		// With priority queue: target is first in queue → drawn in one draw-cycle (~5 ms).
		// Allow generous headroom for CI jitter.
		expect(elapsed).toBeLessThan(50);

		// Target is the very first page drawn after the jump
		expect(drawLog[0].id).toBe(40);
	});
});
