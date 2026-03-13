<script lang="ts" module>
	// Export compound components
	export { default as Renderer } from './PdfRenderer.svelte';
	export { default as ThumbnailViewer } from './PdfThumbnailViewer.svelte';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		setPdfViewerContext,
		PresentationModeState,
		type PdfViewerState,
		type PdfViewerActions,
		type PdfSource,
		type TextHighlightData,
		type DrawingStyle
	} from './pdf-viewer/context.js';
	import type { BoundingBox, DrawnBoundingBox } from './pdf-viewer/BoundingBoxLayer.js';

	interface Props {
		/** PDF source - URL string, ArrayBuffer, Uint8Array, or Blob */
		src: PdfSource;
		/** Initial scale (default: 1.0) */
		scale?: number;
		/** Custom filename for PDF download (default: extracted from URL or 'document.pdf') */
		downloadFilename?: string;
		/** Callback when PDF fails to load */
		onerror?: (error: string) => void;
		/** Callback when text is highlighted in the PDF */
		onTextHighlighted?: (data: TextHighlightData) => void;
		/** CSS class for the container */
		class?: string;
		/** Bounding boxes to render on PDF pages */
		boundingBoxes?: BoundingBox[];
		/** Enable drawing mode for creating bounding boxes */
		drawMode?: boolean;
		/** Style for drawn bounding boxes */
		drawingStyle?: DrawingStyle;
		/** Callback when a bounding box is drawn */
		onBoundingBoxDrawn?: (box: DrawnBoundingBox) => void;
		/** Callback when a bounding box close button is clicked */
		onBoundingBoxClose?: (box: BoundingBox) => void;
		/** Callback when a bounding box is clicked */
		onBoundingBoxClick?: (box: BoundingBox) => void;
		/** Callback when a bounding box is hovered (null when mouse leaves) */
		onBoundingBoxHover?: (box: BoundingBox | null) => void;
		/** Desired page width in pixels. When set, scale is computed automatically to fit this width. */
		pageWidth?: number;
		/** Current page number (1-indexed). Bindable - updates on scroll, and setting it navigates to that page. */
		currentPage?: number;
		/** Children (toolbar and renderer) */
		children?: Snippet;
	}

	let {
		src,
		scale: initialScale = 1.0,
		downloadFilename,
		onerror,
		onTextHighlighted,
		class: className = '',
		boundingBoxes = [],
		drawMode = false,
		drawingStyle = {},
		onBoundingBoxDrawn,
		onBoundingBoxClose,
		onBoundingBoxClick,
		onBoundingBoxHover,
		pageWidth,
		currentPage = $bindable(1),
		children
	}: Props = $props();

	// Keep a copy of binary source data for download (PDF.js transfers/detaches ArrayBuffers)
	// This is set by PdfRenderer before it passes data to PDF.js
	let srcDataForDownload = $state<ArrayBuffer | null>(null);

	// Reactive state that will be shared via context
	let viewerState = $state<PdfViewerState>({
		loading: true,
		error: null,
		totalPages: 0,
		currentPage: 1,
		scale: initialScale,
		rotation: 0,
		pageDimensions: new Map(),
		searchQuery: '',
		searchCurrent: 0,
		searchTotal: 0,
		isSearching: false,
		presentationMode: PresentationModeState.NORMAL,
		drawMode
	});

	// Renderer actions - will be populated when renderer mounts
	let rendererActions: PdfViewerActions | null = null;

	// Download helper function
	async function downloadPdf(filenameOverride?: string) {
		const downloadName =
			filenameOverride ||
			downloadFilename ||
			(typeof src === 'string' ? src.split('/').pop() : 'document.pdf') ||
			'document.pdf';

		let blob: Blob;

		if (typeof src === 'string') {
			// URL - fetch first to handle cross-origin URLs (e.g., Firebase Storage)
			// The download attribute is ignored for cross-origin URLs
			try {
				const response = await fetch(src);
				blob = await response.blob();
			} catch {
				// Fallback for same-origin URLs if fetch fails
				const link = document.createElement('a');
				link.href = src;
				link.download = downloadName;
				link.click();
				return;
			}
		} else if (src instanceof Blob) {
			blob = src;
		} else if (srcDataForDownload) {
			// Use the pre-copied data (original ArrayBuffer/Uint8Array gets detached by PDF.js)
			blob = new Blob([srcDataForDownload], { type: 'application/pdf' });
		} else {
			console.error('Cannot download: no valid source data available');
			return;
		}

		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = downloadName;
		link.click();
		URL.revokeObjectURL(url);
	}

	// Actions that proxy to the renderer
	const actions: PdfViewerActions = {
		zoomIn: () => rendererActions?.zoomIn(),
		zoomOut: () => rendererActions?.zoomOut(),
		setScale: (scale: number) => rendererActions?.setScale(scale),
		rotateClockwise: () => rendererActions?.rotateClockwise(),
		rotateCounterClockwise: () => rendererActions?.rotateCounterClockwise(),
		goToPage: (page: number) => rendererActions?.goToPage(page),
		search: async (query: string) => {
			if (rendererActions) {
				await rendererActions.search(query);
			}
		},
		searchNext: () => rendererActions?.searchNext(),
		searchPrevious: () => rendererActions?.searchPrevious(),
		clearSearch: () => rendererActions?.clearSearch(),
		download: downloadPdf,
		enterPresentationMode: async () => {
			if (rendererActions) {
				return rendererActions.enterPresentationMode();
			}
			return false;
		},
		exitPresentationMode: async () => {
			if (rendererActions) {
				await rendererActions.exitPresentationMode();
			}
		},
		updateBoundingBoxes: (boxes: BoundingBox[]) => {
			rendererActions?.updateBoundingBoxes(boxes);
		},
		updateDrawMode: (enabled: boolean) => {
			rendererActions?.updateDrawMode(enabled);
		},
		scrollToCoordinates: (page: number, x: number, y: number, scrollBehavior?: ScrollBehavior) => {
			rendererActions?.scrollToCoordinates(page, x, y, scrollBehavior);
		}
	};

	// Set up context
	setPdfViewerContext({
		state: viewerState,
		actions,
		get src() {
			return src;
		},
		get boundingBoxes() {
			return boundingBoxes;
		},
		get drawingStyle() {
			return drawingStyle;
		},
		_registerRenderer: (renderer: PdfViewerActions) => {
			rendererActions = renderer;
		},
		get _onerror() {
			return onerror;
		},
		_setSrcDataForDownload: (data: ArrayBuffer | null) => {
			srcDataForDownload = data;
		},
		get _onTextHighlighted() {
			return onTextHighlighted;
		},
		_onBoundingBoxDrawn: onBoundingBoxDrawn,
		_onBoundingBoxClose: onBoundingBoxClose,
		get _pageWidth() {
			return pageWidth;
		},
		_onBoundingBoxClick: onBoundingBoxClick,
		_onBoundingBoxHover: onBoundingBoxHover
	});

	// Update renderer when bounding boxes change
	$effect(() => {
		if (rendererActions) {
			rendererActions.updateBoundingBoxes(boundingBoxes);
		}
	});

	// Update draw mode when it changes
	$effect(() => {
		if (rendererActions) {
			rendererActions.updateDrawMode(drawMode);
		}
	});

	// Sync currentPage: internal state → bindable prop
	$effect(() => {
		const page = viewerState.currentPage;
		if (page !== currentPage) {
			currentPage = page;
		}
	});

	// Sync currentPage: bindable prop → navigate to page
	$effect(() => {
		if (currentPage && rendererActions && currentPage !== viewerState.currentPage) {
			rendererActions.goToPage(currentPage);
		}
	});

	// When pageWidth is set, compute scale to fit the desired pixel width
	$effect(() => {
		// Read all reactive dependencies upfront to ensure Svelte tracks them
		// (short-circuit && would skip reads and miss dependency tracking)
		const pw = pageWidth;
		const firstPage = viewerState.pageDimensions.get(1);

		if (pw !== undefined && rendererActions && firstPage) {
			const newScale = pw / firstPage.width;
			rendererActions.setScale(newScale);
		}
	});
</script>

<div class="pdf-viewer-container {className}">
	{#if viewerState.loading}
		<div class="pdf-loading">Loading PDF...</div>
	{:else if viewerState.error}
		<div class="pdf-error">Error: {viewerState.error}</div>
	{/if}

	{#if children}
		{@render children()}
	{:else}
		<!-- Default layout if no children provided -->
		{#await import('./PdfRenderer.svelte') then { default: Renderer }}
			<Renderer {src} />
		{/await}
	{/if}
</div>

<style>
	.pdf-viewer-container {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background-color: #f0f0f0;
		overflow: hidden;
	}

	.pdf-loading,
	.pdf-error {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #666;
		font-size: 1rem;
		z-index: 10;
	}

	.pdf-error {
		color: #dc3545;
	}
</style>
