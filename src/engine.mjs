import { spawn } from 'node:child_process';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import config from './config.mjs';

const executable = config.rhwpPath;
const outputRoot = config.outputRoot;
const fontArgs = config.fontPaths.filter(Boolean).flatMap(p => ['--font-path', p]);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 6);

export function runEngine(args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args.map(String), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('조판 엔진 실행 시간이 초과되었습니다.')); }, timeoutMs);
    function finish(error, value) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); }
    child.on('error', e => finish(new Error(`rhwp 실행 실패: ${e.message}`)));
    for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]]) {
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        if (isError) stderr += chunk; else stdout += chunk;
        if (stdout.length + stderr.length > 32 * 1024 * 1024) { child.kill(); finish(new Error('엔진 응답 크기 제한을 초과했습니다.')); }
      });
    }
    child.on('close', code => {
      if (code !== 0) return finish(new Error(`rhwp 종료 코드 ${code}: ${(stderr || stdout).slice(0, 5000)}`));
      let data;
      try { data = JSON.parse(stdout.replace(/^\uFEFF/, '')); } catch { /* Some render commands return progress text. */ }
      finish(null, { data, stdout, stderr });
    });
  });
}

async function inputFile(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('문서의 절대 경로가 필요합니다.');
  const real = await fs.realpath(input);
  if (!/\.(hwpx|hwp)$/i.test(real)) throw new Error('HWP 또는 HWPX 파일을 지정하세요.');
  if (!(await fs.stat(real)).isFile()) throw new Error('일반 문서 파일이 아닙니다.');
  return real;
}

async function freshOutput(output, extension = '.hwpx') {
  const target = output || path.join(outputRoot, stamp(), `document${extension}`);
  if (!path.isAbsolute(target) || !/\.(hwpx|hwp)$/i.test(target)) throw new Error('출력은 .hwp/.hwpx 절대 경로여야 합니다.');
  try { await fs.lstat(target); throw new Error('출력 파일이 이미 있습니다. 새 파일명을 사용하세요.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.mkdir(path.dirname(target), { recursive: true });
  return target;
}

async function sha256(file) { return createHash('sha256').update(await fs.readFile(file)).digest('hex'); }
async function workspace() { return fs.mkdtemp(path.join(await fs.mkdir(outputRoot, {recursive:true}).then(() => outputRoot), '.work-')); }

export async function engineInfo() {
  const version = (await runEngine(['--version'])).stdout.trim();
  return { engine: 'rhwp', version, executable, hopPath: config.hopPath, outputRoot,
    capabilities: ['create-hwpx', 'create-hwp', 'edit-template', 'read-fields-tables', 'png-preview', 'pdf-export', 'page-layout'],
    integration: 'HOP uses rhwp; this integration invokes the official rhwp CLI, not the HOP GUI.' };
}

export async function inspectDocument(input) {
  const source = await inputFile(input);
  const commands = [['info', source, '--json'], ['export-text', source, '--json'], ['fields', source, '--json'], ['export-tables', source, '--json']];
  const [info, text, fields, tables] = await Promise.all(commands.map(args => runEngine(args)));
  return { source, sha256: await sha256(source), info: info.data, text: text.data ?? text.stdout,
    fields: fields.data ?? fields.stdout, tables: tables.data ?? tables.stdout };
}

export async function createDocument(spec, output) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('문서 명세 객체가 필요합니다.');
  const target = await freshOutput(output);
  const work = await workspace();
  try {
    const specPath = path.join(work, 'spec.json'), created = path.join(work, 'created.hwpx');
    await fs.writeFile(specPath, JSON.stringify(spec));
    const result = await runEngine(['scaffold', specPath, '-o', created, '--json']);
    let ready = created;
    if (path.extname(target).toLowerCase() === '.hwp') {
      ready = path.join(work, 'created.hwp');
      await runEngine(['convert', created, ready, '--json']);
    }
    await runEngine(['info', ready, '--json']);
    await fs.copyFile(ready, target, constants.COPYFILE_EXCL);
    return { path: target, info: (await runEngine(['info', target, '--json'])).data, result: result.data };
  } finally { await fs.rm(work, { recursive: true, force: true }); }
}

export async function editTemplate(input, output, changes) {
  const source = await inputFile(input), originalHash = await sha256(source);
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 100) throw new Error('1~100개의 편집 작업이 필요합니다.');
  const target = await freshOutput(output, path.extname(source));
  if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) throw new Error('원본과 다른 출력 경로를 사용하세요.');
  const work = await workspace(), operations = [];
  try {
    let current = source;
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i], next = path.join(work, `step-${i}${path.extname(source)}`);
      let args;
      if (change.type === 'replaceText') {
        if (typeof change.find !== 'string' || !change.find || typeof change.replace !== 'string') throw new Error('치환할 find/replace 문자열이 필요합니다.');
        args = ['edit', 'replace-text', current, '--find', change.find, '--replace', change.replace];
      } else if (change.type === 'fillFields') {
        if (!change.data || typeof change.data !== 'object' || Array.isArray(change.data)) throw new Error('누름틀 데이터 객체가 필요합니다.');
        const dataPath = path.join(work, `fields-${i}.json`);
        await fs.writeFile(dataPath, JSON.stringify(change.data));
        args = ['edit', 'fill-fields', current, '--data', `@${dataPath}`];
      } else if (change.type === 'setCell') {
        if (![change.table, change.row, change.col].every(n => Number.isInteger(n) && n >= 0) || typeof change.text !== 'string') throw new Error('표·행·열은 0부터 시작하는 정수, text는 문자열이어야 합니다.');
        args = ['edit', 'set-cell', current, '--table', change.table, '--row', change.row, '--col', change.col, '--text', change.text, '--keep-style'];
      } else throw new Error(`지원하지 않는 편집 종류: ${change.type}`);
      const result = await runEngine([...args, '-o', next, '--json']);
      operations.push({ type: change.type, result: result.data });
      // rhwp deliberately writes no document when a text replacement matches nothing.
      try { await fs.access(next); current = next; }
      catch (e) { if (e.code !== 'ENOENT') throw e; throw new Error('편집 결과 파일이 없습니다. 찾을 문구·누름틀 이름을 확인하세요.'); }
      if (result.data?.notFound?.length) throw new Error(`없는 누름틀: ${JSON.stringify(result.data.notFound)}`);
      if (result.data?.ambiguous?.length) throw new Error(`중복 누름틀은 이름[N]으로 지정하세요: ${JSON.stringify(result.data.ambiguous)}`);
    }
    if (path.extname(target).toLowerCase() !== path.extname(source).toLowerCase()) {
      const converted = path.join(work, `converted${path.extname(target)}`);
      await runEngine([path.extname(target).toLowerCase() === '.hwp' ? 'convert' : 'export-hwpx', current, converted, '--json']);
      current = converted;
    }
    await runEngine(['info', current, '--json']);
    if (await sha256(source) !== originalHash) throw new Error('작업 중 원본이 변경되었습니다. 최신 원본을 다시 읽어야 합니다.');
    await fs.copyFile(current, target, constants.COPYFILE_EXCL);
    const result = { path: target, source, sourceSha256: originalHash, sha256: await sha256(target), operations,
      info: (await runEngine(['info', target, '--json'])).data };
    await fs.writeFile(`${target}.changes.json`, JSON.stringify(result, null, 2), {flag:'wx'});
    return result;
  } finally { await fs.rm(work, {recursive:true, force:true}); }
}

