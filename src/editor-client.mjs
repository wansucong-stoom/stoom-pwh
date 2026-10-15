import { createStudio } from '/sdk/index.js';
import { installDocumentFonts } from '/font-provider.mjs';

// Uses the published @rhwp/editor API, hosted on this same loopback origin.
// Runtime state comes from the visible Studio instance, including unsaved edits.
const $ = (id) => document.getElementById(id);
const token = location.hash.slice(1);
// Each loaded tab owns a distinct editor instance, even when a tab is duplicated.
const clientId = crypto.randomUUID();
const state = {
  studio: null, sessionId: null, documentState: null, stopped: false, busy: false,
  busyMessage: 'Codex가 문서를 편집하고 있습니다.',
  composing: false, saving: false, online: true, notice: '', lastSentState: null,
  syncTimer: null, stateTimer: null, statePollPending: false, disposeChanged: null,
  selectionContext: null, selectionRich: false, selectionState: null,
  annotationRecord: null, annotationVersion: 0, annotationTimer: null, annotationPending: false,
  nativeSurface: null, fonts: null,
};
let operationQueue = Promise.resolve();
const receipts = new Map();
const removers = [];
const requestMenuItems = new Set();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function statesMatch(left, right) {
  return !!left && !!right && left.documentEpoch === right.documentEpoch && left.changeSeq === right.changeSeq && left.documentSha256 === right.documentSha256;
}

export async function selectionFingerprint(selection) {
  const bytes = new TextEncoder().encode(JSON.stringify(selection));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function collaborationBridge(studio) {
  try { return studio.element?.contentWindow?.rhwpStudio?.collaboration; }
  catch { return undefined; }
}

export async function liveSelectionContext(studio) {
  const bridge = collaborationBridge(studio);
  if (typeof bridge?.getSelectionContext === 'function') {
    const context = await bridge.getSelectionContext();
    if (!context || typeof context !== 'object' || Array.isArray(context)) throw bridgeError('INVALID_SELECTION_CONTEXT', '편집기의 선택 정보를 읽지 못했습니다.');
    return { context, rich: true };
  }
  return { context: await studio.getSelectionContext(), rich: false };
}

function bridgeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return token ? message.split(token).join('[세션 인증 정보]') : message;
}

export function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > 180 * 1024 * 1024 || !/^[A-Za-z0-9+/=\r\n]*$/.test(value)) throw bridgeError('INVALID_DOCUMENT', '문서 데이터 형식이 올바르지 않습니다.');
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeBase64(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function serial(task) {
  const result = operationQueue.then(task);
  operationQueue = result.catch(() => {});
  return result;
}

function renderStatus() {
  const current = state.documentState;
  const message = state.stopped ? (state.notice || '공유 세션 연결이 종료되었습니다.')
    : !state.online ? '연결이 끊겼습니다. 로컬 서버에 다시 연결하고 있습니다.'
      : state.busy ? state.busyMessage
        : state.saving ? '현재 문서를 새 수정본으로 저장하고 있습니다.'
          : state.notice || `공유 세션 연결됨${current ? ` · 변경 ${current.changeSeq} · ${current.dirty ? '저장 전 변경 있음' : '저장됨'}` : ''}`;
  $('shared-status').textContent = message;
  $('shared-status').dataset.kind = state.stopped || !state.online ? 'error' : state.busy || state.saving ? 'busy' : 'ready';
  $('save-copy').disabled = !state.studio || state.stopped || state.busy || state.saving || !state.online;
  renderRequestControls();
}

async function api(path, body, { timeout = 75000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'X-HOP-Client': clientId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
    });
    let result;
    try { result = await response.json(); } catch { throw bridgeError('INVALID_SERVER_RESPONSE', '로컬 서버의 응답을 읽지 못했습니다.'); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { state.stopped = true; state.notice = '세션 인증이 만료되었습니다. Codex에서 문서를 다시 열어 주세요.'; renderStatus(); }
      if (response.status === 409 && path === '/api/bootstrap') {
        state.stopped = true; state.notice = '이미 다른 편집 탭에서 이 문서를 열었습니다. 먼저 연 탭에서 작업해 주세요.'; renderStatus();
        throw bridgeError('SESSION_ALREADY_OPEN', state.notice);
      }
      if (response.status === 409 && result?.code === 'SESSION_OWNED_ELSEWHERE') { state.stopped = true; state.notice = '다른 편집 탭에서 공유 세션을 사용하고 있습니다. 먼저 연 탭에서 작업해 주세요.'; renderStatus(); }
      throw bridgeError(result?.error?.code || result?.code || `HTTP_${response.status}`, result?.error?.message || (typeof result?.error === 'string' ? result.error : result?.message) || '로컬 서버 요청에 실패했습니다.');
    }
    state.online = true;
    return result;
  } finally { clearTimeout(timer); }
}

