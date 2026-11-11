// Verify full-source search navigation and cancellation independently of rendered visibility.
import { expect, it, vi } from 'vitest';
import { FindController } from '$lib/pdf-viewer/FindController.js';
import { EventBus } from '$lib/pdf-viewer/EventBus.js';
import type { PDFViewerCore } from '$lib/pdf-viewer/PDFViewerCore.js';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
function setup(gate = Promise.resolve()) {
	const destinations: number[][] = [];
	const viewer = {
		pagesCount: 2,
		getPageViews: () => [],
		container: document.createElement('div'),
		revealSourceRange: async (...args: number[]) => {
			destinations.push(args);
		}
	} as unknown as PDFViewerCore;
	const bus = new EventBus(),
		find = new FindController(viewer, bus);
	find.setDocument({
		numPages: 2,
		getPage: async (page: number) => ({
			getViewport: () => ({
				height: 800,
				convertToViewportPoint: (x: number, y: number) => [x, 800 - y]
			}),
			getTextContent: async () => {
				await gate;
				return {
					items: [
						{
							str: page === 1 ? 'Other text' : 'hidden evidence',
							transform: [12, 0, 0, 12, 48, 400],
							width: 80,
							fontName: 'f'
						}
					],
					styles: { f: { ascent: 1, descent: -0.2 } }
				};
			}
		})
	} as unknown as PDFDocumentProxy);
	return { find, bus, destinations };
}
it('searches hidden source pages and reveals the matching passage bounds', async () => {
	const { find, destinations } = setup();
	await find.find({ query: 'hidden evidence' });
	await vi.waitFor(() => expect(destinations).toHaveLength(1));
	expect(find.matchesCount).toEqual({ current: 1, total: 1 });
	expect(destinations[0][0]).toBe(2);
	expect(destinations[0][1]).toBeCloseTo(48.5);
	expect(destinations[0][2]).toBeCloseTo(50.3);
});
it('does not resurrect a search cleared while source extraction is pending', async () => {
	let release!: () => void;
	const { find, destinations } = setup(new Promise<void>((resolve) => (release = resolve)));
	const searching = find.find({ query: 'hidden evidence' });
	find.reset();
	release();
	await searching;
	expect(find.matchesCount).toEqual({ current: 0, total: 0 });
	expect(destinations).toEqual([]);
});
