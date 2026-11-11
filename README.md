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

configurePdfWorker(new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url));
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

### Custom bounding-box overlays

A bounding box can include an `overlay` snippet. The viewer renders it in the normal
DOM above the box, so your application's styles and components work normally.
The viewer owns scrolling, zoom, rotation, visibility, and placement.

`overlay` receives `{ box, visible }`. The snippet stays mounted when its anchor scrolls
offscreen; use `visible` to control presentation without resetting its owning component's
state. `visible` tracks the anchor, independently of content size. Content that cannot
fit in the viewport is hidden while retaining its measured size.
`overlayPlacement` accepts `side: 'top' | 'bottom'`,
`align: 'start' | 'center' | 'end'`, and `gap` in pixels. Defaults are top/end/6;
the viewer flips and clamps the overlay into the visible viewport.

```svelte
<script lang="ts">
	import { PdfViewer, PdfRenderer, type BoundingBox } from '@equall-ai/svelte-pdf-viewer';
</script>

{#snippet controls({ box, visible }: { box: BoundingBox; visible: boolean })}
	{#if visible}<span class="my-overlay">Page {box.page}</span>{/if}
{/snippet}

<PdfViewer
	src="/document.pdf"
	boundingBoxes={[
		{ id: 'example', page: 1, x: 72, y: 600, width: 150, height: 24, overlay: controls }
	]}
>
	<PdfRenderer />
</PdfViewer>
```

For custom highlights rendered by your app, use `PdfAnchoredOverlay` with a
normalized page rectangle and a child snippet. No highlight ID or DOM lookup is
required. Coordinates are percentages with a top-left origin in the rendered page's
orientation; pages are 1-indexed in the loaded PDF. Translate absolute page numbers
first if your app loads only a page range. An existing package bounding box can also
be targeted with `anchor={{ boxId: 'example' }}`.

```svelte
<script lang="ts">
	import { PdfAnchoredOverlay, type PdfOverlayAnchor } from '@equall-ai/svelte-pdf-viewer';
	let { anchor }: { anchor: PdfOverlayAnchor } = $props();
</script>

<PdfAnchoredOverlay {anchor}>
	{#snippet children({ visible })}
		{#if visible}<span class="my-overlay">Your control</span>{/if}
	{/snippet}
</PdfAnchoredOverlay>
```

This component normally inherits context from `PdfViewer`. When rendering elsewhere,
pass a retained `getPdfViewerContext()` value through its optional `context` prop.
Render it within a positioned container covering the viewer. It remains outside the
PDF shadow root and rotates independently of the page. No measurement or positioning
code is needed in the consumer. The same `side`, `align`, and `gap` options are
available as component props. Use `anchor={null}` to hide and detach it.

### `<PdfViewer>`

The main container component that provides context for toolbar and renderer.

```svelte
<PdfViewer src={pdfSource} scale={1.0} class="my-viewer">
	<!-- Children -->
</PdfViewer>
```

| Prop                 | Type                                | Default  | Description                                                                    |
| -------------------- | ----------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `src`                | `PdfSource`                         | required | PDF source (URL, ArrayBuffer, Uint8Array, or Blob)                             |
| `imageResourcesPath` | `string`                            | `''`     | URL directory for PDF.js annotation icons, including a trailing slash.         |
| `scale`              | `number`                            | `1.0`    | Initial zoom scale                                                             |
| `pageWidth`          | `number`                            | -        | Desired page width in pixels. Overrides `scale` by computing it automatically. |
| `currentPage`        | `number`                            | `1`      | Current page (1-indexed). Bindable — updates on scroll, setting it navigates.  |
| `downloadFilename`   | `string`                            | -        | Custom filename for PDF download (default: from URL or 'document.pdf')         |
| `onerror`            | `(error: string) => void`           | -        | Callback when PDF fails to load                                                |
| `onTextHighlighted`  | `(data: TextHighlightData) => void` | -        | Callback when text is selected in the PDF                                      |
| `boundingBoxes`      | `BoundingBox[]`                     | `[]`     | Bounding boxes to render on PDF pages                                          |
| `drawMode`           | `boolean`                           | `false`  | Enable drawing mode for creating bounding boxes                                |
| `class`              | `string`                            | `''`     | CSS class for the container                                                    |

