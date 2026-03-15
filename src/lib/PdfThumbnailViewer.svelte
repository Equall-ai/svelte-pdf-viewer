<script lang="ts">
	import { BROWSER } from 'esm-env';
	import { onDestroy, tick } from 'svelte';
	import { getPdfViewerContext, type PdfSource } from './pdf-viewer/context.js';
	import { getPdfJs } from './pdf-viewer/pdfjs-singleton.js';
	import { BoundingBoxLayer } from './pdf-viewer/BoundingBoxLayer.js';
	import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

	interface Props {
		/** Number of columns in the thumbnail grid */
		columns?: number;
		/** Width of each thumbnail in pixels */
		width?: number;
		/** Gap between thumbnails in pixels */
		gap?: number;
		/** Callback when a thumbnail page is clicked */
		onPageClick?: (page: number) => void;
		/** Number of off-screen pages to keep rendered above and below the visible area */
		overscan?: number;
		/** First page to show (1-indexed, inclusive). Defaults to 1. */
		startPage?: number;
		/** Last page to show (1-indexed, inclusive). Defaults to the last page. */
		endPage?: number;
		/** CSS class for the grid container */
		class?: string;
		/** CSS class for each thumbnail button */
		buttonClass?: string;
		/** CSS class for the canvas container div */
		containerClass?: string;
		/** CSS class for the page number label */
		labelClass?: string;
	}

	let {
		columns = 1,
		width = 150,
		gap = 8,
		onPageClick,
		overscan = 2,
		startPage,
		endPage,
		class: gridClass = '',
		buttonClass = '',
		containerClass = '',
		labelClass = ''
	}: Props = $props();

	const context = getPdfViewerContext();
	let src = $derived(context.src);
	let boundingBoxes = $derived.by(() => context.boundingBoxes);
	let rotation = $derived(context.state.rotation);

	let gridEl: HTMLDivElement | undefined = $state();
	let pdfDocument: PDFDocumentProxy | null = null;
	let allPages: PDFPageProxy[] = [];
	let totalPages = $state(0);

	// The subset of pages to display, with their original 1-indexed page numbers
	let displayPages: { page: PDFPageProxy; pageNum: number }[] = $state([]);

	// Per-display-slot estimated height (computed from page dimensions + thumbnail width)
	let pageHeights: number[] = $state([]);

	// Track which pages are visible via IntersectionObserver
	let visiblePages: Set<number> = new Set();
	let renderedPages: Set<number> = $state(new Set());

	// Element refs
	let buttonEls: (HTMLButtonElement | undefined)[] = $state([]);
	let containerEls: (HTMLDivElement | undefined)[] = $state([]);
	let canvasEls: (HTMLCanvasElement | undefined)[] = $state([]);

	// Render state
	let bbLayers: Map<number, BoundingBoxLayer> = new Map();
	let renderTasks: Map<number, import('pdfjs-dist/legacy/build/pdf.mjs').RenderTask> = new Map();
	let observer: IntersectionObserver | null = null;

	async function loadDocument(source: PdfSource) {
		if (!BROWSER) return;

		cleanup();

		const pdfjs = await getPdfJs();
		if (!pdfjs) return;

		let documentSource: string | { data: ArrayBuffer } | { data: Uint8Array };

		if (typeof source === 'string') {
			documentSource = source;
		} else if (source instanceof Blob) {
			const arrayBuffer = await source.arrayBuffer();
			documentSource = { data: arrayBuffer };
		} else if (source instanceof ArrayBuffer) {
			documentSource = { data: source.slice(0) };
		} else if (source instanceof Uint8Array) {
			documentSource = { data: new Uint8Array(source) };
		} else {
			throw new Error('Invalid PDF source type');
		}

		const loadingTask = pdfjs.getDocument(documentSource);
		pdfDocument = await loadingTask.promise;
		totalPages = pdfDocument.numPages;

		const lo = Math.max(1, startPage ?? 1);
		const hi = Math.min(totalPages, endPage ?? totalPages);

		// Load page objects for the visible range (lightweight - doesn't render)
		allPages = [];
		const display: { page: PDFPageProxy; pageNum: number }[] = [];
		const heights: number[] = [];
		for (let i = 1; i <= totalPages; i++) {
			const page = await pdfDocument.getPage(i);
			allPages.push(page);
			if (i >= lo && i <= hi) {
				display.push({ page, pageNum: i });
				const vp = page.getViewport({ scale: 1, rotation });
				const s = width / vp.width;
				heights.push(vp.height * s);
			}
		}
		displayPages = display;
		pageHeights = heights;

		await tick();
		setupObserver();
	}

	function setupObserver() {
		if (observer) observer.disconnect();

		// The grid's parent (thumbnail-sidebar) is the scroll container.
		// Use a generous rootMargin so we render pages slightly before they scroll into view.
		const scrollRoot = gridEl?.parentElement;
		observer = new IntersectionObserver(
			(entries) => {
				let changed = false;
				for (const entry of entries) {
					const idx = parseInt(entry.target.getAttribute('data-page-idx') ?? '', 10);
					if (isNaN(idx)) continue;

					if (entry.isIntersecting) {
						if (!visiblePages.has(idx)) {
							visiblePages.add(idx);
							changed = true;
						}
					} else {
						if (visiblePages.has(idx)) {
							visiblePages.delete(idx);
							changed = true;
						}
					}
				}
				if (changed) updateRenderedSet();
			},
			{
				root: scrollRoot ?? null,
				rootMargin: '200px 0px'
			}
		);

		// Observe all button elements
		for (let i = 0; i < buttonEls.length; i++) {
			const el = buttonEls[i];
			if (el) {
				el.setAttribute('data-page-idx', String(i));
				observer.observe(el);
			}
		}
	}

	function updateRenderedSet() {
		if (visiblePages.size === 0 && renderedPages.size === 0) return;

		// Compute the range to render: visible display indices + overscan buffer
		let minVisible = Infinity;
		let maxVisible = -Infinity;
		for (const idx of visiblePages) {
			if (idx < minVisible) minVisible = idx;
			if (idx > maxVisible) maxVisible = idx;
		}

		const newRendered = new Set<number>();
		if (minVisible <= maxVisible) {
			const lo = Math.max(0, minVisible - overscan);
			const hi = Math.min(displayPages.length - 1, maxVisible + overscan);
			for (let i = lo; i <= hi; i++) {
				newRendered.add(i);
			}
		}

		// Tear down pages that left the rendered set
		for (const idx of renderedPages) {
			if (!newRendered.has(idx)) {
				teardownPage(idx);
			}
		}

		// Render pages that entered the rendered set
		for (const idx of newRendered) {
			if (!renderedPages.has(idx)) {
				renderPageIfReady(idx);
			}
		}

		renderedPages = newRendered;
	}

	/** idx is the display-slot index (into displayPages) */
	function renderPageIfReady(idx: number) {
		const entry = displayPages[idx];
		const canvas = canvasEls[idx];
		const container = containerEls[idx];
		if (!entry || !canvas || !container) return;
		renderPage(entry.page, entry.pageNum, canvas, container);
	}

	function renderPage(
		page: PDFPageProxy,
		pageNum: number,
		canvas: HTMLCanvasElement,
		container: HTMLDivElement
	) {
		// Cancel any in-flight render for this page
		const existing = renderTasks.get(pageNum);
		if (existing) existing.cancel();

		const naturalViewport = page.getViewport({ scale: 1, rotation });
		const scale = width / naturalViewport.width;
		const viewport = page.getViewport({ scale, rotation });

		canvas.width = viewport.width;
		canvas.height = viewport.height;
		container.style.width = `${viewport.width}px`;
		container.style.height = `${viewport.height}px`;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const renderTask = page.render({ canvasContext: ctx, viewport });
		renderTasks.set(pageNum, renderTask);

		renderTask.promise
			.then(() => {
				renderTasks.delete(pageNum);
				renderBBLayer(pageNum, viewport, container);
			})
			.catch((err: unknown) => {
				renderTasks.delete(pageNum);
				if (err instanceof Error && !err.message.startsWith('Rendering cancelled')) {
					console.error(`Thumbnail render error page ${pageNum}:`, err);
				}
			});
	}

	/** idx is the display-slot index (into displayPages) */
	function teardownPage(idx: number) {
		const entry = displayPages[idx];
		if (!entry) return;
		const pageNum = entry.pageNum;

		// Cancel render task
		const task = renderTasks.get(pageNum);
		if (task) {
			task.cancel();
			renderTasks.delete(pageNum);
		}

		// Destroy BB layer
		bbLayers.get(pageNum)?.destroy();
		bbLayers.delete(pageNum);

		// Clear canvas
		const canvas = canvasEls[idx];
		if (canvas) {
			const ctx = canvas.getContext('2d');
			ctx?.clearRect(0, 0, canvas.width, canvas.height);
			canvas.width = 0;
			canvas.height = 0;
		}
	}

	function renderBBLayer(
		pageNum: number,
		viewport: import('pdfjs-dist/legacy/build/pdf.mjs').PageViewport,
		container: HTMLDivElement
	) {
		bbLayers.get(pageNum)?.destroy();

		const pageBoxes = boundingBoxes?.filter((b) => b.page === pageNum) ?? [];
		if (pageBoxes.length === 0) return;

		const layer = new BoundingBoxLayer({
			container,
			viewport,
			boxes: pageBoxes,
			pageNumber: pageNum
		});
		layer.render();
		bbLayers.set(pageNum, layer);
	}

	function cleanup() {
		if (observer) {
			observer.disconnect();
			observer = null;
		}
		for (const task of renderTasks.values()) {
			task.cancel();
		}
		renderTasks.clear();

		for (const layer of bbLayers.values()) {
			layer.destroy();
		}
		bbLayers.clear();

		visiblePages.clear();
		renderedPages = new Set();

		if (pdfDocument) {
			pdfDocument.destroy();
			pdfDocument = null;
		}
		allPages = [];
		displayPages = [];
		totalPages = 0;
		pageHeights = [];
	}

	// Reload when src changes
	$effect(() => {
		if (BROWSER && src) {
			loadDocument(src);
		}
	});

	// Re-render bounding boxes on visible pages when they change
	$effect(() => {
		const _boxes = boundingBoxes;
		if (displayPages.length > 0) {
			for (const idx of renderedPages) {
				const entry = displayPages[idx];
				const container = containerEls[idx];
				if (!entry || !container) continue;

				const naturalViewport = entry.page.getViewport({ scale: 1, rotation });
				const s = width / naturalViewport.width;
				const viewport = entry.page.getViewport({ scale: s, rotation });

				renderBBLayer(entry.pageNum, viewport, container);
			}
		}
	});

	// Re-render visible pages when rotation changes
	$effect(() => {
		const _rot = rotation;
		if (displayPages.length > 0) {
			// Update estimated heights
			const heights: number[] = [];
			for (const entry of displayPages) {
				const vp = entry.page.getViewport({ scale: 1, rotation });
				const s = width / vp.width;
				heights.push(vp.height * s);
			}
			pageHeights = heights;

			// Re-render only currently rendered pages
			for (const idx of renderedPages) {
				renderPageIfReady(idx);
			}
		}
	});

	onDestroy(() => {
		cleanup();
	});
</script>

<div
	class={gridClass}
	bind:this={gridEl}
	style:display="grid"
	style:grid-template-columns="repeat({columns}, auto)"
	style:gap="{gap}px"
>
	{#each displayPages as entry, i}
		<button
			class={buttonClass}
			type="button"
			onclick={() => onPageClick?.(entry.pageNum)}
			bind:this={buttonEls[i]}
		>
			<div
				class={containerClass}
				bind:this={containerEls[i]}
				style:position="relative"
				style:width="{width}px"
				style:height="{pageHeights[i] ?? width * 1.4}px"
			>
				<canvas bind:this={canvasEls[i]} style:display="block"></canvas>
			</div>
			<span class={labelClass}>{entry.pageNum}</span>
		</button>
	{/each}
</div>
