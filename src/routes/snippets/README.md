# PDF region API demo

This deterministic seven-page demo uses the exported `PdfViewer`, `PdfRenderer`, region types, and viewer actions. Event semantics and divider design belong entirely to the client. Ordinary card selection does not activate filtering; **Show event evidence** does.

Run `pnpm dev` and open `/snippets`. Exercise Series A (merged nearby citations plus a table on page 5), Closing conditions (separated passages on page 2), Execution & registration (intrinsic rotation on page 6 and an offset CropBox on page 7), and the empty Event. Search for `Clause 4.3` to reveal a hidden passage, or use **Go to page 4**. Switch between custom/default dividers and change their height while reading.

## Assessment

`pdf-lib` is suitable for full-width vector evidence strips from ordinary page content. PDF.js can render these strips with faithful typography and table layout. Supplying transformed original text content keeps source search offsets stable across clipping. This does not provide OCR or document editing.

The principal fidelity limitation is annotations: page embedding omits their appearance streams and interactive links. Region generation therefore refuses pages containing display annotations and provides an explicit error/return-to-source path. Full-document mode, thumbnails, presentation, and download continue to use the original PDF. Supporting region views for annotated forms, signatures, and links requires further work before adopting this for those documents.

Visible text runs are selectable; runs crossing a strip boundary are excluded as a whole, so partially clipped lines may need additional context before they can be selected. Generated strips may contain hidden PDF drawing commands: this is a viewing feature, not redaction or an export facility.

## Validation record

- Unit coverage: sorting, padding, merge IDs, clamping, empty/invalid inputs, cross-page expansion, equivalent input values, highlight/drawing/anchor mapping, rotated offset geometry, original text transforms, annotation refusal, atomic failure/retry, obsolete loads, stale gap actions, source-search geometry/cancellation, rotation during preparation, and rendering/drawing resource cleanup.
- Browser: initial citation grouping and highlights, precise table layout, hidden passage exclusion from the DOM text layer, source-wide search revealing page 4, full-source return to the same page, custom divider CSS/height, and intrinsic rotation/CropBox examples.
- Browser follow-up: same-page merging, cross-page reveal of pages 2–5, reset, rapid Event switching, default divider keyboard actions, empty-state recovery, and narrow-screen layout verified. The form-example toggle exercises the explicit error and return-to-source path. Runtime rotation produced no new console errors after the lifecycle fix.
- Download verified from the saved file: all seven original pages, page 6 rotation of 90°, and page 7 CropBox `(36, 48, 612, 792)` remain intact.
- Visible text selection was verified (`Ventures` selected through a passive highlight). End-to-end clipboard copy could not be verified: the browser automation virtual clipboard returned no data, and native app access was unavailable. Manual copy/paste remains a review check.
- A measured reveal-above operation moved the visible passage by 0.14 CSS pixels. Changing divider height preserved its measured position exactly in the same run.
- Warm sample strip generation: approximately 1.2–1.7 ms per strip; PDF.js loading/render preparation: approximately 14.8 ms per strip. These are small-fixture observations, not a large-document benchmark. Strip elements expose `data-generation-ms` and `data-render-ms` for inspection.

This change does not integrate Equall or publish the package. After review, merge, and publication, integration will use a worktree based on `codex/event-citation-groups`.
