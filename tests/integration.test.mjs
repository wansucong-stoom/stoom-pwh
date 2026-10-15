import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { engineInfo, createDocument, editTemplate, inspectDocument, previewDocument, exportPdf } from '../src/engine.mjs';
import { handleRequest } from '../src/server.mjs';

test('실제 rhwp로 생성 → 서식 편집 → 조판 → PDF, 원본 보존',
  {skip: process.env.PWH_ENGINE_TESTS !== '1' && 'Set PWH_ENGINE_TESTS=1 after installing the optional rhwp runtime.', timeout:120000}, async t => {
  const config = await engineInfo();
  assert.match(config.version, /0\.8\.7/);
  await fs.mkdir(config.outputRoot, {recursive: true});
  const run = await fs.mkdtemp(path.join(config.outputRoot,'test-'));
  t.after(() => fs.rm(run, {recursive: true, force: true}));
  const spec = JSON.parse(await fs.readFile(new URL('../examples/demo.json',import.meta.url),'utf8'));
  const created = await createDocument(spec,path.join(run,'서식.hwpx'));
  const original = await fs.readFile(created.path);
  const changes = JSON.parse(await fs.readFile(new URL('../examples/changes.json',import.meta.url),'utf8'));
  const edited = await editTemplate(created.path,path.join(run,'수정본.hwpx'),changes);
  assert.deepEqual(await fs.readFile(created.path),original);
  const info = await inspectDocument(edited.path);
  assert.match(JSON.stringify(info.text),/함께 다듬은 한글 문서/);
  assert.match(JSON.stringify(info.tables),/서식을 유지하고 수정본 저장/);
  const preview = await previewDocument(edited.path,{maxDimension:1000});
  assert.equal(preview.pages[0].pageNumber,1);
  const image = await fs.readFile(preview.pages[0].path);
  assert.equal(image.subarray(1,4).toString(),'PNG');
  assert.ok(image.length > 5000,'조판 이미지에 실제 문서 내용이 있어야 함');
  const layout = JSON.parse(await fs.readFile(preview.layoutPath,'utf8'));
  assert.equal(layout.sourceSha256,createHash('sha256').update(await fs.readFile(edited.path)).digest('hex'));
  assert.ok(JSON.parse(await fs.readFile(layout.pages[0].treePath,'utf8')));
  const pdfPath=path.join(run,'수정본.pdf');
  await exportPdf(edited.path,pdfPath);
  assert.equal((await fs.readFile(pdfPath)).subarray(0,5).toString(),'%PDF-');
  await assert.rejects(editTemplate(created.path,path.join(run,'불가.hwpx'),[{type:'replaceText',find:'존재하지않는문구-8f11d7',replace:'x'}]));
  await assert.rejects(fs.access(path.join(run,'불가.hwpx')));
  await assert.rejects(createDocument(spec,created.path),/이미 있습니다/);
  await assert.rejects(previewDocument(created.path,{pages:[999]}),/쪽 번호/);
  const native = await createDocument(spec,path.join(run,'새문서.hwp'));
  assert.equal(native.info.format,'hwp5');
  assert.deepEqual(await fs.readFile(created.path),original);
});

test('MCP discovery와 엔진 오류의 실제 전달', async () => {
  const init=await handleRequest({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}});
  assert.equal(init.result.serverInfo.name,'pwh');
  const list=await handleRequest({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.ok(list.result.tools.some(t=>t.name==='pwh_preview' && t._meta.ui.resourceUri));
  const failure=await handleRequest({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'pwh_info',arguments:{input:path.join(os.tmpdir(),'pwh-nonexistent-93d415ac.hwpx')}}});
  assert.equal(failure.result.isError,true);
});
