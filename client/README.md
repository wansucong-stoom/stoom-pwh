# Versioned pwh editor client

Built from preserved rhwp Studio 0.8.7 commit
`1a76570e833917d15817415a53c09ad61ab3203f` plus this package's
`scripts/build-inline.mjs` and `src/` overlays. The core WASM remains the
separately installed, verified r3 runtime. See the repository's LICENSE,
THIRD_PARTY_NOTICES.md and licenses/ for upstream attribution and terms.

Rebuild using the SHA-256 pinned upstream, Studio inputs and dependency archives
in runtime-lock.json, then run build-inline.mjs and bundle-client.mjs. The
client's .pwh-install.json records each delivered asset's SHA-256. A corrupt
bundle is rejected instead of silently loading an old editor.
