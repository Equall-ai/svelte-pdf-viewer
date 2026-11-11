<!-- Reproducible browser measurements for source size, region generation, and warmed expansion. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { runBenchmark, type BenchmarkResult } from '$snippets/benchmark/run.js';
	let host: HTMLDivElement;
	let running = $state(false),
		progress = $state(''),
		results = $state<BenchmarkResult[]>([]);
	async function run() {
		running = true;
		results = [];
		try {
			for (const sample of [
				{ pages: 100, scan: false },
				{ pages: 1000, scan: false },
				{ pages: 100, scan: true }
			]) {
				progress = `Measuring ${sample.pages} ${sample.scan ? 'image' : 'text'} pages…`;
				results = [...results, await runBenchmark(host, sample.pages, sample.scan)];
			}
			progress = 'Complete';
		} catch (e) {
			progress = String(e);
		} finally {
			running = false;
		}
	}
</script>

<h1>PDF region performance</h1>
<p>
	Synthetic text and image PDFs. All times exclude fixture generation and network transfer.
	Animation is disabled to isolate processing.
</p>
<button disabled={running} onclick={run}>Run benchmark</button>
<span role="status">{progress}</span>
<pre>{JSON.stringify(results, null, 2)}</pre>
<div class="viewport" bind:this={host}></div>
<a href={resolve('/snippets')}>Back to snippet demo</a>

<style>
	:global(body) {
		font-family: system-ui;
	}
	.viewport {
		width: 700px;
		max-width: 100%;
		height: 500px;
		overflow: auto;
		position: relative;
	}
	.viewport :global(.pdfViewer) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	}
	pre {
		font-size: 12px;
		white-space: pre-wrap;
	}
</style>
