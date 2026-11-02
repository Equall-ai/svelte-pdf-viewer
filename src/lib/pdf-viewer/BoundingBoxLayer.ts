/**
 * BoundingBoxLayer - Renders bounding boxes on PDF pages
 * Handles coordinate transformations and respects zoom/rotation
 */
import type { PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Normalized bounding box with percentage-based coordinates (0-100) */
export interface NormalizedBoundingBox {
	/** Page number (1-indexed) */
	page: number;
	/** Minimum X coordinate (0-100, percentage of page width) */
	x_min: number;
	/** Maximum X coordinate (0-100, percentage of page width) */
	x_max: number;
	/** Minimum Y coordinate (0-100, percentage of page height, from top) */
	y_min: number;
	/** Maximum Y coordinate (0-100, percentage of page height, from top) */
	y_max: number;
	/** Optional border color (CSS color string) */
	borderColor?: string;
	/** Optional fill color (CSS color string) */
	fillColor?: string;
	/** Optional opacity (0-1) */
	opacity?: number;
	/** Optional border width in pixels */
	borderWidth?: number;
	/** Optional border style (default: 'solid') */
	borderStyle?: 'solid' | 'dashed' | 'dotted';
	/** Optional border radius in pixels */
	borderRadius?: number;
	/** Optional custom class name for styling */
	className?: string;
	/** Optional ID for programmatic access */
	id?: string;
}

/** Result from drawing a bounding box in draw mode */
export interface DrawnBoundingBox {
	/** Page number (1-indexed) */
	page: number;
	/** Minimum X coordinate (0-100, percentage of page width) */
	x_min: number;
	/** Maximum X coordinate (0-100, percentage of page width) */
	x_max: number;
	/** Minimum Y coordinate (0-100, percentage of page height, from top) */
	y_min: number;
	/** Maximum Y coordinate (0-100, percentage of page height, from top) */
	y_max: number;
}

/** Bounding box definition with coordinates and optional styles */
export interface BoundingBox {
	/** Page number (1-indexed) */
	page: number;
	/** X coordinate in points (origin at bottom-left of the visual page, after page rotation) */
	x: number;
	/** Y coordinate in points (origin at bottom-left of the visual page, after page rotation) */
	y: number;
	/** Width in points */
	width: number;
	/** Height in points */
	height: number;
	/** Optional border color (CSS color string) */
	borderColor?: string;
	/** Optional fill color (CSS color string) */
	fillColor?: string;
	/** Optional opacity (0-1) */
	opacity?: number;
	/** Optional border width in pixels */
	borderWidth?: number;
	/** Optional border style (default: 'solid') */
	borderStyle?: 'solid' | 'dashed' | 'dotted';
	/** Optional border radius in pixels */
	borderRadius?: number;
	/** Optional custom class name for styling */
	className?: string;
	/** Optional ID for programmatic access */
	id?: string;
	/** Show close button in top right corner */
	showClose?: boolean;
	/** Optional snippet for custom close button (receives close callback and box data) */
	closeButton?: import('svelte').Snippet<[{ close: () => void; box: BoundingBox }]>;
	/** Custom content anchored above this box, rendered outside the PDF shadow root. */
	overlay?: import('svelte').Snippet<[{ box: BoundingBox; visible: boolean }]>;
	/** Placement defaults to top/end with a six-pixel gap, flipping/clamping into the viewport. */
	overlayPlacement?: import('./overlayAnchor.js').PdfOverlayPlacementOptions;
}

const generatedBoxIds = new WeakMap<BoundingBox, string>();

/** Identify rendered native boxes without requiring consumers to assign IDs. */
export function getBoundingBoxAnchorId(box: BoundingBox): string {
	if (box.id) return box.id;
	let id = generatedBoxIds.get(box);
	if (!id) {
		id = `pdf-overlay-${crypto.randomUUID()}`;
		generatedBoxIds.set(box, id);
	}
	return id;
}

/** Options for BoundingBoxLayer construction */
export interface BoundingBoxLayerOptions {
	/** Container element to append the layer to */
	container: HTMLElement;
	/** PDF viewport for coordinate transformation */
	viewport: PageViewport;
	/** Array of bounding boxes to render */
	boxes: BoundingBox[];
	/** Page number this layer belongs to */
	pageNumber: number;
	/** Callback when a bounding box is clicked */
	onBoundingBoxClick?: (box: BoundingBox) => void;
	/** Callback when a bounding box is hovered */
	onBoundingBoxHover?: (box: BoundingBox | null) => void;
}

/** Default styles for bounding boxes */
const DEFAULT_STYLES = {
	borderColor: '#ff0000',
	fillColor: 'transparent',
	opacity: 1.0,
	borderWidth: 2
} as const;

/**
 * BoundingBoxLayer renders bounding boxes on a PDF page
 * Similar to AnnotationLayer but specifically for custom overlays
 */
export class BoundingBoxLayer {
	private container: HTMLElement;
	private viewport: PageViewport;
	private boxes: BoundingBox[];
	private pageNumber: number;
	private layerDiv: HTMLDivElement | null = null;
	private boxElements: Map<string, HTMLDivElement> = new Map();
	private onBoundingBoxClick?: (box: BoundingBox) => void;
	private onBoundingBoxHover?: (box: BoundingBox | null) => void;

	constructor(options: BoundingBoxLayerOptions) {
		this.container = options.container;
		this.onBoundingBoxClick = options.onBoundingBoxClick;
		this.onBoundingBoxHover = options.onBoundingBoxHover;
		this.viewport = options.viewport;
		this.boxes = options.boxes;
		this.pageNumber = options.pageNumber;
	}

	/**
	 * Render all bounding boxes for this page
	 */
	render(): void {
		// Create layer div if it doesn't exist
		if (!this.layerDiv) {
			this.layerDiv = document.createElement('div');
			this.layerDiv.className = 'boundingBoxLayer';
			this.container.appendChild(this.layerDiv);
		}

		// Clear existing boxes
		this.clear();

		// Filter boxes for this page only
		const pageBoxes = this.boxes.filter((box) => box.page === this.pageNumber);

		// Render each box
		for (const box of pageBoxes) {
			this.renderBox(box);
		}
	}

	/**
	 * Render a single bounding box
	 */
	private renderBox(box: BoundingBox): void {
		if (!this.layerDiv) return;

		const boxDiv = document.createElement('div');
		boxDiv.className = `boundingBox ${box.className || ''}`.trim();
		if (box.id || box.overlay) {
			boxDiv.setAttribute('data-box-id', getBoundingBoxAnchorId(box));
		}

		// Transform coordinates to viewport pixels
		// Box coordinates are in the visual coordinate space (after page rotation),
		// with origin at bottom-left. Scale to viewport pixels and flip Y to top-origin.
		const scale = this.viewport.scale;
		const left = box.x * scale;
		const top = this.viewport.height - (box.y + box.height) * scale;
		const width = box.width * scale;
		const height = box.height * scale;

		// Apply positioning
		boxDiv.style.position = 'absolute';
		boxDiv.style.left = `${left}px`;
		boxDiv.style.top = `${top}px`;
		boxDiv.style.width = `${width}px`;
		boxDiv.style.height = `${height}px`;

		// Apply styles
		const borderColor = box.borderColor ?? DEFAULT_STYLES.borderColor;
		const fillColor = box.fillColor ?? DEFAULT_STYLES.fillColor;
		const opacity = box.opacity ?? DEFAULT_STYLES.opacity;
		const borderWidth = box.borderWidth ?? DEFAULT_STYLES.borderWidth;
		const borderStyle = box.borderStyle ?? 'solid';

		boxDiv.style.border = `${borderWidth}px ${borderStyle} ${borderColor}`;
		boxDiv.style.backgroundColor = fillColor;
		boxDiv.style.opacity = String(opacity);
		const hasInteraction = this.onBoundingBoxClick || this.onBoundingBoxHover;
		boxDiv.style.pointerEvents = hasInteraction ? 'auto' : 'none';
		boxDiv.style.boxSizing = 'border-box';
		boxDiv.style.borderRadius = `${box.borderRadius || 0}px`;
		if (hasInteraction) {
			boxDiv.style.cursor = 'pointer';
		}

		// Add interaction event listeners
		if (this.onBoundingBoxClick) {
			const clickHandler = this.onBoundingBoxClick;
			boxDiv.addEventListener('click', (e) => {
				e.stopPropagation();
				clickHandler(box);
			});
		}
		if (this.onBoundingBoxHover) {
			const hoverHandler = this.onBoundingBoxHover;
			boxDiv.addEventListener('mouseenter', () => {
				hoverHandler(box);
			});
			boxDiv.addEventListener('mouseleave', () => {
				hoverHandler(null);
			});
		}

		this.layerDiv.appendChild(boxDiv);

		// Store reference if box has an ID
		if (box.id) {
			this.boxElements.set(box.id, boxDiv);
		}
	}

	/**
	 * Update the layer with new viewport (for zoom/rotation changes)
	 */
	update(viewport: PageViewport, boxes?: BoundingBox[]): void {
		this.viewport = viewport;
		if (boxes !== undefined) {
			this.boxes = boxes;
		}
		this.render();
	}

	/**
	 * Clear all rendered boxes
	 */
	private clear(): void {
		if (this.layerDiv) {
			this.layerDiv.innerHTML = '';
		}
		this.boxElements.clear();
	}

	/**
	 * Destroy the layer and clean up
	 */
	destroy(): void {
		this.clear();
		if (this.layerDiv) {
			this.layerDiv.remove();
			this.layerDiv = null;
		}
		this.boxElements.clear();
	}

	/**
	 * Get a box element by ID
	 */
	getBoxElement(id: string): HTMLDivElement | undefined {
		return this.boxElements.get(id);
	}
}

/**
 * Convert normalized bounding boxes (0-100 percentage) to PDF coordinate space
 * @param normalizedBoxes - Array of normalized bounding boxes
 * @param pageWidth - Width of the PDF page in points
 * @param pageHeight - Height of the PDF page in points
 * @returns Array of bounding boxes in PDF coordinate space
 */
export function convertNormalizedBoundingBoxes(
	normalizedBoxes: NormalizedBoundingBox[],
	pageWidth: number,
	pageHeight: number
): BoundingBox[] {
	return normalizedBoxes.map((box) => {
		// Convert percentage (0-100) to PDF points
		const x_min_points = (box.x_min / 100) * pageWidth;
		const x_max_points = (box.x_max / 100) * pageWidth;
		const y_min_points = (box.y_min / 100) * pageHeight;
		const y_max_points = (box.y_max / 100) * pageHeight;

		// Note: y_min/y_max are typically from top in screen coordinates
		// We need to convert to PDF coordinates (origin at bottom-left)
		// So y_min from top = pageHeight - y_min_points
		const width = x_max_points - x_min_points;
		const height = y_max_points - y_min_points;

		return {
			page: box.page,
			x: x_min_points,
			// Convert from top-origin to bottom-origin
			y: pageHeight - y_max_points,
			width,
			height,
			borderColor: box.borderColor,
			fillColor: box.fillColor,
			opacity: box.opacity,
			borderWidth: box.borderWidth,
			borderStyle: box.borderStyle,
			borderRadius: box.borderRadius,
			className: box.className,
			id: box.id
		};
	});
}
