<!-- Host the package region API demo with client-designed evidence dividers. -->
<script lang="ts">
	import SnippetDocument from '$snippets/SnippetDocument.svelte';
</script>

<svelte:head><title>Event evidence · PDF region API</title></svelte:head>
<main>
	<header>
		<div>
			<h1>Event evidence</h1>
			<p>Read the passages that matter, with the rest one click away.</p>
		</div>
		<span>Region API demo</span>
	</header>
	<SnippetDocument />
</main>

<style>
	main {
		max-width: 1360px;
		margin: 0 auto;
		padding: 28px 32px 16px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}
	h1 {
		font-size: 26px;
		letter-spacing: -0.6px;
		font-weight: 650;
		color: #263348;
		margin: 0 0 6px;
	}
	p {
		margin: 0;
		font-size: 13px;
		color: #617086;
	}
	header > span {
		font-size: 11px;
		color: #617086;
		border: 1px solid #d4dce5;
		padding: 5px 9px;
		border-radius: 20px;
	}
	@media (max-width: 800px) {
		main {
			padding: 16px 10px 8px;
		}
		header > span {
			display: none;
		}
		h1 {
			font-size: 22px;
		}
	}
</style>
