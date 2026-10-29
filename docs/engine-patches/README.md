# Core patches: table layout and source ownership

This directory preserves reviewable changes to rhwp 0.8.7. They are
**core rendering changes**, separate from pwh's Studio/client patches. They
change derived layout, not the source document's text, XML cell heights, fonts,
or margins. It does not clip overflowing text, compress its line spacing, or
call the global `reflowLinesegs` repair.

## Cause and scope

The height measurer can correctly expand a row to fit wrapped text and reclaim
slack from other rows to preserve the table's total height. Later,
`LayoutEngine::trust_declared_row_heights` can restore the original per-row
heights when their sum matches and the differences fall within its existing
tolerance. A generated HWPX with no stored LINE_SEG information can qualify as a
ViewText content grid. Restoring its declared heights can therefore undo a real
content floor even though the table total remains unchanged.

`rhwp-0.8.7-nols-row-content-floor.patch` adds one check before that restoration.
For a horizontal NO_LS cell whose row would be shortened, the renderer reuses
its existing owner-width, padding, wrapping and content-height calculations.
If the content and padding do not fit the declared row, it keeps the measured
row allocation. The existing correction remains available for fitting
ViewText grids, stored-layout cells and rows that would not be shortened.
Vertical-writing behavior is unchanged. No document IDs, institution names,
specific fonts, row counts or cell numbers appear in the patch.

This first patch changes only `src/renderer/layout/table_layout.rs`. The helper
receives the existing resolved styles at its single call site.

The second patch, `rhwp-0.8.7-inline-table-affect-line-spacing.patch`, addresses
the gap following a fresh inline table whose `affectLSpacing` property is
enabled. The existing fallback always based percent line spacing on the host
font. For a single table on an otherwise empty paragraph, that property makes
the object line box (table height plus outer top/bottom margins) the percentage
base instead. The currently verified base is the **declared** table frame
(`table.common.height` plus its outer margins), as confirmed by the stored
object-line geometry. A different measured height following cell-content
growth is not inferred by this helper. Ignoring the flag in that verified
original-layout case can draw the following paragraph much closer to the
table than Hancom does.

One helper in `src/renderer/mod.rs` supplies the table content height and extra
gap. `src/renderer/composer/line_breaking.rs` writes this gap when it generates
the fresh host's synthetic LINE_SEG, before the following paragraphs' vertical
positions are accumulated. Height measurement, typesetting, paint and cursor
queries can then consume the same derived positions. Changing only the later
fallbacks is insufficient: the import process can already have generated a
synthetic host segment with font-based spacing. The existing table-host metric
fallback and paint-flow path in `src/renderer/layout.rs` also use the helper
when those segments are absent or are regenerated. DPI comes from the caller.

The override requires no **real stored** LINE_SEG, no paragraph text, exactly
one TAC table, `affectLSpacing=1`, and percent spacing above 100%. Internally
generated segments, identified by the existing synthetic tag predicate, remain
eligible. It applies only when the object's line frame exceeds the host font
height. Disabled flags, real stored LINE_SEG records, small objects, mixed
controls, visible text, 100% spacing and other spacing modes retain their
existing paths. Picture and shape metrics are unchanged. Outer margins enter
the percentage base once; the helper's content height excludes those margins
because flow already accounts for them separately. No duplicate trailing
spacing is added to the existing table-placement advance.

Upstream code and comments in the diffs retain their original attribution;
rhwp is Copyright Edward Kim
and contributors and distributed under the MIT license. See the source ZIP's
`LICENSE`, the repository's `THIRD_PARTY_NOTICES.md`, and the original project at
<https://github.com/edwardkim/rhwp>.

## Pinned inputs

### Nested table source ownership

`rhwp-0.8.7-nested-source-ownership.patch` extends the existing child `RowCut`
path to a mixed paragraph containing one non-inline `TopAndBottom` RowBreak
table at its first control position. Host text keeps its own line, spacing and
break atoms. Child row/cell cursors are carried into partial layout instead of
being reconstructed from fixed-height scalar fragments.

A child cut can authorize a stored source-frame boundary only when its remaining
visible owners begin at original plain-text paragraph restarts. Completed label
cells do not own the continuation. Nested control fragments, synthetic or stale
line geometry, unsupported spans and ambiguous owners do not acquire this
authority. A table is drawn only by a cut containing its typed table atoms;
ordinary host text cannot redraw the same block table.

