# Embedded images in the inline editor (0.6.14)

## Trigger and cause

A valid HWPX can display its embedded PNGs in Hancom and native rhwp output
while showing broken image elements in the embedded editor. The preserved
Studio flow-image cache creates `blob:` object URLs. A host sandbox whose
image policy permits `data:` but not `blob:` blocks those URLs, even though
WASM returns the complete, valid PNG bytes. This does not depend on Google Drive
or external image references.

The failure was reproduced with the complete inline editor in an opaque-origin
iframe under `img-src data:`. Browser policy errors named the rejected object
URLs. The same four images decoded correctly after the compatibility change.

## Scope of the fix

`client-assets.mjs` still verifies the preserved Studio files against their
installation hashes first. `inline-image-urls.mjs` then adapts only the known
flow-image cache in the response HTML to use cached `data:` URLs. It leaves the
engine files, HWPX bytes, layout, crop, image MIME and decoded bytes unchanged.
Other object URLs and the existing document-generation cache invalidation are
preserved. No external resource domains or connection permissions are added.

The compatibility adapter requires one recognized cache region and one known
URL factory. A different or ambiguous bundle fails explicitly rather than
silently applying a broad source replacement. An engine upgrade must review
this adapter as well as the normal preservation checks.

Base64 strings add memory compared with binary blobs; the existing cache keeps
encoding to once per image identity and is cleared with document generations.
The module is served with the plugin source and does not require republishing
the unchanged preserved runtime archive.

## Verification

- Unit tests compare exact image bytes across encoding chunk boundaries, check
  one-read cache reuse, preserve unrelated object URLs and reject changed bundles.
- The optional real-browser test decodes the same synthetic PNG through both
  routes under the restricted image policy: old route fails, new route succeeds.
- A local 15-page HWPX with four PNG charts was opened in the complete editor.
  All four old image elements failed, and all four patched elements decoded at
  their original dimensions. The private document and screenshots are excluded
  from this public repository and package.
- The plugin version and fresh file resource are 0.6.14. Previous resource
  identities remain readable, including 0.6.13. Existing unsaved frames are not
  silently replaced: save and reopen them after installing the update.

The iframe browser reproduction is distinct from confirming display in a newly
updated Codex desktop session. A loaded document or increased state counter
alone is not evidence that an image appeared.

To run the optional browser regression with an existing Playwright installation:

```text
PWH_BROWSER_TESTS=1
PWH_PLAYWRIGHT_MODULE=<module specifier or file URL for Playwright>
PWH_BROWSER_EXECUTABLE=<optional installed Chromium executable>
node --test tests/inline-image-browser.test.mjs
```
