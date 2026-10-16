# Large-document interaction and local font preparation

The 0.6.13 candidate removes full context/export work from the 750 ms AI button
availability update. Presentation/poll state uses a digest cache invalidated by
document mutation/change events and keyed by epoch, sequence, format, page count
and dirty state. The authoritative `getDocumentState()` and mutation guards stay
fresh; the cached method is separate. Polling yields during pointer interaction
and recent keyboard/wheel input. Files above the 8 MiB recovery limit skip the
repeated full export used only to discover that they are too large for recovery.

Selection line wrapping still uses the renderer's actual text runs. During one
pointer gesture, a bounded 32-page cache reuses parsed text layouts. End/cancel,
document identity, edits and font/layout invalidation discard the cache. Source
text and selection bounds are checked on every request. Selection rectangles
themselves are not cached.

Canvas font preparation first attempts exact, unambiguous installed full/PostScript
face names with the real weight/slant. A failed/unsupported local load has a one
second bound and falls back to the verified font-byte path. This local path does
not verify font bytes and never searches a broad family name. The server's byte
fallback caches file bytes/SHA with a 64 MiB limit, shares concurrent reads and
checks the authorized catalog stamp on every chunk.

## Evidence and limits

On the reported 13-page, approximately 10.4 MiB document, original full export/hash
state reads averaged 849 ms in a local engine probe. Thirty unchanged presentation
reads required one export; `document-changed` invalidated that cache, and two
authoritative reads still performed two fresh exports. Existing controller
apply/revert/conflict/rollback tests passed (11 tests).

With cursor/hit-test warmed, the original wrapped-selection correction measured
22.32 ms median on one body paragraph, versus 0.29 ms with the gesture cache
(10 reads). These are local query measurements, not end-to-end drag latency or a
guarantee for every document. Browser local-font availability, final rendering,
selection/undo/save behavior and perceived latency must also be checked in the
real Codex editor before calling the UI change verified.

The native CLI/WASM remain unchanged. Engine revision 2 retains the new client
source, overlay and build dependencies separately from revision 1.
