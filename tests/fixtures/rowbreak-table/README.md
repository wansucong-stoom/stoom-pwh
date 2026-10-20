# Synthetic inline RowBreak table regression

All files in this directory were authored from scratch. They contain generic test sentences, no institution or user document content, and no images, logos, or font binaries. `Batang` is referenced by family name only.

`build_fixture.py` uses the Python standard library to regenerate the three small HWPX archives:

- `synthetic-rowbreak-overflow.hwpx`: the last middle cell wraps to three lines.
- `synthetic-rowbreak-two-line-control.hwpx`: that cell wraps to two lines.
- `synthetic-rowbreak-single-line-control.hwpx`: that cell stays on one line.

Each file has one seven-row, three-column inline table with `pageBreak="CELL"` (engine `RowBreak`), 14173-HWPUNIT column widths, 4050-HWPUNIT body-cell heights, 400-HWPUNIT top/bottom cell margins, 11-point type, and 135 percent paragraph spacing. There are no stored line segments. The unfixed engine paints the three-line cell 5.6px below its border while the two control variants fit.

The real-core regression is optional. Set `PWH_CORE_JS` and `PWH_CORE_WASM` to the JavaScript module and WASM file of a candidate build, then run:

```text
node --test tests/rowbreak-table-height.test.mjs
```

It checks text containment and order in all cells and variants, one-page layout, and unchanged table geometry, cell spans/margins and text after export. A renderer can redistribute its table-height allowance among rows; it must preserve the document's stored sizes.
