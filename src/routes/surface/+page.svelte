<!-- Demonstrate a shared PDF/margin scrolling surface with application-owned cards. -->
<script lang="ts">
	import { base } from '$app/paths';
	import { PdfViewer } from '$lib/index.js';
	import SurfaceDemo from './SurfaceDemo.svelte';
	let revision = $state(0);
	let currentPage = $state(1);
</script>

<div class="demo">
	<h1>Document surface</h1>
	<p>One scrollbar for the PDF and its margin. Cards use document coordinates.</p>
	<button onclick={() => revision++}>Replace document</button>
	<span>Page {currentPage}</span>
	<div class="viewer">
		<PdfViewer src={base + '/Demo.pdf?revision=' + revision} bind:currentPage>
			<SurfaceDemo />
		</PdfViewer>
	</div>
</div>

<style>
	.demo {
		max-width: 1200px;
		margin: 24px auto;
		font-family: system-ui;
		color: #1a1a1a;
	}
	h1 {
		font-size: 24px;
		margin-bottom: 4px;
	}
	p {
		color: #484848;
	}
	.viewer {
		height: min(680px, calc(100dvh - 150px));
		resize: both;
		overflow: hidden;
		border: 1px solid #ddd;
		margin-top: 12px;
	}
</style>
