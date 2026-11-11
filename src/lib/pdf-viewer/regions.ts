// Plan full-width source regions and translate geometry without depending on a PDF renderer.
import type { BoundingBox, DrawnBoundingBox } from '$lib/pdf-viewer/BoundingBoxLayer.js';
import type { PageDimensions } from '$lib/pdf-viewer/context.js';

/** One-based source page, with top-origin percentages in its intrinsic visual orientation. */
export interface PdfRegion {
	id: string;
	page: number;
	y_min: number;
	y_max: number;
}
/** A displayed strip; IDs refer to the input regions contributing to it. */
export interface PdfFragment {
	id: string;
	region: Omit<PdfRegion, 'id'>;
	regionIds: readonly string[];
}
export interface PdfSourcePosition {
	page: number;
	y: number;
}
/** Readiness of the current region request, independent of offscreen lazy rendering. */
export type PdfRegionRenderState =
	| { status: 'idle' | 'loading' | 'ready'; error: null }
	| { status: 'error'; error: string };
/** Client-owned gap content receives source geometry and safe asynchronous actions. */
export interface PdfGapContext {
	id: string;
	range: { start: PdfSourcePosition; end: PdfSourcePosition };
	before: PdfFragment | null;
	after: PdfFragment | null;
	/** Remaining hidden range; null when this divider is fully revealed. */
	hiddenRange: PdfGapContext['range'] | null;
	/** Original context interval controlled by this divider. */
	sourceRange: PdfGapContext['range'];
	canCollapse: boolean;
	collapse(): void;
	pending: boolean;
	error: string | null;
	revealFromStart(): void;
	revealFromEnd(): void;
	revealAll(): void;
}
export type RegionGap = Pick<PdfGapContext, 'id' | 'range' | 'before' | 'after'>;
type Rect = Pick<DrawnBoundingBox, 'x_min' | 'x_max' | 'y_min' | 'y_max'>;
const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const fragment = (region: PdfFragment['region'], ids: readonly string[]): PdfFragment => ({
	id: `${region.page}:${region.y_min}:${region.y_max}`,
	region,
	regionIds: [...new Set(ids)].sort()
});
export function regionInputKey(regions: readonly PdfRegion[] | null | undefined): string {
	return regions == null
		? 'full'
		: JSON.stringify(
				regions
					.map(({ id, page, y_min, y_max }) => [id, page, y_min, y_max])
					.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
			);
}
export function mergeFragments(
	fragments: readonly PdfFragment[],
	pages: readonly PageDimensions[]
): PdfFragment[] {
	const sorted = fragments
		.flatMap((f) => {
			const r = f.region;
			if (
				!Number.isInteger(r.page) ||
				!pages[r.page - 1] ||
				!Number.isFinite(r.y_min) ||
				!Number.isFinite(r.y_max)
			)
				return [];
			const region = { page: r.page, y_min: clamp(r.y_min), y_max: clamp(r.y_max) };
			return region.y_max > region.y_min ? [fragment(region, f.regionIds)] : [];
		})
		.sort((a, b) => a.region.page - b.region.page || a.region.y_min - b.region.y_min);
	const result: PdfFragment[] = [];
	for (const f of sorted) {
		const last = result.at(-1);
		if (last && last.region.page === f.region.page && f.region.y_min <= last.region.y_max + 1e-8) {
			result[result.length - 1] = fragment(
				{ ...last.region, y_max: Math.max(last.region.y_max, f.region.y_max) },
				[...last.regionIds, ...f.regionIds]
			);
		} else result.push(f);
	}
	return result;
}
export function initialFragments(
	regions: readonly PdfRegion[],
	pages: readonly PageDimensions[],
	padding: number
): PdfFragment[] {
	return mergeFragments(
		regions.flatMap((r) => {
			const size = pages[r.page - 1];
			if (!size || r.y_max <= r.y_min) return [];
			const pad = (Math.max(0, Number.isFinite(padding) ? padding : 24) / size.height) * 100;
			return [fragment({ page: r.page, y_min: r.y_min - pad, y_max: r.y_max + pad }, [r.id])];
		}),
		pages
	);
}
const distance = (position: PdfSourcePosition, pages: readonly PageDimensions[]) =>
	pages.slice(0, position.page - 1).reduce((sum, p) => sum + p.height, 0) +
	((pages[position.page - 1]?.height ?? 0) * position.y) / 100;
