<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getBoundingBoxAnchorId, type BoundingBox } from './BoundingBoxLayer.js';
	import type { PageDimensions, PdfViewerContext } from './context.js';
	import PdfAnchoredOverlay from '../PdfAnchoredOverlay.svelte';

	interface Props {
		context: PdfViewerContext;
		/** Bounding boxes to render close buttons for */
		boxes: BoundingBox[];
		/** Current scale of the PDF viewer */
		scale: number;
		/** Page dimensions map (unscaled, in PDF points) */
		pageDimensions: Map<number, PageDimensions>;
		/** Shadow root containing the PDF pages */
		shadowRoot: ShadowRoot | null;
		/** Callback when a bounding box is closed */
		onClose?: (box: BoundingBox) => void;
	}

	let { context, boxes, scale, pageDimensions, shadowRoot, onClose }: Props = $props();

	// Filter boxes that should show close button
	let closableBoxes = $derived(boxes.filter((box) => box.showClose));

	// Container element reference
	let containerEl: HTMLDivElement | undefined = $state();

	// Force re-render on scroll/resize
	let updateTrigger = $state(0);

	/**
	 * Calculate the position of a bounding box relative to the container
	 */
	function getBoxPosition(box: BoundingBox) {
		const pageDims = pageDimensions.get(box.page);
		if (!pageDims || !shadowRoot || !containerEl) return null;

		// Find the page div in the shadow DOM
		const pageDiv = shadowRoot.querySelector(`.page[data-page-number="${box.page}"]`);
		if (!pageDiv) return null;

		const pageRect = pageDiv.getBoundingClientRect();
		const containerRect = containerEl.getBoundingClientRect();

		// Convert PDF coordinates (bottom-origin) to screen coordinates (top-origin)
		const pageHeight = pageDims.height * scale;
		const boxTopInPage = pageHeight - (box.y + box.height) * scale;
		const boxLeftInPage = box.x * scale;
		const boxWidthScaled = box.width * scale;
		const boxHeightScaled = box.height * scale;

		// Position relative to the container
		return {
			left: pageRect.left - containerRect.left + boxLeftInPage,
			top: pageRect.top - containerRect.top + boxTopInPage,
			width: boxWidthScaled,
			height: boxHeightScaled
		};
	}

	/**
	 * Handle close button click
	 */
	function handleClose(box: BoundingBox) {
		onClose?.(box);
	}

	/**
	 * Allow wheel events to pass through to the scroll container
	 */
	function handleWheel(event: WheelEvent) {
		if (scrollContainer) {
			// Pass the wheel event to the scroll container
			scrollContainer.scrollTop += event.deltaY;
			scrollContainer.scrollLeft += event.deltaX;
		}
	}

	// Update positions on scroll
	let scrollContainer: HTMLElement | null = null;

	function handleUpdate() {
		updateTrigger++;
	}

	onMount(() => {
		if (shadowRoot) {
			scrollContainer = shadowRoot.querySelector('.pdf-scroll-container');
			if (scrollContainer) {
				scrollContainer.addEventListener('scroll', handleUpdate);
				window.addEventListener('resize', handleUpdate);
			}
		}
	});

	onDestroy(() => {
		if (scrollContainer) {
			scrollContainer.removeEventListener('scroll', handleUpdate);
			window.removeEventListener('resize', handleUpdate);
		}
	});
</script>

<div bind:this={containerEl} class="overlay-container">
	{#each boxes.filter((box) => box.overlay) as box (box.id ?? box)}
		{#if box.overlay}
			<PdfAnchoredOverlay
				{context}
				anchor={{ boxId: getBoundingBoxAnchorId(box) }}
				{...box.overlayPlacement}
			>
				{#snippet children({ visible })}
					{@render box.overlay?.({ box, visible })}
				{/snippet}
			</PdfAnchoredOverlay>
		{/if}
	{/each}
	{#key updateTrigger}
		{#each closableBoxes as box (box.id)}
			{@const position = getBoxPosition(box)}
			{#if position}
				<div
					class="bounding-box-close-wrapper"
					style:left="{position.left}px"
					style:top="{position.top}px"
					style:width="{position.width}px"
					style:height="{position.height}px"
				>
					<div class="close-button-container" onwheel={handleWheel}>
						{#if box.closeButton}
							{@render box.closeButton({ close: () => handleClose(box), box })}
						{:else}
							<!-- Default close button -->
							<button
								type="button"
								class="default-close-button"
								onclick={() => handleClose(box)}
								aria-label="Close"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="12"
									height="12"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							</button>
						{/if}
					</div>
				</div>
			{/if}
		{/each}
	{/key}
</div>

<style>
	.overlay-container {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 1000;
		/* Allow scrolling through the overlay */
		overflow: visible;
	}

	.bounding-box-close-wrapper {
		position: absolute;
		pointer-events: none;
	}

	.close-button-container {
		position: absolute;
		top: -8px;
		right: -8px;
		pointer-events: auto;
	}

	.default-close-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background-color: rgba(0, 0, 0, 0.6);
		color: white;
		cursor: pointer;
		transition: background-color 0.2s;
		user-select: none;
	}

	.default-close-button:hover {
		background-color: rgba(0, 0, 0, 0.9);
	}

	.default-close-button:active {
		transform: scale(0.95);
	}
</style>
