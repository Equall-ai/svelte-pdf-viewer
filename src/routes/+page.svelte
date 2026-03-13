<script lang="ts">
	import { base } from '$app/paths';
	import {
		PdfViewer,
		PdfRenderer,
		PdfThumbnailViewer,
		type PdfSource,
		type TextHighlightData,
		type BoundingBox,
		type DrawnBoundingBox,
		convertNormalizedBoundingBoxes,
		getPdfViewerContext
	} from '$lib/index.js';
	import ScrollDemo from './ScrollDemo.svelte';

	const defaultPdf = `${base}/Demo.pdf`;
	let pdfSource: PdfSource = $state(defaultPdf);
	let sourceType = $state<'url' | 'arraybuffer' | 'uint8array' | 'blob'>('url');
	let loadError = $state<string | null>(null);
	let highlightedText = $state<string | null>(null);
	let tooltipPosition = $state<{ x: number; y: number } | null>(null);

	// Page width control
	let pageWidthEnabled = $state(true);
	let pageWidthValue = $state(800);
	let currentPage = $state(1);

	// Bounding boxes demo
	let showBoundingBoxes = $state(true);
	let boundingBoxes = $state<BoundingBox[]>([
		{
			page: 1,
			x: 100,
			y: 500,
			width: 200,
			height: 100,
			borderColor: '#ff0000',
			fillColor: 'rgba(255, 0, 0, 0.1)',
			borderWidth: 2,
			borderRadius: 8,
			id: 'demo-box-1',
			showClose: true // Show default close button
		},
		{
			page: 1,
			x: 350,
			y: 300,
			width: 150,
			height: 80,
			borderColor: '#0000ff',
			fillColor: 'rgba(0, 0, 255, 0.2)',
			borderWidth: 2,
			borderRadius: 12,
			id: 'demo-box-2',
			showClose: true
		}
	]);

	// Handle bounding box close
	function handleBoundingBoxClose(box: BoundingBox) {
		console.log('Closing bounding box:', box.id);
		boundingBoxes = boundingBoxes.filter((b) => b.id !== box.id);
	}

	// Drawing mode state
	let drawMode = $state(false);
	let drawnBoxes = $state<DrawnBoundingBox[]>([]);

	// Handle drawn bounding boxes
	function handleBoundingBoxDrawn(box: DrawnBoundingBox) {
		console.log('Bounding box drawn:', box);
		drawnBoxes = [...drawnBoxes, box];

		// Convert the normalized coordinates to PDF coordinates and add to display
		// We need to wait for the PDF to be loaded to get dimensions
		// For now, we'll add it to a pending list and convert when dimensions are available
		setTimeout(() => {
			try {
				const { state } = getPdfViewerContext();
				const pageDims = state.pageDimensions.get(box.page);
				if (pageDims) {
					const converted = convertNormalizedBoundingBoxes([box], pageDims.width, pageDims.height);
					boundingBoxes = [
						...boundingBoxes,
						{
							...converted[0],
							borderColor: '#00ff00',
							fillColor: 'rgba(0, 255, 0, 0.2)',
							borderWidth: 2,
							id: `drawn-${Date.now()}`
						}
					];
				}
			} catch (e) {
				console.error('Error converting drawn box:', e);
			}
		}, 100);
	}

	function toggleDrawMode() {
		drawMode = !drawMode;
	}

	/* Example: Using Normalized Bounding Boxes (0-100 coordinates)
	 * If you have bounding boxes in percentage format (0-100), you can convert them
	 * using page dimensions from the viewer state:
	 *
	 * const { state } = getPdfViewerContext();
	 *
	 * const normalizedBoxes: NormalizedBoundingBox[] = [
	 *   {
	 *     page: 1,
	 *     x_min: 10,   // 10% from left
	 *     x_max: 40,   // 40% from left
	 *     y_min: 20,   // 20% from top
	 *     y_max: 35,   // 35% from top
	 *     borderColor: '#00ff00',
	 *     fillColor: 'rgba(0, 255, 0, 0.2)',
	 *     borderRadius: 8
	 *   }
	 * ];
	 *
	 * // Get dimensions for page 1 (works for any page, including landscape pages)
	 * const page1Dims = state.pageDimensions.get(1);
	 * if (page1Dims) {
	 *   const convertedBoxes = convertNormalizedBoundingBoxes(
	 *     normalizedBoxes,
	 *     page1Dims.width,   // Automatically detected from PDF
	 *     page1Dims.height   // Automatically detected from PDF
	 *   );
	 *   boundingBoxes = convertedBoxes;
	 * }
	 *
	 * Note: Each page can have different dimensions (portrait vs landscape)
	 * Common page sizes for reference:
	 * - US Letter: 612 x 792 points (portrait) or 792 x 612 (landscape)
	 * - A4: 595 x 842 points (portrait) or 842 x 595 (landscape)
	 * - Legal: 612 x 1008 points
	 */

	function resetToDefault() {
		pdfSource = defaultPdf;
		sourceType = 'url';
		loadError = null;
	}

	async function rotateSourceType() {
		loadError = null;
		const types: Array<'url' | 'arraybuffer' | 'uint8array' | 'blob'> = [
			'url',
			'arraybuffer',
			'uint8array',
			'blob'
		];
		const currentIndex = types.indexOf(sourceType);
		const nextType = types[(currentIndex + 1) % types.length];

		try {
			// Fetch the PDF and convert to the next type
			const response = await fetch(defaultPdf);
			const arrayBuffer = await response.arrayBuffer();

			switch (nextType) {
				case 'url':
					pdfSource = defaultPdf;
					break;
				case 'arraybuffer':
					pdfSource = arrayBuffer;
					break;
				case 'uint8array':
					pdfSource = new Uint8Array(arrayBuffer);
					break;
				case 'blob':
					pdfSource = new Blob([arrayBuffer], { type: 'application/pdf' });
					break;
			}
			sourceType = nextType;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to convert PDF';
		}
	}

	async function loadInvalidPdf() {
		loadError = null;
		// This should trigger an error in the viewer
		pdfSource = 'https://invalid-url-that-does-not-exist.com/fake.pdf';
		sourceType = 'url';
	}

	function handlePdfError(error: string) {
		console.error('PDF Error (from callback):', error);
		loadError = `Callback received: ${error}`;
	}

	function handleTextHighlight(data: TextHighlightData) {
		highlightedText = data.text;
		// Position the tooltip above the selection
		tooltipPosition = {
			x: data.position.x,
			y: data.position.y - 10 // 10px above the selection
		};
	}

	function toggleBoundingBoxes() {
		showBoundingBoxes = !showBoundingBoxes;
	}

	function addRandomBoundingBox() {
		const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
		const randomColor = colors[Math.floor(Math.random() * colors.length)];

		const newBox: BoundingBox = {
			page: 1,
			x: Math.random() * 400 + 50,
			y: Math.random() * 500 + 100,
			width: Math.random() * 150 + 50,
			height: Math.random() * 100 + 50,
			borderColor: randomColor,
			fillColor: `${randomColor}33`,
			borderWidth: 2,
			borderRadius: Math.floor(Math.random() * 20),
			id: `box-${Date.now()}`
		};

		boundingBoxes = [...boundingBoxes, newBox];
	}

	function clearBoundingBoxes() {
		boundingBoxes = [];
	}

	function resetBoundingBoxes() {
		boundingBoxes = [
			{
				page: 1,
				x: 100,
				y: 500,
				width: 200,
				height: 100,
				borderColor: '#ff0000',
				fillColor: 'rgba(255, 0, 0, 0.1)',
				borderWidth: 2,
				borderRadius: 8,
				id: 'demo-box-1'
			},
			{
				page: 1,
				x: 350,
				y: 300,
				width: 150,
				height: 80,
				borderColor: '#0000ff',
				fillColor: 'rgba(0, 0, 255, 0.2)',
				borderWidth: 2,
				borderRadius: 12,
				id: 'demo-box-2'
			}
		];
	}
