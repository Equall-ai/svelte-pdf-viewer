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

## Expand/collapse transitions and large PDFs

The package now provides `regionTransitionDuration` (220 ms by default, 0 to disable, with system reduced motion respected). Custom and default dividers retain independent collapse actions after all context is revealed. The demo's **Animate context** toggle compares both behaviors. A collapse preserves the original evidence and expansions in other gaps. If it removes the passage currently being read, navigation falls back to the nearest surviving evidence. Outgoing canvases remain briefly for animation but are inert and cannot contribute selectable text or anchor geometry.

Open `/snippets/benchmark` and choose **Run benchmark** to reproduce the measurements below. These are one local browser run on November 11, 2026, with synthetic sources generated in memory, two evidence strips, device-pixel ratio 2, and animation disabled. Network transfer and fixture generation are excluded. PDF.js worker/font caches warm across samples; these are observations, not latency guarantees.

| Source                             |     Size | PDF.js open | Initial region setup | Warm expansion | Collapse |
| ---------------------------------- | -------: | ----------: | -------------------: | -------------: | -------: |
| 100 text pages                     | 0.096 MB |       96 ms |                85 ms |          35 ms |    34 ms |
| 1,000 text pages                   |  0.96 MB |       37 ms |               246 ms |          34 ms |    33 ms |
| 100 pages with unique JPEGs + text | 23.26 MB |        4 ms |               123 ms |          51 ms |    50 ms |

Initial setup includes reading all source page geometries, loading/parsing with pdf-lib, generating the two strips, and nearby PDF.js render preparation. Warm expansion/collapse includes the layout-frame wait and reused source parser/page cache. The image fixture uses unique deterministic noise JPEGs with a text layer; it is not a representative scanned legal document. A 16 ms timer's largest observed excess delay was 1.5–2.9 ms; this coarse signal is not a full responsiveness profile.

Two live strip canvases used approximately 2.45 MB of RGBA pixel storage after each operation. **That is not total memory:** it excludes original source bytes, both PDF object models, decoded images/fonts, text layers, worker memory, and the briefly overlapping old/new canvases during animation.

Sparse evidence looks practical in these samples. Large-document costs that remain:

- Startup loads every source page's geometry and pdf-lib parses the complete source; region mode cannot retain PDF.js's range-loading-only behavior.
- First search extracts text across the entire source.
- “Show all between” across hundreds of pages generates all requested strips before replacing the view; canvas painting is queued, but strip generation itself is not virtualized.
- Visited page normalization and rendered fragment canvases remain cached until replaced or the source/viewer is destroyed. There is no LRU memory budget yet. Extensive browsing/revealing can therefore grow memory.
- Image resolution, embedded fonts, and complex vector pages matter as much as page count. Production adoption for very large files should add a cache budget and lazy strip generation, then benchmark representative documents on lower-powered devices.

Transition regression coverage includes independent collapse, restored contributing region IDs, nearest surviving anchors, reduced-motion duration, interrupted-animation cleanup, and destruction while a replacement frame is suspended.
