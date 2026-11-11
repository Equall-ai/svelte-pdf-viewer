import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

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

	constructor(options: { id: number; rotation?: number }) {
		this.id = options.id;
		this.div = document.createElement('div');
		this.div.dataset.viewerRotation = String(options.rotation ?? 0);
		this.div.scrollIntoView = vi.fn(); // happy-dom stub
	}

	setPdfPage() {}
	reset() {}

	async draw() {
		if (this.drawDelayMs > 0) await new Promise((r) => setTimeout(r, this.drawDelayMs));
		drawLog.push({ id: this.id, t: performance.now() });
		this.renderingState = RenderingStates.FINISHED;
	}

	update({ rotation }: { rotation?: number } = {}) {
		if (rotation !== undefined) this.div.dataset.viewerRotation = String(rotation);
	}
	destroy() {}
	updateBoundingBoxes() {}
	setDrawMode() {}
}

type QueueCore = {
	isRendering: boolean;
	pages: FakePDFPageView[];
	renderingQueue: Set<number>;
	processRenderingQueue: () => Promise<void>;
};
let perPageDrawDelayMs = 0;

vi.mock('./PDFPageView.js', () => ({
	RenderingStates,
	PDFPageView: class extends FakePDFPageView {
		constructor(options: { id: number; rotation?: number }) {
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
	await viewer.setDocument(makeFakeDoc(numPages) as unknown as PDFDocumentProxy);
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
		await viewer.setDocument(makeFakeDoc(5) as unknown as PDFDocumentProxy);

		// Let initial render settle so isRendering is false before we start
		await vi.waitFor(() => {
			expect((viewer as unknown as QueueCore).isRendering).toBe(false);
		});

		const core = viewer as unknown as QueueCore;

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
		const core = viewer as unknown as QueueCore;

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

// Shared viewports must not move outer application scrollers or remove sibling content.
describe('PDFViewerCore shared surface', () => {
	it('mounts and cleans up only its page column', async () => {
		const { PDFViewerCore } = await import('./PDFViewerCore.js');
		const container = makeContainer();
		const pageContainer = document.createElement('div');
		const margin = document.createElement('aside');
		container.append(pageContainer, margin);
		const viewer = new PDFViewerCore({ container, pageContainer });
		expect(viewer.viewer.parentElement).toBe(pageContainer);
		viewer.destroy();
		expect(container.contains(margin)).toBe(true);
	});
	it('navigates inside the shared viewport using nested page offsets', async () => {
		const viewer = await setup(3);
		const page = viewer.getPageView(1)!;
		vi.spyOn(page.div, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 930, 612, 792));
		viewer.container.scrollTop = 100;
		const scroll = vi.spyOn(viewer.container, 'scrollTo');
		viewer.scrollToPage(2);
		expect(scroll).toHaveBeenCalledWith({ top: 1030, behavior: 'instant' });
		expect(page.div.scrollIntoView).not.toHaveBeenCalled();
		viewer.destroy();
	});
});

it('does not append pages from a retired document load', async () => {
	const { PDFViewerCore } = await import('./PDFViewerCore.js');
	const viewer = new PDFViewerCore({ container: makeContainer() });
	const doc = makeFakeDoc(2);
	let release!: () => void;
	const pending = new Promise<void>((resolve) => (release = resolve));
	let requestedSecond = false;
	const firstGetPage = doc.getPage;
	doc.getPage = async (i) => {
		if (i === 2) {
			requestedSecond = true;
			await pending;
		}
		return firstGetPage(i);
	};
	const oldLoad = viewer.setDocument(doc as unknown as PDFDocumentProxy);
	await vi.waitFor(() => expect(requestedSecond).toBe(true));
	await viewer.setDocument(makeFakeDoc(1) as unknown as PDFDocumentProxy);
	release();
	await oldLoad;
	expect(viewer.pagesCount).toBe(1);
	viewer.destroy();
});

it.each(['scale', 'rotation'] as const)(
	'preserves the page-relative reading position during %s changes',
	async (property) => {
		const viewer = await setup(3);
		vi.spyOn(viewer.container, 'clientHeight', 'get').mockReturnValue(300);
		for (let i = 0; i < 3; i++) {
			const page = viewer.getPageView(i)!;
			let height = 800;
			Object.defineProperty(page, 'height', { get: () => height, configurable: true });
			vi.spyOn(page.div, 'getBoundingClientRect').mockImplementation(
				() =>
					new DOMRect(0, 5 + i * (page.height + 16) - viewer.container.scrollTop, 600, page.height)
			);
			vi.spyOn(page, 'update').mockImplementation(() => {
				height = property === 'scale' ? 1600 : 600;
			});
		}
		viewer.refreshLayout();
		viewer.container.scrollTop = 1021;
		viewer[property] = property === 'scale' ? 2 : 90;
		expect(viewer.container.scrollTop).toBe(property === 'scale' ? 2021 : 771);
		expect(viewer.currentPageNumber).toBe(2);
		viewer.destroy();
	}
);

it('keeps source page count while an empty region selection hides every page', async () => {
	const { PDFViewerCore } = await import('./PDFViewerCore.js');
	const viewer = new PDFViewerCore({ container: makeContainer(), regions: [] });
	await viewer.setDocument(makeFakeDoc(3) as unknown as PDFDocumentProxy);
	expect(viewer.pagesCount).toBe(3);
	expect(viewer.getPageViews(0)).toEqual([]);
	expect(drawLog).toHaveLength(0);
	await viewer.setRegions(null);
	expect(viewer.getPageViews(0)).toHaveLength(1);
	viewer.destroy();
});

// PDF.js loading is the asynchronous resource boundary; region planning and PDF generation stay real.
let stripFailure = false;
let stripGate: Promise<void> | null = null;
const stripDocuments: Array<{ destroyed: boolean }> = [];
vi.mock('$lib/pdf-viewer/pdfjs-singleton.js', () => ({
	getPdfWorker: () => null,
	getPdfJs: async () => ({
		getDocument: () => ({
			promise: (async () => {
				if (stripFailure) throw new Error('fixture strip load failure');
				const state = { destroyed: false };
				stripDocuments.push(state);
				if (stripGate) await stripGate;
				return {
					...makeFakeDoc(1),
					destroy: async () => {
						state.destroyed = true;
					}
				};
			})()
		})
	})
}));
async function regionSource() {
	const { PDFDocument } = await import('pdf-lib');
	const pdf = await PDFDocument.create();
	pdf.addPage([612, 792]);
	pdf.addPage([612, 792]);
	const data = await pdf.save();
	const doc = makeFakeDoc(2),
		getPage = doc.getPage;
	return {
		...doc,
		getData: async () => data.slice(),
		getPage: async (n: number) => ({
			...(await getPage(n)),
			getAnnotations: async () => [],
			view: [0, 0, 612, 792],
			userUnit: 1
		})
	} as unknown as PDFDocumentProxy;
}
it('preserves a usable view after expansion failure and can retry without reloading the source', async () => {
	stripFailure = false;
	stripGate = null;
	stripDocuments.length = 0;
	const { PDFViewerCore } = await import('./PDFViewerCore.js');
	let state: import('./PDFViewerCore.js').RegionViewState = {
		gaps: [],
		pending: false,
		error: null
	};
	const viewer = new PDFViewerCore({
		container: makeContainer(),
		regions: [{ id: 'a', page: 1, y_min: 20, y_max: 30 }],
		onRegionsChange: (next) => (state = next)
	});
	await viewer.setDocument(await regionSource());
	expect(state.error).toBeNull();
	expect(viewer.getPageViews(0)).toHaveLength(1);
	const oldView = viewer.getPageView(0),
		oldGap = state.gaps[0];
	stripFailure = true;
	oldGap.revealFromEnd();
	await vi.waitFor(() => expect(state.error).toBe('fixture strip load failure'));
	expect(viewer.getPageView(0)).toBe(oldView);
	expect(state.pending).toBe(false);
	stripFailure = false;
	state.gaps[0].revealFromEnd();
	await vi.waitFor(() => expect(viewer.getPageView(0)).not.toBe(oldView));
	expect(stripDocuments[0].destroyed).toBe(true);
	const expanded = viewer.getPageView(0);
	await viewer.setRegions([{ id: 'a', page: 1, y_min: 20, y_max: 30 }]);
	expect(viewer.getPageView(0)).toBe(expanded);
	oldGap.revealFromEnd();
	expect(viewer.getPageView(0)).toBe(expanded);
	viewer.destroy();
	expect(stripDocuments.every((doc) => doc.destroyed)).toBe(true);
});
it('discards a strip loaded after a newer Event selection', async () => {
	stripFailure = false;
	stripDocuments.length = 0;
	let release!: () => void;
	stripGate = new Promise<void>((resolve) => (release = resolve));
	const { PDFViewerCore } = await import('./PDFViewerCore.js');
	const viewer = new PDFViewerCore({
		container: makeContainer(),
		regions: [{ id: 'old', page: 1, y_min: 20, y_max: 30 }]
	});
	const loading = viewer.setDocument(await regionSource());
	await vi.waitFor(() => expect(stripDocuments).toHaveLength(1));
	await viewer.setRegions([]);
	release();
	await loading;
	stripGate = null;
	expect(viewer.getPageViews(0)).toEqual([]);
	expect(viewer.getPageViews(1)).toEqual([]);
	expect(stripDocuments[0].destroyed).toBe(true);
	viewer.destroy();
});

it('cancels a hidden search reveal before committing its generated strip', async () => {
	stripFailure = false;
	stripGate = null;
	stripDocuments.length = 0;
	const { PDFViewerCore } = await import('./PDFViewerCore.js');
	let state: import('./PDFViewerCore.js').RegionViewState = {
		gaps: [],
		pending: false,
		error: null
	};
	const viewer = new PDFViewerCore({
		container: makeContainer(),
		regions: [{ id: 'a', page: 1, y_min: 20, y_max: 30 }],
		onRegionsChange: (next) => (state = next)
	});
	await viewer.setDocument(await regionSource());
	let release!: () => void,
		current = true;
	stripGate = new Promise<void>((resolve) => (release = resolve));
	const navigation = viewer.revealSourceRange(2, 10, 20, 50, 'instant', () => current);
	await vi.waitFor(() => expect(stripDocuments).toHaveLength(2));
	current = false;
	release();
	await navigation;
	stripGate = null;
	expect(viewer.getPageViews(1)).toEqual([]);
	expect(viewer.getPageViews(0)).toHaveLength(1);
	expect(stripDocuments[1].destroyed).toBe(true);
	expect(state.pending).toBe(false);
	expect(state.error).toBeNull();
	viewer.destroy();
});
it('applies toolbar rotation to a strip prepared during an in-flight render', async () => {
	stripFailure = false;
	stripGate = null;
	stripDocuments.length = 0;
	perPageDrawDelayMs = 100;
	const { PDFViewerCore } = await import('./PDFViewerCore.js');
	const container = makeContainer();
	vi.spyOn(container, 'clientHeight', 'get').mockReturnValue(800);
	const viewer = new PDFViewerCore({
		container,
		regions: [{ id: 'a', page: 1, y_min: 20, y_max: 30 }]
	});
	const loading = viewer.setDocument(await regionSource());
	await vi.waitFor(() => expect(stripDocuments).toHaveLength(1));
	viewer.rotation = 90;
	await loading;
	expect(viewer.getPageView(0)?.div.dataset.viewerRotation).toBe('90');
	viewer.destroy();
});
