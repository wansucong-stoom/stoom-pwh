# Saved table growth fixture

This synthetic HWPX has an inline 5×3 table with saved cell line segments and
text that exceeds the old stored row heights. Following paragraphs approach a
short page's lower edge. The fixture contains no user document or private text.

Run `python tests/fixtures/grown-table-pagination/build_fixture.py` to recreate
it using the synthetic header and package builder in `tac-line-spacing`.
The regression checks page containment and preserves table cells and text when
exporting and reopening the document.