function setEditingBusy(busy, message = 'Codex가 문서를 편집하고 있습니다.') {
  state.busy = busy;
  state.busyMessage = message;
  $('working').querySelector('span').textContent = message;
  $('working').hidden = !busy;
  if (state.studio?.element) {
    // Move keyboard focus outside the iframe as well as blocking pointer input.
    if (busy) $('shared-status').focus({ preventScroll: true });
    state.studio.element.inert = busy;
    state.studio.element.setAttribute('aria-busy', String(busy));
  }
  renderStatus();
}

const MUTATIONS = new Set(['command', 'hwpctrl', 'applyTextCommand', 'undo', 'redo', 'load']);

async function guardedState(studio, expected, isComposing) {
  if (isComposing()) throw bridgeError('IME_COMPOSING', '한글 입력이 조합 중입니다. 입력이 끝난 뒤 다시 시도해 주세요.');
  if (!expected || !Number.isInteger(expected.documentEpoch) || !Number.isInteger(expected.changeSeq) || typeof expected.documentSha256 !== 'string') throw bridgeError('EXPECTED_STATE_REQUIRED', '편집에는 현재 문서의 epoch·changeSeq·SHA256이 필요합니다.');
  const current = await studio.getDocumentState();
  if (!statesMatch(current, expected)) throw bridgeError('STATE_CONFLICT', '문서가 변경되었습니다. 현재 상태를 다시 읽은 뒤 편집해 주세요.');
  if (isComposing()) throw bridgeError('IME_COMPOSING', '한글 입력이 조합 중입니다. 잠시 후 다시 시도해 주세요.');
  return current;
}

