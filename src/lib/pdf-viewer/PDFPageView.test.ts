// Keep page geometry aligned when layout changes interrupt a pending canvas render.
import { afterEach, expect, it, vi } from 'vitest';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFPageView } from '$lib/pdf-viewer/PDFPageView.js';
import { EventBus } from '$lib/pdf-viewer/EventBus.js';

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

it.each([
	{ update: { scale: 0.5 }, width: '300px', height: '400px' },
	{ update: { rotation: 90 }, width: '800px', height: '600px' }
])('keeps a pending canvas aligned after $update', async ({ update, width, height }) => {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		scale: () => {}
	} as unknown as CanvasRenderingContext2D);
	const getViewport = ({ scale = 1, rotation = 0 } = {}) =>
		({
			width: (rotation === 90 ? 800 : 600) * scale,
			height: (rotation === 90 ? 600 : 800) * scale,
			scale,
			rotation
		}) as PageViewport;
	let release!: () => void;
	const pending = new Promise<void>((resolve) => (release = resolve));
	const page = {
		rotate: 0,
		getViewport,
		render: () => ({ promise: pending, cancel: () => {} }),
		cleanup: () => {}
	} as unknown as PDFPageProxy;
	const container = document.createElement('div');
	document.body.append(container);
	const bus = new EventBus();
	const rendered = vi.fn();
	bus.on('pagerendered', rendered);
	const view = new PDFPageView({
		container,
		id: 1,
		defaultViewport: getViewport(),
		eventBus: bus
	});
	view.setPdfPage(page);
	const firstDraw = view.draw();
	try {
		view.update(update);
		const canvas = view.div.querySelector('canvas');
		expect(canvas?.style.width).toBe(width);
		expect(canvas?.style.height).toBe(height);
		expect(view.div.style.width).toBe(width);
		expect(view.div.style.height).toBe(height);
	} finally {
		const currentDraw = view.draw();
		view.destroy();
		release();
		await Promise.all([firstDraw, currentDraw]);
	}
	expect(rendered).not.toHaveBeenCalled();
});
