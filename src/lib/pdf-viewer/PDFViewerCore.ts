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

// Number of pages to render around the visible ones
const PAGES_TO_PRERENDER = 2;

export class PDFViewerCore {
	readonly container: HTMLElement;
	readonly viewer: HTMLDivElement;
	readonly eventBus: EventBus;

	private pdfDocument: PDFDocumentProxy | null = null;
	private pages: PDFPageView[] = [];
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
					});
				}
			},
			{ passive: true, signal: this.scrollAbortController.signal }
		);
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

		this.rebuildPageOffsets();
		this.updateVisiblePages();
	}

	private rebuildPageOffsets(): void {
		this.pageOffsets = this.pages.map((p) => p.div.offsetTop);
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
		const displayPage = this.jumpTargetIdx !== null ? this.jumpTargetIdx + 1 : visible.first + 1;
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
					} catch (_) {}
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

		this.currentScale = newScale;

		// Update all pages
		for (const page of this.pages) {
			page.update({ scale: newScale });
		}

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

		this.jumpTargetIdx = pageNumber - 1;
		this.pages[this.jumpTargetIdx].div.scrollIntoView({ behavior: 'instant', block: 'start' });
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
		return this.getVisiblePages().first + 1;
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
