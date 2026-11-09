// Publish document-surface geometry without exposing renderer DOM to consumers.
export interface PdfSurfaceRect {
	x: number;
	y: number;
	width: number;
	height: number;
}
/** All rectangles are CSS pixels relative to the shared document surface. */
export interface PdfDocumentSurface {
	width: number;
	height: number;
	pages: PdfSurfaceRect;
	margin: PdfSurfaceRect;
	viewport: PdfSurfaceRect;
	/** Changes for layout changes, never for scrolling alone. */
	layoutRevision: number;
}
interface SurfaceElements {
	viewport: HTMLElement;
	surface: HTMLElement;
	pages: HTMLElement;
	margin: HTMLElement;
}
/** Coalesce scrolling, resize, and page layout changes into one geometry update. */
export function observeDocumentSurface(
	elements: SurfaceElements,
	onChange: (surface: PdfDocumentSurface) => void
): () => void {
	const { viewport, surface, pages, margin } = elements;
	let frame = 0;
	let stopped = false;
	let layoutKey = '';
	let previous = '';
	let revision = 0;
	let layoutDirty = true;
	let pageBounds: PdfSurfaceRect = { x: 0, y: 0, width: 0, height: 0 };
	let marginBounds = pageBounds;
	const schedule = () => {
		if (!stopped && !frame) frame = requestAnimationFrame(measure);
	};
	const scheduleLayout = () => {
		layoutDirty = true;
		schedule();
	};
	function measure() {
		frame = 0;
		if (stopped) return;
		const origin = surface.getBoundingClientRect();
		const relative = (element: HTMLElement): PdfSurfaceRect => {
			const box = element.getBoundingClientRect();
			return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
		};
		let layoutChanged = false;
		if (layoutDirty) {
			layoutDirty = false;
			pageBounds = relative(pages);
			marginBounds = relative(margin);
			// Page geometry can change without changing the total height (e.g. mixed-page rotation).
			const pageGeometry = [...pages.querySelectorAll<HTMLElement>('[data-page-number]')].map(
				relative
			);
			const key = JSON.stringify([
				origin.width,
				origin.height,
				pageBounds,
				marginBounds,
				pageGeometry,
				viewport.clientWidth,
				viewport.clientHeight
			]);
			layoutChanged = key !== layoutKey;
			if (layoutChanged) {
				layoutKey = key;
				revision++;
			}
		}
		const viewportBounds = relative(viewport);
		const next: PdfDocumentSurface = {
			width: origin.width,
			height: origin.height,
			pages: pageBounds,
			margin: marginBounds,
			viewport: {
				x: viewportBounds.x + viewport.clientLeft,
				y: viewportBounds.y + viewport.clientTop,
				width: viewport.clientWidth,
				height: viewport.clientHeight
			},
			layoutRevision: revision
		};
		const nextKey = JSON.stringify(next);
		if (nextKey !== previous) {
			previous = nextKey;
			onChange(next);
		}
		if (layoutChanged) viewport.dispatchEvent(new Event('pdf-layout-change'));
	}
	const resize = new ResizeObserver(scheduleLayout);
	for (const element of [viewport, surface, pages, margin]) resize.observe(element);
	const mutations = new MutationObserver(scheduleLayout);
	mutations.observe(pages, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['style', 'class']
	});
	viewport.addEventListener('scroll', schedule, { passive: true });
	window.addEventListener('resize', scheduleLayout);
	schedule();
	return () => {
		stopped = true;
		cancelAnimationFrame(frame);
		resize.disconnect();
		mutations.disconnect();
		viewport.removeEventListener('scroll', schedule);
		window.removeEventListener('resize', scheduleLayout);
	};
}
