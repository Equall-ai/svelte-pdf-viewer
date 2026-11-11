// Animate clipped source strips without scaling text, and retire outgoing rendering resources.
import { anchorInFragment, type PdfFragment } from '$lib/pdf-viewer/regions.js';
export interface RegionSnapshot {
	fragment: PdfFragment;
	rect: DOMRect;
	element?: HTMLElement;
}
export const transitionDuration = (duration: number, reducedMotion: boolean) =>
	reducedMotion || !Number.isFinite(duration) ? 0 : Math.max(0, duration);
const full = { clipPath: 'inset(0% 0% 0% 0%)', transform: 'translate(0px, 0px)' };
export function transitionFrame(
	target: RegionSnapshot,
	others: readonly RegionSnapshot[],
	rotation: number
) {
	const matches = others
		.filter((o) => o.fragment.region.page === target.fragment.region.page)
		.map((other) => ({
			other,
			top: Math.max(other.fragment.region.y_min, target.fragment.region.y_min),
			bottom: Math.min(other.fragment.region.y_max, target.fragment.region.y_max)
		}))
		.filter((m) => m.bottom > m.top)
		.sort((a, b) => b.bottom - b.top - (a.bottom - a.top));
	const match = matches[0];
	if (!match) return { clipPath: 'inset(50% 0% 50% 0%)', transform: 'translate(0px, 0px)' };
	const anchor = {
		page: target.fragment.region.page,
		x_min: 0,
		x_max: 100,
		y_min: match.top,
		y_max: match.bottom
	};
	const a = anchorInFragment(anchor, target.fragment, rotation)!;
	const b = anchorInFragment(anchor, match.other.fragment, rotation)!;
	const dx =
		match.other.rect.left +
		(b.x_min / 100) * match.other.rect.width -
		target.rect.left -
		(a.x_min / 100) * target.rect.width;
	const dy =
		match.other.rect.top +
		(b.y_min / 100) * match.other.rect.height -
		target.rect.top -
		(a.y_min / 100) * target.rect.height;
	return {
		clipPath: `inset(${a.y_min}% ${100 - a.x_max}% ${100 - a.y_max}% ${a.x_min}%)`,
		transform: `translate(${Math.round(dx * 100) / 100}px, ${Math.round(dy * 100) / 100}px)`
	};
}
/** Returns an idempotent cancel function; completion and cancellation both release outgoing pages. */
export function animateRegionChange(
	parent: HTMLElement,
	before: RegionSnapshot[],
	after: RegionSnapshot[],
	retired: HTMLElement[],
	duration: number,
	rotation: number,
	release: () => void,
	gapRects = new Map<string, DOMRect>()
): () => void {
	const animations: Animation[] = [];
	let finished = false;
	const finish = () => {
		if (finished) return;
		finished = true;
		for (const animation of animations) animation.cancel();
		for (const element of retired) element.remove();
		release();
	};
	const ms = transitionDuration(
		duration,
		globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
	);
	if (!ms || !parent.animate || !before.length) {
		finish();
		return finish;
	}
	const options = { duration: ms, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' as FillMode };
	const parentRect = parent.getBoundingClientRect();
	try {
		for (const snapshot of before) {
			const element = snapshot.element;
			if (!element || !retired.includes(element)) continue;
			// Retired text is never selectable or observable as current document content.
			element.inert = true;
			element.setAttribute('aria-hidden', 'true');
			element.dataset.regionStaging = '';
			element.style.cssText += `;position:absolute;left:${snapshot.rect.left - parentRect.left}px;top:${snapshot.rect.top - parentRect.top}px;margin:0;pointer-events:none;user-select:none;z-index:2`;
			parent.append(element);
			animations.push(element.animate([full, transitionFrame(snapshot, after, rotation)], options));
		}
		for (const snapshot of after) {
			if (snapshot.element)
				animations.push(
					snapshot.element.animate([transitionFrame(snapshot, before, rotation), full], options)
				);
		}
		for (const element of parent.querySelectorAll<HTMLElement>('.pdf-region-gap')) {
			const previous = gapRects.get(element.dataset.gapId!);
			if (!previous) continue;
			const current = element.getBoundingClientRect();
			animations.push(
				element.animate(
					[
						{ transform: 'translateY(' + (previous.top - current.top) + 'px)' },
						{ transform: 'translateY(0px)' }
					],
					options
				)
			);
		}
		void Promise.allSettled(animations.map((a) => a.finished)).then(finish);
	} catch {
		finish();
	}
	return finish;
}