export async function executeOperation(studio, command, { isComposing = () => false } = {}) {
  const operation = command?.operation;
  if (!operation || typeof operation.type !== 'string') throw bridgeError('INVALID_OPERATION', '지원하는 편집 작업이 필요합니다.');
  let before;
  if (MUTATIONS.has(operation.type)) before = await guardedState(studio, command.expectedState, isComposing);
  switch (operation.type) {
    case 'state': {
      const snapshot = await studio.getDocumentState();
      const { context: selection } = await liveSelectionContext(studio);
      const text = await studio.hwpctrl.call('GetTextFile', ['UNICODE', '']);
      let diagnostics;
      if (operation.diagnostics === true) {
        const page = Number.isInteger(operation.page) && operation.page >= 0 ? operation.page : 0;
        const [renderer, fonts] = await Promise.all([
          studio.getRendererDiagnostics(page), studio.getFontDecisionTrace(page, {maxCharacters: 96}),
        ]);
        diagnostics = {renderer, fonts, supply: state.fonts?.getState()};
      }
      const after = await studio.getDocumentState();
      if (!statesMatch(snapshot, after)) throw bridgeError('STATE_CHANGED_DURING_READ', '내용을 읽는 동안 문서가 변경되었습니다. 다시 읽어 주세요.');
      return { state: { ...after, selectionFingerprint: await selectionFingerprint(selection) }, selection, text, ...(diagnostics ? {diagnostics} : {}) };
    }
    case 'commands': return studio.commands.list();
    case 'command': {
      if (typeof operation.id !== 'string' || !operation.id.trim() || operation.id.length > 256) throw bridgeError('INVALID_COMMAND', '실행할 메뉴 명령 ID가 필요합니다.');
      if (typeof command.expectedState.selectionFingerprint !== 'string') throw bridgeError('EXPECTED_SELECTION_REQUIRED', '메뉴 명령 실행 전 현재 선택 영역을 다시 읽어 주세요.');
      const { context: selection } = await liveSelectionContext(studio);
      if (await selectionFingerprint(selection) !== command.expectedState.selectionFingerprint) throw bridgeError('SELECTION_CONFLICT', '사용자의 선택 영역이 바뀌었습니다. 현재 선택을 다시 확인해 주세요.');
      if (!statesMatch(await studio.getDocumentState(), before)) throw bridgeError('STATE_CONFLICT', '선택을 확인하는 동안 문서가 변경되었습니다. 다시 읽어 주세요.');
      const result = await studio.commands.execute(operation.id, operation.params, { allowDialog: false });
      if (result?.ok === false) throw bridgeError('COMMAND_REJECTED', result.message || result.reason || '편집기가 명령을 실행하지 않았습니다.');
      return { state: await studio.getDocumentState(), result };
    }
    case 'hwpctrl': {
      if (!Array.isArray(operation.calls) || !operation.calls.length || operation.calls.length > 100) throw bridgeError('INVALID_BATCH', '1~100개의 HwpCtrl 호출이 필요합니다.');
      const calls = operation.calls.map((call) => {
        if (!call || typeof call.method !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(call.method) || (call.args !== undefined && !Array.isArray(call.args))) throw bridgeError('INVALID_BATCH', 'HwpCtrl 메서드와 인자 배열이 올바르지 않습니다.');
        return { m: call.method, a: call.args || [] };
      });
      const results = await studio.hwpctrl.batch(calls);
      return { state: await studio.getDocumentState(), results };
    }
    case 'applyTextCommand': return { receipt: await studio.applyTextCommand(operation.command), state: await studio.getDocumentState() };
    case 'undo': return { result: await studio.hwpctrl.undo(), state: await studio.getDocumentState() };
    case 'redo': return { result: await studio.hwpctrl.redo(), state: await studio.getDocumentState() };
    case 'snapshot': {
      if (!['hwpx', 'hwp'].includes(operation.format)) throw bridgeError('INVALID_FORMAT', '저장 형식은 hwpx 또는 hwp여야 합니다.');
      const snapshot = await studio.getDocumentState();
      if (command.expectedState && !statesMatch(snapshot, command.expectedState)) throw bridgeError('STATE_CONFLICT', '저장할 문서 상태가 변경되었습니다.');
      if (isComposing()) throw bridgeError('IME_COMPOSING', '한글 입력이 끝난 뒤 저장해 주세요.');
      const bytes = operation.format === 'hwpx' ? await studio.exportHwpx() : await studio.exportHwp();
      const after = await studio.getDocumentState();
      if (!statesMatch(snapshot, after)) throw bridgeError('STATE_CHANGED_DURING_EXPORT', '내보내는 동안 문서가 변경되었습니다. 다시 저장해 주세요.');
      return { base64: encodeBase64(bytes), state: after, format: operation.format };
    }
    case 'load': {
      if (before.dirty && operation.allowReplace !== true) throw bridgeError('UNSAVED_CHANGES', '현재 문서에 저장하지 않은 변경이 있어 다른 문서를 불러오지 않았습니다.');
      if (typeof operation.name !== 'string' || !operation.name.trim()) throw bridgeError('INVALID_DOCUMENT', '불러올 문서 이름이 필요합니다.');
      const result = await studio.loadFile(decodeBase64(operation.base64), operation.name, { skipUnsavedGuard: operation.allowReplace === true, suppressDialogs: true });
      return { state: await studio.getDocumentState(), result, name: operation.name };
    }
    default: throw bridgeError('UNSUPPORTED_OPERATION', `지원하지 않는 문서 작업: ${operation.type}`);
  }
}

function scheduleChange(reason = 'document_changed') {
  clearTimeout(state.syncTimer);
  if (state.stopped) return;
  state.syncTimer = setTimeout(() => void serial(() => syncChange(reason)).catch(connectionFailure), 200);
}

async function syncChange(reason, force = false) {
  if (state.stopped || !state.studio) return;
  const documentState = await state.studio.getDocumentState();
  const { context: selection, rich } = await liveSelectionContext(state.studio);
  const verifiedState = await state.studio.getDocumentState();
  if (!statesMatch(documentState, verifiedState)) { invalidateAnnotation(); scheduleChange('selection_changed'); return; }
  const current = { ...documentState, selectionFingerprint: await selectionFingerprint(selection) };
  if ((reason === 'user_input' || reason === 'state_poll') && !statesMatch(current, state.documentState)) state.notice = '';
  state.documentState = current;
  cacheSelection(selection, current, rich);
  // Studio's strict change event covers agent apply/revert. Polling also sees user typing.
  if (force || !statesMatch(current, state.lastSentState) || current.dirty !== state.lastSentState?.dirty || current.selectionFingerprint !== state.lastSentState?.selectionFingerprint) {
    await api('/api/change', { state: current, selection, reason });
    state.lastSentState = current;
  }
  renderStatus();
}

