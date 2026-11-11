// Configure browser-like unit tests and the isolated snippet demo alias.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		conditions: ['browser'],
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			$snippets: fileURLToPath(new URL('./src/routes/snippets', import.meta.url))
		}
	},
	test: {
		environment: 'happy-dom',
		include: ['src/**/*.test.ts']
	}
});
