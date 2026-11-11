<script lang="ts">
	import type { PdfRegion, PdfGapContext, PdfRegionRenderState } from '$lib/pdf-viewer/regions.js';
	import type { RegionViewState } from '$lib/pdf-viewer/PDFViewerCore.js';
	import { BROWSER } from 'esm-env';
	import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
	import { observeDocumentSurface, type PdfDocumentSurface } from './pdf-viewer/documentSurface.js';
	import { observePdfAnchor, observePdfDocumentAnchor } from './pdf-viewer/overlayAnchor.js';
	import {
		getPdfViewerContext,
		type PdfViewerActions,
		type PdfSource
	} from './pdf-viewer/context.js';
	import { getPdfJs, getPdfWorker } from './pdf-viewer/pdfjs-singleton.js';
	import { PdfPresentationMode } from './pdf-viewer/PdfPresentationMode.js';
	import { rendererStyles } from './pdf-viewer/renderer-styles.js';
	import BoundingBoxOverlay from './pdf-viewer/BoundingBoxOverlay.svelte';
	import type { BoundingBox } from './pdf-viewer/BoundingBoxLayer.js';

	interface Props {
		/** Source visibility regions; null means full document, [] means no evidence. */
		regions?: readonly PdfRegion[] | null;
		/** Context above and below each region, in PDF points. Defaults to 24. */
		contextPadding?: number;
		/** Amount revealed per click, as a fraction of the adjacent page height. */
		expansionStep?: number;
		/** Expand/collapse animation in milliseconds; 0 disables it. Respects reduced motion. */
		regionTransitionDuration?: number;
		/** Application-owned divider in the shared scroller's light DOM. */
		gap?: Snippet<[PdfGapContext]>;
		/** Reports region loading, visible-layer readiness after layout, errors, or full-document idle. */
		onRegionRenderStateChange?: (state: PdfRegionRenderState) => void;
		/** Reserved margin width in CSS pixels; changes without reloading the document. */
		marginWidth?: number;
		/** Application-owned content in the shared scrolling margin. */
		margin?: Snippet<[PdfDocumentSurface]>;
		/** Non-interactive connectors or decoration over the complete document surface. */
		surfaceOverlay?: Snippet<[PdfDocumentSurface]>;
		/** Reports surface-relative layout and viewport geometry. */
		onSurfaceChange?: (surface: PdfDocumentSurface | null) => void;
		/** PDF source - URL string, ArrayBuffer, Uint8Array, or Blob. If not provided, uses src from PdfViewer context. */
		src?: PdfSource;
		/** Background color of the scroll container */
		backgroundColor?: string;
		/** Page shadow style */
		pageShadow?: string;
		/** Scrollbar track color */
		scrollbarTrackColor?: string;
		/** Scrollbar thumb color */
		scrollbarThumbColor?: string;
		/** Scrollbar thumb hover color */
		scrollbarThumbHoverColor?: string;
		/** Scrollbar width */
		scrollbarWidth?: string;
		/** Factory that creates a loading indicator element for each page. Called once per page. If omitted, no per-page loading indicator is shown. */
		createLoadingIndicator?: () => HTMLElement;
	}

	let {
		regions = null,
		contextPadding = 24,
		expansionStep = 0.2,
		regionTransitionDuration = 220,
		gap,
		onRegionRenderStateChange,
		marginWidth = 0,
		margin,
		surfaceOverlay,
		onSurfaceChange,
		src: srcProp,
		backgroundColor = '#e8e8e8',
		pageShadow = '0 2px 8px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)',
		scrollbarTrackColor = '#f1f1f1',
		scrollbarThumbColor = '#c1c1c1',
		scrollbarThumbHoverColor = '#a1a1a1',
		scrollbarWidth = '10px',
		createLoadingIndicator
	}: Props = $props();

	const context = getPdfViewerContext();
	const {
		state: viewerState,
		_registerRenderer,
		_setSrcDataForDownload,
		_onTextHighlighted
	} = context;

	// Use prop src if provided, otherwise fall back to context src (via getter for reactivity)
	let src = $derived(srcProp ?? context.src);
	// Get bounding boxes from context - use $derived.by to ensure getter is tracked
	let boundingBoxes = $derived.by(() => context.boundingBoxes);

	let hostEl: HTMLDivElement | undefined = $state();
	let shadowRoot = $state<ShadowRoot | null>(null);
	let scrollContainerEl: HTMLDivElement | null = null;
	let mounted = $state(false);
	let surfaceElement: HTMLDivElement | null = null;
	let pageContainer: HTMLDivElement | null = null;
	let surface = $state.raw<PdfDocumentSurface | null>(null);
	let detachSurface: (() => void) | undefined;
	let detachDocumentAnchors: (() => void) | undefined;
	let loadGeneration = 0;
	let loadingTask: import('pdfjs-dist/legacy/build/pdf.mjs').PDFDocumentLoadingTask | null = null;
	const effectiveMarginWidth = $derived(
		margin && Number.isFinite(marginWidth) ? Math.max(0, marginWidth) : 0
	);
	let textSelectionAbortController: AbortController | null = null;

	// Core instances
	let viewer = $state.raw<import('./pdf-viewer/PDFViewerCore.js').PDFViewerCore | null>(null);
	let regionState = $state.raw<RegionViewState>({ gaps: [], pending: false, error: null });
	let findController: import('./pdf-viewer/FindController.js').FindController | null = null;

	// Presentation mode
	const presentationMode = new PdfPresentationMode({
		onStateChange: (newState) => {
			viewerState.presentationMode = newState;
		},
		onPageChange: (pageNumber) => {
			// Sync page number back to main viewer when changed in presentation mode
			viewer?.scrollToPage(pageNumber);
		}
	});

	function assignSlot(element: HTMLElement, name: string) {
		element.slot = name;
	}

	async function loadPdf(source: PdfSource) {
		if (!BROWSER || !scrollContainerEl) return;

		const generation = ++loadGeneration;
		void loadingTask?.destroy().catch(() => {});
		loadingTask = null;
		viewerState.loading = true;
		viewerState.pageDimensions = new Map();
		viewerState.error = null;
		regionState = { gaps: [], pending: false, error: null };
		untrack(() =>
			onRegionRenderStateChange?.({ status: regions == null ? 'idle' : 'loading', error: null })
		);

		// Cleanup previous viewer
		if (viewer) {
			viewer.destroy();
			viewer = null;
		}

		// Only PDF-owned nodes are retired; slots and consumer state survive source changes.

		let newViewer: import('./pdf-viewer/PDFViewerCore.js').PDFViewerCore | null = null;

		try {
			const pdfjs = await getPdfJs();
			if (!pdfjs || generation !== loadGeneration) return;

			const { PDFViewerCore } = await import('./pdf-viewer/PDFViewerCore.js');
			const { FindController } = await import('./pdf-viewer/FindController.js');
			const { EventBus } = await import('./pdf-viewer/EventBus.js');

			if (generation !== loadGeneration) return;
			const eventBus = new EventBus();

			newViewer = new PDFViewerCore({
				container: scrollContainerEl,
				regions,
				contextPadding,
				expansionStep,
				regionTransitionDuration,
				onRegionRenderStateChange: (next) => {
					if (generation === loadGeneration) untrack(() => onRegionRenderStateChange?.(next));
				},
				onRegionsChange: (next) => {
					if (generation === loadGeneration) regionState = next;
				},
				pageContainer: pageContainer ?? undefined,
				eventBus,
				initialScale: viewerState.scale,
				initialRotation: viewerState.rotation,
				pageWidth: context._pageWidth,
				imageResourcesPath: context.imageResourcesPath,
				boundingBoxes: boundingBoxes,
				drawMode: context.state.drawMode,
				drawingStyle: context.drawingStyle,
				onBoundingBoxDrawn: context._onBoundingBoxDrawn,
				onBoundingBoxClick: context._onBoundingBoxClick,
				onBoundingBoxHover: context._onBoundingBoxHover,
				createLoadingIndicator
			});

			const nextFindController = new FindController(newViewer, eventBus);

			// Setup event listeners
			eventBus.on('scalechanged', (data: Record<string, unknown>) => {
				viewerState.scale = data.scale as number;
			});

			eventBus.on('rotationchanged', (data: Record<string, unknown>) => {
				viewerState.rotation = data.rotation as number;
			});

			eventBus.on('updateviewarea', (data: Record<string, unknown>) => {
				const location = data.location as { pageNumber: number };
				viewerState.currentPage = location.pageNumber;
			});

			eventBus.on('pagesloaded', (data: Record<string, unknown>) => {
				viewerState.totalPages = data.pagesCount as number;
			});

			eventBus.on('pagedimensions', (data: Record<string, unknown>) => {
				const pageNumber = data.pageNumber as number;
				const width = data.width as number;
				const height = data.height as number;
				// Update the Map with new page dimensions
				viewerState.pageDimensions.set(pageNumber, { width, height });
				// Trigger reactivity by reassigning
				viewerState.pageDimensions = new Map(viewerState.pageDimensions);
			});

			eventBus.on('updatefindmatchescount', (data: Record<string, unknown>) => {
				const matchesCount = data.matchesCount as { current: number; total: number };
				viewerState.searchCurrent = matchesCount.current;
				viewerState.searchTotal = matchesCount.total;
			});

			// Handle different source types
			let documentSource: string | { data: ArrayBuffer } | { data: Uint8Array };

			if (typeof source === 'string') {
				// URL string
				documentSource = source;
				_setSrcDataForDownload(null); // URL doesn't need copying
			} else if (source instanceof Blob) {
				// Convert Blob to ArrayBuffer
				const arrayBuffer = await source.arrayBuffer();
				if (generation !== loadGeneration) {
					newViewer.destroy();
					return;
				}
				_setSrcDataForDownload(arrayBuffer.slice(0)); // Store a copy for download
				documentSource = { data: arrayBuffer };
			} else if (source instanceof ArrayBuffer) {
				_setSrcDataForDownload(source.slice(0)); // Store a copy before PDF.js detaches it
				documentSource = { data: source };
			} else if (source instanceof Uint8Array) {
				_setSrcDataForDownload(new Uint8Array(source).buffer.slice(0) as ArrayBuffer); // Store a copy for download
				documentSource = { data: source };
			} else {
				throw new Error('Invalid PDF source type');
			}

			// Pass the singleton worker explicitly so doc.destroy() won't tear it down
			const worker = getPdfWorker();
			const docParams: Record<string, unknown> =
				typeof documentSource === 'string' ? { url: documentSource } : { ...documentSource };
			if (worker) docParams.worker = worker;
			const nextLoadingTask = pdfjs.getDocument(docParams);
			loadingTask = nextLoadingTask;
			const loadedPdfDocument = await nextLoadingTask.promise;
			if (generation !== loadGeneration) {
				newViewer.destroy();
				await loadedPdfDocument.destroy();
				return;
			}

			await newViewer.setDocument(loadedPdfDocument);
			if (generation !== loadGeneration) {
				newViewer.destroy();
				await loadedPdfDocument.destroy();
				return;
			}
			nextFindController.setDocument(loadedPdfDocument);

			// Set document on presentation mode
			presentationMode.setDocument(loadedPdfDocument);

			// Center the scroll position horizontally
			if (scrollContainerEl) {
				// Wait for next tick to ensure DOM is updated
				await new Promise((resolve) => setTimeout(resolve, 0));

				const scrollWidth = scrollContainerEl.scrollWidth;
				const clientWidth = scrollContainerEl.clientWidth;

				if (scrollWidth > clientWidth) {
					scrollContainerEl.scrollLeft = (scrollWidth - clientWidth) / 2;
				}
			}

			if (generation !== loadGeneration) {
				newViewer.destroy();
				return;
			}
			viewer = newViewer;
			findController = nextFindController;
			viewerState.loading = false;
		} catch (e) {
			// Clean up the viewer that was created before the error
			if (newViewer) {
				newViewer.destroy();
				newViewer = null;
			}
			if (generation !== loadGeneration) return;
			findController = null;

			const errorMessage = e instanceof Error ? e.message : 'Failed to load PDF';
			viewerState.error = errorMessage;
			if (regions != null)
				untrack(() => onRegionRenderStateChange?.({ status: 'error', error: errorMessage }));
			viewerState.loading = false;
			// Call the error callback if provided
			context._onerror?.(errorMessage);
		}
	}

	// Handle text selection
	function handleTextSelection() {
		if (!_onTextHighlighted) return;

		// Try to get selection from shadow root first, then fall back to window
		const selection =
			(
				shadowRoot as (ShadowRoot & { getSelection?: () => Selection | null }) | null
			)?.getSelection?.() ?? window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const selectedText = selection.toString().trim();
		if (!selectedText) return;

		// Get the bounding rectangle of the selection
		const range = selection.getRangeAt(0);
		if (
			range.startContainer.getRootNode() !== shadowRoot ||
			range.endContainer.getRootNode() !== shadowRoot
		)
			return;
		const rect = range.getBoundingClientRect();

		// Fire the callback with text and position data
		_onTextHighlighted({
			text: selectedText,
			position: {
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height
			}
		});
	}

	// Register actions with context
	const rendererActions: PdfViewerActions = {
		resetRegionExpansion: () => viewer?.resetRegionExpansion(),
		zoomIn: () => viewer?.zoomIn(),
		zoomOut: () => viewer?.zoomOut(),
		setScale: (scale: number) => {
			if (viewer) viewer.scale = scale;
		},
		rotateClockwise: () => viewer?.rotateClockwise(),
		rotateCounterClockwise: () => viewer?.rotateCounterClockwise(),
		goToPage: (page: number) => viewer?.scrollToPage(page),
		search: async (query: string) => {
			if (!findController) return;
			viewerState.isSearching = true;
			viewerState.searchQuery = query;
			await findController.find({
				query,
				highlightAll: true,
				caseSensitive: false
			});
			viewerState.isSearching = false;
		},
		searchNext: () => findController?.findNext(),
		searchPrevious: () => findController?.findPrevious(),
		clearSearch: () => {
			if (findController) {
				findController.reset();
				viewerState.searchQuery = '';
				viewerState.searchCurrent = 0;
				viewerState.searchTotal = 0;
			}
		},
		download: async () => {}, // Download is handled by PdfViewer, not renderer
		enterPresentationMode: async () => {
			presentationMode.setCurrentPage(viewerState.currentPage);
			return presentationMode.request();
		},
		exitPresentationMode: async () => {
			await presentationMode.exit();
		},
		updateBoundingBoxes: (boxes) => {
			viewer?.updateBoundingBoxes(boxes);
		},
		updateDrawMode: (enabled) => {
			viewer?.updateDrawMode(enabled);
		},
		scrollToCoordinates: (page, x, y, scrollBehavior) => {
			viewer?.scrollToCoordinates(page, x, y, scrollBehavior);
		}
	};

	let detachAnchorObserver: (() => void) | undefined;
	onMount(async () => {
		if (BROWSER && hostEl) {
			// Create shadow root for style isolation
			shadowRoot = hostEl.attachShadow({ mode: 'open' });

			// Inject styles
			const styleEl = document.createElement('style');
			styleEl.textContent = rendererStyles;
			shadowRoot.appendChild(styleEl);

			// Create container structure inside shadow DOM
			const container = document.createElement('div');
			container.className = 'pdf-renderer-container';

			// Apply CSS custom properties for customization
			container.style.setProperty('--pdf-background-color', backgroundColor);
			container.style.setProperty('--pdf-page-shadow', pageShadow);
			container.style.setProperty('--pdf-scrollbar-track-color', scrollbarTrackColor);
			container.style.setProperty('--pdf-scrollbar-thumb-color', scrollbarThumbColor);
			container.style.setProperty('--pdf-scrollbar-thumb-hover-color', scrollbarThumbHoverColor);
			container.style.setProperty('--pdf-scrollbar-width', scrollbarWidth);

			scrollContainerEl = document.createElement('div');
			scrollContainerEl.className = 'pdf-scroll-container';
			container.appendChild(scrollContainerEl);
			surfaceElement = document.createElement('div');
			surfaceElement.className = 'pdf-document-surface';
			pageContainer = document.createElement('div');
			pageContainer.className = 'pdf-page-column';
			const marginColumn = document.createElement('div');
			marginColumn.className = 'pdf-margin-column';
			const marginSlot = document.createElement('slot');
			marginSlot.name = 'margin';
			marginColumn.append(marginSlot);
			const overlay = document.createElement('div');
			overlay.className = 'pdf-surface-overlay';
			const overlaySlot = document.createElement('slot');
			overlaySlot.name = 'surface-overlay';
			overlay.append(overlaySlot);
			surfaceElement.append(pageContainer, marginColumn, overlay);
			scrollContainerEl.append(surfaceElement);

			shadowRoot.appendChild(container);

			// Register actions
			_registerRenderer(rendererActions);
			const elements = { host: hostEl, root: shadowRoot, viewport: scrollContainerEl };
			detachSurface = observeDocumentSurface(
				{
					viewport: scrollContainerEl,
					surface: surfaceElement,
					pages: pageContainer,
					margin: marginColumn
				},
				(next) => {
					const layoutChanged = surface?.layoutRevision !== next.layoutRevision;
					surface = next;
					if (layoutChanged) viewer?.refreshLayout();
					onSurfaceChange?.(next);
				}
			);
			detachDocumentAnchors = context._registerDocumentAnchorObserver(anchorObserver);
			function anchorObserver(
				anchor: Parameters<typeof observePdfDocumentAnchor>[1],
				callback: Parameters<typeof observePdfDocumentAnchor>[2]
			) {
				return observePdfDocumentAnchor(
					{
						...elements,
						surface: surfaceElement!,
						layoutRevision: () => surface?.layoutRevision ?? 0
					},
					anchor,
					callback
				);
			}
			detachAnchorObserver = context._registerAnchorObserver((anchor, callback) =>
				observePdfAnchor(elements, anchor, callback)
			);

			// Set up text selection listener if callback is provided
			if (_onTextHighlighted) {
				textSelectionAbortController = new AbortController();
				document.addEventListener('mouseup', handleTextSelection, {
					signal: textSelectionAbortController.signal
				});
			}

			mounted = true;
		}
	});

	// Load PDF when src changes
	$effect(() => {
		if (BROWSER && src && scrollContainerEl && mounted) {
			untrack(() => {
				void loadPdf(src);
			});
		}
	});

	// Width changes update layout without recreating the PDF or its consumer snippets.
	$effect(() => {
		const width = effectiveMarginWidth;
		if (mounted && surfaceElement)
			surfaceElement.style.setProperty('--pdf-margin-width', width + 'px');
	});

	// Region changes preserve the source document, worker, search index, and consumer snippets.
	$effect(() => {
		if (viewer) {
			viewer.regionTransitionDuration = regionTransitionDuration;
			void viewer.setRegions(regions, contextPadding, expansionStep);
		}
	});

	// Update bounding boxes when they change
	$effect(() => {
		if (viewer && boundingBoxes) {
			viewer.updateBoundingBoxes(boundingBoxes);
		}
	});

	// Handle bounding box close
	function handleBoundingBoxClose(box: BoundingBox) {
		// Call the close callback from context if provided
		context._onBoundingBoxClose?.(box);
	}

	onDestroy(() => {
		loadGeneration++;
		void loadingTask?.destroy().catch(() => {});
		detachAnchorObserver?.();
		detachDocumentAnchors?.();
		detachSurface?.();
		onSurfaceChange?.(null);
		if (viewer) {
			viewer.destroy();
			viewer = null;
		}
		findController = null;
		presentationMode.destroy();
		// Clean up text selection listener
		textSelectionAbortController?.abort();
		textSelectionAbortController = null;
		// Note: Worker is a global singleton, not cleaned up per-component
		// Use destroyPdfJs() from pdfjs-singleton.js if you need to fully cleanup
	});