function nativeAnnotations() {
  const annotation = document.oai?.annotation;
  return typeof annotation?.request === 'function' ? annotation : null;
}

function requestReady() {
  const record = state.annotationRecord;
  return !!record && state.selectionContext?.ready !== false && !state.annotationPending && !state.stopped && !state.busy && !state.saving && !state.composing && state.online
    && statesMatch(record.state, state.selectionState) && statesMatch(record.state, state.documentState)
    && record.state.selectionFingerprint === state.selectionState?.selectionFingerprint;
}

function renderRequestControls() {
  if (!$('request-ai')) return;
  const ready = requestReady();
  $('request-ai').disabled = !ready;
  $('request-ai').textContent = nativeAnnotations() ? 'AI 수정 요청' : '수정 요청 복사';
  $('request-comment').disabled = !state.studio || state.stopped;
  for (const item of requestMenuItems) {
    if (!item.isConnected) { requestMenuItems.delete(item); continue; }
    item.classList.toggle('disabled', !ready);
    item.setAttribute('aria-disabled', String(!ready));
  }
}

function selectedText(context) {
  const candidates = [context?.selectedText?.text, context?.selectedText, context?.selection?.selectedText, context?.selection?.text, context?.text, context?.paragraph?.text, context?.paragraphText, context?.table?.selectedText];
  return candidates.find((value) => typeof value === 'string' && value.length) || '';
}

function selectionObjectType(context) {
  const explicit = context?.objectType || context?.selectionKind || context?.kind || context?.type || context?.selection?.kind || context?.selection?.type;
  if (typeof explicit === 'string') return explicit.slice(0, 80);
  if (context?.table) return 'table';
  if (context?.selectedObjects?.length) return 'object';
  return context?.collapsed === false ? 'text' : 'paragraph';
}

function renderSelectionSummary(context, rich) {
  const type = selectionObjectType(context);
  const names = { table: '표', table_cell: '표 셀', cell: '표 셀', cell_text: '표 셀 안 글자', cell_block: '표 셀 블록', table_object: '표 개체', body_text: '본문 글자·문단', textbox_text: '글상자 안 글자', unsupported_submode: '상세 선택 미지원 영역', text: '글자 선택', text_range: '글자 선택', paragraph: '문단', body_paragraph: '본문 문단', object: '개체', picture: '그림', image: '그림', none: '현재 위치' };
  $('selection-title').textContent = `${names[type] || type} · ${rich ? '현재 선택' : '기본 선택 정보'}`;
  const text = selectedText(context);
  $('selection-text').textContent = text ? text.slice(0, 1000) : (context?.table ? '표 또는 셀의 구조·서식 정보를 수정 요청에 포함합니다.' : '선택 위치와 문서 정보를 수정 요청에 포함합니다.');
  const page = context?.page ?? context?.cursor?.page;
  $('selection-detail').textContent = `${page ? `${page}쪽 · ` : ''}${rich ? (context?.ready === false ? '선택 정보를 준비하고 있습니다.' : type === 'unsupported_submode' ? '이 편집 영역의 정확한 선택 위치는 지원하지 않습니다.' : '문서 개체·커서·서식 정보 연결됨') : '상세 선택 연결이 없습니다. SDK의 본문 문단 정보만 사용합니다.'}`;
}

function invalidateAnnotation() {
  state.annotationRecord = null;
  state.annotationVersion += 1;
  clearTimeout(state.annotationTimer);
  renderRequestControls();
}

function cacheSelection(context, current, rich) {
  const changed = !statesMatch(current, state.selectionState) || current.selectionFingerprint !== state.selectionState?.selectionFingerprint;
  state.selectionContext = context; state.selectionState = current; state.selectionRich = rich;
  state.nativeSurface?.invalidate();
  if (changed) invalidateAnnotation();
  renderSelectionSummary(context, rich);
  if (!state.annotationRecord && !state.annotationPending) scheduleAnnotation();
}

