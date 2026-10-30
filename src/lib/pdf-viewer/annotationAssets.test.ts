// Exercise the real annotation layer through the viewer's page rendering pipeline.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFViewerCore } from './PDFViewerCore.js';

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe('annotation image resources', () => {
	it.each(['/datarooms/room/v2/documents/document', '/datarooms/room/builder/graph'])(
		'renders icons under the configured directory on %s',
		async (route) => {
			window.history.replaceState(null, '', route);
			vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
				scale: vi.fn(),
				measureText: () => ({ width: 0 }),
				canvas: document.createElement('canvas')
			} as unknown as CanvasRenderingContext2D);
			const viewport = {
				width: 612,
				height: 792,
				scale: 1,
				rotation: 0,
				viewBox: [0, 0, 612, 792],
				transform: [1, 0, 0, -1, 0, 792],
				rawDims: { pageWidth: 612, pageHeight: 792, pageX: 0, pageY: 0 },
				clone() {
					return this;
				}
			} as unknown as PageViewport;
			const page = {
				cleanup: vi.fn(),
				rotate: 0,
				view: [0, 0, 612, 792],
				getViewport: () => viewport,
				render: () => ({ promise: Promise.resolve(), cancel() {} }),
				getTextContent: async () => ({ items: [], styles: {} }),
				getAnnotations: async () => [
					{
						annotationType: 1,
						id: 'note',
						name: 'NoIcon',
						rect: [20, 20, 44, 44],
						rotation: 0,
						borderStyle: { width: 0 },
						contentsObj: { str: '', dir: 'ltr' },
						titleObj: { str: '', dir: 'ltr' }
					}
				]
			} as unknown as PDFPageProxy;
			const container = document.createElement('div');
			document.body.appendChild(container);
			const viewer = new PDFViewerCore({ container, imageResourcesPath: '/pdfjs/images/' });
			await viewer.setDocument({ numPages: 1, getPage: async () => page } as PDFDocumentProxy);
			try {
				await vi.waitFor(() => {
					expect(container.querySelector('.textAnnotation img')?.getAttribute('src')).toBe(
						'/pdfjs/images/annotation-noicon.svg'
					);
				});
			} finally {
				viewer.destroy();
			}
		}
	);
});
