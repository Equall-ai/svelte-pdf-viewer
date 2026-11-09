<!-- Render review-like cards and connectors without coupling the package to citation semantics. -->
<script lang="ts">
	import { PdfRenderer, getPdfViewerContext, type PdfDocumentAnchorGeometry } from '$lib/index.js';
	const context = getPdfViewerContext();
	let width = $state(288);
	let open = $state(true);
	let overflow = $state(false);
	let clicks = $state(0);
	let note = $state('');
	let geometry = $state.raw<PdfDocumentAnchorGeometry | null>(null);
	const anchor = { page: 1, x_min: 15, x_max: 75, y_min: 40, y_max: 45 };
	$effect(() => context.observeDocumentAnchor(anchor, (next) => (geometry = next)));
</script>

<div class="controls">
	<button onclick={() => (open = !open)}>Toggle margin</button>
	<label
		>Margin width <input
			aria-label="Margin width"
			type="range"
			min="180"
			max="420"
			bind:value={width}
		/></label
	>
	<button onclick={() => context.actions.zoomIn()}>Zoom in</button>
	<button onclick={() => context.actions.zoomOut()}>Zoom out</button>
	<button onclick={() => context.actions.rotateClockwise()}>Rotate</button>
	<button onclick={() => context.actions.goToPage(1)}>Page 1</button>
	<button onclick={() => context.actions.goToPage(2)}>Page 2</button>
	<label><input type="checkbox" bind:checked={overflow} />Tall margin</label>
	<span data-anchor-status>{geometry?.visible ? 'Anchor visible' : 'Anchor offscreen'}</span>
</div>
<PdfRenderer marginWidth={open ? width : 0}>
	{#snippet margin(surface)}
		<div
			class="margin"
			data-layout-revision={surface.layoutRevision}
			style:min-height={(overflow ? surface.pages.height + 500 : surface.pages.height) + 'px'}
		>
			{#if geometry}
				<section class="card" style:top={geometry.rect.y + 'px'}>
					<strong>Passage review</strong>
					<p>This card and its connector scroll with the PDF. The text is selectable.</p>
					<button onclick={() => clicks++}>Interactions: {clicks}</button>
					<label
						>Note <input
							aria-label="Review note"
							bind:value={note}
							placeholder="Keep typing while resizing"
						/></label
					>
				</section>
			{/if}
			{#if overflow}<p class="end">End of margin content</p>{/if}
		</div>
	{/snippet}
	{#snippet surfaceOverlay(surface)}
		{#if open && geometry}
			<svg width={surface.width} height={surface.height} aria-hidden="true">
				<path
					d={'M ' +
						(geometry.rect.x + geometry.rect.width) +
						' ' +
						(geometry.rect.y + geometry.rect.height / 2) +
						' H ' +
						(surface.margin.x + 6) +
						' V ' +
						(geometry.rect.y + 20) +
						' H ' +
						(surface.margin.x + 12)}
					fill="none"
					stroke="#2586d6"
					stroke-width="1.5"
					stroke-linejoin="round"
				/>
			</svg>
		{/if}
	{/snippet}
</PdfRenderer>

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 8px;
		font: 12px system-ui;
		background: #fff;
	}
	.margin {
		position: relative;
		background: #fafafa;
		box-shadow: inset 8px 0 12px -12px #000;
	}
	.card {
		position: absolute;
		left: 12px;
		right: 12px;
		padding: 16px;
		border: 1px solid #ebedf0;
		border-radius: 12px;
		background: #fff;
		font: 14px system-ui;
		box-shadow: 0 2px 5px #0001;
	}
	.card p {
		color: #484848;
		line-height: 1.5;
	}
	.card label {
		display: block;
		margin-top: 12px;
	}
	.card input {
		width: 100%;
		box-sizing: border-box;
	}
	.end {
		position: absolute;
		bottom: 12px;
		left: 16px;
		font: 14px system-ui;
	}
</style>