export function regionGaps(
	fragments: readonly PdfFragment[],
	pages: readonly PageDimensions[]
): RegionGap[] {
	if (!fragments.length || !pages.length) return [];
	return Array.from({ length: fragments.length + 1 }, (_, i) => {
		const before = fragments[i - 1] ?? null,
			after = fragments[i] ?? null;
		const start = before ? { page: before.region.page, y: before.region.y_max } : { page: 1, y: 0 };
		const end = after
			? { page: after.region.page, y: after.region.y_min }
			: { page: pages.length, y: 100 };
		return {
			id: `gap:${start.page}:${start.y}:${end.page}:${end.y}`,
			range: { start, end },
			before,
			after
		};
	}).filter((g) => distance(g.range.end, pages) - distance(g.range.start, pages) > 0.001);
}
export function expandRegionGap(
	fragments: readonly PdfFragment[],
	gap: RegionGap,
	direction: 'start' | 'end' | 'all',
	pages: readonly PageDimensions[],
	step: number
): PdfFragment[] {
	let start = distance(gap.range.start, pages),
		end = distance(gap.range.end, pages);
	const page = direction === 'end' ? gap.range.end.page : gap.range.start.page;
	const amount = pages[page - 1].height * (Number.isFinite(step) && step > 0 ? step : 0.2);
	if (direction === 'start') end = Math.min(end, start + amount);
	if (direction === 'end') start = Math.max(start, end - amount);
	let offset = 0;
	const added = pages.map((size, i) => {
		const f = fragment(
			{
				page: i + 1,
				y_min: ((start - offset) / size.height) * 100,
				y_max: ((end - offset) / size.height) * 100
			},
			[]
		);
		offset += size.height;
		return f;
	});
	return mergeFragments([...fragments, ...added], pages);
}
/** Rotate a top-origin percentage rectangle clockwise. */
export function rotateRect(r: Rect, rotation: number): Rect {
	switch (((rotation % 360) + 360) % 360) {
		case 90:
			return { x_min: 100 - r.y_max, x_max: 100 - r.y_min, y_min: r.x_min, y_max: r.x_max };
		case 180:
			return {
				x_min: 100 - r.x_max,
				x_max: 100 - r.x_min,
				y_min: 100 - r.y_max,
				y_max: 100 - r.y_min
			};
		case 270:
			return { x_min: r.y_min, x_max: r.y_max, y_min: 100 - r.x_max, y_max: 100 - r.x_min };
		default:
			return { ...r };
	}
}
export function anchorInFragment(
	anchor: DrawnBoundingBox,
	f: PdfFragment,
	rotation: number
): Rect | null {
	const r = f.region,
		top = Math.max(anchor.y_min, r.y_min),
		bottom = Math.min(anchor.y_max, r.y_max);
	if (anchor.page !== r.page || bottom <= top) return null;
	return rotateRect(
		{
			x_min: anchor.x_min,
			x_max: anchor.x_max,
			y_min: ((top - r.y_min) / (r.y_max - r.y_min)) * 100,
			y_max: ((bottom - r.y_min) / (r.y_max - r.y_min)) * 100
		},
		rotation
	);
}
export function boxInFragment(
	box: BoundingBox,
	f: PdfFragment,
	size: PageDimensions,
	rotation: number
): BoundingBox | null {
	const rect = anchorInFragment(
		{
			page: box.page,
			x_min: (box.x / size.width) * 100,
			x_max: ((box.x + box.width) / size.width) * 100,
			y_min: (1 - (box.y + box.height) / size.height) * 100,
			y_max: (1 - box.y / size.height) * 100
		},
		f,
		rotation
	);
	if (!rect) return null;
	const stripHeight = ((f.region.y_max - f.region.y_min) / 100) * size.height;
	const sideways = rotation % 180 !== 0;
	const width = sideways ? stripHeight : size.width,
		height = sideways ? size.width : stripHeight;
	return {
		...box,
		x: (rect.x_min / 100) * width,
		y: ((100 - rect.y_max) / 100) * height,
		width: ((rect.x_max - rect.x_min) / 100) * width,
		height: ((rect.y_max - rect.y_min) / 100) * height
	};
}
export function drawnBoxInSource(
	box: DrawnBoundingBox,
	f: PdfFragment,
	rotation: number
): DrawnBoundingBox {
	const r = rotateRect(box, -rotation),
		source = f.region;
	return {
		page: source.page,
		x_min: r.x_min,
		x_max: r.x_max,
		y_min: source.y_min + (r.y_min / 100) * (source.y_max - source.y_min),
		y_max: source.y_min + (r.y_max / 100) * (source.y_max - source.y_min)
	};
}

