<!-- Render consumer content beside a PDF anchor in the normal DOM, keeping placement inside the viewer. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getOptionalPdfViewerContext, type PdfViewerContext } from './pdf-viewer/context.js';
	import {
		placePdfOverlay,
		type PdfAnchorBounds,
		type PdfOverlayAnchor,
		type PdfOverlayPlacementOptions
	} from './pdf-viewer/overlayAnchor.js';

	interface Props extends PdfOverlayPlacementOptions {
		anchor: PdfOverlayAnchor | null;
		/** Optional for overlays rendered outside the PdfViewer component tree. */
		context?: PdfViewerContext | null;
		/** visible tracks the anchor, independently of whether the content fits the viewport. */
		children: Snippet<[{ visible: boolean }]>;
	}
	let { anchor, context, children, side = 'top', align = 'end', gap = 6 }: Props = $props();
	const inheritedContext = getOptionalPdfViewerContext();
	const viewer = $derived(context === undefined ? inheritedContext : context);
	let bounds = $state.raw<PdfAnchorBounds | null>(null);
	let element = $state<HTMLDivElement>();
	let width = $state(0);
	let height = $state(0);
	const position = $derived(
		bounds ? placePdfOverlay(bounds, width, height, { side, align, gap }) : null
	);
	const coordinates = $derived.by(() => {
		if (!position || !element) return null;
		const parent = element.offsetParent;
		if (
			!(parent instanceof HTMLElement) ||
			(parent === document.body && getComputedStyle(parent).position === 'static')
		) {
			return { left: position.left + window.scrollX, top: position.top + window.scrollY };
		}
		const origin = parent.getBoundingClientRect();
		return {
			left: position.left - origin.left + parent.scrollLeft - parent.clientLeft,
			top: position.top - origin.top + parent.scrollTop - parent.clientTop
		};
	});
	$effect(() => {
		bounds = null;
		if (!viewer || !anchor) return;
		return viewer._observeAnchor(anchor, (next) => {
			bounds = next;
		});
	});
</script>

<div
	data-pdf-overlay
	bind:this={element}
	bind:clientWidth={width}
	bind:clientHeight={height}
	style:left="{coordinates?.left ?? 0}px"
	style:top="{coordinates?.top ?? 0}px"
	style:visibility={coordinates ? 'visible' : 'hidden'}
	inert={!coordinates}
	aria-hidden={!coordinates}
>
	{@render children({ visible: !!bounds })}
</div>

<style>
	[data-pdf-overlay] {
		position: absolute;
		width: max-content;
		z-index: 1000;
		pointer-events: auto;
	}
</style>