export function boundedSelectionContext(context) {
  let truncated = false;
  const visit = (value, depth = 0) => {
    if (typeof value === 'string') { if (value.length > 1000) truncated = true; return value.slice(0, 1000); }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth > 8) { truncated = true; return null; }
    if (Array.isArray(value)) { if (value.length > 100) truncated = true; return value.slice(0, 100).map((item) => visit(item, depth + 1)); }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value); if (entries.length > 100) truncated = true;
      return Object.fromEntries(entries.slice(0, 100).map(([key, item]) => [key, visit(item, depth + 1)]));
    }
    return null;
  };
  const bounded = visit(context);
  return truncated ? { ...bounded, contextTruncated: true } : bounded;
}

function scheduleAnnotation() {
  clearTimeout(state.annotationTimer);
  if (!state.selectionState || !state.selectionContext || state.selectionContext.ready === false || state.stopped || state.composing) return;
  const version = state.annotationVersion;
  state.annotationTimer = setTimeout(() => void prepareAnnotation(version), 280);
  $('request-status').textContent = '선택한 내용과 수정 요청을 준비하고 있습니다.';
}

async function prepareAnnotation(version) {
  if (version !== state.annotationVersion || !state.selectionState || state.stopped) return;
  const record = {
    requestId: crypto.randomUUID(), state: { ...state.selectionState },
    context: boundedSelectionContext(state.selectionContext), comment: $('request-comment').value,
  };
  state.annotationPending = true; renderRequestControls();
  try {
    const response = await api('/api/annotation', record);
    if (version !== state.annotationVersion) return;
    if (typeof response.requestId !== 'string' || !response.requestId) throw bridgeError('ANNOTATION_FAILED', '수정 요청을 준비하지 못했습니다.');
    state.annotationRecord = { ...record, requestId: response.requestId };
    $('request-status').textContent = nativeAnnotations() ? 'AI 수정 요청을 누른 뒤 Codex 채팅에서 보내 주세요.' : '이 브라우저에는 Codex 주석 연결이 없습니다. 요청을 복사해 채팅에 붙여넣을 수 있습니다.';
  } catch (error) {
    if (version === state.annotationVersion) $('request-status').textContent = safeError(error);
  } finally {
    state.annotationPending = false; renderRequestControls();
    if (version !== state.annotationVersion && !state.stopped) scheduleAnnotation();
  }
}

function initialComment(value) {
  let comment = value || '이 문서에서 선택한 내용을 수정해 주세요.';
  comment = comment.slice(0, 240);
  if (/[\uD800-\uDBFF]$/.test(comment)) comment = comment.slice(0, -1);
  return comment;
}

// Intentionally synchronous: native annotation requests must retain the user's click gesture.
function requestAiEdit() {
  if (!requestReady()) { $('request-status').textContent = '선택 정보를 준비하고 있습니다. 잠시 후 다시 눌러 주세요.'; return; }
  const record = state.annotationRecord;
  const annotation = nativeAnnotations();
  if (annotation) {
    try {
      const result = annotation.request($('selection-card'), {
        initialComment: initialComment(record.comment),
        metadata: {
          sessionId: state.sessionId, requestId: record.requestId,
          epoch: record.state.documentEpoch, seq: record.state.changeSeq,
          sha256: record.state.documentSha256, objectType: selectionObjectType(record.context),
        },
      });
      $('request-status').textContent = result?.accepted ? '주석 작성을 요청했습니다. 내용을 확인하고 Codex 채팅에서 보내 주세요.' : '주석 작성을 열지 못했습니다. 브라우저의 주석 기능 권한을 확인해 주세요.';
    } catch (error) { $('request-status').textContent = safeError(error); }
    return;
  }
  const text = `pwh 문서에서 선택한 내용의 수정 요청입니다. 원본을 보존하고 현재 공유 세션에서 내용을 확인한 뒤 수정해 주세요.\n세션: ${state.sessionId}\n요청 ID: ${record.requestId}\n요청: ${record.comment || '선택한 내용을 수정해 주세요.'}`;
  const copied = navigator.clipboard?.writeText?.(text);
  if (copied && typeof copied.then === 'function') copied.then(() => { $('request-status').textContent = '요청을 복사했습니다. Codex 채팅에 붙여넣고 보내 주세요.'; }).catch(() => { $('request-manual').textContent = text; $('request-manual').hidden = false; $('request-status').textContent = '아래 요청을 복사해 Codex 채팅으로 보내 주세요.'; });
  else { $('request-manual').textContent = text; $('request-manual').hidden = false; $('request-status').textContent = '아래 요청을 복사해 Codex 채팅으로 보내 주세요.'; }
}