Typed child runs in stored paragraphs also reserve the physical height of the
exact selected child `RowCut`, including its per-fragment cell padding. This
includes empty hosts with placeholder visual lines when their run has explicit
child-cut provenance; complete rows may share the run with partial row cuts.
Placeholder line ranges alone do not authorize a physical reservation. The same
reserve enters pagination and partial row rendering. Previously the parent could
budget only projected source-unit heights while the child painted its padding
too, leaving an inner border below its parent frame. Separate mixed-host text
atoms retain paragraph spacing; empty hosts retain their existing edge-spacing
ownership. Untyped stored scalar projections keep their existing path. No fixed
padding or pixel adjustment is introduced.

The patch changes derived pagination and rendering, retaining original document
text and source cursor addresses. It does not change saved cell dimensions,
hide overflow by changing view preferences, or contain document/page identifiers.
The r4 runtime promotes this patch after source, synthetic and real-document
regression gates. Its editor WASM is 13,758,962 bytes with SHA256
`22516f486ced5fbff3a957b34e0d48adf77a05f8c0e80d8b7ff834d35ef5919b`.
The reproducible build script applies all four patches and verifies every
before/after source hash. Regression commands and synthetic fixtures are in
[`tests/engine-source-ownership`](../../tests/engine-source-ownership/README.md).

| Input | Identity / SHA256 |
| --- | --- |
| Upstream source commit | `1a76570e833917d15817415a53c09ad61ab3203f` |
| Preserved source ZIP | `pwh-upstream-rhwp-0.8.7-1a76570e8339.zip` |
| Source ZIP SHA256 | `067feefc25d36921ee41fea5df6fead00255ffa86441891fbaa202f96de202a2` |
| Original `table_layout.rs` SHA256 | `1dcbd3254a0f68b7de40c922f10e15cb62f2ef85e2c59fb24050bb143fa5f5f9` |
| Patched `table_layout.rs` SHA256 | `c3df908c978e4aef7876b555c4a4c7b85749587194b4755d43e4c5ae9c67c238` |
| Patch SHA256 | `5a2427c162ee3928b7edecbaabad10936700c7db02f25a5436fb0a74a92bd221` |
| Inline-table spacing patch SHA256 | `a9f6a533debe686f6e89ec06870e47ccb0357635f8303775467ceb6cfca9da7a` |
| Nested source ownership patch SHA256 | `346e2885cb5720574515167db94448f256e5d210d729ee63e2c0ac732e5b2a96` |
| Stored grown-table pagination patch SHA256 | `596bf711aaf4494438c76e0b77aa29741c93f2cdb9b75c5b49e3e4c3364eade3` |
| `saved/blank2010.hwp` | 13,824 bytes; `43f472751fafefb8c66b0f831660ebed51e443a46bebe44c75bba918154ce4c9` |
| Rust / Cargo | `1.93.1` |
| Compilation target | `wasm32-unknown-unknown` |
| wasm-bindgen CLI | `0.2.127`; `--target web --out-name rhwp` |

The second patch's source hashes are:

| File | Original SHA256 | Patched SHA256 |
| --- | --- | --- |
| `src/renderer/mod.rs` | `b27c1148d0496fe02dfef5ee3375511c3f2cd110925ebbfe90398a67b018f15d` | `c9191193db4a0b14a936887fac5ffd99f47d77311f60dc58b961574048c3271a` |
| `src/renderer/composer/line_breaking.rs` | `42a685bc83d81e01356a5576fcc03d0c92117d5054d018c84f77ddbad297921e` | `6ced0b75cf4b46090801dd05adabe6e715d9ff06e22468ead3dbd5e6fbc9b940` |
| `src/renderer/layout.rs` | `eb561f70fed2217db8e17efc8b33a5639de4dd5c8087797cd2cf876be4bc4ca5` | `81fef37b2cd464f007d721edcdaf938d6ba47439dc9418c8745bc7da927d7a61` |

The third patch applies after the two existing patches:

| File | Before SHA256 | After SHA256 |
| --- | --- | --- |
| `src/renderer/layout/table_layout.rs` | `c3df908c978e4aef7876b555c4a4c7b85749587194b4755d43e4c5ae9c67c238` | `7f294df11f7dc48611cdcfbf8a7fa813763778dd9c4573cd619c06bc4c26990a` |
| `src/renderer/layout/table_partial.rs` | `9e0a4d66d00906d4c949481088dba04d81d1f04ac1091b09188d65a9140ddeab` | `cebac7b673a9c051bf31e64bcc6d2310f669b74a97bfd6351d663a9cc5b452d6` |

