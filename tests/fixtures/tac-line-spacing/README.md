# Synthetic inline-table line-spacing fixtures

These files and sentences are authored from scratch and contain no user or institution document data, images, logos, or font binaries. `Batang` is referenced by family name only. `build_fixture.py` uses Python's standard library and regenerates the 18 HWPX files and their JSON descriptors.

The first 12 variants cross:

- object heights of 5000 and 10000 HWPUNIT;
- percentage paragraph spacing of 100, 135 and 160;
- `treatAsChar="1"` with `affectLSpacing="0"` or `"1"`.

Every object has a 100-HWPUNIT outer top margin and a 200-HWPUNIT outer bottom margin. The font height is 1100 HWPUNIT. A single short cell sentence fits with substantial vertical allowance, isolating paragraph spacing from table-content overflow. The host and cell paragraphs have no stored line segments.

For an inline object that affects line spacing, the percentage's extra spacing uses the object's height including outer margins. With that flag off, it uses the font height. At 100 percent the extra spacing is zero in either case. Two additional controls provide an explicit stored host `lineseg` spacing of 1777 HWPUNIT, deliberately different from either calculated 135-percent value. That recorded layout must be retained regardless of the flag.

Two further files place both flag settings' tables in the same document: one keeps their normal flow on one page and the other explicitly starts the second table on a new page. Two compact-page boundary files have identical content and body heights of 16490 and 16450 HWPUNIT. Both pages are less than 500px tall. With the large inline object's correct leading included, the following paragraph fits the first body and moves to page two in the smaller body; the table itself still fits page one. These controls detect a fix that changes painted coordinates without giving pagination the same line geometry.

The optional real-WASM test uses `PWH_CORE_JS` and `PWH_CORE_WASM`. It measures the following paragraph's position relative to the table's painted bottom, subtracts the object outer-bottom margin, and compares the remaining spacing to the oracle within 2.5 HWPUNIT. Layer-tree bounds provide 0.001px precision; the rounded 0.1px render-tree output is too coarse for this tolerance. The test also exports/reopens the files and checks retained content, dimensions, margins, flags and stored line segments.

An additional check compares `getCursorRect` positions for the flag-on/off pairs with both the expected leading change and the painted line's movement. The public cursor API rounds each position to 0.1px, so a difference of two reads permits 8 HWPUNIT (at most 7.5 HU quantization). This exception does not relax the 2.5-HU layer-spacing oracle. Compact-page controls also require the following cursor and painted paragraph to land on the same page.

Run from the repository root:

```text
node --test tests/tac-table-line-spacing.test.mjs
```

Without the two runtime environment variables the XML fixture checks run and the real-WASM check is skipped. The old engine fails the four single-table NO_LS `affectLSpacing="1"` variants above 100 percent; the flag-off, 100-percent, and stored-layout controls pass. The two-table cases and compact out-of-body case additionally expose the missing leading in shared flow and pagination.
