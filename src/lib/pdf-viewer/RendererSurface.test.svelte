<!-- Exercise application-owned snippets across renderer layout changes. -->
<script lang="ts">
	import PdfViewer from '../PdfViewer.svelte';
	import PdfRenderer from '../PdfRenderer.svelte';
	import type { PdfSource } from './context.js';
	let source = $state<PdfSource>('');
	export function setSource(next: PdfSource) {
		source = next;
	}
	let width = $state(288);
	let count = $state(0);
</script>

<button onclick={() => (width = width ? 0 : 288)}>Toggle margin</button>
<PdfViewer src={source}>
	<PdfRenderer marginWidth={width}>
		{#snippet margin(surface)}
			<button data-margin-button onclick={() => count++}>Count {count}</button>
			<span data-revision>{surface.layoutRevision}</span>
		{/snippet}
		{#snippet surfaceOverlay(surface)}<svg data-connector width={surface.width}></svg>{/snippet}
	</PdfRenderer>
</PdfViewer>
