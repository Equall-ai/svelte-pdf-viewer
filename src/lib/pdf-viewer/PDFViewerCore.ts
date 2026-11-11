/* Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * PDFViewerCore - Main viewer that manages all pages in a scroll container.
 * This is a derivative work based on PDF.js pdf_viewer.js
 */
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EventBus } from './EventBus.js';
import { PDFPageView, RenderingStates } from './PDFPageView.js';
import { SimpleLinkService } from './SimpleLinkService.js';
import {
	getBoundingBoxAnchorId,
	type BoundingBox,
	type DrawnBoundingBox
} from './BoundingBoxLayer.js';
import type { DrawingStyle, PageDimensions } from './context.js';
import {
	initialFragments,
	mergeFragments,
	regionInputKey,
	regionDividers,
	collapseRegionGap,
	nearestFragmentPosition,
	expandRegionGap,
	boxInFragment,
	drawnBoxInSource,
	rotateRect,
	type PdfRegion,
	type PdfFragment,
	type PdfGapContext,
	type RegionGap
} from '$lib/pdf-viewer/regions.js';
import { getPdfJs, getPdfWorker } from '$lib/pdf-viewer/pdfjs-singleton.js';
import { animateRegionChange, type RegionSnapshot } from '$lib/pdf-viewer/regionTransition.js';
import type { RegionPdfSource } from '$lib/pdf-viewer/regionPdf.js';
type RegionPart = { fragment: PdfFragment; view: PDFPageView; document: PDFDocumentProxy };
type SourceReadingPosition = { page: number; x: number; y: number; screenY: number };
export interface RegionViewState {
	gaps: PdfGapContext[];
	pending: boolean;
	error: string | null;
}

export interface PDFViewerOptions {
	regions?: readonly PdfRegion[] | null;
	contextPadding?: number;
	expansionStep?: number;
	regionTransitionDuration?: number;
	onRegionsChange?: (state: RegionViewState) => void;
	container: HTMLElement;
	/** Page mount target inside the scrolling viewport; defaults to container. */
	pageContainer?: HTMLElement;
	imageResourcesPath?: string;
	eventBus?: EventBus;
	initialScale?: number;
	initialRotation?: number;
	/** Desired page width in pixels. Overrides initialScale by computing scale from first page's natural width. */
	pageWidth?: number;
	boundingBoxes?: BoundingBox[];
	drawMode?: boolean;
	drawingStyle?: DrawingStyle;
	onBoundingBoxDrawn?: (box: DrawnBoundingBox) => void;
	onBoundingBoxClick?: (box: BoundingBox) => void;
	onBoundingBoxHover?: (box: BoundingBox | null) => void;
	/** Factory that creates a loading indicator element for each page. If omitted, no loading indicator is shown. */
	createLoadingIndicator?: () => HTMLElement;
}

const DEFAULT_SCALE = 1.0;
const MIN_SCALE = 0.1;
const MAX_SCALE = 10.0;
const DEFAULT_SCALE_DELTA = 0.1;

// Number of pages to render around the visible ones
const PAGES_TO_PRERENDER = 2;

export class PDFViewerCore {
	readonly container: HTMLElement;
	readonly viewer: HTMLDivElement;
	readonly eventBus: EventBus;

	private pdfDocument: PDFDocumentProxy | null = null;
	private documentGeneration = 0;
	private pages: PDFPageView[] = [];
	private sourcePages: PDFPageView[] = [];
	private pageSizes: PageDimensions[] = [];
	private regionInput: readonly PdfRegion[] | null = null;
	private regionKey = 'full';
	private contextPadding = 24;
	private expansionStep = 0.2;
	private regionVersion = 0;
	regionTransitionDuration = 220;
	private transitionActive = false;
	private transitionViewport = { width: 0, height: 0 };
	private finishTransition: (() => void) | null = null;
	private layoutVersion = 0;
	private regionParts: RegionPart[] = [];
	private fragments: PdfFragment[] = [];
	private regionGenerator: Promise<RegionPdfSource> | null = null;
	private onRegionsChange?: (state: RegionViewState) => void;
	private regionPending = false;
	private regionError: string | null = null;
	private gapResize: ResizeObserver | null = null;
	private lastReadingPosition: SourceReadingPosition | null = null;
	private mappedBoxes = new WeakMap<BoundingBox, BoundingBox>();
	private currentScale: number;
	private currentRotation: number;
	private scrollAbortController: AbortController | null = null;
	private renderingQueue: Set<number> = new Set();
	private isRendering = false;
	private renderVersion = 0;
	private jumpTargetIdx: number | null = null;
	/** Cumulative top offset for each page, in scroll-container px. Rebuilt after setDocument / scale change. */
	private pageOffsets: number[] = [];

	// Link service for annotation navigation
	private linkService: SimpleLinkService;

	// Bounding boxes
	private boundingBoxes: BoundingBox[] = [];

	// Drawing mode
	private drawMode: boolean;
	private drawingStyle: DrawingStyle;
	private onBoundingBoxDrawn?: (box: DrawnBoundingBox) => void;
	private onBoundingBoxClick?: (box: BoundingBox) => void;
	private onBoundingBoxHover?: (box: BoundingBox | null) => void;

