// Verify surface metrics and revisions without coupling consumers to renderer DOM.
import { afterEach, expect, it, vi } from 'vitest';
import { observeDocumentSurface } from './documentSurface.js';
afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});
it('reports column geometry and viewport movement without changing the layout revision on scroll', async () => {
	const viewport = document.createElement('div');
	const surface = document.createElement('div');
	const pages = document.createElement('div');
	const margin = document.createElement('div');
	viewport.append(surface);
	surface.append(pages, margin);
	document.body.append(viewport);
	let y = 0;
	let width = 300;
	vi.spyOn(viewport, 'clientWidth', 'get').mockReturnValue(900);
	vi.spyOn(viewport, 'clientHeight', 'get').mockReturnValue(500);
	vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 900, 500));
	vi.spyOn(surface, 'getBoundingClientRect').mockImplementation(
		() => new DOMRect(10, 20 - y, 900, 2000)
	);
	vi.spyOn(pages, 'getBoundingClientRect').mockImplementation(
		() => new DOMRect(10, 20 - y, 900 - width, 1900)
	);
	vi.spyOn(margin, 'getBoundingClientRect').mockImplementation(
		() => new DOMRect(910 - width, 20 - y, width, 2000)
	);
	const changed = vi.fn();
	const stop = observeDocumentSurface({ viewport, surface, pages, margin }, changed);
	await vi.waitFor(() => expect(changed).toHaveBeenCalled());
	const initial = changed.mock.lastCall![0];
	expect(initial.margin.x).toBe(600);
	expect(initial.height).toBe(2000);
	y = 200;
	viewport.scrollTop = 200;
	viewport.dispatchEvent(new Event('scroll'));
	await vi.waitFor(() => expect(changed.mock.lastCall![0].viewport.y).toBe(200));
	expect(changed.mock.lastCall![0].layoutRevision).toBe(initial.layoutRevision);
	width = 350;
	window.dispatchEvent(new Event('resize'));
	await vi.waitFor(() => expect(changed.mock.lastCall![0].margin.width).toBe(350));
	expect(changed.mock.lastCall![0].layoutRevision).toBeGreaterThan(initial.layoutRevision);
	stop();
	changed.mockClear();
	window.dispatchEvent(new Event('resize'));
	await new Promise((resolve) => setTimeout(resolve, 30));
	expect(changed).not.toHaveBeenCalled();
});
