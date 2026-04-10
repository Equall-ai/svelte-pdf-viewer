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
import type { BoundingBox, DrawnBoundingBox } from './BoundingBoxLayer.js';
import type { DrawingStyle } from './context.js';

export interface PDFViewerOptions {
	container: HTMLElement;
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

export class PDFViewerCore {
	readonly container: HTMLElement;
	readonly viewer: HTMLDivElement;
	readonly eventBus: EventBus;

	private pdfDocument: PDFDocumentProxy | null = null;
	private pages: PDFPageView[] = [];
	private currentScale: number;
	private currentRotation: number;
	private scrollAbortController: AbortController | null = null;
	private renderingQueue: number[] = [];
	private isRendering = false;

	// IntersectionObserver for visible page tracking
	private pageObserver: IntersectionObserver | null = null;
	private visiblePageIndices: Set<number> = new Set();

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

	// Loading indicator factory
	private createLoadingIndicator?: () => HTMLElement;

	constructor(options: PDFViewerOptions) {
		this.container = options.container;
		this.eventBus = options.eventBus ?? new EventBus();
		this.currentScale = options.initialScale ?? DEFAULT_SCALE;
		this.currentRotation = options.initialRotation ?? 0;
		this.pageWidth = options.pageWidth;
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
		this.container.appendChild(this.viewer);

		// Create link service for annotation navigation
		this.linkService = new SimpleLinkService({
			eventBus: this.eventBus
		});

		// Setup scroll listener for current page tracking
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
						this.emitCurrentPage();
					});
				}
			},
			{ passive: true, signal: this.scrollAbortController.signal }
		);
	}

	private setupPageObserver(): void {
		this.pageObserver?.disconnect();

		this.pageObserver = new IntersectionObserver(
			(entries) => {
				let changed = false;
				for (const entry of entries) {
					const idx = parseInt(entry.target.getAttribute('data-page-index') ?? '', 10);
					if (isNaN(idx)) continue;

					if (entry.isIntersecting) {
						if (!this.visiblePageIndices.has(idx)) {
							this.visiblePageIndices.add(idx);
							changed = true;
						}
					} else {
						if (this.visiblePageIndices.has(idx)) {
							this.visiblePageIndices.delete(idx);
							changed = true;
						}
					}
				}
				if (changed) {
					this.updateVisiblePages();
				}
			},
			{
				root: this.container,
				// Pre-render pages slightly before they scroll into view
				rootMargin: '200% 0px'
			}
		);

		for (let i = 0; i < this.pages.length; i++) {
			const page = this.pages[i];
			page.div.setAttribute('data-page-index', String(i));
			this.pageObserver.observe(page.div);
		}
	}

	/** Emit current page number based on visible pages (for UI updates) */
	private emitCurrentPage(): void {
		if (this.visiblePageIndices.size === 0) return;
		const firstVisible = Math.min(...this.visiblePageIndices);
		this.eventBus.dispatch('updateviewarea', {
			location: {
				pageNumber: firstVisible + 1,
				scale: this.currentScale,
				rotation: this.currentRotation
			}
		});
	}

	async setDocument(pdfDocument: PDFDocumentProxy): Promise<void> {
		// Cleanup previous document
		this.cleanup();

		this.pdfDocument = pdfDocument;
		const numPages = pdfDocument.numPages;

		// Setup link service with document and viewer
		this.linkService.setDocument(pdfDocument);
		this.linkService.setViewer(this);

		// If pageWidth is set, compute scale from first page's natural width
		if (this.pageWidth !== undefined) {
			const firstPage = await pdfDocument.getPage(1);
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
				boundingBoxes: this.boundingBoxes,
				drawMode: this.drawMode,
				drawingStyle: this.drawingStyle,
				onBoundingBoxDrawn: this.onBoundingBoxDrawn,
				onBoundingBoxClick: this.onBoundingBoxClick,
				onBoundingBoxHover: this.onBoundingBoxHover,
				createLoadingIndicator: this.createLoadingIndicator
			});

			pageView.setPdfPage(page);
			this.pages.push(pageView);

			// Emit page dimensions for each page (unscaled, but with page rotation applied)
			// Use page.rotate so dimensions match the visual layout (e.g., landscape pages show as landscape)
			const unscaledViewport = page.getViewport({ scale: 1.0, rotation: page.rotate });
			this.eventBus.dispatch('pagedimensions', {
				pageNumber: i,
				width: unscaledViewport.width,
				height: unscaledViewport.height
			});
		}

		this.eventBus.dispatch('pagesloaded', { pagesCount: numPages });

		// Setup observer to detect visible pages and trigger rendering
		this.setupPageObserver();
	}

	private updateVisiblePages(): void {
		if (!this.pdfDocument || this.pages.length === 0) return;

		// Queue visible pages that need rendering
		for (const idx of this.visiblePageIndices) {
			const page = this.pages[idx];
			if (page && page.renderingState === RenderingStates.INITIAL) {
				this.renderingQueue.push(idx);
			}
		}

		this.processRenderingQueue();
		this.emitCurrentPage();
	}

	private async processRenderingQueue(): Promise<void> {
		if (this.isRendering || this.renderingQueue.length === 0) return;

		this.isRendering = true;

		while (this.renderingQueue.length > 0) {
			// Sort by proximity to the center of visible pages so nearby pages render first
			const visibleCenter = this.getVisibleCenter();
			this.renderingQueue.sort((a, b) => Math.abs(a - visibleCenter) - Math.abs(b - visibleCenter));

			// Render up to 3 pages concurrently
			const batch: Promise<void>[] = [];
			const batchSize = Math.min(3, this.renderingQueue.length);
			const batchIndices = this.renderingQueue.splice(0, batchSize);

			for (const pageIndex of batchIndices) {
				const page = this.pages[pageIndex];
				if (page && page.renderingState === RenderingStates.INITIAL) {
					batch.push(page.draw());
				}
			}

			if (batch.length > 0) {
				await Promise.all(batch);
			}
		}

		this.isRendering = false;
	}

	/** Get the center index of visible pages for priority sorting */
	private getVisibleCenter(): number {
		if (this.visiblePageIndices.size === 0) return 0;
		let sum = 0;
		for (const idx of this.visiblePageIndices) {
			sum += idx;
		}
		return sum / this.visiblePageIndices.size;
	}

	get scale(): number {
		return this.currentScale;
	}

	set scale(value: number) {
		const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
		if (newScale === this.currentScale) return;

		this.currentScale = newScale;

		// Update all pages
		for (const page of this.pages) {
			page.update({ scale: newScale });
		}

		this.eventBus.dispatch('scalechanged', { scale: newScale });
		this.updateVisiblePages();
	}

	get rotation(): number {
		return this.currentRotation;
	}

	set rotation(value: number) {
		const newRotation = ((value % 360) + 360) % 360;
		if (newRotation === this.currentRotation) return;

		this.currentRotation = newRotation;

		// Update all pages
		for (const page of this.pages) {
			page.update({ rotation: newRotation });
		}

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
		if (pageNumber < 1 || pageNumber > this.pages.length) return;

		const pageView = this.pages[pageNumber - 1];
		pageView.div.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
		if (page < 1 || page > this.pages.length) return;

		const pageView = this.pages[page - 1];
		const containerRect = this.container.getBoundingClientRect();

		// Get the actual page's offset from the DOM (more accurate than calculating)
		const pageOffsetTop = pageView.div.offsetTop;

		// Get the page dimensions (scaled)
		const pageHeight = pageView.height;

		// Convert PDF coordinates (bottom-origin) to screen coordinates (top-origin)
		// In PDF: y is measured from bottom, increasing upward
		// In Screen: y is measured from top, increasing downward
		const pointYInScreen = pageHeight - y * this.currentScale;
		const pointXInScreen = x * this.currentScale;

		// Calculate the scroll position to center the point
		const targetScrollTop = pageOffsetTop + pointYInScreen - containerRect.height / 2;
		const targetScrollLeft = pointXInScreen - containerRect.width / 2;

		// Scroll to the target position with specified behavior
		this.container.scrollTo({
			top: targetScrollTop,
			left: targetScrollLeft,
			behavior: scrollBehavior
		});

		this.eventBus.dispatch('pagechanged', { pageNumber: page });
	}

	get pagesCount(): number {
		return this.pages.length;
	}

	get currentPageNumber(): number {
		if (this.visiblePageIndices.size === 0) return 1;
		return Math.min(...this.visiblePageIndices) + 1;
	}

	getPageView(pageIndex: number): PDFPageView | undefined {
		return this.pages[pageIndex];
	}

	/**
	 * Update bounding boxes for all pages
	 * @param boxes - New array of bounding boxes
	 */
	updateBoundingBoxes(boxes: BoundingBox[]): void {
		this.boundingBoxes = boxes;
		// Update all existing pages
		for (const page of this.pages) {
			page.updateBoundingBoxes(boxes);
		}
	}

	/**
	 * Update draw mode for all pages
	 * @param enabled - Whether draw mode is enabled
	 */
	updateDrawMode(enabled: boolean): void {
		this.drawMode = enabled;
		// Update all existing pages
		for (const page of this.pages) {
			page.setDrawMode(enabled);
		}
	}

	cleanup(): void {
		// Cancel all rendering
		for (const page of this.pages) {
			page.destroy();
		}
		this.pages = [];
		this.renderingQueue.length = 0;
		this.visiblePageIndices.clear();

		// Clear viewer
		this.viewer.innerHTML = '';

		this.pdfDocument = null;
	}

	destroy(): void {
		this.scrollAbortController?.abort();
		this.pageObserver?.disconnect();
		this.pageObserver = null;
		this.cleanup();
		this.eventBus.destroy();
		this.viewer.remove();
	}
}