function installNativeSurface(studio) {
  state.nativeSurface?.dispose(); state.nativeSurface = null;
  const annotation = document.oai?.annotation;
  const bridge = collaborationBridge(studio);
  if (typeof annotation?.registerSurface !== 'function' || typeof bridge?.hitTest !== 'function') return;
  try {
    state.nativeSurface = annotation.registerSurface({
      element: $('workspace'),
      hitTest({ clientX, clientY, signal }) {
        if (signal?.aborted || state.stopped) return null;
        const bounds = studio.element.getBoundingClientRect();
        if (clientX < bounds.left || clientY < bounds.top || clientX > bounds.right || clientY > bounds.bottom || !bounds.width || !bounds.height) return null;
        const point = {
          clientX: (clientX - bounds.left) * (studio.element.clientWidth / bounds.width),
          clientY: (clientY - bounds.top) * (studio.element.clientHeight / bounds.height),
        };
        const viewport = studio.element.contentDocument?.getElementById?.('scroll-container')?.getBoundingClientRect();
        if (viewport && (point.clientX < viewport.left || point.clientX > viewport.right || point.clientY < viewport.top || point.clientY > viewport.bottom)) return null;
        let hit;
        try { hit = bridge.hitTest(point); } catch { return null; }
        const convert = (value) => {
          if (signal?.aborted || !value?.ready || !value.position) return null;
          const position = JSON.stringify(value.position);
          // Bounds candidates are not an observed z-order selection. Identify the source position.
          return {
            id: `source-${state.selectionState?.documentEpoch ?? 0}-${value.pageIndex}-${position}`,
            name: `${value.pageIndex + 1}쪽 · 문서 위치`, role: 'document-position',
            metadata: {
              sessionId: state.sessionId, epoch: state.selectionState?.documentEpoch ?? null,
              seq: state.selectionState?.changeSeq ?? null, pageIndex: value.pageIndex,
              sourcePosition: position.slice(0, 256), hitKind: 'source-position',
            },
          };
        };
        return hit && typeof hit.then === 'function' ? Promise.resolve(hit).then(convert).catch(() => null) : convert(hit);
      },
    });
  } catch { /* Native annotations are optional; the explicit request button remains available. */ }
}

function connectionFailure(error) {
  if (state.stopped) return;
  state.online = false;
  state.notice = safeError(error);
  renderStatus();
}

async function processCommand(command) {
  if (!command || (typeof command.id !== 'string' && typeof command.id !== 'number')) throw bridgeError('INVALID_COMMAND', '서버 명령 ID가 필요합니다.');
  if (receipts.has(command.id)) return receipts.get(command.id);
  let response;
  const mutation = MUTATIONS.has(command.operation?.type);
  try {
    if (mutation && state.composing) throw bridgeError('IME_COMPOSING', '한글 입력이 조합 중입니다. 입력이 끝난 뒤 다시 시도해 주세요.');
    if (mutation) setEditingBusy(true);
    const result = await executeOperation(state.studio, command, { isComposing: () => state.composing });
    if (result?.state) state.documentState = result.state;
    if (command.operation?.type === 'load' && result?.name) $('document-name').textContent = result.name;
    if (mutation) { state.notice = 'Codex의 편집을 같은 문서에 반영했습니다.'; scheduleChange('agent_command'); }
    response = { id: command.id, ok: true, result };
  } catch (error) {
    state.notice = safeError(error);
    response = { id: command.id, ok: false, error: { code: error.code || 'EDITOR_OPERATION_FAILED', message: safeError(error), ...(typeof error.recovered === 'boolean' ? { recovered: error.recovered } : {}) } };
    scheduleChange('command_failed');
  } finally { if (mutation) setEditingBusy(false); renderStatus(); }
  receipts.set(command.id, response);
  if (receipts.size > 100) receipts.delete(receipts.keys().next().value);
  return response;
}

