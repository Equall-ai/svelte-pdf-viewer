// Verify source-region planning and coordinate contracts independently of PDF rendering.
import { describe, expect, it } from 'vitest';
import {
	initialFragments,
	mergeFragments,
	expandRegionGap,
	regionGaps,
	regionInputKey,
	boxInFragment,
	drawnBoxInSource,
	anchorInFragment
} from '$lib/pdf-viewer/regions.js';
const pages = [
	{ width: 600, height: 800 },
	{ width: 600, height: 1000 },
	{ width: 600, height: 800 }
];
const region = (id: string, page: number, y_min: number, y_max: number) => ({
	id,
	page,
	y_min,
	y_max
});
describe('source regions', () => {
	it('sorts, pads, clamps and merges while retaining contributing ids', () => {
		const result = initialFragments(
			[region('last', 3, 99, 100), region('b', 1, 12, 15), region('a', 1, 10, 11)],
			pages,
			24
		);
		expect(result.map((f) => [f.region, f.regionIds])).toEqual([
			[{ page: 1, y_min: 7, y_max: 18 }, ['a', 'b']],
			[{ page: 3, y_min: 96, y_max: 100 }, ['last']]
		]);
	});
	it('keeps empty evidence empty and ignores invalid intervals', () => {
		expect(initialFragments([], pages, 24)).toEqual([]);
		expect(
			initialFragments(
				[region('bad', 9, 0, 10), region('nan', 1, NaN, 20), region('reverse', 1, 80, 10)],
				pages,
				24
			)
		).toEqual([]);
	});
	it('expands from either boundary across pages and merges joined regions', () => {
		const initial = initialFragments([region('a', 1, 90, 95), region('b', 3, 10, 20)], pages, 0);
		const gap = regionGaps(initial, pages)[1];
		expect(expandRegionGap(initial, gap, 'start', pages, 0.2).map((f) => f.region)).toEqual([
			{ page: 1, y_min: 90, y_max: 100 },
			{ page: 2, y_min: 0, y_max: 12 },
			{ page: 3, y_min: 10, y_max: 20 }
		]);
		expect(expandRegionGap(initial, gap, 'end', pages, 0.2).map((f) => f.region)).toEqual([
			{ page: 1, y_min: 90, y_max: 95 },
			{ page: 2, y_min: 92, y_max: 100 },
			{ page: 3, y_min: 0, y_max: 20 }
		]);
		expect(expandRegionGap(initial, gap, 'all', pages, 0.2).map((f) => f.region)).toEqual([
			{ page: 1, y_min: 90, y_max: 100 },
			{ page: 2, y_min: 0, y_max: 100 },
			{ page: 3, y_min: 0, y_max: 20 }
		]);
	});
	it('compares region values independent of fresh arrays and input order', () => {
		const a = region('a', 1, 10, 20),
			b = region('b', 2, 30, 40);
		expect(regionInputKey([a, b])).toBe(regionInputKey([{ ...b }, { ...a }]));
		expect(regionInputKey([])).not.toBe(regionInputKey(null));
		expect(regionInputKey([a])).not.toBe(regionInputKey([{ ...a, y_max: 21 }]));
	});
	it('clips highlights and maps rotated drawings back to source percentages', () => {
		const fragment = initialFragments([region('a', 2, 20, 40)], pages, 0)[0];
		const box = { id: 'box', page: 2, x: 60, y: 550, width: 120, height: 150 };
		expect(boxInFragment(box, fragment, pages[1], 0)).toMatchObject({
			page: 2,
			x: 60,
			y: 0,
			width: 120
		});
		expect(boxInFragment(box, fragment, pages[1], 0)?.height).toBeCloseTo(100);
		expect(boxInFragment(box, fragment, pages[1], 90)).toMatchObject({ x: 0, y: 420, height: 120 });
		expect(boxInFragment(box, fragment, pages[1], 90)?.width).toBeCloseTo(100);
		expect(
			drawnBoxInSource({ page: 2, x_min: 0, x_max: 50, y_min: 10, y_max: 30 }, fragment, 90)
		).toEqual({ page: 2, x_min: 10, x_max: 30, y_min: 30, y_max: 40 });
	});
	it('returns only the intersecting anchor portion and hides excluded anchors', () => {
		const fragment = initialFragments([region('a', 1, 20, 40)], pages, 0)[0];
		expect(
			anchorInFragment({ page: 1, x_min: 10, x_max: 30, y_min: 10, y_max: 30 }, fragment, 0)
		).toEqual({ x_min: 10, x_max: 30, y_min: 0, y_max: 50 });
		expect(
			anchorInFragment({ page: 1, x_min: 10, x_max: 30, y_min: 50, y_max: 60 }, fragment, 0)
		).toBeNull();
		expect(mergeFragments([fragment, fragment], pages)).toHaveLength(1);
	});
});

it('keeps a fully revealed divider collapsible without hiding other expansions or evidence', async () => {
	const { regionDividers, collapseRegionGap } = await import('$lib/pdf-viewer/regions.js');
	const initial = initialFragments([region('a', 1, 90, 95), region('b', 3, 10, 20)], pages, 0);
	const base = regionGaps(initial, pages);
	const expanded = expandRegionGap(
		expandRegionGap(initial, base[1], 'all', pages, 0.2),
		base[2],
		'start',
		pages,
		0.2
	);
	const dividers = regionDividers(initial, expanded, pages);
	expect(dividers[1]).toMatchObject({ id: base[1].id, hiddenRange: null, canCollapse: true });
	const collapsed = collapseRegionGap(expanded, base[1], pages, initial);
	expect(collapsed.map((f) => f.region)).toEqual([
		{ page: 1, y_min: 90, y_max: 95 },
		{ page: 3, y_min: 10, y_max: 40 }
	]);
	expect(regionDividers(initial, collapsed, pages)[1].canCollapse).toBe(false);
});

it('restores contributing IDs after splitting merged evidence during collapse', async () => {
	const { collapseRegionGap } = await import('$lib/pdf-viewer/regions.js');
	const initial = initialFragments([region('a', 1, 10, 20), region('b', 1, 40, 50)], pages, 0);
	const gap = regionGaps(initial, pages)[1];
	const expanded = expandRegionGap(initial, gap, 'all', pages, 0.2);
	expect(collapseRegionGap(expanded, gap, pages, initial).map((f) => f.regionIds)).toEqual([
		['a'],
		['b']
	]);
});
it('chooses the nearest retained passage when collapse hides the reading anchor', async () => {
	const { nearestFragmentPosition } = await import('$lib/pdf-viewer/regions.js');
	const fragments = initialFragments([region('a', 1, 10, 20), region('b', 3, 40, 50)], pages, 0);
	expect(nearestFragmentPosition(fragments, { page: 2, y: 80 })).toMatchObject({
		position: { page: 3, y: 40 }
	});
	expect(nearestFragmentPosition(fragments, { page: 1, y: 15 })).toMatchObject({
		position: { page: 1, y: 15 }
	});
});

it('keeps outer divider orientation after revealing all leading or trailing context', async () => {
	const { regionDividers } = await import('$lib/pdf-viewer/regions.js');
	const initial = initialFragments([region('a', 1, 20, 30)], pages, 0),
		gaps = regionGaps(initial, pages);
	const leading = expandRegionGap(initial, gaps[0], 'all', pages, 0.2);
	expect(regionDividers(initial, leading, pages)[0].before).toBeNull();
	const trailing = expandRegionGap(initial, gaps[1], 'all', pages, 0.2);
	expect(regionDividers(initial, trailing, pages)[1].after).toBeNull();
});
