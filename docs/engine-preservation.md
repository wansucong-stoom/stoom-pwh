# Preserved engine and rebuild provenance

The default `node scripts/setup.mjs` installs a prebuilt Windows x64 runtime
from **this repository's GitHub Releases**, using the SHA256 in
`runtime-lock.json`. It does not clone rhwp or run npm. If that asset is
unavailable it fails explicitly; it does not silently switch to a new upstream
version. Node itself is a prerequisite, not bundled.

For an offline initial installation:

```powershell
node scripts/setup.mjs --runtime-root C:\pwh-runtime --runtime-archive C:\backups\pwh-runtime-rhwp-0.8.7-pwh-r1-windows-x64.zip --skip-download
```

The ZIP hash, identity, file names, expanded sizes, component licenses and every
file hash are checked before components are published. Existing files with
different contents are preserved and cause an error; choose a fresh runtime
root. Institution documents, recovery drafts, machine configuration and system
fonts are not in the archive. Optional `--with-nanum` is separate and may still
download from NAVER unless a verified local `--nanum-archive` is supplied.

## What is preserved

`runtime-lock.json` names immutable, versioned release assets:

- The CLI, WASM/core, editor SDK, built Studio and pwh inline editor.
- Original upstream CLI/core/editor packages, without changing their bytes.
- A source-input snapshot at the exact upstream commit. Reference documents,
  samples, screenshots and binary fonts are excluded; this is not a complete
  clone of every file in the upstream repository.
- Patched Studio inputs and a **git-apply-compatible binary patch** against the
  pristine Studio inputs plus original core glue.
- Installed dependencies needed to rebuild the Windows x64 Studio client,
  including package licenses. Upstream browser-test/PWA dependencies are not
  promised by this bundle.
- Pwh maintenance/build sources, original Cargo crate archives, license
  inventories, full collected notices and Lightning CSS's corresponding source.

`PROVENANCE.json` records the upstream commit, pwh base commit and build-file
hashes; each added/modified path with before/after SHA256; unchanged native
CLI/core status; the patch digest and successful patch replay. The build-source
snapshot excludes `runtime-lock.json` to avoid circular archive hashes; use the
separate manifest published with the release.

## Rebuild the client without upstream access

Extract the patched Studio input ZIP and dependency ZIP into the same build
directory. From the preserved/current pwh source, run:

```powershell
node scripts/build-inline.mjs C:\pwh-build
```

The result is `inline-dist/editor.js`, `rhwp-studio.css` and
`editor-body.html`. Compare their hashes with the runtime manifest. Applying the
recorded patch to pristine inputs is a separate reproducibility check.

Revision 1 was installed into a fresh directory from its local ZIP with downloads
disabled. A real five-page HWPX opened, exported and reopened with five pages;
the original file remained unchanged. Rebuilding from the preserved inputs and
22 installed build packages produced byte-identical CSS and HTML. JavaScript
differed only in generated `//#region` build-directory comments; removing that
specific comment-path difference made the complete files identical. The release's
`VERIFICATION.json` records both raw hashes and this limitation. The 15-file
upstream-to-pwh patch also replayed with every resulting source hash matching.

Cargo crate archives are preserved with their original checksums. **A full
native CLI/WASM rebuild is not claimed:** Rust toolchains, Skia externals and
platform build tooling are not all vendored or validated. The existing native
CLI and core binaries are retained byte-for-byte. The legacy
`setup.mjs --from-source` path is explicit and can still need upstream Git/npm;
it is not the normal install or the preserved offline rebuild procedure.

## Future engine upgrades

Keep the old release. Inspect the new upstream version/license and compare its
APIs with pwh's recorded changes. Apply/revise the patch and build scripts, build
a separate candidate, and test selection/rewrite/undo, table styling, picture
replacement, fonts, page layout, reopening and saving real HWPX files. Publish a
new immutable engine revision and only then update `runtime-lock.json`. Do not
overwrite an old asset or label a new upstream build as the old revision.

Maintenance command (Python standard library and Git; not used by end users):

```powershell
python scripts/preserve-engine.py --runtime-root C:\runtime --build-root C:\build --upstream-root C:\pristine --license-evidence C:\license-evidence --output-dir C:\preservation --revision 1 --write-lock
```

Review `docs/license-review-2026-10-16.md` before distributing new assets. A file
checksum proves identity, not licensing permission.
