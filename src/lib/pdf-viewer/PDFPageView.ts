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
 * PDFPageView - Renders a single PDF page with canvas, text layer, and annotation layer.
 * This is a derivative work based on PDF.js pdf_page_view.js
 */
import type { PDFPageProxy, PageViewport, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { EventBus } from './EventBus.js';
import { AnnotationLayerBuilder } from './AnnotationLayerBuilder.js';
import type { SimpleLinkService } from './SimpleLinkService.js';
import { BoundingBoxLayer, type BoundingBox, type DrawnBoundingBox } from './BoundingBoxLayer.js';
import { DrawingLayer } from './DrawingLayer.js';
import type { DrawingStyle } from './context.js';

// Dynamically loaded pdfjs utilities
let setLayerDimensions: typeof import('pdfjs-dist/legacy/build/pdf.mjs').setLayerDimensions;

async function ensurePdfJsLoaded() {
	if (!setLayerDimensions) {
		const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
		setLayerDimensions = pdfjs.setLayerDimensions;
	}
}

export interface PDFPageViewOptions {
	container: HTMLElement;
	id: number;
	defaultViewport: PageViewport;
	eventBus: EventBus;
	scale?: number;
	rotation?: number;
	linkService?: SimpleLinkService;
	boundingBoxes?: BoundingBox[];
	drawMode?: boolean;
	drawingStyle?: DrawingStyle;
	onBoundingBoxDrawn?: (box: DrawnBoundingBox) => void;
	onBoundingBoxClick?: (box: BoundingBox) => void;
	onBoundingBoxHover?: (box: BoundingBox | null) => void;
	/** Factory that creates a loading indicator element for each page. If omitted, no loading indicator is shown. */
	createLoadingIndicator?: () => HTMLElement;
}

export const RenderingStates = {
	INITIAL: 0,
	RUNNING: 1,
	PAUSED: 2,
	FINISHED: 3
} as const;

export type RenderingState = (typeof RenderingStates)[keyof typeof RenderingStates];

export class PDFPageView {
	readonly id: number;
	readonly eventBus: EventBus;

	private container: HTMLElement;
	private viewport: PageViewport;
	private pdfPage: PDFPageProxy | null = null;
	private scale: number;
	private rotation: number;
	private pdfPageRotate: number = 0;

	public div: HTMLDivElement;
	private canvas: HTMLCanvasElement | null = null;
	private canvasWrapper: HTMLDivElement | null = null;
	private textLayerDiv: HTMLDivElement | null = null;
	private loadingDiv: HTMLElement | null = null;

	// Annotation layer
	private linkService: SimpleLinkService | null = null;
	private annotationLayerBuilder: AnnotationLayerBuilder | null = null;
	private annotationLayerRendered = false;

	// Bounding box layer
	private boundingBoxLayer: BoundingBoxLayer | null = null;
	private boundingBoxes: BoundingBox[] = [];
	private boundingBoxLayerRendered = false;

	// Drawing layer
	private drawingLayer: DrawingLayer | null = null;
	private drawMode: boolean;
	private drawingStyle: DrawingStyle;
	private onBoundingBoxDrawn?: (box: DrawnBoundingBox) => void;
	private onBoundingBoxClick?: (box: BoundingBox) => void;
	private onBoundingBoxHover?: (box: BoundingBox | null) => void;

	public renderingState: RenderingState = RenderingStates.INITIAL;
	private renderTask: ReturnType<PDFPageProxy['render']> | null = null;

	// Text layer instance for updates
	private textLayer: TextLayer | null = null;
	private textLayerRendered = false;

	// Text layer data for search
	public textDivs: HTMLElement[] = [];
	public textContentItemsStr: string[] = [];

	constructor(options: PDFPageViewOptions) {
		this.id = options.id;
		this.container = options.container;
		this.eventBus = options.eventBus;
		this.scale = options.scale ?? 1.0;
		this.rotation = options.rotation ?? 0;
		this.viewport = options.defaultViewport;
		this.linkService = options.linkService ?? null;
		this.boundingBoxes = options.boundingBoxes ?? [];
		this.drawMode = options.drawMode ?? false;
		this.drawingStyle = options.drawingStyle ?? {};
		this.onBoundingBoxDrawn = options.onBoundingBoxDrawn;
		this.onBoundingBoxClick = options.onBoundingBoxClick;
		this.onBoundingBoxHover = options.onBoundingBoxHover;

		// Create page container
		this.div = document.createElement('div');
		this.div.className = 'page';
		this.div.setAttribute('data-page-number', String(this.id));
		this.div.setAttribute('role', 'region');

		this.setDimensions();
		this.container.appendChild(this.div);

		// Add loading indicator if a factory was provided
		if (options.createLoadingIndicator) {
			this.loadingDiv = options.createLoadingIndicator();
			this.div.appendChild(this.loadingDiv);
		}
	}

	private async setDimensions(): Promise<void> {
		const { width, height } = this.viewport;
		this.div.style.width = `${Math.floor(width)}px`;
		this.div.style.height = `${Math.floor(height)}px`;

		// Set CSS variables for text layer scaling
		// viewport.scale already includes our scale factor
		this.div.style.setProperty('--scale-factor', String(this.viewport.scale));

		// Set rotation attribute for text layer
		const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
		this.div.setAttribute('data-main-rotation', String(totalRotation));

		// Update text layer dimensions if it exists
		// mustFlip=false because the text layer uses raw page coordinates
		// and rotation is handled via CSS transforms
		if (this.textLayerDiv) {
			await ensurePdfJsLoaded();
			setLayerDimensions(this.textLayerDiv, this.viewport, /* mustFlip */ false);
		}
	}

	setPdfPage(pdfPage: PDFPageProxy): void {
		this.pdfPage = pdfPage;
		this.pdfPageRotate = pdfPage.rotate;
		this.updateViewport();
	}

	private updateViewport(): void {
		if (!this.pdfPage) return;

		const totalRotation = (this.rotation + this.pdfPageRotate) % 360;
		this.viewport = this.pdfPage.getViewport({
			scale: this.scale,
			rotation: totalRotation
		});
		this.setDimensions();
	}

	update({ scale, rotation }: { scale?: number; rotation?: number }): void {
		if (scale !== undefined) {
			this.scale = scale;
		}
		if (rotation !== undefined) {
			this.rotation = rotation;
		}
		this.updateViewport();

		// Re-render if already rendered
		if (this.renderingState === RenderingStates.FINISHED) {
			// Update text layer - TextLayer.update() handles both scale and rotation
			// Rotation is applied via CSS transforms based on data-main-rotation attribute
			if (this.textLayer && this.textLayerRendered && this.textLayerDiv) {
				this.textLayerDiv.hidden = true;
				this.textLayer.update({
					viewport: this.viewport
				});
				this.textLayerDiv.hidden = false;
			}
			// Update annotation layer
			if (this.annotationLayerBuilder && this.annotationLayerRendered) {
				this.annotationLayerBuilder.update(this.viewport);
			}
			// Update bounding box layer
			if (this.boundingBoxLayer && this.boundingBoxLayerRendered) {
				this.boundingBoxLayer.update(this.viewport, this.boundingBoxes);
			}
			// Re-render canvas
			this.resetCanvas();
			this.draw();
		}
	}

	private resetCanvas(): void {
		this.cancelRendering();
		this.renderingState = RenderingStates.INITIAL;

		// Clear canvas only
		if (this.canvas) {
			this.canvas.width = 0;
			this.canvas.height = 0;
			this.canvas.remove();
			this.canvas = null;
		}
		if (this.canvasWrapper) {
			this.canvasWrapper.remove();
			this.canvasWrapper = null;
		}
	}

	reset(): void {
		this.cancelRendering();
		this.renderingState = RenderingStates.INITIAL;

		// Clear canvas
		if (this.canvas) {
			this.canvas.width = 0;
			this.canvas.height = 0;
			this.canvas.remove();
			this.canvas = null;
		}
		if (this.canvasWrapper) {
			this.canvasWrapper.remove();
			this.canvasWrapper = null;
		}

		// Clear text layer
		if (this.textLayerDiv) {
			this.textLayerDiv.remove();
			this.textLayerDiv = null;
		}
		this.textLayer = null;
		this.textLayerRendered = false;
		this.textDivs = [];
		this.textContentItemsStr = [];

		// Clear annotation layer
		if (this.annotationLayerBuilder) {
			this.annotationLayerBuilder.destroy();
			this.annotationLayerBuilder = null;
		}
		this.annotationLayerRendered = false;

		// Clear bounding box layer
		if (this.boundingBoxLayer) {
			this.boundingBoxLayer.destroy();
			this.boundingBoxLayer = null;
		}
		this.boundingBoxLayerRendered = false;

		// Show loading
		if (this.loadingDiv) {
			this.loadingDiv.style.display = '';
		}
	}

	async draw(): Promise<void> {
		if (!this.pdfPage || this.renderingState !== RenderingStates.INITIAL) {
			return;
		}

		this.renderingState = RenderingStates.RUNNING;

		try {
			// Hide loading indicator
			if (this.loadingDiv) {
				this.loadingDiv.style.display = 'none';
			}

			// Create canvas wrapper
			this.canvasWrapper = document.createElement('div');
			this.canvasWrapper.className = 'canvasWrapper';
			this.div.appendChild(this.canvasWrapper);

			// Create and render canvas
			this.canvas = document.createElement('canvas');
			this.canvas.className = 'pdf-canvas';
			this.canvasWrapper.appendChild(this.canvas);

			const outputScale = window.devicePixelRatio || 1;
			const { width, height } = this.viewport;

			this.canvas.width = Math.floor(width * outputScale);
			this.canvas.height = Math.floor(height * outputScale);
			this.canvas.style.width = `${Math.floor(width)}px`;
			this.canvas.style.height = `${Math.floor(height)}px`;

			const ctx = this.canvas.getContext('2d')!;
			ctx.scale(outputScale, outputScale);

			this.renderTask = this.pdfPage.render({
				canvasContext: ctx,
				viewport: this.viewport,
				canvas: this.canvas
			});

			await this.renderTask.promise;
			this.renderTask = null;

			// Render text layer, annotation layer, and bounding boxes in parallel
			// since they are independent of each other
			const layerPromises: Promise<void>[] = [];

			if (!this.textLayerRendered) {
				layerPromises.push(this.renderTextLayer());
			}
			if (!this.annotationLayerRendered) {
				layerPromises.push(this.renderAnnotationLayer());
			}

			await Promise.all(layerPromises);

			// Bounding box layer and drawing layer are synchronous
			if (!this.boundingBoxLayerRendered) {
				this.renderBoundingBoxLayer();
			}
			if (this.drawMode) {
				this.initDrawingLayer();
			}

			this.renderingState = RenderingStates.FINISHED;
			this.eventBus.dispatch('pagerendered', {
				pageNumber: this.id,
				source: this
			});
		} catch (error) {
			if ((error as Error).name === 'RenderingCancelledException') {
				return;
			}
			this.renderingState = RenderingStates.INITIAL;
			console.error('Error rendering page:', error);
		}
	}

	private async renderTextLayer(): Promise<void> {
		if (!this.pdfPage) return;

		// If text layer already rendered, just update it
		if (this.textLayerRendered && this.textLayer && this.textLayerDiv) {
			this.textLayerDiv.hidden = true;
			this.textLayer.update({ viewport: this.viewport });
			this.textLayerDiv.hidden = false;
			return;
		}

		// Create text layer div
		this.textLayerDiv = document.createElement('div');
		this.textLayerDiv.className = 'textLayer';
		this.div.appendChild(this.textLayerDiv);

		try {
			// Import TextLayer from pdfjs-dist
			const [{ TextLayer }] = await Promise.all([
				import('pdfjs-dist/legacy/build/pdf.mjs'),
				ensurePdfJsLoaded()
			]);

			// Check if reset() was called during the await
			if (!this.textLayerDiv || !this.pdfPage) return;

			const textContent = await this.pdfPage.getTextContent();

			// Check again after await - reset() may have been called
			if (!this.textLayerDiv) return;

			this.textDivs = [];
			this.textContentItemsStr = [];

			// Set text layer dimensions using PDF.js utility
			// mustFlip=false because text layer uses raw page coordinates
			// and rotation is handled via CSS transforms
			setLayerDimensions(this.textLayerDiv, this.viewport, /* mustFlip */ false);

			// Use PDF.js TextLayer for proper positioning
			this.textLayer = new TextLayer({
				textContentSource: textContent,
				container: this.textLayerDiv,
				viewport: this.viewport
			});

			await this.textLayer.render();

			// Check again after render - reset() may have been called
			if (!this.textLayerDiv) return;

			this.textLayerRendered = true;

			// Collect text divs and their content for search highlighting
			// We extract text from the rendered spans to ensure 1:1 correspondence
			// between textDivs and textContentItemsStr
			const spans = this.textLayerDiv.querySelectorAll('span:not(.markedContent)');
			spans.forEach((span) => {
				this.textDivs.push(span as HTMLElement);
				this.textContentItemsStr.push(span.textContent || '');
			});

			this.eventBus.dispatch('textlayerrendered', {
				pageNumber: this.id,
				source: this
			});
		} catch (error) {
			console.error('Error rendering text layer:', error);
		}
	}

	private async renderAnnotationLayer(): Promise<void> {
		if (!this.pdfPage || !this.linkService) {
			return;
		}

		// If annotation layer already rendered, just update it
		if (this.annotationLayerRendered && this.annotationLayerBuilder) {
			this.annotationLayerBuilder.update(this.viewport);
			return;
		}

		try {
			this.annotationLayerBuilder = new AnnotationLayerBuilder({
				pdfPage: this.pdfPage,
				linkService: this.linkService,
				renderForms: true,
				onAppend: (div) => {
					this.div.appendChild(div);
				}
			});

			await this.annotationLayerBuilder.render({
				viewport: this.viewport
			});
			this.annotationLayerRendered = true;

			this.eventBus.dispatch('annotationlayerrendered', {
				pageNumber: this.id,
				source: this
			});
		} catch (error) {
			console.error('Error rendering annotation layer:', error);
		}
	}

	private renderBoundingBoxLayer(): void {
		// If bounding box layer already rendered, just update it
		if (this.boundingBoxLayerRendered && this.boundingBoxLayer) {
			this.boundingBoxLayer.update(this.viewport, this.boundingBoxes);
			return;
		}

		// Only render if we have boxes for this page
		const pageBoxes = this.boundingBoxes.filter((box) => box.page === this.id);
		if (pageBoxes.length === 0) {
			return;
		}

		try {
			this.boundingBoxLayer = new BoundingBoxLayer({
				container: this.div,
				viewport: this.viewport,
				boxes: this.boundingBoxes,
				pageNumber: this.id,
				onBoundingBoxClick: this.onBoundingBoxClick,
				onBoundingBoxHover: this.onBoundingBoxHover
			});

			this.boundingBoxLayer.render();
			this.boundingBoxLayerRendered = true;

			this.eventBus.dispatch('boundingboxlayerrendered', {
				pageNumber: this.id,
				source: this
			});
		} catch (error) {
			console.error('Error rendering bounding box layer:', error);
		}
	}

	cancelRendering(): void {
		if (this.renderTask) {
			this.renderTask.cancel();
			this.renderTask = null;
		}
	}

	/**
	 * Update bounding boxes for this page
	 * @param boxes - New array of bounding boxes
	 */
	updateBoundingBoxes(boxes: BoundingBox[]): void {
		this.boundingBoxes = boxes;
		if (this.boundingBoxLayer && this.boundingBoxLayerRendered) {
			this.boundingBoxLayer.update(this.viewport, this.boundingBoxes);
		} else if (this.renderingState === RenderingStates.FINISHED) {
			// Render for the first time if page is already rendered
			this.renderBoundingBoxLayer();
		}
	}

	/**
	 * Initialize or update the drawing layer
	 */
	private initDrawingLayer(): void {
		if (!this.drawingLayer && this.onBoundingBoxDrawn) {
			this.drawingLayer = new DrawingLayer({
				container: this.div,
				viewport: this.viewport,
				pageNumber: this.id,
				drawingStyle: this.drawingStyle,
				onBoxDrawn: this.onBoundingBoxDrawn,
				isDrawModeEnabled: () => this.drawMode
			});

			this.drawingLayer.init();
			this.drawingLayer.setDrawMode(this.drawMode);
		}
	}

	/**
	 * Set draw mode on/off for this page
	 * @param enabled - Whether draw mode should be enabled
	 */
	setDrawMode(enabled: boolean): void {
		this.drawMode = enabled;

		// Initialize drawing layer if needed
		if (enabled && !this.drawingLayer && this.renderingState === RenderingStates.FINISHED) {
			this.initDrawingLayer();
		}

		// Update existing drawing layer
		if (this.drawingLayer) {
			this.drawingLayer.setDrawMode(enabled);
		}
	}

	destroy(): void {
		this.cancelRendering();

		// Clean up drawing layer
		if (this.drawingLayer) {
			this.drawingLayer.destroy();
			this.drawingLayer = null;
		}

		this.reset();
		this.pdfPage?.cleanup();
		this.div.remove();
	}

	get width(): number {
		return this.viewport.width;
	}

	get height(): number {
		return this.viewport.height;
	}
}
