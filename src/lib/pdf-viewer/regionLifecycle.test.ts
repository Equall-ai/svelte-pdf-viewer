// Verify cancellation releases rendering and drawing resources when fragments are replaced.
import { expect, it, vi } from 'vitest';
import { PDFPageView } from '$lib/pdf-viewer/PDFPageView.js';
import { DrawingLayer } from '$lib/pdf-viewer/DrawingLayer.js';
import { EventBus } from '$lib/pdf-viewer/EventBus.js';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';
it('does not finish a destroyed page after its canvas render resolves', async () => {
	const container = document.createElement('div');
	document.body.append(container);
	const bus = new EventBus(),
		rendered = vi.fn();
	bus.on('pagerendered', rendered);
	let release!: () => void;
	const promise = new Promise<void>((resolve) => (release = resolve));
	const viewport = { width: 600, height: 800, scale: 1, rotation: 0 } as PageViewport;
	const page = {
		rotate: 0,
		getViewport: () => viewport,
		render: () => ({ promise, cancel: () => {} }),
		cleanup: () => {},
		getTextContent: vi.fn()
	} as unknown as PDFPageProxy;
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		scale: () => {}
	} as unknown as CanvasRenderingContext2D);
	const view = new PDFPageView({ container, id: 1, defaultViewport: viewport, eventBus: bus });
	view.setPdfPage(page);
	const drawing = view.draw();
	view.destroy();
	release();
	await drawing;
	expect(rendered).not.toHaveBeenCalled();
	expect(page.getTextContent).not.toHaveBeenCalled();
	expect(container.childElementCount).toBe(0);
	vi.restoreAllMocks();
	container.remove();
});
it('removes document listeners when a drawing layer is retired', () => {
	const add = vi.spyOn(document, 'addEventListener'),
		remove = vi.spyOn(document, 'removeEventListener');
	const layer = new DrawingLayer({
		container: document.createElement('div'),
		viewport: { width: 600, height: 800 } as PageViewport,
		pageNumber: 1,
		drawingStyle: {},
		onBoxDrawn: () => {},
		isDrawModeEnabled: () => true
	});
	layer.init();
	layer.destroy();
	for (const name of ['mousemove', 'mouseup']) {
		const handler = add.mock.calls.find((call) => call[0] === name)?.[1];
		expect(remove).toHaveBeenCalledWith(name, handler);
	}
	vi.restoreAllMocks();
});