The fourth patch preserves the measured height of a saved inline table whose
plain-text rows have grown beyond their stored sizes, and consumes that same
height in pagination. It leaves stored cell sizes, text and nested-table
viewport rules unchanged. The synthetic saved-table fixture checks page
containment and export/reopen content preservation.

Obtain the pinned source ZIP from the immutable engine-r2 release:
<https://github.com/wansucong-stoom/stoom-pwh/releases/download/engine-rhwp-0.8.7-pwh-r2/pwh-upstream-rhwp-0.8.7-1a76570e8339.zip>.

The source snapshot intentionally omitted reference documents and `saved/`.
The library's `newBlank` implementation includes `saved/blank2010.hwp` at compile
time, so the rebuild needs that upstream blank template. The fixed-commit
source is
<https://raw.githubusercontent.com/edwardkim/rhwp/1a76570e833917d15817415a53c09ad61ab3203f/saved/blank2010.hwp>.
Supply it as a local input; the script verifies its hash before copying it.
No user document or institution template is required.

The Windows build used Rust's `1.93.1-x86_64-pc-windows-gnu` toolchain and the
official `wasm-bindgen-0.2.127-x86_64-pc-windows-msvc` executable. Its host triple
does not change the WebAssembly target. A compatible installed toolchain and
the `wasm32-unknown-unknown` standard library must already be available.

## Rebuild into a separate candidate

`scripts/build-patched-core.mjs` accepts all paths as arguments. It never uses a
maintainer's home/workspace path, installs a runtime, edits the engine lock, or
overwrites an existing source/output directory. It verifies the source and
patches before applying them and rejects an unexpected source revision. All
patches are required and applied in the recorded order. Git
line-ending conversion is disabled explicitly for patch application so a
Windows global `core.autocrlf` setting cannot change the source hashes.

Example from a repository checkout, with locally obtained inputs and tools:

```powershell
$env:RUSTUP_TOOLCHAIN = '1.93.1-x86_64-pc-windows-gnu'
node scripts/build-patched-core.mjs `
  --source-archive C:\pwh-inputs\pwh-upstream-rhwp-0.8.7-1a76570e8339.zip `
  --blank-template C:\pwh-inputs\blank2010.hwp `
  --source-root C:\pwh-rebuild\source `
  --output-root C:\pwh-rebuild\candidate-core `
  --wasm-bindgen C:\pwh-tools\wasm-bindgen.exe
