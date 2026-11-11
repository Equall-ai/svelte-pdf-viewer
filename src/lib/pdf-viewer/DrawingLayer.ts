/**
 * DrawingLayer - Handles drawing bounding boxes on PDF pages
 */
import type { PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DrawnBoundingBox } from './BoundingBoxLayer.js';
import type { DrawingStyle } from './context.js';

export interface DrawingLayerOptions {
	/** Container element to append the layer to */
	container: HTMLElement;
	/** PDF viewport for coordinate transformation */
	viewport: PageViewport;
	/** Page number this layer belongs to */
	pageNumber: number;
	/** Drawing style configuration */
	drawingStyle: DrawingStyle;
	/** Callback when a box is drawn */
	onBoxDrawn: (box: DrawnBoundingBox) => void;
	/** Function to check if draw mode is enabled */
	isDrawModeEnabled: () => boolean;
}

/** Default drawing styles */
const DEFAULT_DRAWING_STYLE: Required<DrawingStyle> = {
	borderColor: '#0000ff',
	borderWidth: 2,
	borderStyle: 'dashed',
	fillColor: 'rgba(0, 0, 255, 0.1)',
	opacity: 1.0
} as const;

/**
 * DrawingLayer manages the interactive drawing of bounding boxes on a PDF page
 */
export class DrawingLayer {
	private container: HTMLElement;
	private viewport: PageViewport;
	private pageNumber: number;
	private drawingStyle: DrawingStyle;
	private onBoxDrawn: (box: DrawnBoundingBox) => void;
	private isDrawModeEnabled: () => boolean;

	private layerDiv: HTMLDivElement | null = null;
	private isDrawing = false;
	private detachListeners: (() => void) | null = null;
	private startX = 0;
	private startY = 0;
	private currentBox: HTMLDivElement | null = null;

	constructor(options: DrawingLayerOptions) {
		this.container = options.container;
		this.viewport = options.viewport;
		this.pageNumber = options.pageNumber;
		this.drawingStyle = options.drawingStyle;
		this.onBoxDrawn = options.onBoxDrawn;
		this.isDrawModeEnabled = options.isDrawModeEnabled;
	}

	/**
	 * Initialize the drawing layer
	 */
	init(): void {
		if (this.layerDiv) return;

		this.layerDiv = document.createElement('div');
		this.layerDiv.className = 'drawingLayer';
		this.layerDiv.style.position = 'absolute';
		this.layerDiv.style.top = '0';
		this.layerDiv.style.left = '0';
		this.layerDiv.style.width = '100%';
		this.layerDiv.style.height = '100%';
		this.layerDiv.style.pointerEvents = 'none'; // Default: no interaction
		this.layerDiv.style.zIndex = '100'; // Above other layers

		this.container.appendChild(this.layerDiv);

		// Add event listeners to the layer
		this.setupEventListeners();
	}

	/**
	 * Setup mouse event listeners for drawing
	 */
	private setupEventListeners(): void {
		if (!this.layerDiv) return;

		const onMouseDown = (e: MouseEvent) => {
			if (!this.isDrawModeEnabled()) return;

			this.isDrawing = true;
			const rect = this.layerDiv!.getBoundingClientRect();
			this.startX = e.clientX - rect.left;
			this.startY = e.clientY - rect.top;

			// Create the drawing box
			this.currentBox = document.createElement('div');
			this.currentBox.style.position = 'absolute';
			this.currentBox.style.left = `${this.startX}px`;
			this.currentBox.style.top = `${this.startY}px`;
			this.currentBox.style.width = '0px';
			this.currentBox.style.height = '0px';
			this.currentBox.style.boxSizing = 'border-box';
			this.currentBox.style.pointerEvents = 'none';

			// Apply drawing styles
			const borderColor = this.drawingStyle.borderColor ?? DEFAULT_DRAWING_STYLE.borderColor;
			const borderWidth = this.drawingStyle.borderWidth ?? DEFAULT_DRAWING_STYLE.borderWidth;
			const borderStyle = this.drawingStyle.borderStyle ?? DEFAULT_DRAWING_STYLE.borderStyle;
			const fillColor = this.drawingStyle.fillColor ?? DEFAULT_DRAWING_STYLE.fillColor;
			const opacity = this.drawingStyle.opacity ?? DEFAULT_DRAWING_STYLE.opacity;

			this.currentBox.style.border = `${borderWidth}px ${borderStyle} ${borderColor}`;
			this.currentBox.style.backgroundColor = fillColor;
			this.currentBox.style.opacity = String(opacity);

			this.layerDiv!.appendChild(this.currentBox);
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!this.isDrawing || !this.currentBox || !this.isDrawModeEnabled()) return;

			const rect = this.layerDiv!.getBoundingClientRect();
			const currentX = e.clientX - rect.left;
			const currentY = e.clientY - rect.top;

			const width = Math.abs(currentX - this.startX);
			const height = Math.abs(currentY - this.startY);
			const left = Math.min(this.startX, currentX);
			const top = Math.min(this.startY, currentY);

			this.currentBox.style.left = `${left}px`;
			this.currentBox.style.top = `${top}px`;
			this.currentBox.style.width = `${width}px`;
			this.currentBox.style.height = `${height}px`;
		};

		const onMouseUp = (e: MouseEvent) => {
			if (!this.isDrawing || !this.currentBox || !this.isDrawModeEnabled()) return;

			this.isDrawing = false;

			const rect = this.layerDiv!.getBoundingClientRect();
			const currentX = e.clientX - rect.left;
			const currentY = e.clientY - rect.top;

			const width = Math.abs(currentX - this.startX);
			const height = Math.abs(currentY - this.startY);

			// Only create box if it has some size
			if (width > 5 && height > 5) {
				const left = Math.min(this.startX, currentX);
				const top = Math.min(this.startY, currentY);

				// Convert viewport coordinates to normalized coordinates (0-100)
				const pageWidth = this.viewport.width;
				const pageHeight = this.viewport.height;

				const x_min = (left / pageWidth) * 100;
				const x_max = ((left + width) / pageWidth) * 100;
				const y_min = (top / pageHeight) * 100;
				const y_max = ((top + height) / pageHeight) * 100;

				const drawnBox: DrawnBoundingBox = {
					page: this.pageNumber,
					x_min,
					x_max,
					y_min,
					y_max
				};

				this.onBoxDrawn(drawnBox);
			}

			// Remove the temporary box
			if (this.currentBox) {
				this.currentBox.remove();
				this.currentBox = null;
			}
		};

		// Attach listeners to the layer div
		this.layerDiv.addEventListener('mousedown', onMouseDown);
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);

		// Store event cleanup
		this.detachListeners = () => {
			this.layerDiv?.removeEventListener('mousedown', onMouseDown);
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};
	}

	/**
	 * Enable or disable draw mode
	 */
	setDrawMode(enabled: boolean): void {
		if (!this.layerDiv) return;
		this.layerDiv.style.pointerEvents = enabled ? 'auto' : 'none';
		this.layerDiv.style.cursor = enabled ? 'crosshair' : 'default';
	}

	/**
	 * Update the viewport (for zoom/rotation changes)
	 */
	update(viewport: PageViewport): void {
		this.viewport = viewport;
	}

	/**
	 * Destroy the layer and clean up
	 */
	destroy(): void {
		this.detachListeners?.();
		this.detachListeners = null;
		if (this.currentBox) {
			this.currentBox.remove();
			this.currentBox = null;
		}

		if (this.layerDiv) {
			this.layerDiv.remove();
			this.layerDiv = null;
		}

		this.isDrawing = false;
	}
}
