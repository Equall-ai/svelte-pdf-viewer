// Exercise real PDF embedding with offset and rotated source page geometry.
import { expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { RegionPdfSource } from '$lib/pdf-viewer/regionPdf.js';
it('normalizes a rotated offset CropBox and preserves source text order', async () => {
	const input = await PDFDocument.create();
	const font = await input.embedFont(StandardFonts.Helvetica);
	const page = input.addPage([700, 900]);
	page.setCropBox(50, 100, 600, 800);
	page.drawText('Visible text', { x: 100, y: 200, font, size: 12 });
	const bytes = await input.save();
	let reads = 0;
	const source = {
		getData: async () => {
			reads++;
			return bytes.slice();
		},
		getPage: async () => ({
			getAnnotations: async () => [],
			view: [50, 100, 650, 900],
			userUnit: 1,
			getViewport: () => ({ width: 800, height: 600, transform: [0, 1, 1, 0, -100, -50] }),
			getTextContent: async () => ({
				items: [
					{ str: 'Visible text', transform: [12, 0, 0, 12, 100, 200], width: 60, height: 12 }
				],
				styles: {},
				lang: null
			})
		})
	} as unknown as PDFDocumentProxy;
	const generator = await RegionPdfSource.create(source);
	const first = await generator.generate({
		id: '1:0:50',
		region: { page: 1, y_min: 0, y_max: 50 },
		regionIds: ['a']
	});
	const pdf = await PDFDocument.load(first.bytes);
	expect(pdf.getPage(0).getSize()).toEqual({ width: 800, height: 300 });
	const text = await first.textContent();
	expect(text.items[0]).toMatchObject({
		str: 'Visible text',
		transform: [0, -12, 12, -0, 100, 250]
	});
	await generator.generate({
		id: '1:50:100',
		region: { page: 1, y_min: 50, y_max: 100 },
		regionIds: []
	});
	expect(reads).toBe(1);
});
it('retains the original annotated page and maps its viewport into the strip', async () => {
	const pdf = await PDFDocument.create();
	pdf.addPage([600, 800]);
	const bytes = await pdf.save();
	const source = {
		getData: async () => bytes,
		getPage: async () => ({
			rotate: 0,
			userUnit: 1,
			view: [0, 0, 600, 800],
			getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
			getAnnotations: async () => [{ annotationType: 20 }]
		})
	} as unknown as PDFDocumentProxy;
	const generator = await RegionPdfSource.create(source);
	const generated = await generator.generate({
		id: 'a',
		region: { page: 1, y_min: 25, y_max: 50 },
		regionIds: ['a']
	});
	expect(generated.appearance).toBeDefined();
	const viewport = {
		scale: 1,
		rotation: 0,
		transform: [1, 0, 0, -1, 0, 200]
	} as import('pdfjs-dist/legacy/build/pdf.mjs').PageViewport;
	expect(generated.appearance!.transform(viewport)).toEqual([1, 0, 0, 1, 0, -200]);
	expect(generated.appearance!.includes([0, 450, 50, 500])).toBe(true);
	expect(generated.appearance!.includes([0, 700, 50, 750])).toBe(false);
});