#### Annotation images

Serve the files from your installed `pdfjs-dist/web/images/` directory and pass
their public URL to the viewer. Use a root-relative or absolute URL so annotation
icons resolve correctly on nested routes. The path is read when a PDF loads;
changing `imageResourcesPath` alone does not rebuild existing annotations.
Configure it before loading the PDF:

```svelte
<PdfViewer src={pdfSource} imageResourcesPath="/pdfjs/images/">
	<PdfRenderer />
</PdfViewer>
```

The library does not copy these files into the consuming application's build.

#### Page Navigation with `bind:currentPage`

```svelte
<script lang="ts">
	import { PdfViewer, PdfToolbar, PdfRenderer } from 'svelte-pdf-view';

	let currentPage = $state(1);
</script>

<button onclick={() => (currentPage = 5)}>Go to page 5</button>
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

| Prop                       | Type                | Default                             | Description                                                    |
| -------------------------- | ------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `src`                      | `PdfSource`         | -                                   | PDF source (falls back to PdfViewer context if omitted)        |
| `backgroundColor`          | `string`            | `'#e8e8e8'`                         | Background color of scroll container                           |
| `pageShadow`               | `string`            | `'0 2px 8px rgba(0,0,0,0.12), ...'` | Box shadow for PDF pages                                       |
| `scrollbarTrackColor`      | `string`            | `'#f1f1f1'`                         | Scrollbar track background                                     |
| `scrollbarThumbColor`      | `string`            | `'#c1c1c1'`                         | Scrollbar thumb color                                          |
| `scrollbarThumbHoverColor` | `string`            | `'#a1a1a1'`                         | Scrollbar thumb hover color                                    |
| `scrollbarWidth`           | `string`            | `'10px'`                            | Scrollbar width                                                |
| `createLoadingIndicator`   | `() => HTMLElement` | -                                   | Factory that creates a loading indicator element for each page |

#### Custom Page Loading Indicator

By default, no per-page loading indicator is shown. Pass a `createLoadingIndicator` factory to display a custom element while each page renders:

```svelte
<PdfRenderer
	createLoadingIndicator={() => {
		const el = document.createElement('div');
		el.style.cssText =
			'display:flex;align-items:center;justify-content:center;height:100%;color:#999;';
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
				onPageClick={(page) => (currentPage = page)}
				buttonClass="thumbnail-btn"
				containerClass="thumbnail-container"
				labelClass="thumbnail-label"
			/>
		</div>
		<PdfRenderer />
	</div>
</PdfViewer>
```

| Prop             | Type                     | Default | Description                                 |
| ---------------- | ------------------------ | ------- | ------------------------------------------- |
| `columns`        | `number`                 | `1`     | Number of columns in the thumbnail grid     |
| `width`          | `number`                 | `150`   | Width of each thumbnail in pixels           |
| `gap`            | `number`                 | `8`     | Gap between thumbnails in pixels            |
| `onPageClick`    | `(page: number) => void` | -       | Callback when a thumbnail is clicked        |
| `overscan`       | `number`                 | `2`     | Number of off-screen pages to keep rendered |
| `startPage`      | `number`                 | `1`     | First page to show (1-indexed, inclusive)   |
| `endPage`        | `number`                 | -       | Last page to show (1-indexed, inclusive)    |
| `class`          | `string`                 | `''`    | CSS class for the grid container            |
| `buttonClass`    | `string`                 | `''`    | CSS class for each thumbnail button         |
| `containerClass` | `string`                 | `''`    | CSS class for the canvas container div      |
| `labelClass`     | `string`                 | `''`    | CSS class for the page number label         |

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
	scrollToCoordinates: (
		page: number,
		x: number,
		y: number,
		scrollBehavior?: ScrollBehavior
	) => void;
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

## Shared document surface and margin

Use a renderer margin when application content should scroll with the document.
The renderer keeps one scroll viewport spanning both columns, with its scrollbar
at the right edge. The margin stays in CSS pixels as the PDF zooms.

```svelte
<PdfRenderer marginWidth={open ? 288 : 0}>
	{#snippet margin(surface)}
		<YourMargin {surface} />
	{/snippet}
	{#snippet surfaceOverlay(surface)}
		<YourConnectors {surface} />
	{/snippet}
</PdfRenderer>
```

Both snippets receive a `PdfDocumentSurface`: `width`, `height`, `pages`,
`margin`, `viewport`, and `layoutRevision`. Rectangles use CSS pixels relative
to the surface's top-left. `viewport` moves as the reader scrolls;
`layoutRevision` changes only when layout changes. The optional
`onSurfaceChange` callback receives the same snapshot, and `null` on teardown.

The snippets are rendered in light DOM and distributed through Shadow DOM slots,
so application styles, Svelte context, text selection, and native keyboard focus
continue to work. `surfaceOverlay` is non-interactive. Margin content participates
in the surface height: when positioning cards absolutely, give their parent an
explicit height that includes the last card. Avoid sizing it from `surface.height`
plus padding, which would create a feedback loop; use `surface.pages.height` and
card positions instead. Width zero hides the margin while preserving its state.
The package does not choose card order, collision handling, or selection behavior.

Subscribe to anchor positions from a descendant of `PdfViewer`:

```ts
const context = getPdfViewerContext();
$effect(() =>
	context.observeDocumentAnchor(
		{ page: 1, x_min: 10, x_max: 50, y_min: 20, y_max: 25 },
		(geometry) => {
			anchorGeometry = geometry;
		}
	)
);
```

The callback receives `{ rect, visible, layoutRevision }` or `null` while the
renderer/page is unavailable. `rect` remains available offscreen and uses the
same surface coordinates as the snippets. Percentage anchors use the rendered
page's orientation, matching `PdfOverlayAnchor`; `{ boxId }` measures the actual
rendered bounding box. Page shells exist independently of lazy canvas rendering.
Subscriptions survive renderer replacement and return an unsubscribe function.
The existing `PdfAnchoredOverlay` API keeps its viewport-clipped behavior.

At the core layer, `PDFViewerOptions.pageContainer` optionally separates the
page mount target from `container`, the scrolling viewport. Existing callers
retain their original structure. Scale and rotation preserve the top visible
page's relative reading position; margin width changes do not reload the PDF or
change its scale. Page fitting remains controlled through the viewer's existing
page-width/scale settings. See the `/surface` demo for resizing, zoom, rotation,
source replacement, and overflowing margin content.

## Region views and custom gap dividers

`PdfRenderer` can show selected full-width passages while keeping the original document available for navigation, search, and download. Regions use the same source convention as normalized bounding boxes: one-based pages and top-origin percentages, after the PDF's intrinsic rotation and CropBox are applied. Viewer toolbar rotation does not change these inputs.

```svelte
<script lang="ts">
	import { PdfViewer, PdfRenderer, type PdfRegion } from '@equall-ai/svelte-pdf-viewer';

	let { documentUrl }: { documentUrl: string } = $props();
	let regions = $state<PdfRegion[] | null>([
		{ id: 'passage-a', page: 2, y_min: 25, y_max: 35 },
		{ id: 'passage-b', page: 5, y_min: 40, y_max: 45 }
	]);
</script>

<button onclick={() => (regions = null)}>Full document</button>
<PdfViewer src={documentUrl}>
	<PdfRenderer {regions} contextPadding={24} expansionStep={0.2} regionTransitionDuration={220}>
		{#snippet gap(gap)}
			<div class="evidence-divider" aria-busy={gap.pending}>
				<span
					>{gap.hiddenRange ? 'Hidden' : 'Expanded'} context: pages {gap.range.start.page}–{gap
						.range.end.page}</span
				>
				{#if gap.hiddenRange && gap.before}
					<button disabled={gap.pending} onclick={gap.revealFromStart}>Show more below</button>
				{/if}
				{#if gap.hiddenRange && gap.before && gap.after}
					<button disabled={gap.pending} onclick={gap.revealAll}>Show all between</button>
				{/if}
				{#if gap.hiddenRange && gap.after}
					<button disabled={gap.pending} onclick={gap.revealFromEnd}>Show more above</button>
				{/if}
				<button hidden={!gap.canCollapse} disabled={gap.pending} onclick={gap.collapse}
					>Collapse context</button
				>
				{#if gap.error}<p role="alert">{gap.error}</p>{/if}
			</div>
		{/snippet}
	</PdfRenderer>
</PdfViewer>

<style>
	.evidence-divider {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 12px;
		background: #eef3fa;
	}
</style>
```

The divider is application-owned light DOM. Your Svelte components, CSS, labels, keyboard behavior, and loading indicators work normally; the viewer measures its height and includes it in the shared scrolling surface. Omitting `gap` supplies an accessible default divider. Give interactive controls a disabled state while `gap.pending` is true.

| Input or action                           | Behavior                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `regions={null}` or omitted               | Full original PDF; preserves the visible source passage when leaving a region view.                                |
| `regions={[]}`                            | No visible evidence. Render your application's empty state and full-document action alongside the renderer.        |
| `contextPadding={24}`                     | Adds 24 PDF points above and below each input region, clamps to its page, and merges overlaps.                     |
| `expansionStep={0.2}`                     | Reveals 20% of the neighboring source page per action, including across page boundaries.                           |
| `regionTransitionDuration={220}`          | Expand/collapse transition duration in ms; `0` disables motion. System reduced-motion preferences also disable it. |
| `boundingBoxes` on `PdfViewer`            | Precise highlights, independently of which regions are visible.                                                    |
| `actions.resetRegionExpansion()`          | Restores the initial padded regions. Available through `getPdfViewerContext()` inside a `PdfViewer`.               |
| `actions.goToPage(page)`                  | Reveals the full requested source page without leaving region mode.                                                |
| `actions.scrollToCoordinates(page, x, y)` | Reveals a padded neighborhood around original visual-page PDF points; `y` remains bottom-origin.                   |
| Search                                    | Searches the whole original document and reveals the selected match's passage.                                     |

Changing source or region values resets expansion. Equivalent fresh arrays, including reordered inputs, preserve it. Invalid/non-finite page intervals are ignored; valid intervals are clamped to page boundaries. Regions and highlights never expose generated strip page numbers.

The exported types are `PdfRegion`, `PdfFragment`, `PdfSourcePosition`, and `PdfGapContext`. A fragment describes its original source interval and contributing input `regionIds`; navigation-only context can have no contributing IDs. Gap `range.start` and `range.end` contain original `{ page, y }` positions, with `y` in top-origin percentages. `before` and `after` identify the adjacent fragments. `revealFromStart()` expands down from `before`; `revealFromEnd()` expands up from `after`. `revealAll()` reveals the entire gap. `hiddenRange` is the remaining hidden interval, or `null` when fully revealed; `range` equals that interval while hidden, falling back to `sourceRange` when fully revealed. `sourceRange` is the original gap interval, and the divider ID remains stable through expansion and collapse. `canCollapse` indicates revealed context; `collapse()` hides only context within that original gap, preserving evidence and other gaps' expansions. Fully revealed gaps retain a divider so clients can expose collapse. Search/navigation context within that interval is also removed by collapse. Actions return immediately and report completion/failure through `pending` and `error`; callbacks retained from an obsolete gap safely do nothing.

Transitions begin after replacement strips are ready, keep text at its natural scale, and temporarily retain outgoing canvases as inert, nonselectable content. `pending` covers generation, not the cosmetic transition; another action safely finishes the preceding transition. Navigation, resizing, source changes, and teardown can finish transitions immediately. When collapse hides the reading position itself, the viewer anchors the nearest remaining evidence. Clients retain control over divider styling, icons, and focus behavior.

`observeDocumentAnchor()` remains passive. Hidden source anchors report `null`; an anchor spanning multiple strips resolves to its first source-ordered intersection. Bounding-box callbacks and drawn boxes retain original source coordinates.

### Fidelity and lifecycle

Region mode lazily loads `pdf-lib` 1.17.1, reads source bytes once, and generates temporary vector strips. The existing PDF.js page renderer supplies canvas, selectable text, and package highlight layers. Original text item ordering is preserved for search; text runs intersecting a clipped boundary are removed from selection until more context is revealed. This may make a partially visible line unselectable. Cropping is **not redaction**, and downloads always contain the complete original document.

**Annotated pages render their original PDF.js canvas into each clipped strip**, preserving annotation and form appearances that `pdf-lib` embedding would omit. Visible links and notes use the original annotation layer, transformed into strip coordinates; fully hidden annotations are excluded. Forms are read-only in region mode and display their saved appearances. Open the full document for form interaction. Each annotated strip renders the original page content, so several strips from a complex annotated page can cost more than an ordinary embedded strip. Rendering failures retain the previous usable view and expose a return-to-source action. Scanned documents still require an existing text layer for selection; this package does not add OCR.

Unchanged strips are reused, nearby strips are prepared before replacement, and the existing rendering queue handles offscreen canvases. Replaced documents, canvases, text layers, and drawing listeners are released. New source/region requests discard obsolete results. Large document performance depends on source resources and the amount revealed; revealing every page can be substantially more expensive than the initial evidence view.

Run `pnpm dev` and open `/snippets` for the deterministic Event demo, including custom/default dividers, table evidence, shared citations, empty evidence, intrinsic rotation, and an offset CropBox. See [the demo assessment](src/routes/snippets/README.md) for validation and measured timings.

Run `/snippets/benchmark` for reproducible 100/1,000-page text and 100-page image-source measurements. This implementation is optimized for a sparse set of evidence strips: startup reads every page's geometry and parses the full source, search extracts all source text on first use, and revealing many pages increases generated-document and retained-canvas memory. There is no LRU eviction of previously rendered fragments yet. See the assessment for timings and their limits.

### Region render readiness

`PdfRenderer` accepts `onRegionRenderStateChange(state: PdfRegionRenderState)`.
Use it to drive application-owned placeholders or shimmers while switching evidence:

```svelte
<script lang="ts">
	import { PdfRenderer, type PdfRegionRenderState } from '@equall-ai/svelte-pdf-viewer';
	let rendering = $state<PdfRegionRenderState>({ status: 'idle', error: null });
</script>

<PdfRenderer {regions} onRegionRenderStateChange={(state) => (rendering = state)} />
{#if rendering.status === 'loading'}
	<div role="status">Preparing evidence…</div>
{/if}
```

- `loading`: a region selection, expansion, collapse, reset, or hidden-range reveal is being prepared.
- `ready`: the current region layout is mounted, its source reading position restored, and its visible canvas, text, annotation, and highlight layers have finished rendering. Empty regions also become ready. Offscreen strips remain lazily rendered; this is not a promise that every strip has rendered or that an expand/collapse animation has finished.
- `error`: generation or rendering failed; `error` contains the message. The viewer's existing error and return-to-source controls remain available.
- `idle`: full-document mode. `error` is null outside the error state.

Equivalent replacement region arrays do not start a new cycle. Obsolete requests cannot emit ready for a newer selection or source. Cancelled hidden-range reveals settle back to the retained visible view. Ordinary scrolling does not start a new region request. `gap.pending` still describes divider actions; it is not a rendering-readiness signal.
