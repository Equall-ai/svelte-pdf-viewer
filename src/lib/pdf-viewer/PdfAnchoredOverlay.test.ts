// Exercise snippet rendering and placement without exposing geometry work to consumers.
import { afterEach, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import PdfAnchoredOverlay from '../PdfAnchoredOverlay.svelte';
import BoundingBoxOverlay from './BoundingBoxOverlay.svelte';
import type { PdfAnchorBounds, PdfAnchorObserver } from './overlayAnchor.js';
import type { PdfViewerContext } from './context.js';
import { BoundingBoxLayer, type BoundingBox } from './BoundingBoxLayer.js';
import type { PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';

const instances: ReturnType<typeof mount>[] = [];
afterEach(async () => {
	for (const instance of instances.splice(0)) await unmount(instance);
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

it.each([true, false])(
	'renders native box overlay snippets with or without a box ID: %s',
	(withId) => {
		const observe = vi.fn<PdfAnchorObserver>((_anchor, callback) => {
			callback({ anchor: new DOMRect(100, 150, 100, 20), viewport: new DOMRect(0, 0, 500, 500) });
			return vi.fn();
		});
		const context = { _observeAnchor: observe } as unknown as PdfViewerContext;
		const overlay = createRawSnippet<[{ box: BoundingBox; visible: boolean }]>((get) => ({
			render: () => `<span>Page ${get().box.page} controls</span>`
		}));
		const target = document.createElement('div');
		document.body.append(target);
		const instance = mount(BoundingBoxOverlay, {
			target,
			props: {
				context,
				boxes: [
					{
						...(withId ? { id: 'native-box' } : {}),
						page: 1,
						x: 20,
						y: 50,
						width: 40,
						height: 50,
						overlay
					}
				],
				scale: 1,
				pageDimensions: new Map([[1, { width: 200, height: 200 }]]),
				shadowRoot: null
			}
		});
		instances.push(instance);
		flushSync();
		expect(target.textContent?.trim()).toBe('Page 1 controls');
		expect(target.querySelector<HTMLElement>('[data-pdf-overlay]')?.style.visibility).toBe(
			'visible'
		);
		expect(observe.mock.calls[0][0]).toEqual({
			boxId: withId ? 'native-box' : expect.any(String)
		});
	}
);

it('anchors an ID-less native overlay to the rendered box through rotation', () => {
	const observe = vi.fn<PdfAnchorObserver>(() => vi.fn());
	const box: BoundingBox = {
		page: 1,
		x: 60,
		y: 40,
		width: 120,
		height: 30,
		overlay: createRawSnippet(() => ({ render: () => '<span>Controls</span>' }))
	};
	const target = document.createElement('div');
	const page = document.createElement('div');
	document.body.append(target, page);
	const layer = new BoundingBoxLayer({
		container: page,
		viewport: { scale: 1, width: 600, height: 800 } as PageViewport,
		boxes: [box],
		pageNumber: 1
	});
	layer.render();
	instances.push(
		mount(BoundingBoxOverlay, {
			target,
			props: {
				context: { _observeAnchor: observe } as unknown as PdfViewerContext,
				boxes: [box],
				scale: 1,
				pageDimensions: new Map([[1, { width: 600, height: 800 }]]),
				shadowRoot: null
			}
		})
	);
	flushSync();
	const anchor = observe.mock.calls[0][0];
	expect(anchor).toHaveProperty('boxId');
	if (!('boxId' in anchor)) throw new Error('Native overlays must measure their rendered box');
	const initial = page.querySelector<HTMLElement>('.boundingBox')!;
	expect(initial.dataset.boxId).toBe(anchor.boxId);
	layer.update({ scale: 1, width: 800, height: 600 } as PageViewport);
	const rotated = page.querySelector<HTMLElement>('.boundingBox')!;
	expect(rotated.dataset.boxId).toBe(anchor.boxId);
	expect(rotated.style.left).toBe('60px');
	expect(rotated.style.width).toBe('120px');
	expect(rotated.style.top).toBe('530px');
});

it('keeps snippet visibility independent of an oversized footprint', () => {
	let notify!: (bounds: PdfAnchorBounds | null) => void;
	let isVisible!: () => boolean;
	vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
	vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(24);
	const target = document.createElement('div');
	document.body.append(target);
	const context = {
		_observeAnchor: ((_anchor, callback) => {
			notify = callback;
			return vi.fn();
		}) as PdfAnchorObserver
	} as PdfViewerContext;
	instances.push(
		mount(PdfAnchoredOverlay, {
			target,
			props: {
				anchor: { boxId: 'box' },
				context,
				children: createRawSnippet<[{ visible: boolean }]>((get) => {
					isVisible = () => get().visible;
					return { render: () => '<span>Long content</span>' };
				})
			}
		})
	);
	flushSync();
	notify({ anchor: new DOMRect(0, 40, 50, 20), viewport: new DOMRect(0, 0, 100, 100) });
	flushSync();
	expect(target.querySelector<HTMLElement>('[data-pdf-overlay]')!.style.visibility).toBe('hidden');
	expect(isVisible()).toBe(true);
	notify(null);
	flushSync();
	expect(isVisible()).toBe(false);
});

it('renders the snippet in normal DOM, follows its anchor, hides offscreen, and unsubscribes', () => {
	let notify!: (bounds: PdfAnchorBounds | null) => void;
	const stop = vi.fn();
	const context = {
		_observeAnchor: ((_anchor, callback) => {
			notify = callback;
			return stop;
		}) as PdfAnchorObserver
	} as PdfViewerContext;
	const target = document.createElement('div');
	target.style.position = 'relative';
	document.body.append(target);
	const clicked = vi.fn();
	const children = createRawSnippet(() => ({
		render: () => '<button>Linked cells</button>',
		setup(element) {
			element.addEventListener('click', clicked);
		}
	}));
	const instance = mount(PdfAnchoredOverlay, {
		target,
		props: {
			anchor: { page: 2, x_min: 10, x_max: 30, y_min: 20, y_max: 40 },
			context,
			children
		}
	});
	instances.push(instance);
	flushSync();
	const overlay = target.querySelector<HTMLElement>('[data-pdf-overlay]')!;
	expect(overlay.style.visibility).toBe('hidden');
	notify({ anchor: new DOMRect(100, 150, 100, 20), viewport: new DOMRect(0, 0, 500, 500) });
	flushSync();
	expect(overlay.style.visibility).toBe('visible');
	expect(overlay.getRootNode()).toBe(document);
	target.querySelector('button')!.click();
	expect(clicked).toHaveBeenCalledOnce();
	const button = target.querySelector('button');
	notify({ anchor: new DOMRect(200, 250, 100, 20), viewport: new DOMRect(0, 0, 500, 500) });
	flushSync();
	expect(overlay.style.top).toBe('244px');
	expect(target.querySelector('button')).toBe(button);
	notify(null);
	flushSync();
	expect(overlay.style.visibility).toBe('hidden');
	expect(overlay.inert).toBe(true);
	expect(target.querySelector('button')).toBe(button);
	unmount(instance);
	expect(stop).toHaveBeenCalledOnce();
	instances.pop();
});