	// Page width override
	private pageWidth?: number;
	private imageResourcesPath: string;

	// Loading indicator factory
	private createLoadingIndicator?: () => HTMLElement;

	constructor(options: PDFViewerOptions) {
		this.container = options.container;
		this.regionInput = options.regions ?? null;
		this.regionKey = regionInputKey(this.regionInput);
		this.contextPadding = options.contextPadding ?? 24;
		this.expansionStep = options.expansionStep ?? 0.2;
		this.regionTransitionDuration = options.regionTransitionDuration ?? 220;
		this.onRegionsChange = options.onRegionsChange;
		this.eventBus = options.eventBus ?? new EventBus();
		this.currentScale = options.initialScale ?? DEFAULT_SCALE;
		this.currentRotation = options.initialRotation ?? 0;
		this.pageWidth = options.pageWidth;
		this.imageResourcesPath = options.imageResourcesPath ?? '';
		this.boundingBoxes = options.boundingBoxes ?? [];
		this.drawMode = options.drawMode ?? false;
		this.drawingStyle = options.drawingStyle ?? {};
		this.onBoundingBoxDrawn = options.onBoundingBoxDrawn;
		this.onBoundingBoxClick = options.onBoundingBoxClick;
		this.onBoundingBoxHover = options.onBoundingBoxHover;
		this.createLoadingIndicator = options.createLoadingIndicator;

		// Create viewer div inside container
		this.viewer = document.createElement('div');
		this.viewer.className = 'pdfViewer';
		this.viewer.style.position = 'relative';
		(options.pageContainer ?? this.container).appendChild(this.viewer);

		// Create link service for annotation navigation
		this.linkService = new SimpleLinkService({
			eventBus: this.eventBus
		});

		// Setup scroll listener for lazy rendering
		this.setupScrollListener();
	}

	private setupScrollListener(): void {
		this.scrollAbortController?.abort();
		this.scrollAbortController = new AbortController();

		let rafId: number | null = null;

		this.container.addEventListener(
			'scroll',
			() => {
				if (rafId === null) {
					rafId = requestAnimationFrame(() => {
						rafId = null;
						this.updateVisiblePages();
						if (!this.transitionActive) this.lastReadingPosition = this.captureSourcePosition();
					});
				}
			},
			{ passive: true, signal: this.scrollAbortController.signal }
		);
	}

	async setDocument(pdfDocument: PDFDocumentProxy): Promise<void> {
		// Cleanup previous document
		this.cleanup();

		const generation = this.documentGeneration;
		this.pdfDocument = pdfDocument;
		const numPages = pdfDocument.numPages;

		// Setup link service with document and viewer
		this.linkService.setDocument(pdfDocument);
		this.linkService.setViewer(this);

		// If pageWidth is set, compute scale from first page's natural width
		if (this.pageWidth !== undefined) {
			const firstPage = await pdfDocument.getPage(1);
			if (generation !== this.documentGeneration) return;
			const naturalViewport = firstPage.getViewport({ scale: 1.0, rotation: firstPage.rotate });
			this.currentScale = Math.max(
				MIN_SCALE,
				Math.min(MAX_SCALE, this.pageWidth / naturalViewport.width)
			);
			this.eventBus.dispatch('scalechanged', { scale: this.currentScale });
		}

		// Create page views
		for (let i = 1; i <= numPages; i++) {
			const page = await pdfDocument.getPage(i);
			if (generation !== this.documentGeneration) return;
			const viewport = page.getViewport({
				scale: this.currentScale,
				rotation: this.currentRotation
			});

			const pageView = new PDFPageView({
				container: this.viewer,
				id: i,
				defaultViewport: viewport,
				eventBus: this.eventBus,
				scale: this.currentScale,
				rotation: this.currentRotation,
				linkService: this.linkService,
				imageResourcesPath: this.imageResourcesPath,
				boundingBoxes: this.boundingBoxes,
				drawMode: this.drawMode,
				drawingStyle: this.drawingStyle,
				onBoundingBoxDrawn: this.onBoundingBoxDrawn,
				onBoundingBoxClick: this.onBoundingBoxClick,
				onBoundingBoxHover: this.onBoundingBoxHover,
				createLoadingIndicator: this.createLoadingIndicator
			});

			pageView.setPdfPage(page);
			this.sourcePages.push(pageView);
			if (this.regionInput !== null) pageView.div.remove();

			// Emit page dimensions for each page (unscaled, but with page rotation applied)
			// Use page.rotate so dimensions match the visual layout (e.g., landscape pages show as landscape)
			const unscaledViewport = page.getViewport({ scale: 1.0, rotation: page.rotate });
			this.pageSizes.push({ width: unscaledViewport.width, height: unscaledViewport.height });
			this.eventBus.dispatch('pagedimensions', {
				pageNumber: i,
				width: unscaledViewport.width,
				height: unscaledViewport.height
			});
		}

		this.eventBus.dispatch('pagesloaded', { pagesCount: numPages });
		if (this.regionInput !== null) {
			await this.replaceFragments(
				initialFragments(this.regionInput, this.pageSizes, this.contextPadding)
			);
			return;
		}
		this.pages = this.sourcePages;

		this.rebuildPageOffsets();
		this.updateVisiblePages();
	}

