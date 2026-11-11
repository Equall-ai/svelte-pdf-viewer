// Benchmark the real PDF.js and region-rendering pipeline on deterministic large sources.
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PDFViewerCore, type RegionViewState } from '$lib/pdf-viewer/PDFViewerCore.js';
import { getPdfJs, getPdfWorker } from '$lib/pdf-viewer/pdfjs-singleton.js';
import { rendererStyles } from '$lib/pdf-viewer/renderer-styles.js';
export interface BenchmarkResult {
	pages: number;
	kind: string;
	sourceMB: number;
	pdfJsOpenMs: number;
	initialRegionsMs: number;
	warmExpansionMs: number;
	collapseMs: number;
	maxTimerDelayMs: number;
	canvasMB: number;
	canvases: number;
}
async function fixture(pages: number, scan: boolean) {
	const pdf = await PDFDocument.create(),
		font = await pdf.embedFont(StandardFonts.Helvetica);
	const canvas = document.createElement('canvas');
	canvas.width = 600;
	canvas.height = 800;
	const ctx = canvas.getContext('2d')!;
	let seed = 42;
	for (let i = 1; i <= pages; i++) {
		const page = pdf.addPage([600, 800]);
		if (scan) {
			const image = ctx.createImageData(600, 800);
			for (let j = 0; j < image.data.length; j += 4) {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				const c = seed >>> 24;
				image.data[j] = c;
				image.data[j + 1] = c;
				image.data[j + 2] = c;
				image.data[j + 3] = 255;
			}
			ctx.putImageData(image, 0, 0);
			const jpeg = await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.65));
			page.drawImage(jpeg, { x: 0, y: 0, width: 600, height: 800 });
		}
		for (let row = 0; row < 35; row++)
			page.drawText(
				`Page ${i}, clause ${row + 1}: The parties agree to the terms set out in this agreement.`,
				{ x: 30, y: 760 - row * 20, size: 10, font }
			);
	}
	return pdf.save();
}
export async function runBenchmark(
	host: HTMLElement,
	pages: number,
	scan: boolean
): Promise<BenchmarkResult> {
	const bytes = await fixture(pages, scan),
		sourceMB = bytes.length / 1e6;
	const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
	const style = document.createElement('style');
	style.textContent = rendererStyles;
	const container = document.createElement('div');
	container.style.cssText = 'height:500px;overflow:auto;position:relative';
	root.replaceChildren(style, container);
	const js = await getPdfJs();
	if (!js) throw new Error('Browser required');
	let state: RegionViewState = { gaps: [], pending: false, error: null };
	let maxDelay = 0,
		previous = performance.now();
	const timer = setInterval(() => {
		const now = performance.now();
		maxDelay = Math.max(maxDelay, now - previous - 16);
		previous = now;
	}, 16);
	let doc: PDFDocumentProxy | null = null;
	let viewer: PDFViewerCore | null = null;
	try {
		const start = performance.now();
		doc = await js.getDocument({ data: bytes, worker: getPdfWorker() ?? undefined }).promise;
		const pdfJsOpenMs = performance.now() - start;
		viewer = new PDFViewerCore({
			container,
			regions: [
				{ id: 'a', page: 2, y_min: 30, y_max: 40 },
				{ id: 'b', page: pages - 1, y_min: 60, y_max: 70 }
			],
			regionTransitionDuration: 0,
			onRegionsChange: (next) => (state = next)
		});
		const settle = async () => {
			while (state.pending) await new Promise((r) => setTimeout(r, 1));
			if (state.error) throw new Error(state.error);
			await new Promise((r) => requestAnimationFrame(r));
		};
		const initial = performance.now();
		await viewer.setDocument(doc);
		await settle();
		const initialRegionsMs = performance.now() - initial;
		const warm = performance.now();
		state.gaps[1].revealFromStart();
		await settle();
		const warmExpansionMs = performance.now() - warm;
		const collapse = performance.now();
		state.gaps[1].collapse();
		await settle();
		const collapseMs = performance.now() - collapse;
		const canvases = [...root.querySelectorAll('canvas')];
		return {
			pages,
			kind: scan ? 'unique noisy JPEG + text' : 'text',
			sourceMB,
			pdfJsOpenMs,
			initialRegionsMs,
			warmExpansionMs,
			collapseMs,
			maxTimerDelayMs: maxDelay,
			canvases: canvases.length,
			canvasMB: canvases.reduce((s, c) => s + c.width * c.height * 4, 0) / 1e6
		};
	} finally {
		clearInterval(timer);
		viewer?.destroy();
		await doc?.destroy();
	}
}
