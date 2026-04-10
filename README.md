# svelte-pdf-view

A modern, modular PDF viewer component for Svelte 5. Built on top of [PDF.js](https://mozilla.github.io/pdf.js/), with full TypeScript support and Shadow DOM isolation.

**[Live Demo](https://nullpointerexceptionkek.github.io/svelte-pdf-view/)**

## Features

- **PDF Rendering** - High-quality PDF rendering powered by PDF.js
- **Text Search** - Full-text search with highlight navigation
- **Rotation** - Rotate pages clockwise/counter-clockwise
- **Zoom** - Zoom in/out controls
- **Responsive** - Works on desktop and mobile
- **Customizable** - Style the scrollbar, background, and more
- **Modular** - Use the default layout or build your own toolbar
- **Shadow DOM** - Renderer styles are isolated and won't leak
- **Multiple Sources** - Load from URL, ArrayBuffer, Uint8Array, or Blob

## Installation

```bash
npm install svelte-pdf-view pdfjs-dist
# or
pnpm add svelte-pdf-view pdfjs-dist
# or
yarn add svelte-pdf-view pdfjs-dist
```

If you want to use the default `<PdfToolbar>` component, also install:

```bash
npm install @lucide/svelte
```

### Vite Configuration

If you're using Vite (including SvelteKit), you may need to exclude `pdfjs-dist` from dependency optimization to ensure the PDF.js worker loads correctly:

```ts
// vite.config.ts
export default defineConfig({
	// ... other config
	optimizeDeps: {
		exclude: ['svelte-pdf-view']
	}
});
```

This is especially important in monorepo setups where Vite's optimizer may incorrectly bundle the worker.

### Vite 8 Worker Configuration

Vite 8 changed how `new URL(bare-specifier, import.meta.url)` resolves from `node_modules`. If the PDF.js worker fails to load, configure it explicitly:

```ts
import { configurePdfWorker } from 'svelte-pdf-view';

configurePdfWorker(
	new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
);
```

Call this once at app startup (e.g., in your root `+layout.svelte` or `+page.svelte`) before any PDF viewer mounts.

## Quick Start

### Basic Usage

```svelte
<script lang="ts">
	import { PdfViewer, PdfToolbar, PdfRenderer } from 'svelte-pdf-view';
</script>

<div style="height: 100vh;">
	<PdfViewer src="/document.pdf">
		<PdfToolbar />
		<PdfRenderer />
	</PdfViewer>
</div>
```

The `src` prop is passed to `PdfViewer` and automatically shared with `PdfRenderer` via context - no need to pass it twice!

### Loading from Different Sources

```svelte
<script lang="ts">
	import { PdfViewer, PdfToolbar, PdfRenderer, type PdfSource } from 'svelte-pdf-view';

	// From URL
	let pdfSource: PdfSource = '/document.pdf';

	// From file input
	function handleFileSelect(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) {
			pdfSource = file; // Blob works directly
		}
	}

	// From fetch response
	async function loadFromApi() {
		const response = await fetch('/api/document');
		const arrayBuffer = await response.arrayBuffer();
		pdfSource = arrayBuffer;
	}
</script>

<input type="file" accept=".pdf" onchange={handleFileSelect} />

<PdfViewer src={pdfSource}>
	<PdfToolbar />
	<PdfRenderer />
</PdfViewer>
```

## Components

### `<PdfViewer>`

The main container component that provides context for toolbar and renderer.

```svelte
<PdfViewer src={pdfSource} scale={1.0} class="my-viewer">
	<!-- Children -->
</PdfViewer>
```

| Prop                | Type                                | Default  | Description                                                            |
| ------------------- | ----------------------------------- | -------- | ---------------------------------------------------------------------- |
| `src`               | `PdfSource`                         | required | PDF source (URL, ArrayBuffer, Uint8Array, or Blob)                     |
| `scale`             | `number`                            | `1.0`    | Initial zoom scale                                                     |
| `pageWidth`         | `number`                            | -        | Desired page width in pixels. Overrides `scale` by computing it automatically. |
| `currentPage`       | `number`                            | `1`      | Current page (1-indexed). Bindable — updates on scroll, setting it navigates. |
| `downloadFilename`  | `string`                            | -        | Custom filename for PDF download (default: from URL or 'document.pdf') |
| `onerror`           | `(error: string) => void`           | -        | Callback when PDF fails to load                                        |
| `onTextHighlighted` | `(data: TextHighlightData) => void` | -        | Callback when text is selected in the PDF                              |
| `boundingBoxes`     | `BoundingBox[]`                     | `[]`     | Bounding boxes to render on PDF pages                                  |
| `drawMode`          | `boolean`                           | `false`  | Enable drawing mode for creating bounding boxes                        |
| `class`             | `string`                            | `''`     | CSS class for the container                                            |

#### Page Navigation with `bind:currentPage`

```svelte
<script lang="ts">
	import { PdfViewer, PdfToolbar, PdfRenderer } from 'svelte-pdf-view';

	let currentPage = $state(1);
</script>

<button onclick={() => currentPage = 5}>Go to page 5</button>
<p>Currently viewing page {currentPage}</p>

<PdfViewer src="/document.pdf" bind:currentPage>
	<PdfToolbar />
	<PdfRenderer />
</PdfViewer>
```

#### Error Handling

```svelte
<script lang="ts">
	import { PdfViewer, PdfToolbar, PdfRenderer } from 'svelte-pdf-view';

	let errorMessage = $state<string | null>(null);

	function handleError(error: string) {
		errorMessage = error;
		console.error('PDF failed to load:', error);
	}
</script>

{#if errorMessage}
	<div class="error-banner">Failed to load PDF: {errorMessage}</div>
{/if}

<PdfViewer src="/document.pdf" onerror={handleError}>
	<PdfToolbar />
	<PdfRenderer />
</PdfViewer>
```

### `<PdfToolbar>`

The default toolbar with page navigation, zoom, rotation, and search controls.

```svelte
<PdfToolbar />
```

The toolbar automatically connects to the viewer context - no props needed.

### `<PdfRenderer>`

The PDF rendering component. Uses Shadow DOM for style isolation.

```svelte
<PdfRenderer
	src={pdfSource}
	backgroundColor="#e8e8e8"
	scrollbarThumbColor="#c1c1c1"
	scrollbarTrackColor="#f1f1f1"
	scrollbarThumbHoverColor="#a1a1a1"
	scrollbarWidth="10px"
	pageShadow="0 2px 8px rgba(0, 0, 0, 0.12)"
/>
```

| Prop                       | Type                  | Default                             | Description                                                    |
| -------------------------- | --------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `src`                      | `PdfSource`           | -                                   | PDF source (falls back to PdfViewer context if omitted)        |
| `backgroundColor`          | `string`              | `'#e8e8e8'`                         | Background color of scroll container                           |
| `pageShadow`               | `string`              | `'0 2px 8px rgba(0,0,0,0.12), ...'` | Box shadow for PDF pages                                       |
| `scrollbarTrackColor`      | `string`              | `'#f1f1f1'`                         | Scrollbar track background                                     |
| `scrollbarThumbColor`      | `string`              | `'#c1c1c1'`                         | Scrollbar thumb color                                          |
| `scrollbarThumbHoverColor` | `string`              | `'#a1a1a1'`                         | Scrollbar thumb hover color                                    |
| `scrollbarWidth`           | `string`              | `'10px'`                            | Scrollbar width                                                |
| `createLoadingIndicator`   | `() => HTMLElement`   | -                                   | Factory that creates a loading indicator element for each page  |

#### Custom Page Loading Indicator

By default, no per-page loading indicator is shown. Pass a `createLoadingIndicator` factory to display a custom element while each page renders:

```svelte
<PdfRenderer
	createLoadingIndicator={() => {
		const el = document.createElement('div');
		el.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#999;';
		el.textContent = 'Loading page...';
		return el;
	}}
/>
```

The factory is called once per page. The element is automatically hidden when rendering completes and re-shown on page reset (e.g., scale or rotation change). Since `PdfRenderer` uses Shadow DOM, styles must be inline or injected into the shadow root.

### `<PdfThumbnailViewer>`

A virtualized thumbnail grid that renders page previews. Must be placed inside a `<PdfViewer>` to access the PDF context. Supports bounding box overlays, page range filtering, and custom styling via class props.

```svelte
<script lang="ts">
	import { PdfViewer, PdfRenderer, PdfThumbnailViewer } from 'svelte-pdf-view';

	let currentPage = $state(1);
</script>

<PdfViewer src="/document.pdf" bind:currentPage>
	<div style="display:flex; height:100vh;">
		<div style="width:200px; overflow-y:auto;">
			<PdfThumbnailViewer
				width={150}
				columns={1}
				gap={8}
				onPageClick={(page) => currentPage = page}
				buttonClass="thumbnail-btn"
				containerClass="thumbnail-container"
				labelClass="thumbnail-label"
			/>
		</div>
		<PdfRenderer />
	</div>
</PdfViewer>
```

| Prop             | Type                       | Default | Description                                              |
| ---------------- | -------------------------- | ------- | -------------------------------------------------------- |
| `columns`        | `number`                   | `1`     | Number of columns in the thumbnail grid                  |
| `width`          | `number`                   | `150`   | Width of each thumbnail in pixels                        |
| `gap`            | `number`                   | `8`     | Gap between thumbnails in pixels                         |
| `onPageClick`    | `(page: number) => void`   | -       | Callback when a thumbnail is clicked                     |
| `overscan`       | `number`                   | `2`     | Number of off-screen pages to keep rendered              |
| `startPage`      | `number`                   | `1`     | First page to show (1-indexed, inclusive)                 |
| `endPage`        | `number`                   | -       | Last page to show (1-indexed, inclusive)                  |
| `class`          | `string`                   | `''`    | CSS class for the grid container                         |
| `buttonClass`    | `string`                   | `''`    | CSS class for each thumbnail button                      |
| `containerClass` | `string`                   | `''`    | CSS class for the canvas container div                   |
| `labelClass`     | `string`                   | `''`    | CSS class for the page number label                      |

The thumbnail viewer uses `IntersectionObserver` for virtualization — only visible pages (plus an overscan buffer) are rendered, keeping memory usage low for large documents. Thumbnails are rendered at the correct `devicePixelRatio` for crisp display on HiDPI screens.

The component renders no opinionated styles beyond layout essentials (`display:grid`, `position:relative`). All visual styling is done via the class props, making it easy to use with Tailwind or any CSS framework.

## Custom Toolbar

You can create your own toolbar using the context API:

```svelte
<script lang="ts">
	import { PdfViewer, PdfRenderer, getPdfViewerContext } from 'svelte-pdf-view';
</script>

<PdfViewer src="/document.pdf">
	<MyCustomToolbar />
	<PdfRenderer src="/document.pdf" />
</PdfViewer>
```

```svelte
<!-- MyCustomToolbar.svelte -->
<script lang="ts">
	import { getPdfViewerContext } from 'svelte-pdf-view';

	const { state, actions } = getPdfViewerContext();
</script>

<div class="toolbar">
	<span>Page {state.currentPage} of {state.totalPages}</span>

	<button onclick={() => actions.zoomOut()}>-</button>
	<span>{Math.round(state.scale * 100)}%</span>
	<button onclick={() => actions.zoomIn()}>+</button>

	<button onclick={() => actions.rotateCounterClockwise()}>↺</button>
	<button onclick={() => actions.rotateClockwise()}>↻</button>
</div>

<style>
	/* Your custom styles */
</style>
```

### Context API

#### `state: PdfViewerState`

| Property        | Type             | Description                        |
| --------------- | ---------------- | ---------------------------------- |
| `loading`       | `boolean`        | Whether the PDF is loading         |
| `error`         | `string \| null` | Error message if loading failed    |
| `totalPages`    | `number`         | Total number of pages              |
| `currentPage`   | `number`         | Current visible page               |
| `scale`         | `number`         | Current zoom scale                 |
| `rotation`      | `number`         | Current rotation (0, 90, 180, 270) |
| `searchQuery`   | `string`         | Current search query               |
| `searchCurrent` | `number`         | Current match index                |
| `searchTotal`   | `number`         | Total number of matches            |
| `isSearching`   | `boolean`        | Whether search is in progress      |

#### `actions: PdfViewerActions`

| Method                        | Description                  |
| ----------------------------- | ---------------------------- |
| `zoomIn()`                    | Increase zoom level          |
| `zoomOut()`                   | Decrease zoom level          |
| `setScale(scale: number)`     | Set specific zoom scale      |
| `rotateClockwise()`           | Rotate 90° clockwise         |
| `rotateCounterClockwise()`    | Rotate 90° counter-clockwise |
| `goToPage(page: number)`      | Navigate to specific page    |
| `search(query: string)`       | Search for text              |
| `searchNext()`                | Go to next search match      |
| `searchPrevious()`            | Go to previous search match  |
| `clearSearch()`               | Clear search highlights      |
| `download(filename?: string)` | Download the PDF             |

## Types

```typescript
// PDF source can be URL, ArrayBuffer, Uint8Array, or Blob
type PdfSource = string | ArrayBuffer | Uint8Array | Blob;

interface PdfViewerState {
	loading: boolean;
	error: string | null;
	totalPages: number;
	currentPage: number;
	scale: number;
	rotation: number;
	pageDimensions: Map<number, { width: number; height: number }>;
	searchQuery: string;
	searchCurrent: number;
	searchTotal: number;
	isSearching: boolean;
	presentationMode: PresentationModeState;
	drawMode: boolean;
}

interface PdfViewerActions {
	zoomIn: () => void;
	zoomOut: () => void;
	setScale: (scale: number) => void;
	rotateClockwise: () => void;
	rotateCounterClockwise: () => void;
	goToPage: (page: number) => void;
	search: (query: string) => Promise<void>;
	searchNext: () => void;
	searchPrevious: () => void;
	clearSearch: () => void;
	download: (filename?: string) => Promise<void>;
	enterPresentationMode: () => Promise<boolean>;
	exitPresentationMode: () => Promise<void>;
	updateBoundingBoxes: (boxes: BoundingBox[]) => void;
	updateDrawMode: (enabled: boolean) => void;
	scrollToCoordinates: (page: number, x: number, y: number, scrollBehavior?: ScrollBehavior) => void;
}
```

## Styling Examples

### Dark Theme

```svelte
<PdfRenderer
	src={pdfSource}
	backgroundColor="#1a1a1a"
	scrollbarTrackColor="#2d2d2d"
	scrollbarThumbColor="#555"
	scrollbarThumbHoverColor="#666"
	pageShadow="0 4px 12px rgba(0, 0, 0, 0.5)"
/>
```

### Minimal Theme

```svelte
<PdfRenderer
	src={pdfSource}
	backgroundColor="#ffffff"
	scrollbarWidth="6px"
	scrollbarTrackColor="transparent"
	scrollbarThumbColor="#ddd"
	pageShadow="none"
/>
```

## Use Cases

**Texpile** ([texpile.com](https://texpile.com/)) uses this package to display generated documents (PDFs) directly in the browser.

## License

Apache 2.0

## Attribution

This project is built on top of [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla, licensed under the Apache License 2.0.

Several files in this project are derivative works based on PDF.js viewer source code:

| File                  | Based on                                                |
| --------------------- | ------------------------------------------------------- |
| `EventBus.ts`         | `web/event_utils.js`                                    |
| `FindController.ts`   | `web/pdf_find_controller.js`, `web/text_highlighter.js` |
| `PDFPageView.ts`      | `web/pdf_page_view.js`                                  |
| `PDFViewerCore.ts`    | `web/pdf_viewer.js`                                     |
| `renderer-styles.css` | `web/text_layer_builder.css`                            |

These files retain the original Apache 2.0 license headers with attribution to the Mozilla Foundation.
