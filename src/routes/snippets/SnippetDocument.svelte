<!-- Demonstrate source-region filtering using only the package's public API. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { PdfViewer, type BoundingBox, type PdfRegion } from '$lib/index.js';
	import { createFixture, events } from '$snippets/fixture.js';
	import EvidenceView from '$snippets/EvidenceView.svelte';
	let bytes = $state.raw<Uint8Array | null>(null);
	let error = $state<string | null>(null);
	let selected = $state(events[0].id);
	let active = $state<string | null>(null);
	let width = $state(720);
	let includeForm = $state(false);
	async function reloadFixture() {
		try {
			bytes = await createFixture(includeForm);
			error = null;
		} catch (e) {
			error = String(e);
		}
	}
	const activeEvent = $derived(events.find((e) => e.id === active));
	const regions = $derived<readonly PdfRegion[] | null>(activeEvent?.citations ?? null);
	const boxes = $derived<BoundingBox[]>(
		(activeEvent?.citations ?? []).map((c) => ({
			id: c.id,
			page: c.page,
			x: (c.x_min / 100) * 612,
			y: ((100 - c.y_max) / 100) * 792,
			width: ((c.x_max - c.x_min) / 100) * 612,
			height: ((c.y_max - c.y_min) / 100) * 792,
			fillColor: '#fbbf2438',
			borderColor: '#b48522',
			borderWidth: 1
		}))
	);
	onMount(() => {
		void reloadFixture();
	});
</script>

<div class="workspace">
	<aside aria-label="Sample Events">
		<label class="fixture-toggle"
			><input type="checkbox" bind:checked={includeForm} onchange={() => void reloadFixture()} /> Include
			PDF form example</label
		>
		<div class="aside-heading">TIMELINE <span>{events.length} Events</span></div>
		{#each events as event (event.id)}
			<article class:active={active === event.id} class:selected={selected === event.id}>
				<button
					class="select"
					onclick={() => (selected = event.id)}
					aria-pressed={selected === event.id}
				>
					<small>{event.date}</small><strong>{event.title}</strong><span>{event.detail}</span>
				</button>
				<footer>
					<span>{event.citations.length} citations</span><button
						class="evidence"
						onclick={() => {
							selected = event.id;
							active = event.id;
						}}>Show event evidence</button
					>
				</footer>
			</article>
		{/each}
		<p class="hint">
			Choose “Show event evidence” to focus the document. Selecting a card alone keeps your current
			view.
		</p>
	</aside>
	<section class="document" bind:clientWidth={width} aria-label="Document evidence">
		{#if error}<p role="alert">{error}</p>{/if}
		{#if bytes}
			<PdfViewer
				src={bytes}
				boundingBoxes={boxes}
				pageWidth={Math.max(260, Math.min(740, width - 40))}
				downloadFilename="northstar-source.pdf"
			>
				<EvidenceView
					{regions}
					title={activeEvent?.title ?? 'Full document'}
					onFullDocument={() => (active = null)}
				/>
			</PdfViewer>
		{:else}<p>Preparing sample document…</p>{/if}
	</section>
</div>

<style>
	.fixture-toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: #64748b;
		margin: 0 0 14px;
	}
	.workspace {
		display: grid;
		grid-template-columns: 290px minmax(0, 1fr);
		gap: 24px;
		height: calc(100vh - 140px);
		min-height: 450px;
		color: #263348;
	}
	aside {
		overflow: auto;
		padding: 4px 2px;
	}
	.aside-heading {
		font-size: 11px;
		letter-spacing: 1.3px;
		font-weight: 650;
		display: flex;
		justify-content: space-between;
		margin-bottom: 16px;
	}
	.aside-heading span {
		font-weight: 400;
		letter-spacing: 0;
		color: #64748b;
	}
	article {
		border: 1px solid #dbe2e9;
		background: white;
		border-radius: 8px;
		margin-bottom: 12px;
		overflow: hidden;
	}
	article.selected {
		border-color: #899bb5;
	}
	article.active {
		border-color: #4671aa;
		box-shadow: 0 0 0 1px #4671aa;
	}
	button {
		font: inherit;
		cursor: pointer;
	}
	.select {
		display: flex;
		flex-direction: column;
		text-align: left;
		gap: 8px;
		width: 100%;
		padding: 16px;
		border: 0;
		background: transparent;
		color: inherit;
	}
	.select small {
		font-size: 11px;
		color: #718096;
	}
	.select strong {
		font-size: 15px;
		font-weight: 600;
	}
	.select span {
		font-size: 12px;
		line-height: 1.5;
		color: #64748b;
	}
	footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 14px;
		border-top: 1px solid #eef1f5;
		font-size: 11px;
		color: #718096;
	}
	.evidence {
		background: #edf3fc;
		border: 0;
		border-radius: 4px;
		padding: 7px;
		color: #315f98;
		font-size: 11px;
	}
	.hint {
		font-size: 12px;
		line-height: 1.6;
		color: #718096;
		padding: 4px 12px;
	}
	.document {
		min-width: 0;
		min-height: 0;
		border: 1px solid #dbe2e9;
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		background: #edf0f4;
	}
	@media (max-width: 800px) {
		.workspace {
			display: flex;
			flex-direction: column;
			gap: 12px;
			height: calc(100dvh - 100px);
		}
		aside {
			display: flex;
			flex: none;
			gap: 10px;
			overflow: auto;
		}
		article {
			min-width: 235px;
			margin: 0;
		}
		.aside-heading,
		.hint {
			display: none;
		}
		.select {
			padding: 10px;
			gap: 5px;
		}
		footer {
			padding: 8px;
		}
		.document {
			flex: 1;
		}
	}
</style>