```

Node.js 22.12+, Python 3.11+, Git and the pinned Rust tools must be on PATH, or
use `--python`, `--cargo`, `--rustc` and `--wasm-bindgen`. `RUSTUP_HOME` and
`CARGO_HOME` are inherited; they may point to an isolated build environment.
`--target-dir` can reuse an existing compilation cache. `--offline` prevents
Cargo from fetching dependencies and requires them to be present already.
`--prepare-only` performs source/hash/patch/workspace/template preparation
without invoking the compiler. Choose new source/output roots for each run.
Failed candidate directories are retained for inspection, not deleted.

The build command is:

```text
cargo build --lib --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-name rhwp --out-dir <candidate-core> <target>/wasm32-unknown-unknown/release/rhwp.wasm
```

Upstream default features are retained. The script adds `--offline` only when
requested. Cargo's dependencies and Rust/wasm-bindgen installation are not
bundled by this script, so this is a reproducible procedure with pinned inputs,
not a claim of a fully self-contained offline toolchain.

## Workspace and dependency lock handling

The preserved source ZIP lacks standalone `tools/` projects that remain named
in the original workspace list. Building that snapshot as-is fails while
resolving missing workspace manifests. For this WASM library build, the rebuild
restricts **only** the root workspace `members` to `[".", "crates/*"]` and keeps
`default-members`, root dependency declarations and crate manifests intact.
The removed members are `tools/rhwp-subsecond`, `bindings/Native`,
`tools/batch-convert`, and the three `tools/llm_verifier` projects.

The first build is intentionally not `--locked`: Cargo must prune lock entries
that belong exclusively to the removed workspace members. Immediately after
building, the script compares the resulting lock against the original ZIP
using Python's TOML parser. It **rejects the candidate** if a package is added
or any retained package's complete lock record changes, including version,
source, checksum or dependency list.

The verified build pruned 408 original package records to 373: 35 removed,
0 added, and 0 changed retained records. This includes removal of six local
workspace packages and their unused registry dependencies. It did not update
the versions of retained dependencies. Its pruned `Cargo.lock` SHA256 was
`775639086168903cd7b5978704decf498aac7235b6a5e89c5a4fe8be325b3b06`.
That file is a build-workspace derivative, not a replacement upstream lock.

## Output and release boundary

The script emits the generated `.wasm`, JavaScript glue, declarations, upstream
license and a `BUILD-RECORD.json` with input/output hashes, tool versions and
lock audit. The generated glue must remain byte-identical to the preserved
upstream glue (`70cde06a369fa7fd4fc8bc8f3d6acaee158596ba1a116a2c72159002b0b5654e`).
The independently repeated **first-patch-only** build was 13,751,774 bytes with SHA256
`2af00b34b622b33d341d0be5a78f00d56dcd50d74fddca1ec71dd5d5474af907`.
It is historical evidence for the row-floor fix, not the identity of the
historical two-patch build. The current script builds all four patches and records their
individual input/output source hashes in `BUILD-RECORD.json`.
The verified **two-patch production** rebuild was 13,752,323 bytes with SHA256
`a9c082330122e79120f8e0976f94837cc62625261fbb77c2fa2f51d6cb3e09d8`.
Both synthetic WASM suites passed against that exact output: 25 passed,
0 failed and 0 skipped, including row containment, stored-spacing controls,
following-text cursor positions, consecutive tables and page boundaries.
Record the actual hash of each rebuild; compiler path differences or build
environment changes must be investigated rather than silently relabeled.

Run the synthetic regression fixture against the rebuilt core before packaging
it: wrapped NO_LS rows must fit, fitting rows must retain their correction,
export/reopen must preserve document content and source cell heights, and
snapshot undo must restore the original state. A successful compile or patch
hash is not a rendering test.

For inline-table spacing, compare independently varied table heights, outer
margins, enabled/disabled flags and percent settings. Include 100% controls and
stored-LINE_SEG controls to show that existing layout stays unchanged. Check
both the following paragraph's painted position and its cursor position, along
with export/reopen preservation and a page-boundary case. Do not substitute a
document-specific pixel adjustment for the shared line-box calculation.

Run both fixture suites against the candidate explicitly:

```powershell
$env:PWH_CORE_JS = 'C:\pwh-rebuild\candidate-core\rhwp.js'
$env:PWH_CORE_WASM = 'C:\pwh-rebuild\candidate-core\rhwp_bg.wasm'
node --test tests/rowbreak-table-height.test.mjs tests/tac-table-line-spacing.test.mjs
```

The fixtures contain synthetic text and geometry. They do not contain a user
document, institution report, source-document path or research manuscript.
Without both environment variables, the core-dependent tests skip; a skipped
run does not verify a candidate engine.

This core requires a **new immutable engine revision**, its own provenance and
runtime manifest. Keep engine-r2 and the original npm core bytes. The existing
`scripts/preserve-engine.py` assertion that its original core is unchanged must
not be bypassed or made to accept changed bytes under the old identity. Prepare
and verify the patched revision through an explicit release path; the rebuild
script does not publish it or modify `runtime-lock.json`.


## Preserve a later patched runtime

`scripts/preserve-engine.py` preserves the original upstream binaries and remains
the tool for initial source/license preservation. Its original-core checks must
not be weakened to package a patched core.

`scripts/preserve-patched-runtime.py` instead verifies a prior immutable runtime
archive and its complete manifest, the new optimized core's `BUILD-RECORD.json`,
all current patch hashes, and the versioned inline client's file hashes. It also
normalizes the inline build's host-supplied-WASM resolver to prove its remaining
JavaScript glue exactly matches the rebuilt core. Passing regression evidence
must identify the exact WASM and build-record digests. It creates a new runtime ZIP,
source/build-input archives, verification record and proposed lock in a new
output directory. It never writes the project's lock or an installed runtime.

Example after completing the core and inline-client regression gates:

```text
python scripts/preserve-patched-runtime.py --base-lock <preserved-r3-runtime-lock.json> --base-archive <verified-r3.zip> --candidate-core <optimized-core> --client-root client --client-build-root <studio-build-root> --regression-evidence <passing-core-regression.json> --revision 4 --output-dir <new-r4-output>
```

The current Pwh and Desktop inline clients use the new shared core. The separate
historical full-Studio component retains its prior bytes by default; its bundled
WASM must not be replaced merely on an assumed ABI match. A complete replacement
requires explicit tree-hash and smoke-test evidence through the optional
`--studio-replacement` and `--studio-verification` inputs. This scope is recorded
in the manifest and verification file. Existing upstream source, dependency and
license assets retain their immutable prior URLs.
