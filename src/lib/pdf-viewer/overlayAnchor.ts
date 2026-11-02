// Observe PDF anchors and place consumer-owned overlays outside the renderer's shadow DOM.
import type { NormalizedBoundingBox } from './BoundingBoxLayer.js';

/** A rectangle in the rendered page's orientation (percentages, top-left origin), or a box ID. */
export type PdfOverlayAnchor =
	| Pick<NormalizedBoundingBox, 'page' | 'x_min' | 'y_min' | 'x_max' | 'y_max'>
	| { boxId: string };

/** Both rectangles use browser viewport coordinates, suitable for fixed-position overlays. */
export interface PdfAnchorBounds {
	anchor: DOMRect;
	viewport: DOMRect;
}

export interface PdfOverlayPlacementOptions {
	side?: 'top' | 'bottom';
	align?: 'start' | 'center' | 'end';
	gap?: number;
}

export type PdfAnchorObserver = (
	anchor: PdfOverlayAnchor,
	onBounds: (bounds: PdfAnchorBounds | null) => void
) => () => void;

function intersects(a: DOMRect, b: DOMRect): boolean {
	return (
		a.width > 0 &&
		a.height > 0 &&
		b.width > 0 &&
		b.height > 0 &&
		a.right > b.left &&
		a.left < b.right &&
		a.bottom > b.top &&
		a.top < b.bottom
	);
}

/** Align, flip, and clamp an overlay inside the visible PDF viewport. */
export function placePdfOverlay(
	bounds: PdfAnchorBounds,
	width: number,
	height: number,
	{ side = 'top', align = 'end', gap = 6 }: PdfOverlayPlacementOptions = {}
): { left: number; top: number } | null {
	const { anchor, viewport } = bounds;
	if (!intersects(anchor, viewport) || width > viewport.width || height > viewport.height)
		return null;
	const above = anchor.top - height - gap;
	const below = anchor.bottom + gap;
	const top =
		side === 'top'
			? above >= viewport.top
				? above
				: below
			: below + height <= viewport.bottom
				? below
				: above;
	const left =
		align === 'start'
			? anchor.left
			: align === 'center'
				? anchor.left + (anchor.width - width) / 2
				: anchor.right - width;
	return {
		left: Math.max(viewport.left, Math.min(left, viewport.right - width)),
		top: Math.max(viewport.top, Math.min(top, viewport.bottom - height))
	};
}

interface RendererElements {
	host: HTMLElement;
	root: ShadowRoot;
	viewport: HTMLElement;
}

