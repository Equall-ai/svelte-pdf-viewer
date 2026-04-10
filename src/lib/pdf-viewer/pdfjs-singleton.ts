import { BROWSER } from 'esm-env';

// Global singleton state
let pdfjsLib: typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null = null;
let pdfWorker: import('pdfjs-dist/legacy/build/pdf.mjs').PDFWorker | null = null;
let rawWorker: Worker | null = null;
let initPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null> | null = null;

// User-configured worker source URL
let configuredWorkerSrc: string | URL | undefined;

/**
 * Configure the PDF.js worker URL. Call this before mounting any PdfViewer component.
 *
 * This is required when consuming this library as a package in Vite 8+, because
 * `new URL(bare-specifier, import.meta.url)` does not resolve bare module specifiers
 * from within `node_modules`.
 *
 * @example
 * ```ts
 * // Copy pdf.worker.mjs to your static/ folder, then:
 * import { configurePdfWorker } from '@equall-ai/svelte-pdf-viewer';
 * configurePdfWorker('/pdf.worker.mjs');
 * ```
 *
 * @param workerSrc - URL or path to the PDF.js worker file (pdf.worker.mjs)
 */
export function configurePdfWorker(workerSrc: string | URL): void {
	configuredWorkerSrc = workerSrc;
}

/**
 * Get the PDF.js library instance. Creates the worker on first call.
 * Subsequent calls return the cached instance.
 */
export async function getPdfJs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs') | null> {
	if (!BROWSER) return null;

	// Return cached instance
	if (pdfjsLib && pdfWorker) return pdfjsLib;

	// If initialization is in progress, wait for it
	if (initPromise) return initPromise;

	// Start initialization
	initPromise = (async () => {
		pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

		// Use configured worker URL, or fall back to import.meta.url resolution
		// (the fallback works in dev / when the library source is served directly,
		// but may fail when consumed as a built package in Vite 8+ due to bare specifier resolution)
		const workerUrl = configuredWorkerSrc
			? configuredWorkerSrc
			: new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url);

		rawWorker = new Worker(workerUrl, { type: 'module' });
		pdfWorker = new pdfjsLib.PDFWorker({
			port: rawWorker as unknown as null
		});
		pdfjsLib.GlobalWorkerOptions.workerPort = pdfWorker.port;

		return pdfjsLib;
	})();

	return initPromise;
}

/**
 * Get the singleton PDFWorker instance.
 * Pass this to `getDocument({ worker })` so that `PDFDocumentProxy.destroy()`
 * does not destroy the shared worker.
 */
export function getPdfWorker(): import('pdfjs-dist/legacy/build/pdf.mjs').PDFWorker | null {
	return pdfWorker;
}

/**
 * Destroy the PDF.js worker and cleanup resources.
 * Call this when you're completely done with PDF viewing in your app.
 * Note: After calling this, the next getPdfJs() call will create a new worker.
 */
export function destroyPdfJs(): void {
	if (pdfWorker) {
		pdfWorker.destroy();
		pdfWorker = null;
	}
	if (rawWorker) {
		rawWorker.terminate();
		rawWorker = null;
	}
	pdfjsLib = null;
	initPromise = null;
}
