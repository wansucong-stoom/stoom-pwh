import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { installDocumentFonts } from '../src/font-provider.mjs';

const origin = 'http://127.0.0.1:4321';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const signal = () => new AbortController().signal;

async function fixture(t, { bytes = new Uint8Array([1, 2, 3]), hash, faceIndex = 0 } = {}) {
  const globals = new Map(['fetch', 'location', 'crypto'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const realm = vm.runInNewContext('({ Uint8Array, ArrayBuffer })');
  let currentBytes = bytes.slice();
  let manifest = {
    schemaVersion: 1, revision: 'nanum-v1',
    faces: [{ id: 'nanumbarun-bold', family: '나눔바른고딕', fullName: 'NanumBarunGothic Bold',
      postscriptName: 'NanumBarunGothicBold', style: 'Bold', weight: 600, slant: 'normal',
      aliases: ['NanumBarunGothic', 'Nanum Barun Gothic'], sha256: hash ?? sha256(bytes), faceIndex }],
  };
  let provider, unsubscribe, notifications = 0, fontRequests = 0, snapshot;
  let notificationJob = Promise.resolve();
  let state = { active: false, generation: 0, count: 0, lastError: null };
  const api = {
    async setProvider(next) {
      unsubscribe?.();
      provider = next;
      state = { active: !!next, generation: state.generation + 1, count: 0, lastError: null };
      if (!next) return;
      const updateSnapshot = async () => {
        snapshot = await next.getSnapshot(signal());
        state.count = snapshot.faces.length;
      };
      unsubscribe = next.subscribe(() => {
        notifications += 1;
        state.generation += 1;
        notificationJob = updateSnapshot();
      });
      await updateSnapshot();
    },
    getState: () => ({ ...state }),
  };
  const studio = { element: { contentWindow: { ...realm, location: { origin }, rhwpStudio: { fonts: api } } } };
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin } });
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, origin, 'font resources must stay on the local origin');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    if (url.pathname === '/document-fonts/manifest') return new Response(JSON.stringify(manifest));
    assert.equal(url.pathname, '/document-fonts/nanumbarun-bold');
    fontRequests += 1;
    return new Response(currentBytes.slice());
  };
  let controller;
  t.after(async () => {
    try { await controller?.dispose(); }
    finally {
      for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
  controller = await installDocumentFonts(studio);
  return {
    controller, studio, realm,
    get provider() { return provider; },
    get snapshot() { return snapshot; },
    get notifications() { return notifications; },
    get fontRequests() { return fontRequests; },
    setManifest(next) { manifest = structuredClone(next); },
    getManifest() { return structuredClone(manifest); },
    setBytes(next) { currentBytes = next.slice(); },
    settleNotifications: () => notificationJob,
  };
}

test('host font contract keeps actual weight and TTC face while handing off owned iframe buffers', async t => {
  const f = await fixture(t, { faceIndex: 2 });
  const face = f.snapshot.faces[0];
  assert.equal(face.weight, 600, 'a Bold label must not silently replace the file weight with 700');
  assert.deepEqual(face.aliases, ['NanumBarunGothic', 'Nanum Barun Gothic']);
  // Upstream HostFontFace is metadata; faceIndex belongs to HostFontData/readFace.
  assert.equal(Object.hasOwn(face, 'faceIndex'), false);
  assert.equal(Object.hasOwn(face, 'sha256'), false);
  const first = await f.provider.readFace(face.id, 'nanum-v1', signal());
  assert.equal(first.faceIndex, 2);
  assert.ok(first.bytes instanceof f.realm.ArrayBuffer);
  assert.ok(!(first.bytes instanceof ArrayBuffer), 'a parent-realm buffer fails upstream instanceof checks');
  assert.deepEqual([...new f.realm.Uint8Array(first.bytes)], [1, 2, 3]);
  new f.realm.Uint8Array(first.bytes)[0] = 255;
  const second = await f.provider.readFace(face.id, 'nanum-v1', signal());
  assert.deepEqual([...new f.realm.Uint8Array(second.bytes)], [1, 2, 3], 'consumer mutation must not alter cached font bytes');
  assert.equal(f.fontRequests, 1);
  assert.equal(await installDocumentFonts(f.studio), f.controller);
});

test('catalog revision guards metadata changes and invalidates old bytes after publishing the replacement', async t => {
  const f = await fixture(t);
  await f.provider.readFace('nanumbarun-bold', 'nanum-v1', signal());
  const original = f.getManifest();
  f.setManifest({ ...original, faces: [{ ...original.faces[0], family: 'changed without revision' }] });
  await assert.rejects(f.controller.refresh(), /revision/);
  assert.equal(f.controller.getState().revision, 'nanum-v1');
  assert.equal(f.notifications, 0);

  const nextBytes = new Uint8Array([4, 5, 6, 7]);
  f.setBytes(nextBytes);
  f.setManifest({ ...original, revision: 'nanum-v2', faces: [{ ...original.faces[0], sha256: sha256(nextBytes) }] });
  await f.controller.refresh();
  await f.settleNotifications();
  assert.equal(f.notifications, 1);
  assert.equal(f.snapshot.revision, 'nanum-v2', 'subscriber must read the newly published snapshot');
  await assert.rejects(f.provider.readFace('nanumbarun-bold', 'nanum-v1', signal()), { name: 'AbortError' });
  const loaded = await f.provider.readFace('nanumbarun-bold', 'nanum-v2', signal());
  assert.deepEqual([...new f.realm.Uint8Array(loaded.bytes)], [...nextBytes]);
  assert.equal(f.fontRequests, 2, 'a new revision must not reuse old bytes');
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(f.provider.readFace('nanumbarun-bold', 'nanum-v2', aborted.signal), { name: 'AbortError' });
});

test('a digest mismatch cannot enter the byte cache or reach the renderer', async t => {
  const f = await fixture(t, { hash: '0'.repeat(64) });
  await assert.rejects(f.provider.readFace('nanumbarun-bold', 'nanum-v1', signal()), /SHA256/);
  assert.equal(f.controller.getState().cachedFaces, 0);
  await assert.rejects(f.provider.readFace('nanumbarun-bold', 'nanum-v1', signal()), /SHA256/);
  assert.equal(f.fontRequests, 2, 'failed bytes must not be reused as a trusted cached face');
});
