import {createHwpHandler, loadStoomRuntime} from '../bridge/hwp-codex-host.mjs';
import {randomUUID} from 'node:crypto';

const MAX_TEXT = 160000;
const hostNames = new Set(['localhost', '127.0.0.1', '[::1]']);

// Restrict the connection to this computer. A local server can itself proxy
// remote models, so this restriction alone does not guarantee local inference.
export function localApiBase(value = 'http://127.0.0.1:11434/v1') {
  let url;
  try { url = new URL(value); } catch { throw Error('로컬 AI 서버 주소가 올바르지 않습니다.'); }
  if (url.protocol !== 'http:' || !hostNames.has(url.hostname) || url.username || url.password || url.search || url.hash)
    throw Error('로컬 AI에는 이 PC의 localhost 주소만 사용할 수 있습니다.');
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/v1')) throw Error('서버 주소는 /v1으로 끝나야 합니다.');
  return url.toString().replace(/\/$/, '');
}

export function createLocalProvider({baseUrl, model, fetchImpl = fetch, timeoutMs = 120000} = {}) {
  const base = localApiBase(baseUrl);
  async function request(path, options = {}) {
    let response;
    try { response = await fetchImpl(base + path, {...options, redirect:'error', signal:AbortSignal.timeout(timeoutMs)}); }
    catch { throw Error('로컬 AI 서버에 연결하지 못했습니다. 서버가 실행 중인지 확인하세요.'); }
    if (!response.ok) throw Error(`로컬 AI 서버가 오류를 반환했습니다 (${response.status}).`);
    const raw = await response.text();
    if (raw.length > 2 * 1024 * 1024) throw Error('로컬 AI 응답이 너무 큽니다.');
    try { return JSON.parse(raw); } catch { throw Error('로컬 AI 응답 형식이 올바르지 않습니다.'); }
  }
  return {
    async status() {
      const result = await request('/models');
      if (!Array.isArray(result.data)) throw Error('로컬 AI 모델 목록을 읽지 못했습니다.');
      return {ready:true, models:result.data.filter(x => typeof x?.id === 'string' && x.id.length <= 256).map(x => ({id:x.id, name:x.id}))};
    },
    async generate({prompt}) {
      if (typeof model !== 'string' || !model.trim() || model.length > 256) throw Error('로컬 AI 모델을 선택하세요.');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_TEXT) throw Error('요청 내용이 비었거나 너무 깁니다.');
      const result = await request('/chat/completions', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model, messages:[{role:'user',content:prompt}], stream:false})});
      const text = result.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw Error('로컬 AI의 응답을 사용할 수 없습니다.');
      return {text};
    }
  };
}

export async function createCodexProvider({stoomModule, runtime: suppliedRuntime} = {}) {
  const runtime = suppliedRuntime || (await loadStoomRuntime(stoomModule)).runtime;
  const handle = createHwpHandler({runtime});
  let accountId = '';
  return {
    async status() { const result = await handle({id:'status',action:'status'}); accountId = result.ready ? result.accountId : ''; return {...result, accountId:undefined}; },
    async generate({prompt, model, reasoningEffort}) {
      if (!accountId) throw Error('설치된 Codex의 로그인 상태를 먼저 확인하세요.');
      return handle({id:randomUUID(),action:'generate',usageConsent:true,accountId,prompt,...(model?{model}:{}),...(reasoningEffort?{reasoningEffort}:{})});
    }
  };
}