export async function previewDocument(input, {outputDir, pages, maxDimension = 1600} = {}) {
  const source = await inputFile(input), sourceSha256 = await sha256(source);
  const info = (await runEngine(['info', source, '--json'])).data;
  const pageCount = Number(info.pageCount ?? info.pages ?? 1);
  const selected = pages ?? Array.from({length: Math.min(pageCount, 8)}, (_, i) => i + 1);
  if (!Array.isArray(selected) || !selected.length || selected.length > 24 || !selected.every(n => Number.isInteger(n) && n >= 1 && n <= pageCount)) throw new Error(`쪽 번호는 1~${pageCount}, 한 번에 최대 24쪽입니다.`);
  if (!Number.isInteger(maxDimension) || maxDimension < 400 || maxDimension > 2400) throw new Error('이미지 최대 크기는 400~2400입니다.');
  const output = outputDir || path.join(outputRoot, `preview-${stamp()}`);
  if (!path.isAbsolute(output)) throw new Error('미리보기 출력 폴더의 절대 경로가 필요합니다.');
  // Always isolate one render to avoid reusing stale page images.
  const directory = path.join(output, stamp());
  await fs.mkdir(directory, {recursive:true});
  const rendered = [], trees = [];
  for (const pageNumber of [...new Set(selected)]) {
    const pageDir = path.join(directory, `page-${pageNumber}`);
    await fs.mkdir(pageDir);
    await runEngine(['export-png', source, '-o', pageDir, '-p', pageNumber - 1, '--profile', 'screen', '--max-dimension', maxDimension, ...fontArgs]);
    const files = (await fs.readdir(pageDir)).filter(name => name.endsWith('.png'));
    if (files.length !== 1) throw new Error('조판 결과 PNG를 찾을 수 없습니다.');
    const imagePath = path.join(pageDir, files[0]), bytes = await fs.readFile(imagePath);
    rendered.push({pageNumber, path:imagePath, dataUrl:`data:image/png;base64,${bytes.toString('base64')}`});
    await runEngine(['export-render-tree', source, '-o', pageDir, '-p', pageNumber - 1]);
    const treeName = (await fs.readdir(pageDir)).find(name => /^render_tree_.*\.json$/.test(name));
    if (!treeName) throw new Error('페이지 레이아웃 JSON을 찾을 수 없습니다.');
    const treePath = path.join(pageDir, treeName);
    JSON.parse(await fs.readFile(treePath, 'utf8'));
    const pagination = (await runEngine(['dump-pages', source, '-p', pageNumber - 1, '--json'])).data;
    trees.push({pageNumber, treePath, pagination});
  }
  if (await sha256(source) !== sourceSha256) throw new Error('미리보기 생성 중 문서가 변경되었습니다. 다시 렌더링하세요.');
  const layoutPath = path.join(directory, 'layout.json');
  await fs.writeFile(layoutPath, JSON.stringify({source,sourceSha256,pages:trees},null,2));
  const result = {source, sourceSha256, title:path.basename(source), pageCount, pages:rendered, layoutPath,
    omittedPages: pageCount - rendered.length, htmlPath:path.join(directory, 'index.html')};
  await fs.writeFile(result.htmlPath, standaloneHtml(result));
  await fs.writeFile(path.join(directory, 'preview.json'), JSON.stringify({...result, pages:rendered.map(({dataUrl,...page})=>page)}, null, 2));
  return result;
}

