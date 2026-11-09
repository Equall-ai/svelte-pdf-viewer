// Verify reusable PDF overlay placement, transformed anchors, and observer lifetimes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createAnchorRegistry,
	observePdfAnchor,
	observePdfDocumentAnchor,
	placePdfOverlay
} from './overlayAnchor.js';

const rect = (x: number, y: number, width: number, height: number) =>
	new DOMRect(x, y, width, height);
const anchor = { page: 2, x_min: 10, y_min: 20, x_max: 40, y_max: 30 };
afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('placement', () => {
	it('aligns to the end above the anchor and flips below when needed', () => {
		const viewport = rect(20, 30, 300, 400);
		expect(placePdfOverlay({ anchor: rect(100, 150, 80, 20), viewport }, 100, 24)).toEqual({
			left: 80,
			top: 120
		});
		expect(placePdfOverlay({ anchor: rect(20, 32, 40, 20), viewport }, 100, 24)).toEqual({
			left: 20,
			top: 58
		});
	});
	it('supports start/center alignment, bottom placement and custom gaps', () => {
		const bounds = { anchor: rect(100, 150, 80, 20), viewport: rect(0, 0, 500, 500) };
		expect(placePdfOverlay(bounds, 40, 24, { side: 'bottom', align: 'start', gap: 10 })).toEqual({
			left: 100,
			top: 180
		});
		expect(placePdfOverlay(bounds, 40, 24, { align: 'center' })).toEqual({ left: 120, top: 120 });
	});
	it('hides offscreen anchors and overlays too large to fit', () => {
		const viewport = rect(0, 0, 300, 300);
		expect(placePdfOverlay({ anchor: rect(0, 500, 80, 20), viewport }, 100, 24)).toBeNull();
		expect(placePdfOverlay({ anchor: rect(0, 100, 80, 20), viewport }, 400, 24)).toBeNull();
	});
});

function setup() {
	const host = document.createElement('div');
	document.body.append(host);
	const root = host.attachShadow({ mode: 'open' });
	const viewport = document.createElement('div');
	root.append(viewport);
	vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 600, 500));
	vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 600, 500));
	const page = document.createElement('div');
	page.dataset.pageNumber = '2';
	const changed = vi.fn();
	return { host, root, viewport, page, changed };
}

it('waits for a page, measures its transformed rectangle, tracks scroll/remount, and disposes', async () => {
	const { host, root, viewport, page, changed } = setup();
	let bounds = rect(50, 100, 200, 20);
	const native = HTMLElement.prototype.getBoundingClientRect;
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
		this: HTMLElement
	) {
		return this.hasAttribute('data-pdf-anchor-probe') ? bounds : native.call(this);
	});
	const stop = observePdfAnchor({ host, root, viewport }, anchor, changed);
	await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith(null));
	viewport.append(page);
	await vi.waitFor(() => expect(changed.mock.lastCall?.[0]?.anchor).toEqual(bounds));
	const probe = page.querySelector<HTMLElement>('[data-pdf-anchor-probe]')!;
	expect(probe.style.left).toBe('10%');
	expect(probe.style.width).toBe('30%');
	expect(probe.style.pointerEvents).toBe('none');
	bounds = rect(80, 20, 40, 200);
	page.style.transform = 'rotate(90deg) scale(.8)';
	await vi.waitFor(() => expect(changed.mock.lastCall?.[0]?.anchor).toEqual(bounds));
	bounds = rect(80, -300, 40, 200);
	viewport.dispatchEvent(new Event('scroll'));
	await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith(null));
	page.remove();
	bounds = rect(20, 100, 300, 25);
	const replacement = page.cloneNode(false) as HTMLElement;
	viewport.append(replacement);
	await vi.waitFor(() => expect(changed.mock.lastCall?.[0]?.anchor).toEqual(bounds));
	expect(replacement.querySelector('[data-pdf-anchor-probe]')).toBeTruthy();
	stop();
	expect(replacement.querySelector('[data-pdf-anchor-probe]')).toBeNull();
	changed.mockClear();
	window.dispatchEvent(new Event('resize'));
	await new Promise((resolve) => setTimeout(resolve, 40));
	expect(changed).not.toHaveBeenCalled();
});

