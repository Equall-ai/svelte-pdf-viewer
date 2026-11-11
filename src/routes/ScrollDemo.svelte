<script lang="ts">
	import { getPdfViewerContext, type BoundingBox } from '$lib/index.js';

	let {
		boundingBoxes
	}: {
		boundingBoxes: BoundingBox[];
	} = $props();

	const { actions } = getPdfViewerContext();

	function scrollToBox(box: BoundingBox) {
		// Calculate the center of the bounding box
		const centerX = box.x + box.width / 2;
		const centerY = box.y + box.height / 2;
		actions.scrollToCoordinates(box.page, centerX, centerY);
	}
</script>

<div class="scroll-demo">
	<strong>Scroll to Box:</strong>
	{#each boundingBoxes as box, i (box.id ?? i)}
		<button onclick={() => scrollToBox(box)} class="scroll-btn">
			Box {i + 1}
		</button>
	{/each}
</div>

<style>
	.scroll-demo {
		position: absolute;
		top: 60px;
		right: 10px;
		z-index: 100;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		background: white;
		padding: 0.5rem;
		border-radius: 4px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.scroll-btn {
		padding: 0.4rem 0.8rem;
		border: 1px solid #10b981;
		border-radius: 4px;
		background: #d1fae5;
		cursor: pointer;
		color: #065f46;
		font-size: 0.875rem;
	}

	.scroll-btn:hover {
		background: #a7f3d0;
	}
</style>
