// Reexport your entry components here
export {
	default as PdfViewer,
	Renderer as PdfRenderer,
	ThumbnailViewer as PdfThumbnailViewer
} from './PdfViewer.svelte';

// Export types from context (PdfSource is the canonical source)
export type { PdfSource, TextHighlightData } from './pdf-viewer/context.js';

// Export context for custom toolbars
export {
	getPdfViewerContext,
	PresentationModeState,
	type PdfViewerState,
	type PdfViewerActions,
	type PdfViewerContext,
	type PageDimensions,
	type DrawingStyle
} from './pdf-viewer/context.js';

// Export bounding box types and utilities
export type {
	BoundingBox,
	NormalizedBoundingBox,
	DrawnBoundingBox
} from './pdf-viewer/BoundingBoxLayer.js';
export { convertNormalizedBoundingBoxes } from './pdf-viewer/BoundingBoxLayer.js';

// Render consumer-provided content beside a page rectangle or registered bounding box.
export { default as PdfAnchoredOverlay } from './PdfAnchoredOverlay.svelte';
export type { PdfOverlayAnchor, PdfOverlayPlacementOptions } from './pdf-viewer/overlayAnchor.js';

// Export PDF.js singleton utilities
export { configurePdfWorker, destroyPdfJs } from './pdf-viewer/pdfjs-singleton.js';
