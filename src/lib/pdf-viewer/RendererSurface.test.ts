// Ensure slotted Svelte content survives layout changes and renderer disposal.
import { expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Harness from './RendererSurface.test.svelte';
const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('./pdfjs-singleton.js', () => ({
	getPdfJs: async () => ({ getDocument }),
	getPdfWorker: () => undefined
}));
it('keeps margin content in light DOM and preserves its state when hidden', async () => {
	const target = document.createElement('div');
	document.body.append(target);
	const instance = mount(Harness, { target });
	flushSync();
	try {
		await vi.waitFor(() => expect(target.querySelector('[data-margin-button]')).toBeTruthy());
		const button = target.querySelector<HTMLButtonElement>('[data-margin-button]')!;
		expect(button.getRootNode()).toBe(document);
		expect(button.parentElement!.slot).toBe('margin');
		button.click();
		flushSync();
		expect(button.textContent).toContain('Count 1');
		const toggle = target.querySelector('button')!;
		toggle.click();
		flushSync();
		expect(button.parentElement!.hidden).toBe(true);
		toggle.click();
		flushSync();
		expect(target.querySelector('[data-margin-button]')).toBe(button);
		expect(button.textContent).toContain('Count 1');
		const shadow = target.querySelector('.pdf-renderer-host')!.shadowRoot!;
		expect(
			shadow.querySelector('.pdf-scroll-container .pdf-margin-column slot')?.getAttribute('name')
		).toBe('margin');
		expect(shadow.querySelectorAll('.pdf-scroll-container')).toHaveLength(1);
	} finally {
		await unmount(instance);
		target.remove();
	}
});

it('ignores Blob conversion that finishes after a newer source starts', async () => {
	getDocument.mockImplementation(() => {
		let reject!: (error: Error) => void;
		return {
			promise: new Promise((_resolve, fail) => (reject = fail)),
			destroy: async () => reject(new Error('Cancelled'))
		};
	});
	const target = document.createElement('div');
	document.body.append(target);
	const instance = mount(Harness, { target });
	flushSync();
	let release!: (buffer: ArrayBuffer) => void;
	const blob = new Blob(['old']);
	const conversion = vi
		.spyOn(blob, 'arrayBuffer')
		.mockReturnValue(new Promise((resolve) => (release = resolve)));
	try {
		instance.setSource(blob);
		flushSync();
		await vi.waitFor(() => expect(conversion).toHaveBeenCalledOnce());
		instance.setSource(new Uint8Array([7, 8, 9]));
		flushSync();
		await vi.waitFor(() => expect(getDocument).toHaveBeenCalledOnce());
		release(new ArrayBuffer(3));
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(getDocument).toHaveBeenCalledOnce();
	} finally {
		await unmount(instance);
		target.remove();
		getDocument.mockReset();
	}
});