	private rebuildPageOffsets(): void {
		this.pageOffsets = this.pages.map((p) => this.pageTop(p));
	}

	private pageTop(page: PDFPageView): number {
		return (
			page.div.getBoundingClientRect().top -
			this.container.getBoundingClientRect().top -
			this.container.clientTop +
			this.container.scrollTop
		);
	}

	/** Refresh page visibility after the containing surface changes size. */
	refreshLayout(): void {
		if (
			this.transitionActive &&
			this.transitionViewport.width === this.container.clientWidth &&
			this.transitionViewport.height === this.container.clientHeight
		)
			return;
		this.finishTransition?.();
		this.rebuildPageOffsets();
		this.updateVisiblePages();
	}

	private readingPosition(): { index: number; fraction: number } | null {
		if (!this.pages.length) return null;
		const index = this.getVisiblePages().first;
		const page = this.pages[index];
		return { index, fraction: (this.container.scrollTop - this.pageTop(page)) / page.height };
	}

	private restoreReadingPosition(position: { index: number; fraction: number } | null): void {
		if (!position) return;
		const page = this.pages[position.index];
		if (page) this.container.scrollTop = this.pageTop(page) + position.fraction * page.height;
	}

	private getVisiblePages(): { first: number; last: number } {
		const offsets = this.pageOffsets;
		const n = this.pages.length;

		if (offsets.length !== n) return { first: 0, last: 0 };

		const containerTop = this.container.scrollTop;
		const containerBottom = containerTop + this.container.clientHeight;

		let lo = 0;
		let hi = n - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (offsets[mid] < containerBottom) lo = mid;
			else hi = mid - 1;
		}
		const last = lo;

		let first = last;
		while (first > 0 && offsets[first - 1] + this.pages[first - 1].height > containerTop) {
			first--;
		}