export async function exportPdf(input, output) {
  const source = await inputFile(input);
  if (!path.isAbsolute(output) || !output.toLowerCase().endsWith('.pdf')) throw new Error('PDF 절대 출력 경로가 필요합니다.');
  try { await fs.access(output); throw new Error('PDF 출력 파일이 이미 있습니다.'); } catch(e) {if(e.code !== 'ENOENT') throw e;}
  await fs.mkdir(path.dirname(output), {recursive:true});
  const work = await workspace();
  try {
    const temporary = path.join(work, 'export.pdf');
    const result = (await runEngine(['export-pdf', source, '-o', temporary, '--json', ...fontArgs])).data;
    await fs.copyFile(temporary, output, constants.COPYFILE_EXCL);
    return {...result, output};
  } finally { await fs.rm(work, {recursive:true, force:true}); }
}

export function standaloneHtml(document) {
  const data = JSON.stringify(document).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>pwh 미리보기</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e8ebef;color:#17212b;font:14px system-ui,sans-serif}header{position:sticky;top:0;z-index:1;padding:12px 20px;background:#fff;display:flex;gap:12px;align-items:center;border-bottom:1px solid #d7dde3}h1{font-size:15px;line-height:1.5;margin:0;flex:1;min-width:0;overflow-wrap:anywhere}select{font:inherit;padding:6px 10px;border:1px solid #c2cad2;border-radius:5px;background:#fff;color:inherit}main{padding:24px;overflow:auto}#paper{margin:0 auto;width:100%;max-width:1280px;box-shadow:0 3px 24px #15233322;background:white;line-height:0}img{width:100%;height:auto;display:block}@media(max-width:640px){header{padding:10px 12px;gap:8px;flex-wrap:wrap}h1{flex-basis:100%;font-size:14px}main{padding:12px}}</style>
<header><h1 id="title"></h1><select id="page" aria-label="쪽 선택"></select><select id="zoom" aria-label="확대"><option value="fit">너비 맞춤</option><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option></select></header>
<main><div id="paper"><img id="image" alt="조판된 문서 페이지" draggable="false"></div></main>
<script>const doc=${data};const $=s=>document.getElementById(s);const page=$('page'),paper=$('paper'),image=$('image');$('title').textContent=doc.title;for(const p of doc.pages){const o=document.createElement('option');o.value=p.pageNumber;o.textContent=p.pageNumber+' / '+doc.pageCount+'쪽';page.append(o)}function zoom(){if($('zoom').value==='fit'){paper.style.width='100%';paper.style.maxWidth='1280px'}else{paper.style.width=Math.round((image.naturalWidth||1280)*Number($('zoom').value)/100)+'px';paper.style.maxWidth='none'}}function show(){const selected=doc.pages.find(p=>p.pageNumber===Number(page.value));if(!selected)return;image.src=selected.dataUrl;image.alt=doc.title+' '+selected.pageNumber+'쪽';zoom()}page.onchange=show;$('zoom').onchange=zoom;image.onload=zoom;show();</script></html>`;
}