/** Keep one stable control per initial gap, even after fragments join. */
export function regionDividers(
	initial: readonly PdfFragment[],
	current: readonly PdfFragment[],
	pages: readonly PageDimensions[]
) {
	const hidden = regionGaps(current, pages);
	return regionGaps(initial, pages).map((base) => {
		const start = distance(base.range.start, pages),
			end = distance(base.range.end, pages);
		const remaining = hidden.filter(
			(g) =>
				distance(g.range.start, pages) < end - 0.001 && distance(g.range.end, pages) > start + 0.001
		);
		const first = remaining[0],
			last = remaining.at(-1);
		const hiddenRange = first && last ? { start: first.range.start, end: last.range.end } : null;
		const before = first
			? first.before
			: !base.before
				? null
				: (current.find(
						(f) =>
							f.region.page === base.range.start.page &&
							f.region.y_min <= base.range.start.y &&
							f.region.y_max >= base.range.start.y
					) ?? null);
		const after = last
			? last.after
			: !base.after
				? null
				: (current.find(
						(f) =>
							f.region.page === base.range.end.page &&
							f.region.y_min <= base.range.end.y &&
							f.region.y_max >= base.range.end.y
					) ?? null);
		const canCollapse = current.some(
			(f) =>
				distance({ page: f.region.page, y: f.region.y_max }, pages) > start + 0.001 &&
				distance({ page: f.region.page, y: f.region.y_min }, pages) < end - 0.001
		);
		return {
			...base,
			range: hiddenRange ?? base.range,
			sourceRange: base.range,
			hiddenRange,
			before,
			after,
			canCollapse
		};
	});
}
/** Remove only context within an initial gap; preserve all other revealed passages. */
export function collapseRegionGap(
	current: readonly PdfFragment[],
	gap: RegionGap,
	pages: readonly PageDimensions[],
	initial: readonly PdfFragment[]
): PdfFragment[] {
	return mergeFragments(
		current.flatMap((f) => {
			const r = f.region,
				start = gap.range.start,
				end = gap.range.end;
			if (r.page < start.page || r.page > end.page) return [f];
			const top = r.page === start.page ? start.y : 0;
			const bottom = r.page === end.page ? end.y : 100;
			if (r.y_max <= top || r.y_min >= bottom) return [f];
			return [
				fragment({ ...r, y_max: Math.min(r.y_max, top) }, f.regionIds),
				fragment({ ...r, y_min: Math.max(r.y_min, bottom) }, f.regionIds)
			];
		}),
		pages
	).map((f) => ({
		...f,
		regionIds: [
			...new Set(
				initial
					.filter(
						(base) =>
							base.region.page === f.region.page &&
							base.region.y_min < f.region.y_max &&
							base.region.y_max > f.region.y_min
					)
					.flatMap((base) => base.regionIds)
			)
		].sort()
	}));
}

/** Clamp a removed reading position to the closest surviving source passage. */
export function nearestFragmentPosition(
	fragments: readonly PdfFragment[],
	position: PdfSourcePosition
) {
	return fragments
		.map((fragment) => {
			const r = fragment.region,
				y = clamp((position.page - r.page) * 100 + position.y, r.y_min, r.y_max);
			const delta = Math.abs((r.page - position.page) * 100 + y - position.y);
			return { fragment, position: { page: r.page, y }, delta };
		})
		.sort((a, b) => a.delta - b.delta)[0];
}
