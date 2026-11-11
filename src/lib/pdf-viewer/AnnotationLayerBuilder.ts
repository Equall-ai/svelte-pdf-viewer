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
 * AnnotationLayerBuilder - Renders PDF annotations (links, form widgets, popups).
 * Adapted from PDF.js annotation_layer_builder.js
 */
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { SimpleLinkService } from './SimpleLinkService.js';

// Dynamically loaded pdfjs components
let AnnotationLayer: typeof import('pdfjs-dist/legacy/build/pdf.mjs').AnnotationLayer;

async function ensurePdfJsLoaded() {
	if (!AnnotationLayer) {
		const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
		AnnotationLayer = pdfjs.AnnotationLayer;
	}
}

export interface AnnotationLayerBuilderOptions {
	annotationFilter?: (annotation: { rect?: number[] }) => boolean;
	pdfPage: PDFPageProxy;
	linkService: SimpleLinkService;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	annotationStorage?: any;
	imageResourcesPath?: string;
	renderForms?: boolean;
	onAppend?: (div: HTMLDivElement) => void;
}

export interface AnnotationLayerBuilderRenderOptions {
	viewport: PageViewport;
	intent?: string;
}

export class AnnotationLayerBuilder {
	private pdfPage: PDFPageProxy;
	private annotationFilter?: AnnotationLayerBuilderOptions['annotationFilter'];
	private linkService: SimpleLinkService;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private annotationStorage: any;
	private imageResourcesPath: string;
	private renderForms: boolean;
	private onAppend: ((div: HTMLDivElement) => void) | null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private annotationLayer: any = null;
	div: HTMLDivElement | null = null;
	private cancelled = false;

	constructor(options: AnnotationLayerBuilderOptions) {
		this.pdfPage = options.pdfPage;
		this.annotationFilter = options.annotationFilter;
		this.linkService = options.linkService;
		this.annotationStorage = options.annotationStorage ?? null;
		this.imageResourcesPath = options.imageResourcesPath ?? '';
		this.renderForms = options.renderForms ?? true;
		this.onAppend = options.onAppend ?? null;
	}

	/**
	 * Render the annotation layer.
	 */
	async render(options: AnnotationLayerBuilderRenderOptions): Promise<void> {
		const { viewport, intent = 'display' } = options;

		if (this.div) {
			// Already rendered - just update
			if (this.cancelled || !this.annotationLayer) {
				return;
			}
			this.annotationLayer.update({
				viewport: viewport.clone({ dontFlip: true })
			});
			return;
		}

		await ensurePdfJsLoaded();

		const all = await this.pdfPage.getAnnotations({ intent });
		const visible = new Set(
			all
				.filter((annotation) => this.annotationFilter?.(annotation) ?? true)
				.map((annotation) => annotation.id)
		);
		const annotations = all.filter(
			(annotation) => visible.has(annotation.id) || visible.has(annotation.parentId)
		);
		if (this.cancelled) {
			return;
		}

		// Create annotation layer div
		this.div = document.createElement('div');
		this.div.className = 'annotationLayer';
		this.onAppend?.(this.div);

		// Set layer dimensions directly (setLayerDimensions uses CSS round() which may not work everywhere)
		const { width, height } = viewport;
		this.div.style.width = `${Math.floor(width)}px`;
		this.div.style.height = `${Math.floor(height)}px`;

		// Initialize the annotation layer
		this.annotationLayer = new AnnotationLayer({
			div: this.div,
			accessibilityManager: null,
			annotationCanvasMap: null,
			annotationEditorUIManager: null,
			page: this.pdfPage,
			viewport: viewport.clone({ dontFlip: true }),
			structTreeLayer: null,
			commentManager: null,
			linkService: this.linkService,
			annotationStorage: this.annotationStorage
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);

		if (annotations.length === 0) {
			return;
		}

		// Render annotations
		await this.annotationLayer.render({
			annotations,
			imageResourcesPath: this.imageResourcesPath,
			renderForms: this.renderForms,
			linkService: this.linkService,
			downloadManager: undefined,
			annotationStorage: this.annotationStorage,
			enableScripting: false,
			hasJSActions: false,
			fieldObjects: null
		});
	}

	/**
	 * Update the annotation layer viewport.
	 */
	update(viewport: PageViewport): void {
		if (!this.div || !this.annotationLayer) {
			return;
		}
		this.annotationLayer.update({
			viewport: viewport.clone({ dontFlip: true })
		});
	}

	/**
	 * Cancel rendering.
	 */
	cancel(): void {
		this.cancelled = true;
	}

	/**
	 * Hide the annotation layer.
	 */
	hide(): void {
		if (this.div) {
			this.div.hidden = true;
		}
	}

	/**
	 * Show the annotation layer.
	 */
	show(): void {
		if (this.div) {
			this.div.hidden = false;
		}
	}

	/**
	 * Destroy the annotation layer.
	 */
	destroy(): void {
		this.cancel();
		if (this.div) {
			this.div.remove();
			this.div = null;
		}
		this.annotationLayer = null;
	}
}
