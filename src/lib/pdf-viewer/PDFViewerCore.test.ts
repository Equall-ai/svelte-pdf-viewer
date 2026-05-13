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
