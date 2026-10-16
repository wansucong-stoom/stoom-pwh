# Paragraph-relative floating picture layout

The maintained candidate patch is
`engine-patches/rhwp-0.8.7-floating-picture.patch`, based on upstream commit
`1a76570e833917d15817415a53c09ad61ab3203f`. It changes the renderer and
pagination inputs; it does not rewrite a document's object properties.

## Failure and independent reference

A local thirteen-page HWPX was exported through installed Hancom HWP 2022 and
compared with the unchanged rhwp 0.8.7 WASM. The source SHA was checked before
and after conversion. The institution document and its fonts are kept outside
this repository and build artifacts.

The body text positions matched closely, but a paragraph-relative picture with
`treatAsChar=false` and `TopAndBottom` was placed against the start of its host
paragraph. Its control belongs to the last of four text lines. The resulting
picture intersected the last three lines. Canvas painted text over the picture;
the SVG path could conceal the same text behind the picture.

At 96 DPI, the independent Hancom PDF placed the picture at approximately
193.068 px from the page top. The unchanged rhwp query placed it at 120.160 px.
The original source has an owner-line position of 5480 HWPUNIT and a vertical
offset of 1925 HWPUNIT. Retaining the owner line's absolute position predicts
193.227 px. Subtracting the first line's inset would incorrectly lose another
200 HWPUNIT.

## Candidate change and limits

One `ParagraphFloatPlacement` is shared by pagination and the existing paint
consumer. A valid saved tail-picture frame uses its actual control-owning line,
source caption extent and following paragraph's saved flow boundary. The
object's size, crop, relative position attributes, wrapping mode and document
content stay unchanged.

The plan is restricted to a whole host paragraph on the same page, one trailing
non-inline picture with paragraph/top alignment and above/below text wrapping.
It checks valid original line partitions, the actual host origin, body lines
ending above the picture and the picture/caption ending before the next saved
paragraph. Both occupied extent and next flow must fit the current page.
Unsupported or stale frames retain the existing engine path.

The new path uses paragraph-level validity rather than disabling all unchanged
anchors after an unrelated edit. Freshly recomposed owner paragraphs require a
separate computed-line contract; this patch does not make a blanket claim about
all floating objects or every editing state.

## Rebuild and verification

The maintainer-only `Build patched rhwp core candidate` Actions workflow builds
the exact upstream commit with this patch on Linux. It uses Rust 1.93.1,
locked dependencies and wasm-bindgen 0.2.127, requires nonzero passing native
`pwh_floating_picture` tests, then generates matching WASM and web glue.

The build records compiler and command details, source and patch hashes, test
logs and output checksums. It does not install a runtime or publish a release.
`scripts/preserve-engine.py --core-build-dir` can preserve a verified candidate
and its corresponding source alongside the original upstream packages.

This sanitized source snapshot is not a complete offline Rust build kit. The
build used the full pinned upstream checkout. The retained snapshot excludes
the production `saved/blank2010.hwp` template, test fixtures, binary fonts and
compiler toolchains; their origin and license evidence must be reviewed before
any broader redistribution. The preserved prebuilt runtime remains usable
without rebuilding Rust.

The native CLI remains a separate, unchanged binary. A successful WASM build is
not evidence that the CLI's PNG/PDF output has changed. Actual document queries,
export/reopen, unrelated edits and the Codex editor require verification with
the candidate before it is pinned for installation.
