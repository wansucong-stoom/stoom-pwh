// Same-origin, host-owned fonts for Studio 0.8.7. The existing Studio provider
// loads these exact bytes for Canvas2D paint, supplemental WASM metrics and
// CanvasKit faces; it does not rewrite font names in the document.
const installations = new WeakMap();
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FONT_BYTES = 64 * 1024 * 1024;
const MAX_FACES = 4096;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;

function abortError() {
  const error = new Error('글꼴 요청이 취소되었습니다.');
  error.name = 'AbortError';
  return error;
}

function checkName(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > 1024 || (!allowEmpty && !value.trim())) {
    throw new Error(`글꼴 manifest의 ${label} 값이 올바르지 않습니다.`);
  }
  return value;
}

function validateManifest(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.faces) || value.faces.length > MAX_FACES) {
    throw new Error('지원하지 않는 글꼴 manifest입니다. schemaVersion:1과 faces 배열이 필요합니다.');
  }
  const revision = checkName(value.revision, 'revision');
  const ids = new Set();
  const faces = value.faces.map((face) => {
    if (!face || typeof face.id !== 'string' || !ID.test(face.id) || ids.has(face.id)) {
      throw new Error('글꼴 ID는 중복 없는 영문·숫자·점·밑줄·하이픈이어야 합니다.');
    }
    ids.add(face.id);
    if (!Number.isInteger(face.weight) || face.weight < 1 || face.weight > 1000
      || !['normal', 'italic', 'oblique'].includes(face.slant ?? 'normal')) {
      throw new Error(`글꼴 ${face.id}의 weight/slant가 올바르지 않습니다.`);
    }
    if (!Array.isArray(face.aliases ?? []) || (face.aliases?.length ?? 0) > 32) {
      throw new Error(`글꼴 ${face.id}의 aliases가 올바르지 않습니다.`);
    }
    if (typeof face.sha256 !== 'string' || !SHA256.test(face.sha256)
      || !Number.isSafeInteger(face.faceIndex ?? 0) || (face.faceIndex ?? 0) < 0) {
      throw new Error(`글꼴 ${face.id}의 sha256/faceIndex가 올바르지 않습니다.`);
    }
    return Object.freeze({
      id: face.id,
      family: checkName(face.family, 'family'),
      fullName: checkName(face.fullName, 'fullName'),
      postscriptName: checkName(face.postscriptName, 'postscriptName', true),
      style: checkName(face.style, 'style', true),
      aliases: Object.freeze([...new Set((face.aliases ?? []).map(alias => checkName(alias, 'alias')))]),
      weight: face.weight, slant: face.slant ?? 'normal',
      sha256: face.sha256.toLowerCase(), faceIndex: face.faceIndex ?? 0,
    });
  });
  return Object.freeze({ schemaVersion: 1, revision, faces: Object.freeze(faces) });
}

function publicFace(face) {
  const { id, family, fullName, postscriptName, style, aliases, weight, slant } = face;
  return { id, family, fullName, postscriptName, style, aliases: [...aliases], weight, slant };
}

