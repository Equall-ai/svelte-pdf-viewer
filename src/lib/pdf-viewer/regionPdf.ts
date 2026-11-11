// Lazily normalize original pages and embed vector strips, retaining original text offsets.
import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';
type TextContent = Awaited<
	ReturnType<import('pdfjs-dist/legacy/build/pdf.mjs').PDFPageProxy['getTextContent']>
>;
import type { PdfFragment } from '$lib/pdf-viewer/regions.js';
type Matrix = [number, number, number, number, number, number];
const multiply = (a: Matrix, b: number[]): Matrix => [
	a[0] * b[0] + a[2] * b[1],
	a[1] * b[0] + a[3] * b[1],
	a[0] * b[2] + a[2] * b[3],
	a[1] * b[2] + a[3] * b[3],
	a[0] * b[4] + a[2] * b[5] + a[4],
	a[1] * b[4] + a[3] * b[5] + a[5]
];
/** Keep native annotation/form appearances on the original page, cropped into a normalized strip. */
export interface RegionAppearance {
	page: PDFPageProxy;
	viewport: (target: PageViewport) => PageViewport;
	transform: (target: PageViewport) => Matrix;
	includes: (rect: number[]) => boolean;
}
function inverse(m: number[]): Matrix {
	const det = m[0] * m[3] - m[1] * m[2];
	return [
		m[3] / det,
		-m[1] / det,
		-m[2] / det,
		m[0] / det,
		(m[2] * m[5] - m[3] * m[4]) / det,
		(m[1] * m[4] - m[0] * m[5]) / det
	];
}
function appearance(
	page: PDFPageProxy,
	mapping: Matrix,
	width: number,
	height: number
): RegionAppearance {
	const viewport = (target: PageViewport) =>
		page.getViewport({ scale: target.scale, rotation: (page.rotate + target.rotation) % 360 });
	return {
		page,
		viewport,
		transform: (target) =>
			multiply(multiply(target.transform as Matrix, mapping), inverse(viewport(target).transform)),
		includes: (rect) => {
			const points = [
				[rect[0], rect[1]],
				[rect[0], rect[3]],
				[rect[2], rect[1]],
				[rect[2], rect[3]]
			].map(([x, y]) => [
				mapping[0] * x + mapping[2] * y + mapping[4],
				mapping[1] * x + mapping[3] * y + mapping[5]
			]);
			const xs = points.map((p) => p[0]),
				ys = points.map((p) => p[1]);
			return (
				Math.max(...xs) >= 0 &&
				Math.min(...xs) <= width &&
				Math.max(...ys) >= 0 &&
				Math.min(...ys) <= height
			);
		}
	};
}
export class RegionPdfSource {
	private normalized = new Map<
		number,
		Promise<{
			pdf: PDFDocument;
			width: number;
			height: number;
			transform: Matrix;
			annotated?: PDFPageProxy;
		}>
	>();
	private constructor(
		private original: PDFDocumentProxy,
		private input: PDFDocument
	) {}
	static async create(original: PDFDocumentProxy): Promise<RegionPdfSource> {
		return new RegionPdfSource(original, await PDFDocument.load(await original.getData()));
	}
	private normalize(pageNumber: number) {
		const cached = this.normalized.get(pageNumber);
		if (cached) return cached;
		const pending = (async () => {
			const original = await this.original.getPage(pageNumber);
			const annotations = await original.getAnnotations({ intent: 'display' });
			const viewport = original.getViewport({ scale: 1 });
			const [a, b, c, d, e, f] = viewport.transform;
			const transform: Matrix = [a, -b, c, -d, e, viewport.height - f];
			const [left, bottom, right, top] = original.view;
			const pdf = await PDFDocument.create();
			const page = pdf.addPage([viewport.width, viewport.height]);
			// Empty pages have no Contents stream; preserve their dimensions without embedding.
			if (!annotations.length && this.input.getPage(pageNumber - 1).node.Contents()) {
				const embedded = await pdf.embedPage(
					this.input.getPage(pageNumber - 1),
					{ left, bottom, right, top },
					transform
				);
				page.drawPage(embedded);
				await pdf.flush();
			}
			return {
				pdf,
				width: viewport.width,
				height: viewport.height,
				transform,
				annotated: annotations.length ? original : undefined
			};
		})();
		this.normalized.set(pageNumber, pending);
		void pending.catch(() => this.normalized.delete(pageNumber));
		return pending;
	}
	async generate(fragment: PdfFragment): Promise<{
		bytes: Uint8Array;
		textContent: () => Promise<TextContent>;
		generationMs: number;
		appearance?: RegionAppearance;
	}> {
		const started = performance.now();
		const r = fragment.region,
			source = await this.normalize(r.page);
		const bottom = source.height * (1 - r.y_max / 100),
			top = source.height * (1 - r.y_min / 100);
		const output = await PDFDocument.create();
		const page = output.addPage([source.width, top - bottom]);
		if (source.pdf.getPage(0).node.Contents()) {
			const embedded = await output.embedPage(source.pdf.getPage(0), {
				left: 0,
				right: source.width,
				bottom,
				top
			});
			page.drawPage(embedded);
		}
		const bytes = await output.save();
		const mapping: Matrix = [...source.transform];
		mapping[5] -= bottom;
		return {
			bytes,
			generationMs: performance.now() - started,
			appearance: source.annotated
				? appearance(source.annotated, mapping, source.width, top - bottom)
				: undefined,
			textContent: async () => {
				const original = await this.original.getPage(r.page);
				const text = await original.getTextContent();
				const transform: Matrix = [...source.transform];
				transform[5] -= bottom;
				return {
					...text,
					items: text.items.map((item) =>
						'str' in item
							? {
									...item,
									transform: multiply(transform, item.transform),
									width: item.width * original.userUnit,
									height: item.height * original.userUnit
								}
							: item
					)
				};
			}
		};
	}
}
