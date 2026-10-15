import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import config from './config.mjs';

const script = fileURLToPath(new URL('../scripts/replace_image.py', import.meta.url));

/** Replace one embedded image payload without serializing document XML. */
export async function replaceDocumentImage(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('그림 교체 명세가 필요합니다.');
  for (const key of ['input', 'output', 'image']) {
    if (typeof request[key] !== 'string' || !path.isAbsolute(request[key])) throw new Error(`${key}: 로컬 파일의 절대 경로가 필요합니다.`);
  }
  if (!/\.hwpx$/i.test(request.input) || !/\.hwpx$/i.test(request.output)) throw new Error('input/output은 HWPX 파일이어야 합니다.');
  if (typeof request.expectedSourceSha256 !== 'string' || !/^[a-f\d]{64}$/i.test(request.expectedSourceSha256)) throw new Error('원본 expectedSourceSha256이 필요합니다.');
  const selectors = ['binaryItemId', 'manifestHref'].filter(key => request[key] !== undefined);
  if (selectors.length !== 1 || typeof request[selectors[0]] !== 'string' || !request[selectors[0]].trim()) {
    throw new Error('binaryItemId 또는 manifestHref 중 하나를 정확히 지정하세요.');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonPath, ['-B', script, '--stdin'], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: {...process.env, PYTHONUTF8: '1'},
    });
    let stdout = '', stderr = '', done = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('그림 교체가 90초를 넘었습니다.')); }, 90000);
    function finish(error, value) {
      if (done) return;
      done = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    }
    child.on('error', error => finish(new Error(`그림 교체기 실행 실패: ${error.message}`)));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') finish(error); });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) { child.kill(); finish(new Error('그림 교체 응답 크기를 초과했습니다.')); }
    });
    child.stderr.on('data', chunk => { if (stderr.length < 65536) stderr += chunk.slice(0, 65536 - stderr.length); });
    child.on('close', code => {
      if (done) return;
      let parsed;
      try { parsed = JSON.parse(stdout.replace(/^\uFEFF/, '')); }
      catch { return finish(new Error(`그림 교체 결과를 읽지 못했습니다: ${stderr.slice(0, 2000)}`)); }
      if (code !== 0 || parsed?.ok !== true) return finish(new Error(parsed?.error || stderr.slice(0, 2000) || `종료 코드 ${code}`));
      finish(null, {...parsed, path: parsed.output});
    });
    child.stdin.end(JSON.stringify(request));
  });
}