</script>

<div class="pdf-renderer-wrapper">
	{#if regionState.error}
		<div class="pdf-region-error" role="alert">
			{regionState.error}
			<button onclick={() => viewer?.resetRegionExpansion()}>Retry</button>
			<button onclick={() => void viewer?.setRegions(null)}>Return to source</button>
		</div>
	{/if}
	<div bind:this={hostEl} class="pdf-renderer-host">
		{#each regionState.gaps as context (context.id)}
			<div use:assignSlot={context.id} class="pdf-consumer-gap" aria-busy={context.pending}>
				{#if gap}{@render gap(context)}{:else}
					<div class="pdf-default-gap">
						<span
							>{context.hiddenRange ? 'Hidden context' : 'Expanded context'} · pages {context.range
								.start.page}–{context.range.end.page}</span
						>
						{#if context.hiddenRange && context.before}<button
								disabled={context.pending}
								onclick={context.revealFromStart}>Show more below</button
							>{/if}
						{#if context.hiddenRange && context.before && context.after}<button
								disabled={context.pending}
								onclick={context.revealAll}>Show all between</button
							>{/if}
						{#if context.hiddenRange && context.after}<button
								disabled={context.pending}
								onclick={context.revealFromEnd}>Show more above</button
							>{/if}
						<button
							hidden={!context.canCollapse}
							disabled={context.pending}
							onclick={context.collapse}>Collapse context</button
						>
						{#if context.error}<span role="alert">{context.error}</span>{/if}
					</div>
				{/if}
			</div>
		{/each}
		{#if margin && surface}
			<div
				use:assignSlot={'margin'}
				class="pdf-consumer-margin"
				hidden={effectiveMarginWidth === 0}
			>
				{@render margin(surface)}
			</div>
		{/if}
		{#if surfaceOverlay && surface}
			<div use:assignSlot={'surface-overlay'} class="pdf-consumer-overlay">
				{@render surfaceOverlay(surface)}
			</div>
		{/if}
	</div>
	{#if !viewerState.loading && mounted}
		<BoundingBoxOverlay
			{context}
			boxes={boundingBoxes}
			scale={viewerState.scale}
			pageDimensions={viewerState.pageDimensions}
			{shadowRoot}
			onClose={handleBoundingBoxClose}
		/>
	{/if}
</div>

<style>
	.pdf-consumer-gap {
		width: 100%;
	}
	.pdf-default-gap {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 12px;
		font: 13px system-ui;
		color: #334155;
		background: #eef2f6;
	}
	.pdf-region-error {
		position: absolute;
		z-index: 10;
		top: 8px;
		left: 8px;
		right: 8px;
		background: #fff;
		padding: 12px;
		color: #9f1239;
	}
	.pdf-renderer-wrapper {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.pdf-consumer-margin {
		position: relative;
		width: 100%;
	}
	.pdf-consumer-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.pdf-renderer-host {
		display: block;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}
</style>