		return { first, last };
	}

	private updateVisiblePages(): void {
		if (!this.pdfDocument || this.pages.length === 0) return;

		const visible = this.getVisiblePages();
		const startPage = Math.max(0, visible.first - PAGES_TO_PRERENDER);
		const endPage = Math.min(this.pages.length - 1, visible.last + PAGES_TO_PRERENDER);

		// If jump target is already rendered, clear it
		if (this.jumpTargetIdx !== null) {
			const jp = this.pages[this.jumpTargetIdx];
			if (!jp || jp.renderingState !== RenderingStates.INITIAL) this.jumpTargetIdx = null;
		}

		// Rebuild queue: jump target first, then visible pages, then prerender buffer
		this.renderingQueue.clear();
		if (this.jumpTargetIdx !== null) this.renderingQueue.add(this.jumpTargetIdx);
		for (let i = visible.first; i <= visible.last; i++) {
			if (i !== this.jumpTargetIdx && this.pages[i].renderingState === RenderingStates.INITIAL)
				this.renderingQueue.add(i);
		}
		for (let i = startPage; i < visible.first; i++) {
			if (i !== this.jumpTargetIdx && this.pages[i].renderingState === RenderingStates.INITIAL)
				this.renderingQueue.add(i);
		}
		for (let i = visible.last + 1; i <= endPage; i++) {
			if (i !== this.jumpTargetIdx && this.pages[i].renderingState === RenderingStates.INITIAL)
				this.renderingQueue.add(i);
		}

		// Capture displayPage before processRenderingQueue clears jumpTargetIdx
		const displayPage = this.pages[this.jumpTargetIdx ?? visible.first].id;
		this.renderVersion++;
		this.processRenderingQueue();

		this.eventBus.dispatch('updateviewarea', {
			location: {
				pageNumber: displayPage,
				scale: this.currentScale,
				rotation: this.currentRotation
			}
		});
	}

	private async processRenderingQueue(): Promise<void> {
		if (this.isRendering || this.renderingQueue.size === 0) return;

		this.isRendering = true;
		const myVersion = this.renderVersion;
		try {
			while (this.renderingQueue.size > 0) {
				if (this.renderVersion !== myVersion) break;
				const pageIndex = this.renderingQueue.values().next().value as number;
				this.renderingQueue.delete(pageIndex);

				const page = this.pages[pageIndex];
				if (page && page.renderingState === RenderingStates.INITIAL) {
					try {
						await page.draw();
						if (page.renderError && this.pages.includes(page) && this.regionInput !== null) {
							this.regionError = page.renderError.message;
							this.publishRegions();
						}
					} catch (error) {
						if (this.regionInput !== null) {
							this.regionError =
								error instanceof Error ? error.message : 'Could not render this passage.';
							this.publishRegions();
						}
					}
				}
			}
		} finally {
			this.isRendering = false;
			if (this.renderingQueue.size > 0) this.processRenderingQueue();
		}
	}

	get scale(): number {
		return this.currentScale;
	}

	set scale(value: number) {
		const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
		if (newScale === this.currentScale) return;

		this.finishTransition?.();
		const position = this.readingPosition();
		this.currentScale = newScale;
		this.layoutVersion++;

		// Update all pages
		for (const page of this.pages) {
			page.update({ scale: newScale });
		}

		this.restoreReadingPosition(position);
		this.eventBus.dispatch('scalechanged', { scale: newScale });
		this.rebuildPageOffsets();
		this.updateVisiblePages();
	}

	get rotation(): number {
		return this.currentRotation;
	}

	set rotation(value: number) {
		const newRotation = ((value % 360) + 360) % 360;
		if (newRotation === this.currentRotation) return;

		const position = this.readingPosition();
		this.finishTransition?.();
		this.currentRotation = newRotation;
		this.layoutVersion++;

		// Update all pages
		for (const page of this.pages) {
			page.update({ rotation: newRotation });
			const part = this.regionParts.find((p) => p.view === page);
			if (part) page.updateBoundingBoxes(this.boxesForFragment(part.fragment));
		}

		this.restoreReadingPosition(position);
		this.rebuildPageOffsets();
		this.eventBus.dispatch('rotationchanged', { rotation: newRotation });
		this.updateVisiblePages();
	}

	zoomIn(): void {
		this.scale = this.currentScale + DEFAULT_SCALE_DELTA;
	}

	zoomOut(): void {
		this.scale = this.currentScale - DEFAULT_SCALE_DELTA;
	}

	rotateClockwise(): void {
		this.rotation = this.currentRotation + 90;
	}

	rotateCounterClockwise(): void {
		this.rotation = this.currentRotation - 90;
	}

	scrollToPage(pageNumber: number): void {
		if (this.regionInput !== null) {
			void this.revealPage(pageNumber);
			return;
		}
		if (pageNumber < 1 || pageNumber > this.pages.length) return;

		this.jumpTargetIdx = pageNumber - 1;
		this.container.scrollTo({
			top: this.pageTop(this.pages[this.jumpTargetIdx]),
			behavior: 'instant'
		});
		this.updateVisiblePages();
		this.eventBus.dispatch('pagechanged', { pageNumber });
	}

	/**
	 * Scroll to specific coordinates and center them in the viewport
	 * @param page - Page number (1-indexed)
	 * @param x - X coordinate in PDF points (from left)
	 * @param y - Y coordinate in PDF points (from bottom, PDF coordinate system)
	 * @param scrollBehavior - Scroll behavior: "auto", "smooth", or "instant" (default: "smooth")
	 */
	scrollToCoordinates(
		page: number,
		x: number,
		y: number,
		scrollBehavior: ScrollBehavior = 'smooth'
	): void {
		if (this.regionInput !== null) {
			void this.revealCoordinates(page, x, y, scrollBehavior);
			return;
		}
		if (page < 1 || page > this.pages.length) return;

		const pageView = this.pages[page - 1];
		const containerRect = this.container.getBoundingClientRect();

		// Get the actual page's offset from the DOM (more accurate than calculating)
		const pageOffsetTop = this.pageTop(pageView);

		// Get the page dimensions (scaled)
		const pageHeight = pageView.height;

		// Convert PDF coordinates (bottom-origin) to screen coordinates (top-origin)
		// In PDF: y is measured from bottom, increasing upward
		// In Screen: y is measured from top, increasing downward
		const pointYInScreen = pageHeight - y * this.currentScale;
		const pointXInScreen = x * this.currentScale;

		// Calculate the scroll position to center the point
		const targetScrollTop = pageOffsetTop + pointYInScreen - containerRect.height / 2;
		const pageLeft =
			pageView.div.getBoundingClientRect().left -
			containerRect.left -
			this.container.clientLeft +
			this.container.scrollLeft;
		const targetScrollLeft = pageLeft + pointXInScreen - containerRect.width / 2;

		// Scroll to the target position with specified behavior
		this.container.scrollTo({
			top: targetScrollTop,
			left: targetScrollLeft,
			behavior: scrollBehavior
		});

		this.eventBus.dispatch('pagechanged', { pageNumber: page });
	}

	get pagesCount(): number {
		return this.pdfDocument?.numPages ?? 0;
	}

	get currentPageNumber(): number {
		return this.pages[this.getVisiblePages().first]?.id ?? 1;
	}

	getPageView(pageIndex: number): PDFPageView | undefined {
		return this.getPageViews(pageIndex)[0];
	}

	/**
	 * Update bounding boxes for all pages
	 * @param boxes - New array of bounding boxes
	 */
	updateBoundingBoxes(boxes: BoundingBox[]): void {
		this.boundingBoxes = boxes;
		this.layoutVersion++;
		// Update all existing pages
		for (const page of this.pages) {
			const part = this.regionParts.find((p) => p.view === page);
			page.updateBoundingBoxes(part ? this.boxesForFragment(part.fragment) : boxes);
		}
	}

	/**
	 * Update draw mode for all pages
	 * @param enabled - Whether draw mode is enabled
	 */
	updateDrawMode(enabled: boolean): void {
		this.drawMode = enabled;
		this.layoutVersion++;
		// Update all existing pages
		for (const page of this.pages) {
			page.setDrawMode(enabled);
		}
	}

	/** All displayed fragments for an original page (source indexing is zero-based internally). */
	getPageViews(pageIndex: number): PDFPageView[] {
		return this.pages.filter((p) => p.id === pageIndex + 1);
	}
	get isRegionMode(): boolean {
		return this.regionInput !== null;
	}

	async setRegions(
		regions: readonly PdfRegion[] | null | undefined,
		padding = 24,
		step = 0.2
	): Promise<void> {
		const key = regionInputKey(regions),
			changed = key !== this.regionKey || padding !== this.contextPadding;
		this.expansionStep = step;
		if (!changed) return;
		this.eventBus.dispatch('regionselectionchanged', {});
		this.regionKey = key;
		this.regionInput = regions == null ? null : regions.map((r) => ({ ...r }));
		this.contextPadding = padding;
		if (!this.pdfDocument) return;
		if (this.regionInput === null) {
			this.finishTransition?.();
			this.regionVersion++;
			this.regionPending = false;
			this.regionError = null;
			const position = this.captureSourcePosition();
			this.disposeParts(this.regionParts);
			this.regionParts = [];
			this.fragments = [];
			this.gapResize?.disconnect();
			this.viewer.style.paddingBottom = '';
			this.pages = this.sourcePages;
			for (const page of this.pages) {
				page.update({ scale: this.currentScale, rotation: this.currentRotation });
				page.updateBoundingBoxes(this.boundingBoxes);
				page.setDrawMode(this.drawMode);
			}
			this.viewer.replaceChildren(...this.pages.map((p) => p.div));
			this.publishRegions();
			this.refreshLayout();
			this.restoreSourcePosition(position);
			return;
		}
		await this.replaceFragments(initialFragments(this.regionInput, this.pageSizes, padding), false);
	}
	resetRegionExpansion(): void {
		if (this.regionInput !== null)
			void this.replaceFragments(
				initialFragments(this.regionInput, this.pageSizes, this.contextPadding)
			);
	}
	private boxesForFragment(fragment: PdfFragment): BoundingBox[] {
		return this.boundingBoxes.flatMap((box) => {
			const mapped = boxInFragment(
				box,
				fragment,
				this.pageSizes[fragment.region.page - 1],
				this.currentRotation
			);
			if (!mapped) return [];
			if (box.overlay && !box.id) mapped.id = getBoundingBoxAnchorId(box);
			this.mappedBoxes.set(mapped, box);
			return [mapped];
		});
	}
	private dividers() {
		return this.regionInput === null
			? []
			: regionDividers(
					initialFragments(this.regionInput, this.pageSizes, this.contextPadding),
					this.fragments,
					this.pageSizes
				);
	}
	private publishRegions(): void {
		const version = this.regionVersion;
		this.onRegionsChange?.({
			pending: this.regionPending,
			error: this.regionError,
			gaps: this.dividers().map((g) => ({
				...g,
				pending: this.regionPending,
				error: this.regionError,
				collapse: () => {
					if (version !== this.regionVersion || this.regionPending || !g.canCollapse) return;
					void this.replaceFragments(
						collapseRegionGap(
							this.fragments,
							{ ...g, range: g.sourceRange },
							this.pageSizes,
							initialFragments(this.regionInput!, this.pageSizes, this.contextPadding)
						)
					);
				},
				revealFromStart: () => {
					if (g.hiddenRange) this.expand(g, 'start', version);
				},
				revealFromEnd: () => {
					if (g.hiddenRange) this.expand(g, 'end', version);
				},
				revealAll: () => {
					if (g.hiddenRange) this.expand(g, 'all', version);
				}
			}))
		});
	}
	private expand(gap: RegionGap, direction: 'start' | 'end' | 'all', version: number): void {
		if (version !== this.regionVersion || this.regionPending || this.regionInput === null) return;
		void this.replaceFragments(
			expandRegionGap(this.fragments, gap, direction, this.pageSizes, this.expansionStep)
		);
	}
	private disposeParts(parts: RegionPart[]): void {
		for (const part of parts) {
			part.view.destroy();
			void part.document.destroy().catch(() => {});
		}
	}
	private async replaceFragments(
		fragments: PdfFragment[],
		preservePosition = true,
		isCurrent: () => boolean = () => true
	): Promise<boolean> {
		this.finishTransition?.();
		this.finishTransition = null;
		const version = ++this.regionVersion,
			original = this.pdfDocument;
		if (!original) return false;
		let position = preservePosition ? this.captureSourcePosition() : null;
		this.regionPending = true;
		this.regionError = null;
		this.publishRegions();
		const created: RegionPart[] = [],
			next: RegionPart[] = [];
		const staging = document.createElement('div');
		staging.dataset.regionStaging = '';
		staging.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none';
		this.viewer.append(staging);
		try {
			if (fragments.length && !this.regionGenerator) {
				const generator = import('$lib/pdf-viewer/regionPdf.js').then((m) =>
					m.RegionPdfSource.create(original)
				);
				this.regionGenerator = generator;
				void generator.catch(() => {
					if (this.regionGenerator === generator) this.regionGenerator = null;
				});
			}
			let preparedHeight = 0;
			for (const fragment of fragments) {
				if (version !== this.regionVersion || !isCurrent()) return false;
				const reused = this.regionParts.find((p) => p.fragment.id === fragment.id);
				if (reused) {
					next.push({ ...reused, fragment });
					continue;
				}
				const generated = await (await this.regionGenerator!).generate(fragment);
				if (version !== this.regionVersion || !isCurrent()) return false;
				const js = await getPdfJs();
				if (!js) throw new Error('PDF regions require a browser.');
				const doc = await js.getDocument({
					data: generated.bytes,
					worker: getPdfWorker() ?? undefined
				}).promise;
				if (version !== this.regionVersion || !isCurrent()) {
					await doc.destroy();
					return false;
				}
				let view: PDFPageView;
				try {
					const page = await doc.getPage(1);
					view = new PDFPageView({
						container: staging,
						id: fragment.region.page,
						eventBus: this.eventBus,
						defaultViewport: page.getViewport({
							scale: this.currentScale,
							rotation: this.currentRotation
						}),
						scale: this.currentScale,
						rotation: this.currentRotation,
						boundingBoxes: this.boxesForFragment(fragment),
						drawMode: this.drawMode,
						drawingStyle: this.drawingStyle,
						onBoundingBoxDrawn: (box) =>
							this.onBoundingBoxDrawn?.(drawnBoxInSource(box, fragment, this.currentRotation)),
						onBoundingBoxClick: this.onBoundingBoxClick
							? (box) => this.onBoundingBoxClick?.(this.mappedBoxes.get(box) ?? box)
							: undefined,
						onBoundingBoxHover: this.onBoundingBoxHover
							? (box) => this.onBoundingBoxHover?.(box ? (this.mappedBoxes.get(box) ?? box) : null)
							: undefined,
						createLoadingIndicator: this.createLoadingIndicator,
						sourceTextContent: generated.textContent,
						sourceAppearance: generated.appearance,
						linkService: this.linkService,
						imageResourcesPath: this.imageResourcesPath,
						clipText: true
					});
					view.setPdfPage(page);
				} catch (error) {
					await doc.destroy();
					throw error;
				}
				view.div.dataset.sourceMin = String(fragment.region.y_min);
				view.div.dataset.sourceMax = String(fragment.region.y_max);
				view.div.dataset.fragmentId = fragment.id;
				view.div.setAttribute('aria-label', 'Page ' + fragment.region.page);
				view.div.style.overflow = 'hidden';
				const part = { fragment, view, document: doc };
				created.push(part);
				next.push(part);
				// Prepare only nearby content. The existing queue renders the remaining strips on demand.
				if (
					preparedHeight < this.container.clientHeight ||
					fragment.region.page === position?.page
				) {
					const renderStart = performance.now();
					await view.draw();
					if (view.renderingState !== RenderingStates.FINISHED)
						throw new Error('Could not render this passage.');
					view.div.dataset.renderMs = String(performance.now() - renderStart);
				}
				view.div.dataset.generationMs = String(generated.generationMs);
				preparedHeight += view.height;
			}
			if (version !== this.regionVersion || !isCurrent()) return false;
			// Toolbar changes may happen while a new strip is being generated or rendered.
			let layoutVersion: number;
			do {
				layoutVersion = this.layoutVersion;
				for (const part of created) {
					part.view.update({ scale: this.currentScale, rotation: this.currentRotation });
					part.view.updateBoundingBoxes(this.boxesForFragment(part.fragment));
					part.view.setDrawMode(this.drawMode);
					if (part.view.renderingState === RenderingStates.RUNNING) await part.view.draw();
					if (part.view.renderError) throw part.view.renderError;
				}
				if (version !== this.regionVersion || !isCurrent()) return false;
			} while (layoutVersion !== this.layoutVersion);
			// Read again while the previous DOM is mounted: the reader may have scrolled during loading.
			position = preservePosition ? this.captureSourcePosition() : null;
			this.gapResize?.disconnect();
			const retained = new Set(next.map((p) => p.view));
			const before: RegionSnapshot[] = this.regionParts.map((p) => ({
				fragment: p.fragment,
				element: p.view.div,
				rect: p.view.div.getBoundingClientRect()
			}));
			const retired = this.regionParts.filter((p) => !retained.has(p.view));
			let released = false;
			const retire = () => {
				if (released) return;
				released = true;
				this.transitionActive = false;
				this.disposeParts(retired);
			};
			// Own outgoing resources before yielding to a potentially suspended animation frame.
			this.finishTransition = retire;
			const gapRects = new Map(
				Array.from(this.viewer.querySelectorAll<HTMLElement>('.pdf-region-gap')).map((el) => [
					el.dataset.gapId!,
					el.getBoundingClientRect()
				])
			);
			for (const page of this.sourcePages) page.reset();
			this.regionParts = next;
			this.fragments = fragments;
			this.pages = next.map((p) => p.view);
			const gaps = this.dividers(),
				nodes: HTMLElement[] = [];
			const addGap = (g: RegionGap) => {
				const wrapper = document.createElement('div');
				wrapper.className = 'pdf-region-gap';
				wrapper.dataset.gapId = g.id;
				const slot = document.createElement('slot');
				slot.name = g.id;
				wrapper.append(slot);
				nodes.push(wrapper);
			};
			for (const part of next) {
				for (const gap of gaps.filter(
					(g) => g.after?.id === part.fragment.id && g.before?.id !== part.fragment.id
				))
					addGap(gap);
				const label = document.createElement('div');
				label.className = 'pdf-region-page-label';
				label.textContent = 'Page ' + part.fragment.region.page;
				nodes.push(label, part.view.div);
				for (const gap of gaps.filter(
					(g) => g.before?.id === part.fragment.id && (!g.after || g.after.id === part.fragment.id)
				))
					addGap(gap);
			}

			this.viewer.style.paddingBottom = '';
			this.viewer.replaceChildren(...nodes);
			this.regionPending = false;
			this.publishRegions();
			// Let Svelte mount/update the light DOM gap content before restoring the source anchor.
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			if (version !== this.regionVersion || !isCurrent()) {
				retire();
				return false;
			}
			this.rebuildPageOffsets();
			this.updateVisiblePages();
			this.restoreSourcePosition(position);
			if (!preservePosition) this.container.scrollTop = 0;
			this.lastReadingPosition = this.captureSourcePosition();
			// A resize may have cancelled and released this transition during the layout frame.
			if (!released) {
				this.transitionActive = true;
				this.transitionViewport = {
					width: this.container.clientWidth,
					height: this.container.clientHeight
				};
				this.finishTransition = animateRegionChange(
					this.viewer,
					before,
					next.map((p) => ({
						fragment: p.fragment,
						element: p.view.div,
						rect: p.view.div.getBoundingClientRect()
					})),
					retired.map((p) => p.view.div),
					preservePosition ? this.regionTransitionDuration : 0,
					this.currentRotation,
					retire,
					gapRects
				);
			}
			const gapHeights = new Map(
				nodes.filter((n) => n.classList.contains('pdf-region-gap')).map((n) => [n, n.offsetHeight])
			);
			this.gapResize = new ResizeObserver((entries) => {
				if (
					!entries.some(
						(e) =>
							gapHeights.get(e.target as HTMLElement) !== (e.target as HTMLElement).offsetHeight
					)
				)
					return;
				for (const entry of entries)
					gapHeights.set(entry.target as HTMLElement, (entry.target as HTMLElement).offsetHeight);
				this.finishTransition?.();
				this.restoreSourcePosition(this.lastReadingPosition);
				this.refreshLayout();
				this.container.dispatchEvent(new Event('pdf-layout-change'));
			});
			for (const node of nodes)
				if (node.classList.contains('pdf-region-gap')) this.gapResize.observe(node);
			this.eventBus.dispatch('regionlayoutchanged', {});
			return true;
		} catch (error) {
			if (version === this.regionVersion && isCurrent()) {
				this.regionError =
					error instanceof Error ? error.message : 'Could not reveal this passage.';
				this.regionPending = false;
				this.publishRegions();
			}
			return false;
		} finally {
			if (version === this.regionVersion && !isCurrent()) {
				this.regionPending = false;
				this.publishRegions();
			}
			staging.remove();
			this.disposeParts(
				created.filter((p) => !this.regionParts.some((active) => active.view === p.view))
			);
		}
	}
	private captureSourcePosition(): SourceReadingPosition | null {
		const top = this.container.getBoundingClientRect().top + this.container.clientTop;
		const view = this.pages.find((p) => p.div.getBoundingClientRect().bottom > top);
		if (!view) return null;
		const rect = view.div.getBoundingClientRect();
		if (!rect.height || !rect.width) return null;
		const screenY = Math.max(top, rect.top) - top;
		const point = {
			page: view.id,
			x_min: 50,
			x_max: 50,
			y_min: ((top + screenY - rect.top) / rect.height) * 100,
			y_max: ((top + screenY - rect.top) / rect.height) * 100
		};
		const part = this.regionParts.find((p) => p.view === view);
		const source = part
			? drawnBoxInSource(point, part.fragment, this.currentRotation)
			: { ...point, ...rotateRect(point, -this.currentRotation) };
		return { page: view.id, x: source.x_min, y: source.y_min, screenY };
	}
	private restoreSourcePosition(inputPosition: SourceReadingPosition | null): void {
		if (!inputPosition) return;
		let position = inputPosition;
		let part = this.regionParts.find(
			(p) =>
				p.fragment.region.page === position.page &&
				p.fragment.region.y_min <= position.y + 1e-8 &&
				p.fragment.region.y_max >= position.y - 1e-8
		);
		if (!part && this.regionParts.length) {
			const nearest = nearestFragmentPosition(this.fragments, position);
			if (nearest) {
				part = this.regionParts.find((p) => p.fragment.id === nearest.fragment.id);
				position = { ...position, ...nearest.position };
			}
		}
		const view = part?.view ?? this.pages.find((p) => p.id === position.page);
		if (!view) return;
		const r = part?.fragment.region ?? { y_min: 0, y_max: 100 };
		const point = rotateRect(
			{
				x_min: position.x,
				x_max: position.x,
				y_min: ((position.y - r.y_min) / (r.y_max - r.y_min)) * 100,
				y_max: ((position.y - r.y_min) / (r.y_max - r.y_min)) * 100
			},
			this.currentRotation
		);
		const target =
			this.pageTop(view) +
			(point.y_min / 100) * view.div.getBoundingClientRect().height -
			position.screenY;
		const max = this.container.scrollHeight - this.container.clientHeight;
		if (target > max)
			this.viewer.style.paddingBottom =
				(parseFloat(this.viewer.style.paddingBottom) || 0) + (target - max) + 'px';
		this.container.scrollTop = Math.max(0, target);
	}
	private async revealPage(page: number): Promise<void> {
		if (!this.pageSizes[page - 1]) return;
		const full = initialFragments(
			[{ id: 'navigation', page, y_min: 0, y_max: 100 }],
			this.pageSizes,
			0
		).map((f) => ({ ...f, regionIds: [] }));
		if (
			!(await this.replaceFragments(mergeFragments([...this.fragments, ...full], this.pageSizes)))
		)
			return;
		this.finishTransition?.();
		const view = this.getPageViews(page - 1)[0];
		if (view) {
			this.container.scrollTop = this.pageTop(view);
			this.refreshLayout();
			this.lastReadingPosition = this.captureSourcePosition();
		}
	}
	private async revealCoordinates(
		page: number,
		x: number,
		y: number,
		behavior: ScrollBehavior
	): Promise<void> {
		const size = this.pageSizes[page - 1];
		if (!size) return;
		const top = (1 - y / size.height) * 100;
		await this.revealSourceRange(page, top, top, (x / size.width) * 100, behavior);
	}
	async revealSourceRange(
		page: number,
		top: number,
		bottom: number,
		x = 50,
		behavior: ScrollBehavior = 'instant',
		isCurrent: () => boolean = () => true
	): Promise<void> {
		if (!this.pageSizes[page - 1] || !isCurrent()) return;
		if (this.regionInput !== null) {
			const contained = this.fragments.some(
				(f) => f.region.page === page && f.region.y_min <= top && f.region.y_max >= bottom
			);
			if (!contained) {
				const added = initialFragments(
					[
						{
							id: 'navigation',
							page,
							y_min: Math.max(0, top - 0.01),
							y_max: Math.min(100, Math.max(top + 0.01, bottom))
						}
					],
					this.pageSizes,
					this.contextPadding
				).map((f) => ({ ...f, regionIds: [] }));
				if (
					!(await this.replaceFragments(
						mergeFragments([...this.fragments, ...added], this.pageSizes),
						true,
						isCurrent
					))
				)
					return;
			}
		}
		if (!isCurrent()) return;
		this.finishTransition?.();
		const part = this.regionParts.find(
			(p) =>
				p.fragment.region.page === page &&
				p.fragment.region.y_min <= top &&
				p.fragment.region.y_max >= top
		);
		const view = part?.view ?? this.getPageViews(page - 1)[0];
		if (!view) return;
		this.restoreSourcePosition({ page, x, y: top, screenY: this.container.clientHeight / 2 });
		this.refreshLayout();
		await view.draw();
		if (!isCurrent()) return;
		this.lastReadingPosition = this.captureSourcePosition();
		// The source anchor is already centered; use the requested behavior for horizontal navigation.
		const r = view.div.getBoundingClientRect(),
			container = this.container.getBoundingClientRect();
		this.container.scrollTo({
			left:
				this.container.scrollLeft +
				r.left -
				container.left +
				(x / 100) * r.width -
				container.width / 2,
			behavior
		});
	}

	cleanup(): void {
		this.finishTransition?.();
		this.finishTransition = null;
		this.documentGeneration++;
		this.regionVersion++;
		this.gapResize?.disconnect();
		this.gapResize = null;
		this.disposeParts(this.regionParts);
		this.regionParts = [];
		this.fragments = [];
		this.regionGenerator = null;
		this.pageSizes = [];
		this.regionPending = false;
		this.regionError = null;
		this.lastReadingPosition = null;
		this.pageOffsets = [];
		// Cancel all rendering
		for (const page of this.sourcePages) {
			page.destroy();
		}
		this.pages = [];
		this.sourcePages = [];
		this.renderingQueue.clear();

		// Clear viewer
		this.viewer.innerHTML = '';

		this.pdfDocument = null;
	}

	destroy(): void {
		this.scrollAbortController?.abort();
		this.cleanup();
		this.eventBus.destroy();
		this.viewer.remove();
	}
}