async function limitedBytes(response, maximum, label) {
  if (!response.ok) throw new Error(`${label} 요청 실패: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new Error(`${label} 크기 제한을 초과했습니다.`);
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maximum) throw new Error(`${label} 크기 제한을 초과했습니다.`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error(`${label} 크기 제한을 초과했습니다.`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

async function hashBytes(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Call after createStudio() resolves, before loadFile().
 * GET /document-fonts/manifest:
 * {schemaVersion:1, revision:string, faces:[{id,family,fullName,postscriptName,
 * style,aliases?:string[],weight:400|700,slant?:'normal',sha256,faceIndex?:0}]}.
 * Other weights/slants and nonzero TTC face indexes follow the same contract.
 * GET /document-fonts/{id} returns the exact font file, never a local file path.
 */
export async function installDocumentFonts(studio) {
  if (!studio || (typeof studio !== 'object' && typeof studio !== 'function')) {
    throw new Error('준비된 Studio 인스턴스가 필요합니다.');
  }
  const existing = installations.get(studio);
  if (existing) return existing;
  const frame = studio.element?.contentWindow;
  const parentOrigin = globalThis.location?.origin;
  let frameOrigin, api;
  try { frameOrigin = frame?.location?.origin; api = frame?.rhwpStudio?.fonts; }
  catch { throw new Error('글꼴 공급에는 같은 origin의 로컬 Studio iframe이 필요합니다.'); }
  if (!frame || !parentOrigin || frameOrigin !== parentOrigin
    || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(parentOrigin).hostname)) {
    throw new Error('글꼴 공급은 같은 origin의 localhost Studio에서만 사용할 수 있습니다.');
  }
  if (typeof api?.setProvider !== 'function' || typeof api?.getState !== 'function') {
    throw new Error('현재 Studio에 공개 글꼴 provider API가 없습니다.');
  }
  const manifestUrl = new URL('/document-fonts/manifest', parentOrigin).href;
  let manifest, disposed = false, epoch = 0, refreshJob;
  const subscribers = new Set();
  const cached = new Map();
  const pending = new Map();
  const controllers = new Set();

  async function requestBytes(url, limit, label) {
    if (disposed) throw abortError();
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      return await limitedBytes(response, limit, label);
    } finally { controllers.delete(controller); }
  }

  async function readManifest() {
    const bytes = await requestBytes(manifestUrl, MAX_MANIFEST_BYTES, '글꼴 manifest');
    return validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  }

  function invalidate() {
    epoch += 1;
    for (const controller of controllers) controller.abort();
    cached.clear(); pending.clear();
  }

  const provider = {
    async getSnapshot(signal) {
      if (disposed || signal?.aborted) throw abortError();
      return { revision: manifest.revision, faces: manifest.faces.map(publicFace) };
    },
    async readFace(id, revision, signal) {
      if (disposed || signal?.aborted || revision !== manifest.revision) throw abortError();
      const face = manifest.faces.find(item => item.id === id);
      if (!face) throw new Error('등록되지 않은 글꼴 ID입니다.');
      const generation = epoch;
      const key = `${revision}\u0000${id}`;
      let bytes = cached.get(key);
      if (!bytes) {
        let job = pending.get(key);
        if (!job) {
          job = (async () => {
            const data = await requestBytes(new URL(`/document-fonts/${encodeURIComponent(id)}`, parentOrigin).href,
              MAX_FONT_BYTES, `글꼴 ${id}`);
            if (!data.byteLength || await hashBytes(data) !== face.sha256) {
              throw new Error(`글꼴 ${id}의 SHA256이 manifest와 다릅니다.`);
            }
            if (disposed || generation !== epoch || revision !== manifest.revision) throw abortError();
            cached.set(key, data);
            return data;
          })().finally(() => { if (pending.get(key) === job) pending.delete(key); });
          pending.set(key, job);
        }
        bytes = await job;
      }
      if (disposed || signal?.aborted || generation !== epoch || revision !== manifest.revision) throw abortError();
      // HostFontSource checks instanceof its own ArrayBuffer constructor. A view
      // over a parent buffer is insufficient: allocate, then copy in the iframe.
      const localBytes = new frame.Uint8Array(bytes.byteLength);
      localBytes.set(new Uint8Array(bytes));
      return { bytes: localBytes.buffer, faceIndex: face.faceIndex };
    },
    subscribe(onChange) {
      if (typeof onChange !== 'function') throw new Error('글꼴 변경 구독 함수가 필요합니다.');
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
  };

  const controller = Object.freeze({
    getState() {
      return { installed: !disposed, revision: manifest?.revision ?? null, count: manifest?.faces.length ?? 0,
        families: [...new Set(manifest?.faces.map(face => face.family) ?? [])],
        cachedFaces: cached.size, studio: api.getState() };
    },
    /** Explicit refresh; no background requests or document edits are scheduled. */
    async refresh() {
      if (disposed) throw abortError();
      if (refreshJob) return refreshJob;
      refreshJob = (async () => {
        const next = await readManifest();
        if (disposed) throw abortError();
        if (next.revision === manifest.revision) {
          if (JSON.stringify(next) !== JSON.stringify(manifest)) {
            throw new Error('글꼴 목록·속성·바이트가 바뀌면 manifest revision도 변경해야 합니다.');
          }
          return controller.getState();
        }
        invalidate();
        manifest = next;
        // Publish the snapshot before asking Studio to invalidate metrics/faces.
        for (const notify of [...subscribers]) notify();
        return controller.getState();
      })().finally(() => { refreshJob = undefined; });
      return refreshJob;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      subscribers.clear();
      if (installations.get(studio) === controller) {
        installations.delete(studio);
        await api.setProvider(null);
      }
    },
  });

  try {
    manifest = await readManifest();
    await api.setProvider(provider);
    const status = api.getState();
    if (!status.active || status.lastError || status.count !== manifest.faces.length) {
      throw new Error(`Studio 글꼴 등록 실패: ${status.lastError || '목록 개수 불일치'}`);
    }
    installations.set(studio, controller);
    return controller;
  } catch (error) {
    disposed = true; invalidate(); subscribers.clear();
    try { await api.setProvider(null); } catch { /* Preserve the original failure. */ }
    throw error;
  }
}