async function pollLoop() {
  let retryDelay = 1000;
  while (!state.stopped) {
    try {
      const { command } = await api('/api/poll', undefined, { timeout: 35000 });
      renderStatus();
      if (command) {
        const response = await serial(() => processCommand(command));
        // Keep the receipt and retry delivery; never execute a command again after a network error.
        while (!state.stopped) {
          try { await api('/api/result', response); break; }
          catch (error) { connectionFailure(error); if (!state.stopped) await sleep(1000); }
        }
      }
      retryDelay = 1000;
      await sleep(300);
    } catch (error) {
      connectionFailure(error);
      if (!state.stopped) { await sleep(retryDelay); retryDelay = Math.min(5000, retryDelay * 2); }
    }
  }
}

function trackComposition(studio) {
  let detachDocument = () => {};
  const attach = () => {
    detachDocument(); state.composing = false;
    let innerDocument;
    try { innerDocument = studio.element.contentDocument; } catch { /* Same-origin hosting is required. */ }
    if (!innerDocument) { state.stopped = true; state.notice = '편집기 입력 상태를 확인할 수 없습니다. 같은 로컬 주소에서 문서를 다시 열어 주세요.'; renderStatus(); return; }
    const start = () => { state.composing = true; };
    const end = () => { state.composing = false; scheduleChange('user_input'); };
    innerDocument.addEventListener('compositionstart', start, true);
    innerDocument.addEventListener('compositionend', end, true);
    // input events can fire during IME; preserve isComposing until compositionend.
    const input = (event) => {
      if (state.documentState) state.documentState = { ...state.documentState, dirty: true };
      invalidateAnnotation();
      if (!event.isComposing && !state.composing) scheduleChange('user_input');
    };
    innerDocument.addEventListener('input', input, true);
    const selectionChanged = () => { invalidateAnnotation(); scheduleChange('selection_changed'); };
    for (const eventName of ['selectionchange', 'mouseup', 'keyup', 'contextmenu']) innerDocument.addEventListener(eventName, selectionChanged, true);
    const surfaceMoved = () => state.nativeSurface?.invalidate();
    innerDocument.addEventListener('scroll', surfaceMoved, true);
    studio.element.contentWindow.addEventListener('resize', surfaceMoved);
    const addMenuAction = (menu) => {
      if (menu.querySelector('[data-hop-ai-request]')) return;
      const item = innerDocument.createElement('div');
      item.className = 'md-item'; item.dataset.hopAiRequest = 'true'; item.textContent = 'AI 수정 요청';
      item.setAttribute('role', 'menuitem'); item.tabIndex = 0;
      item.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation(); });
      const activate = (event) => {
        event.preventDefault(); event.stopPropagation();
        requestAiEdit();
        if (requestReady()) innerDocument.dispatchEvent(new studio.element.contentWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      };
      item.addEventListener('click', activate);
      item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') activate(event); });
      menu.insertBefore(item, menu.firstChild);
      const separator = innerDocument.createElement('div'); separator.className = 'md-sep'; menu.insertBefore(separator, item.nextSibling);
      requestMenuItems.add(item); renderRequestControls();
    };
    for (const menu of innerDocument.querySelectorAll('.context-menu')) addMenuAction(menu);
    const Observer = studio.element.contentWindow.MutationObserver;
    const observer = new Observer((mutations) => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches('.context-menu')) addMenuAction(node);
        else for (const menu of node.querySelectorAll('.context-menu')) addMenuAction(menu);
      }
    });
    observer.observe(innerDocument.body, { childList: true, subtree: true });
    detachDocument = () => {
      innerDocument.removeEventListener('compositionstart', start, true);
      innerDocument.removeEventListener('compositionend', end, true);
      innerDocument.removeEventListener('input', input, true);
      for (const eventName of ['selectionchange', 'mouseup', 'keyup', 'contextmenu']) innerDocument.removeEventListener(eventName, selectionChanged, true);
      innerDocument.removeEventListener('scroll', surfaceMoved, true);
      studio.element.contentWindow.removeEventListener('resize', surfaceMoved);
      observer.disconnect();
    };
    installNativeSurface(studio);
  };
  attach();
  studio.element.addEventListener('load', attach);
  removers.push(() => { detachDocument(); studio.element.removeEventListener('load', attach); });
}

