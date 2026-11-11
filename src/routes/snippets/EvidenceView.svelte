<!-- Client-owned toolbar and gap dividers exercise the exported region API. -->
<script lang="ts">
	import { PdfRenderer, getPdfViewerContext, type PdfRegion } from '$lib/index.js';
	let {
		regions,
		title,
		onFullDocument
	}: { regions: readonly PdfRegion[] | null; title: string; onFullDocument: () => void } = $props();
	const { state: viewerState, actions } = getPdfViewerContext();
	let query = $state('');
	let spacious = $state(false);
	let defaultDividers = $state(false);
	let motion = $state(true);
</script>

<div class="toolbar">
	<div>
		<strong>{title}</strong><span>Page {viewerState.currentPage} / {viewerState.totalPages}</span>
	</div>
	<nav aria-label="Evidence controls">
		<button onclick={actions.zoomOut} aria-label="Zoom out">−</button><button
			onclick={actions.zoomIn}
			aria-label="Zoom in">+</button
		>
		<button onclick={actions.rotateClockwise}>Rotate</button>
		{#if regions !== null}<button onclick={actions.resetRegionExpansion}>Reset context</button
			><button onclick={onFullDocument}>Full document</button>{/if}
	</nav>
</div>
<form
	class="search"
	onsubmit={(e) => {
		e.preventDefault();
		void actions.search(query);
	}}
>
	<input
		aria-label="Search entire source document"
		placeholder="Search the entire source…"
		bind:value={query}
	/>
	<button type="submit">Find</button><button type="button" onclick={actions.searchNext}
		>Next match</button
	>
	{#if viewerState.searchQuery}<span>{viewerState.searchCurrent} / {viewerState.searchTotal}</span
		><button
			type="button"
			onclick={() => {
				query = '';
				actions.clearSearch();
			}}>Clear</button
		>{/if}
</form>
<div class="options">
	<label><input type="checkbox" bind:checked={spacious} /> Taller dividers</label>
	<label><input type="checkbox" bind:checked={motion} /> Animate context</label>
	<label><input type="checkbox" bind:checked={defaultDividers} /> Default dividers</label>
	<button onclick={() => actions.goToPage(4)}>Go to page 4</button>
	<button onclick={() => void actions.download()}>Download source</button>
</div>
{#if regions?.length === 0}<div class="empty">
		<strong>No evidence in this document</strong>
		<p>This Event has no attached passages.</p>
		<button onclick={onFullDocument}>View full document</button>
	</div>{/if}
{#if viewerState.error}<p role="alert">{viewerState.error}</p>{/if}
<PdfRenderer
	{regions}
	contextPadding={24}
	regionTransitionDuration={motion ? 220 : 0}
	expansionStep={0.2}
	backgroundColor="#edf0f4"
	gap={defaultDividers ? undefined : divider}
/>
{#snippet divider(gap: import('$lib/index.js').PdfGapContext)}
	<div class="divider" class:spacious aria-busy={gap.pending}>
		<span class="range"
			>··· {gap.hiddenRange ? 'Hidden context' : 'Expanded context'} · pages {gap.range.start
				.page}–{gap.range.end.page}</span
		>
		<div class="gap-actions">
			{#if gap.hiddenRange && gap.before}<button
					disabled={gap.pending}
					onclick={gap.revealFromStart}>↓ Show more below</button
				>{/if}
			{#if gap.hiddenRange && gap.before && gap.after}<button
					disabled={gap.pending}
					onclick={gap.revealAll}>Show all between</button
				>{/if}
			{#if gap.hiddenRange && gap.after}<button disabled={gap.pending} onclick={gap.revealFromEnd}
					>↑ Show more above</button
				>{/if}
			<button hidden={!gap.canCollapse} disabled={gap.pending} onclick={gap.collapse}
				>Collapse context</button
			>
		</div>
		{#if gap.error}<p role="alert">{gap.error}</p>{/if}
	</div>
{/snippet}

<style>
	.toolbar {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 18px;
		background: white;
		border-bottom: 1px solid #dbe2e9;
		flex-wrap: wrap;
		font-size: 12px;
	}
	.toolbar > div {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.toolbar span {
		color: #718096;
	}
	nav {
		display: flex;
		gap: 6px;
	}
	button {
		font: inherit;
		cursor: pointer;
		border: 1px solid #dbe2e9;
		background: white;
		border-radius: 4px;
		padding: 6px 9px;
		color: #395777;
	}
	button:disabled {
		cursor: wait;
		opacity: 0.55;
	}
	button:hover:not(:disabled) {
		background: #f0f5fb;
	}
	button:focus-visible {
		outline: 2px solid #4671aa;
		outline-offset: 2px;
	}
	.search {
		display: flex;
		gap: 6px;
		padding: 8px 18px;
		background: #fff;
		align-items: center;
		font-size: 12px;
	}
	.search input {
		flex: 1;
		min-width: 80px;
		padding: 6px 9px;
		border: 1px solid #dbe2e9;
		border-radius: 4px;
		font: inherit;
	}
	.options {
		display: flex;
		gap: 14px;
		align-items: center;
		flex-wrap: wrap;
		padding: 6px 18px;
		background: white;
		font-size: 11px;
		color: #64748b;
	}
	.options button {
		border: 0;
		padding: 2px;
	}
	.options label {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.divider {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 7px;
		padding: 12px 6px;
		color: #5b6c83;
		background: #eaf0f8;
		border-block: 1px solid #d4dfed;
		font:
			12px -apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}
	.divider.spacious {
		padding-block: 38px;
	}
	.range {
		font-size: 11px;
		letter-spacing: 0.2px;
	}
	.gap-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: center;
	}
	.divider button {
		background: transparent;
		border-color: transparent;
		padding: 3px 8px;
		color: #315f98;
	}
	.empty {
		text-align: center;
		padding: 35px 20px;
		font-size: 14px;
	}
	.empty p {
		color: #64748b;
		font-size: 13px;
	}
	@media (max-width: 600px) {
		.toolbar {
			padding: 10px;
		}
		.search {
			padding: 6px;
		}
		.options {
			gap: 8px;
			padding: 6px;
		}
		.toolbar > div {
			flex-wrap: wrap;
			gap: 4px;
		}
	}
</style>
