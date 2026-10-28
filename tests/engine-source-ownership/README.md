# Nested table source ownership regression tests

These tests create synthetic HWPX documents. No user documents, screenshots, or private anchor specifications are included.

## Run

Set `PWH_CORE_JS` and `PWH_CORE_WASM` to the exact engine build to test. Set `PWH_PLAYWRIGHT_MODULE` to the Playwright ESM entry URL. `PWH_BROWSER_EXECUTABLE` optionally selects a browser executable; otherwise Playwright uses its configured Chromium.

```powershell
node --test tests/engine-source-ownership/engine-source-ownership.test.mjs
```

The tests skip when the core or browser module environment is absent. Individual scripts also accept positional core paths:

```powershell
node tests/engine-source-ownership/synthetic-nested-regression.mjs <rhwp.js> <rhwp_bg.wasm>
node tests/engine-source-ownership/local-host-reset-regression.mjs <rhwp.js> <rhwp_bg.wasm>
```

`PWH_SYNTHETIC_TABLE_FIRST=1` inserts a table before the host text; the default inserts it after the text. `PWH_SYNTHETIC_HOST_SPACING=1` gives that host paragraph 12pt before and 8pt after. The test runner exercises all four combinations. `PWH_ENGINE_FIXTURE_OUTPUT` optionally saves a generated fixture to an explicit path; the tests write no document by default.

## Assertions

The larger fixture contains a 90×3 outer table and a 10×1 table inside its final cell. That row has ample declared height to hold the inner table; intentionally clipped oversized content is not classified as lost source. The checks cover:

- All 280 unique source markers appear once in the source scan and once across the visible pages.
- The visible SVG oracle intersects ancestor rectangular clip paths with the viewport, so text that exists only above or below its clip is not counted as displayed.
- A rendered nested cursor path resolves to its original source text.
- HWPX export/reopen preserves the source text and the nonzero host paragraph spacing.
- Editing a nested source location and restoring a snapshot recovers the original text.

The smaller fixture stores local host line positions `0 → 1600 → 0` in a short cell with an inner table. All five markers must remain visible once on one page. It guards against promoting every stored coordinate restart to a physical page break.

`getPageTextLayout` alone is insufficient for visibility checks: it recursively returns TextRun nodes without applying ancestor clipping. The SVG helper reports unsupported clip shapes as limitations, and those are test failures. Its visibility rule uses the glyph center and records partially clipped glyphs separately. Font appearance, stroke thickness, and border layout still require separate geometric or visual comparison for a particular engine change.

Passing these fixtures is a regression gate, not proof of compatibility with every HWP/HWPX shape. Engine-level cursor/frame tests and reference-document comparisons remain necessary.

## Physical child-frame reservation

`node physical-reserve.mjs <engine-source-root>` extracts the real `projected_recursive_run_extra` function and its unit/cut types from the selected source tree, then compiles a std-only Rust harness. `PWH_RUSTC` selects the compiler. The fixture adapter supplies independently specified child physical RowCut heights, including explicit cell padding; it does not reimplement the parent projection algorithm.

The cases cover padding on every partial fragment, exact child RowCuts on stored empty-host placeholders, rejection of untyped stored placeholders/text atoms, existing recursive reflow support, and avoidance of double-counted host spacing/captions/outer margins. Full-engine reference-document tests must still verify that the producer and actual child measurement supply those physical heights correctly.

`frame-border-oracle.mjs` measures actual horizontal SVG border strokes for a specified owned child-frame relation. A bbox or paint clip can be enlarged without moving the physical border; the helper deliberately checks the strokes and uses clipping depth to exclude lower descendant borders. It requires a visible complete parent horizontal edge and reports an unknown result otherwise. Intentionally oversized clipped objects must not automatically be classified as frame-containment defects.

`frame-border-oracle.test.mjs` tests the oracle with synthetic SVGs: an expanded bbox with an escaping child stroke, merged row edges covering a narrower cell, and an incomplete visible frame that must remain unknown. A containing table frame can be supplied to identify its stroke scope before measuring the target cell, so a descendant border cannot become the parent's boundary.

## Source predicate tests

With Rust 1.93.1 available, pass an extracted engine source root to the standalone
tests below, or set `PWH_ENGINE_SOURCE`. `PWH_RUSTC` selects the Rust executable.

```powershell
node tests/engine-source-ownership/run.mjs <engine-source-root>
node tests/engine-source-ownership/sourceframe.mjs <engine-source-root>
```

The harness extracts the actual source functions and records their SHA256 rather
than copying their implementations. The source-frame adapter supplies fixture
CellUnits in place of the full composer. It checks completed siblings, mixed and
recursive owners, synchronized plain-text restarts, stale text/format coordinates,
invalid cursors, synthetic lines and unsupported spans. These predicate checks
complement the browser and document roundtrip tests above.


## Patched runtime preservation integrity

`python tests/engine-source-ownership/preserve-patched-runtime.test.py` exercises
archive and manifest integrity, component markers, safe Windows member paths,
deterministic non-overwriting ZIP creation, dependency drift rejection, patch
digest rejection and core-output substitution rejection. The fixtures contain
only synthetic component bytes. `scripts/preserve-patched-runtime.py
--verify-only` also verifies real pinned build/client inputs without creating a
release archive or changing a lock or installation.
