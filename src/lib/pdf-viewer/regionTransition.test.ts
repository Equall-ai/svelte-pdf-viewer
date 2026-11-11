// Verify transition geometry and resource retirement independently of browser animation timing.
import { expect, it } from 'vitest';
import { transitionFrame, transitionDuration } from '$lib/pdf-viewer/regionTransition.js';
const part = (min: number, max: number, top: number) => ({
	fragment: { id: `${min}`, region: { page: 1, y_min: min, y_max: max }, regionIds: [] },
	rect: new DOMRect(0, top, 600, (max - min) * 8)
});
it('reveals added context without scaling text or moving the retained source passage', () => {
	const old = part(30, 40, 200),
		next = part(10, 40, 40);
	expect(transitionFrame(next, [old], 0)).toEqual({
		clipPath: 'inset(66.66666666666666% 0% 0% 0%)',
		transform: 'translate(0px, 0px)'
	});
	expect(transitionFrame(old, [next], 0).clipPath).toBe('inset(0% 0% 0% 0%)');
});
it('disables transitions for reduced motion and invalid duration', () => {
	expect(transitionDuration(240, true)).toBe(0);
	expect(transitionDuration(-10, false)).toBe(0);
	expect(transitionDuration(NaN, false)).toBe(0);
	expect(transitionDuration(300, false)).toBe(300);
});

it('releases outgoing pages exactly once when an animation is interrupted', async () => {
	const { animateRegionChange } = await import('$lib/pdf-viewer/regionTransition.js');
	const parent = document.createElement('div'),
		old = document.createElement('div'),
		current = document.createElement('div');
	const pending = new Promise<Animation>(() => {});
	// Web Animations is a browser boundary; the real transition owns DOM retirement and release.
	for (const el of [parent, old, current])
		el.animate = () => ({ finished: pending, cancel() {} }) as Animation;
	parent.append(current);
	let released = 0;
	const cancel = animateRegionChange(
		parent,
		[{ ...part(20, 40, 100), element: old }],
		[{ ...part(10, 40, 20), element: current }],
		[old],
		220,
		0,
		() => released++
	);
	expect(old.inert).toBe(true);
	expect(old.parentElement).toBe(parent);
	cancel();
	cancel();
	expect(released).toBe(1);
	expect(old.parentElement).toBeNull();
	expect(current.parentElement).toBe(parent);
});