async function saveCopy() {
  if (!state.studio || state.saving || state.busy || state.stopped) return;
  state.saving = true; state.notice = ''; renderStatus();
  try {
    await serial(async () => {
      if (state.composing) throw bridgeError('IME_COMPOSING', '한글 입력이 끝난 뒤 저장해 주세요.');
      setEditingBusy(true, '수정본을 저장하고 있습니다.');
      try {
      const snapshot = await executeOperation(state.studio, { operation: { type: 'snapshot', format: 'hwpx' } }, { isComposing: () => state.composing });
      const saved = await api('/api/user-save', snapshot);
      if (typeof saved.path !== 'string' || !saved.path) throw bridgeError('SAVE_FAILED', '저장한 파일 경로를 확인하지 못했습니다.');
      const current = await state.studio.getDocumentState();
      let clean = false;
      if (statesMatch(current, snapshot.state)) {
        try { await state.studio.notifySaved(saved.path.split(/[\\/]/).pop()); clean = true; }
        catch { /* Old Studio builds may lack notify-saved-v1; the file is still saved. */ }
      }
      state.notice = `${clean ? '수정본 저장 완료' : '수정본 저장 완료 · 현재 문서에는 저장 전 변경이 남아 있습니다'}: ${saved.path}`;
      await syncChange('user_saved', true);
      } finally { setEditingBusy(false); }
    });
  } catch (error) { state.notice = safeError(error); }
  finally { state.saving = false; renderStatus(); }
}

async function start() {
  if (!token) { state.stopped = true; state.notice = '공유 세션 인증 정보가 없습니다. Codex에서 편집기를 열어 주세요.'; renderStatus(); return; }
  const bootstrap = await api('/api/bootstrap');
  if (typeof bootstrap.sessionId !== 'string' || !bootstrap.sessionId) throw bridgeError('INVALID_SESSION', '공유 문서 세션을 확인하지 못했습니다.');
  state.sessionId = bootstrap.sessionId;
  $('document-name').textContent = bootstrap.document?.name || '새 한글 문서';
  document.title = `${bootstrap.document?.name || '한글 문서'} · pwh 함께 편집`;
  const studio = await createStudio('#editor', { studioUrl: `${location.origin}/studio/`, plugins: ['hwpctrl'], renderer: 'canvas2d', requestTimeoutMs: 60000 });
  state.studio = studio;
  state.fonts = await installDocumentFonts(studio);
  trackComposition(studio);
  if (state.stopped) return;
  if (bootstrap.document) await studio.loadFile(decodeBase64(bootstrap.document.base64), bootstrap.document.name, { suppressDialogs: true });
  installNativeSurface(studio);
  state.disposeChanged = studio.onDocumentChanged((event) => { invalidateAnnotation(); scheduleChange(event.reason || 'document_changed'); });
  await syncChange('session_ready', true);
  $('save-copy').addEventListener('click', () => void saveCopy());
  $('request-ai').addEventListener('mousedown', (event) => event.preventDefault());
  $('request-ai').addEventListener('click', requestAiEdit);
  $('request-comment').addEventListener('input', () => { invalidateAnnotation(); scheduleAnnotation(); });
  state.stateTimer = setInterval(() => {
    if (state.stopped || state.statePollPending) return;
    state.statePollPending = true;
    void serial(() => syncChange('state_poll')).catch(connectionFailure).finally(() => { state.statePollPending = false; });
  }, 900);
  renderStatus();
  void pollLoop();
}

window.addEventListener('beforeunload', (event) => {
  if (state.documentState?.dirty || state.composing) { event.preventDefault(); event.returnValue = ''; }
});

// beforeunload can be cancelled by the user; clean up only when the page actually leaves.
window.addEventListener('pagehide', () => {
  state.stopped = true; clearTimeout(state.syncTimer); clearTimeout(state.annotationTimer); clearInterval(state.stateTimer);
  state.nativeSurface?.dispose();
  state.fonts?.dispose();
  state.disposeChanged?.(); removers.forEach((remove) => remove());
});

renderRequestControls();
void start().catch((error) => { state.stopped = true; state.notice = safeError(error); renderStatus(); });