/** Internal renderer implementation used by PdfAnchoredOverlay. */
export function observePdfAnchor(
	{ host, root, viewport }: RendererElements,
	anchor: PdfOverlayAnchor,
	onBounds: (bounds: PdfAnchorBounds | null) => void
): () => void {
	let frame = 0;
	let stopped = false;
	let probe: HTMLDivElement | null = null;
	let observed: HTMLElement | null = null;
	let last = '';
	const schedule = () => {
		if (!stopped && !frame) frame = requestAnimationFrame(measure);
	};
	const resize = new ResizeObserver(schedule);
	const mutations = new MutationObserver(schedule);
	const publish = (bounds: PdfAnchorBounds | null) => {
		const key = JSON.stringify(bounds);
		if (key === last) return;
		last = key;
		onBounds(bounds);
	};
	function resolve(): HTMLElement | null {
		if ('boxId' in anchor) {
			return (
				[...root.querySelectorAll<HTMLElement>('[data-box-id]')].find(
					(box) => box.dataset.boxId === anchor.boxId
				) ?? null
			);
		}
		if (
			!Number.isInteger(anchor.page) ||
			anchor.page < 1 ||
			![anchor.x_min, anchor.x_max, anchor.y_min, anchor.y_max].every(Number.isFinite)
		)
			return null;
		const page = root.querySelector<HTMLElement>(`[data-page-number="${anchor.page}"]`);
		if (!page) {
			probe?.remove();
			probe = null;
			return null;
		}
		if (!probe || probe.parentElement !== page) {
			probe?.remove();
			probe = document.createElement('div');
			probe.setAttribute('data-pdf-anchor-probe', '');
			probe.setAttribute('aria-hidden', 'true');
			// A non-interactive rectangle inherits the same page transforms as rendered content.
			// Measuring it handles CSS rotations/scaling without duplicating PDF.js geometry.
			probe.style.cssText =
				`position:absolute;pointer-events:none;visibility:hidden;` +
				`left:${Math.min(anchor.x_min, anchor.x_max)}%;top:${Math.min(anchor.y_min, anchor.y_max)}%;` +
				`width:${Math.abs(anchor.x_max - anchor.x_min)}%;height:${Math.abs(anchor.y_max - anchor.y_min)}%;`;
			page.append(probe);
		}
		return probe;
	}
	function measure() {
		frame = 0;
		if (stopped) return;
		const element = resolve();
		if (element !== observed) {
			resize.disconnect();
			resize.observe(host);
			resize.observe(viewport);
			if (element) resize.observe(element);
			observed = element;
		}
		if (!element || !host.isConnected) {
			publish(null);
			return;
		}
		const bounds = element.getBoundingClientRect();
		const scroll = viewport.getBoundingClientRect();
		const outer = host.getBoundingClientRect();
		const left = Math.max(0, outer.left, scroll.left);
		const top = Math.max(0, outer.top, scroll.top);
		const right = Math.min(window.innerWidth, outer.right, scroll.right);
		const bottom = Math.min(window.innerHeight, outer.bottom, scroll.bottom);
		const visible = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
		publish(intersects(bounds, visible) ? { anchor: bounds, viewport: visible } : null);
	}
	resize.observe(host);
	resize.observe(viewport);
	mutations.observe(root, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['style', 'class', 'data-box-id', 'data-page-number']
	});
	root.addEventListener('scroll', schedule, true);
	window.addEventListener('scroll', schedule, true);
	window.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('resize', schedule);
	window.visualViewport?.addEventListener('scroll', schedule);
	schedule();
	return () => {
		stopped = true;
		cancelAnimationFrame(frame);
		resize.disconnect();
		mutations.disconnect();
		root.removeEventListener('scroll', schedule, true);
		window.removeEventListener('scroll', schedule, true);
		window.removeEventListener('resize', schedule);
		window.visualViewport?.removeEventListener('resize', schedule);
		window.visualViewport?.removeEventListener('scroll', schedule);
		probe?.remove();
	};
}

/** Keep subscriptions valid when a renderer mounts late or is replaced. */
export function createAnchorRegistry() {
	const entries = new Set<{
		anchor: PdfOverlayAnchor;
		callback: (bounds: PdfAnchorBounds | null) => void;
		stop?: () => void;
	}>();
	let observer: PdfAnchorObserver | null = null;
	const reset = () => {
		for (const entry of entries) {
			entry.stop?.();
			entry.stop = undefined;
			entry.callback(null);
		}
	};
	const observe: PdfAnchorObserver = (anchor, callback) => {
		const entry: { anchor: PdfOverlayAnchor; callback: typeof callback; stop?: () => void } = {
			anchor,
			callback
		};
		entries.add(entry);
		callback(null);
		entry.stop = observer?.(anchor, callback);
		return () => {
			entry.stop?.();
			entries.delete(entry);
		};
	};
	return {
		observe,
		attach(next: PdfAnchorObserver) {
			reset();
			observer = next;
			for (const entry of entries) entry.stop = next(entry.anchor, entry.callback);
			return () => {
				if (observer === next) {
					observer = null;
					reset();
				}
			};
		},
		destroy() {
			observer = null;
			reset();
			entries.clear();
		}
	};
}