it('resolves a registered bounding box without assuming CSS-safe IDs', async () => {
	const { host, root, viewport, page, changed } = setup();
	viewport.append(page);
	const box = document.createElement('div');
	box.dataset.boxId = 'box["special"]';
	vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(rect(20, 100, 50, 20));
	const stop = observePdfAnchor({ host, root, viewport }, { boxId: box.dataset.boxId }, changed);
	page.append(box);
	await vi.waitFor(() => expect(changed.mock.lastCall?.[0]?.anchor.width).toBe(50));
	box.remove();
	await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith(null));
	stop();
});

it('clips to the host and visible window, and reacts to resize', async () => {
	const { host, root, viewport, page, changed } = setup();
	viewport.append(page);
	const box = document.createElement('div');
	box.dataset.boxId = 'box';
	page.append(box);
	vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(rect(20, 100, 50, 20));
	vi.mocked(host.getBoundingClientRect).mockReturnValue(rect(10, 50, 400, 300));
	const stop = observePdfAnchor({ host, root, viewport }, { boxId: 'box' }, changed);
	await vi.waitFor(() =>
		expect(changed.mock.lastCall?.[0]?.viewport).toEqual(rect(10, 50, 400, 300))
	);
	vi.mocked(host.getBoundingClientRect).mockReturnValue(rect(10, 200, 400, 300));
	window.dispatchEvent(new Event('resize'));
	await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith(null));
	stop();
});

it('queues subscriptions until renderer mount and retires replaced renderers', () => {
	const registry = createAnchorRegistry();
	const changed = vi.fn();
	const firstStop = vi.fn();
	const first = vi.fn(() => firstStop);
	const stop = registry.observe(anchor, changed);
	expect(changed).toHaveBeenLastCalledWith(null);
	const detachFirst = registry.attach(first);
	expect(first).toHaveBeenCalledOnce();
	const secondStop = vi.fn();
	const second = vi.fn(() => secondStop);
	const detachSecond = registry.attach(second);
	expect(firstStop).toHaveBeenCalledOnce();
	detachFirst();
	expect(secondStop).not.toHaveBeenCalled();
	stop();
	expect(secondStop).toHaveBeenCalledOnce();
	detachSecond();
	registry.attach(first);
	expect(first).toHaveBeenCalledOnce();
});

it('retains document coordinates offscreen and separates scrolling from layout revisions', async () => {
	const { host, root, viewport, page, changed } = setup();
	const surface = document.createElement('div');
	viewport.append(surface);
	surface.append(page);
	let scrollTop = 0;
	vi.spyOn(surface, 'getBoundingClientRect').mockImplementation(() =>
		rect(0, -scrollTop, 600, 2000)
	);
	const box = document.createElement('div');
	box.dataset.boxId = 'persistent';
	page.append(box);
	vi.spyOn(box, 'getBoundingClientRect').mockImplementation(() =>
		rect(20, 1000 - scrollTop, 50, 20)
	);
	let revision = 1;
	const stop = observePdfDocumentAnchor(
		{ host, root, viewport, surface, layoutRevision: () => revision },
		{ boxId: 'persistent' },
		changed
	);
	await vi.waitFor(() =>
		expect(changed.mock.lastCall?.[0]).toMatchObject({
			rect: rect(20, 1000, 50, 20),
			visible: false,
			layoutRevision: 1
		})
	);
	scrollTop = 800;
	viewport.scrollTop = 800;
	viewport.dispatchEvent(new Event('scroll'));
	await vi.waitFor(() =>
		expect(changed.mock.lastCall?.[0]).toMatchObject({
			rect: rect(20, 1000, 50, 20),
			visible: true,
			layoutRevision: 1
		})
	);
	revision = 2;
	page.style.width = '800px';
	await vi.waitFor(() => expect(changed.mock.lastCall?.[0]?.layoutRevision).toBe(2));
	stop();
	changed.mockClear();
	window.dispatchEvent(new Event('resize'));
	await new Promise((resolve) => setTimeout(resolve, 40));
	expect(changed).not.toHaveBeenCalled();
});