</script>

<div class="demo">
	<h1>PDF Viewer Demo</h1>

	<div class="controls">
		<div class="url-input">
			<label for="pdf-url">PDF URL:</label>
			<input
				id="pdf-url"
				type="text"
				value={typeof pdfSource === 'string' ? pdfSource : `[${sourceType}]`}
				oninput={(e) => {
					pdfSource = e.currentTarget.value;
					sourceType = 'url';
				}}
				placeholder="Enter PDF URL..."
			/>
		</div>
		<div class="buttons">
			<button onclick={resetToDefault}>Reset</button>
			<button onclick={rotateSourceType}>
				Rotate Source Type (current: {sourceType})
			</button>
			<button onclick={loadInvalidPdf} class="error-btn">Test Error Handling</button>
		</div>
		<div class="page-width-controls">
			<strong>Page Width:</strong>
			<label>
				<input type="checkbox" bind:checked={pageWidthEnabled} />
				Set page width
			</label>
			{#if pageWidthEnabled}
				<input type="range" min="200" max="1400" bind:value={pageWidthValue} />
				<input type="number" min="200" max="1400" bind:value={pageWidthValue} class="width-input" />
				<span>px</span>
			{/if}
		</div>
		<div class="bounding-box-controls">
			<strong>Bounding Boxes:</strong>
			<button onclick={toggleBoundingBoxes} class="bbox-btn">
				{showBoundingBoxes ? 'Hide' : 'Show'} Boxes ({boundingBoxes.length})
			</button>
			<button onclick={addRandomBoundingBox} class="bbox-btn">Add Random Box</button>
			<button onclick={resetBoundingBoxes} class="bbox-btn">Reset Boxes</button>
			<button onclick={clearBoundingBoxes} class="bbox-btn">Clear All</button>
			<button onclick={toggleDrawMode} class="draw-btn" class:active={drawMode}>
				{drawMode ? '✓ Drawing Mode ON' : 'Enable Drawing Mode'}
			</button>
		</div>
		{#if drawMode}
			<div class="draw-info">
				Click and drag on the PDF to draw bounding boxes (blue dashed border). Drawn boxes: {drawnBoxes.length}
			</div>
		{/if}
		{#if loadError}
			<div class="local-error">Local Error: {loadError}</div>
		{/if}
	</div>

	<div class="viewer-container">
		<PdfViewer
			src={pdfSource}
			onerror={handlePdfError}
			boundingBoxes={showBoundingBoxes ? boundingBoxes : []}
			onTextHighlighted={handleTextHighlight}
			pageWidth={pageWidthEnabled ? pageWidthValue : undefined}
			{drawMode}
			drawingStyle={{
				borderColor: '#0000ff',
				borderWidth: 2,
				borderStyle: 'dashed',
				fillColor: 'rgba(0, 0, 255, 0.1)',
				opacity: 1.0
			}}
			onBoundingBoxDrawn={handleBoundingBoxDrawn}
			onBoundingBoxClose={handleBoundingBoxClose}
			bind:currentPage
		>
			<ScrollDemo boundingBoxes={showBoundingBoxes ? boundingBoxes : []} />
			<div class="viewer-layout">
				<div class="thumbnail-sidebar">
					<PdfThumbnailViewer
						columns={1}
						width={120}
						gap={8}
						onPageClick={(page) => {
							currentPage = page;
						}}
					/>
				</div>
				<PdfRenderer
					backgroundColor="#e8e8e8"
					scrollbarThumbColor="#c1c1c1"
					scrollbarTrackColor="#f1f1f1"
				/>
			</div>
		</PdfViewer>
	</div>

	{#if highlightedText && tooltipPosition}
		<div class="highlight-tooltip" style="left: {tooltipPosition.x}px; top: {tooltipPosition.y}px;">
			{highlightedText}
		</div>
	{/if}
</div>

<style>
	.demo {
		display: flex;
		flex-direction: column;
		height: 100vh;
		padding: 1rem;
		box-sizing: border-box;
	}

	h1 {
		margin: 0 0 1rem 0;
	}

	.controls {
		margin-bottom: 1rem;
	}

	.url-input {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.url-input input {
		flex: 1;
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}

	.buttons {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.buttons button {
		padding: 0.5rem 1rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #f5f5f5;
		cursor: pointer;
	}

	.buttons button:hover {
		background: #e5e5e5;
	}

	.page-width-controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-top: 0.5rem;
	}

	.page-width-controls input[type='range'] {
		width: 200px;
	}

	.width-input {
		width: 70px;
		padding: 0.25rem 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		text-align: center;
	}

	.bounding-box-controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}

	.bbox-btn {
		padding: 0.5rem 1rem;
		border: 1px solid #4f46e5;
		border-radius: 4px;
		background: #eef2ff;
		cursor: pointer;
		color: #4f46e5;
	}

	.bbox-btn:hover {
		background: #ddd6fe;
	}

	.draw-btn {
		padding: 0.5rem 1rem;
		border: 1px solid #0ea5e9;
		border-radius: 4px;
		background: #e0f2fe;
		cursor: pointer;
		color: #0369a1;
	}

	.draw-btn:hover {
		background: #bae6fd;
	}

	.draw-btn.active {
		background: #0ea5e9;
		color: white;
		font-weight: 600;
	}

	.draw-info {
		margin-top: 0.5rem;
		padding: 0.5rem;
		background: #e0f2fe;
		border: 1px solid #0ea5e9;
		border-radius: 4px;
		color: #0369a1;
	}

	.error-btn {
		background: #fee2e2 !important;
		border-color: #fca5a5 !important;
	}

	.error-btn:hover {
		background: #fecaca !important;
	}

	.local-error {
		margin-top: 0.5rem;
		padding: 0.5rem;
		background: #fee2e2;
		border: 1px solid #fca5a5;
		border-radius: 4px;
		color: #b91c1c;
	}

	.viewer-container {
		flex: 1;
		min-height: 0;
		border: 1px solid #ccc;
		border-radius: 4px;
		overflow: hidden;
	}

	.viewer-layout {
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.thumbnail-sidebar {
		width: 150px;
		flex-shrink: 0;
		overflow-y: auto;
		border-right: 1px solid #ccc;
	}

	.highlight-tooltip {
		position: fixed;
		background: #1f2937;
		color: white;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.875rem;
		max-width: 300px;
		word-wrap: break-word;
		box-shadow:
			0 4px 6px -1px rgba(0, 0, 0, 0.1),
			0 2px 4px -1px rgba(0, 0, 0, 0.06);
		z-index: 1000;
		pointer-events: none;
		transform: translateY(-100%);
		animation: fadeIn 0.2s ease-in-out;
	}

	.highlight-tooltip::after {
		content: '';
		position: absolute;
		bottom: -6px;
		left: 20px;
		width: 0;
		height: 0;
		border-left: 6px solid transparent;
		border-right: 6px solid transparent;
		border-top: 6px solid #1f2937;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-100%) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(-100%) scale(1);
		}
	}
</style>
