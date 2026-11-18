import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareDocumentOpen} from '../src/document-open.mjs';
import {callTool, handleRequest} from '../src/server.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-open-existing-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return root;
}

test('existing-file handoff preserves bytes and requires actual host load',async t=>{
  const root=await fixture(t),input=path.join(root,'첨부 문서.hwpx');
  const bytes=Buffer.from([0x50,0x4b,0x03,0x04,0x61,0x62]);
  await fs.writeFile(input,bytes);const before=await fs.stat(input);
  const result=(await callTool('pwh_open_document',{input})).structuredContent;
  assert.equal(result.intent,'open-existing');assert.equal(result.path,await fs.realpath(input));
  assert.equal(result.validation,'regular-file-and-zip-signature');assert.equal(result.documentLoaded,false);
  assert.deepEqual(result.nextAction.arguments,{target:{type:'file',path:await fs.realpath(input)},placement:'right'});
  assert.equal(result.nextAction.awaitingHostOpen,true);assert.equal(result.bytes,bytes.length);
  assert.deepEqual(await fs.readFile(input),bytes);assert.equal((await fs.stat(input)).mtimeMs,before.mtimeMs);
  assert.deepEqual(await fs.readdir(root),['첨부 문서.hwpx']);
  const tools=(await handleRequest({jsonrpc:'2.0',id:1,method:'tools/list'})).result.tools;
  assert.equal(tools.find(x=>x.name==='pwh_open_document').annotations.readOnlyHint,true);
});

test('missing input never creates a replacement or an output directory',async t=>{
  const root=await fixture(t),input=path.join(root,'missing','attachment.hwpx');
  await assert.rejects(prepareDocumentOpen(input),{code:'ENOENT'});
  assert.deepEqual(await fs.readdir(root),[]);
});

test('relative paths are not guessed from the plugin working directory',async()=>{
  await assert.rejects(prepareDocumentOpen('attachment.hwpx'),/절대 경로/);
});

test('invalid signatures and empty files are rejected without changing the original',async t=>{
  const root=await fixture(t);
  for(const bytes of [Buffer.alloc(0),Buffer.from('not an HWPX archive')]){
    const input=path.join(root,'invalid.hwpx');await fs.writeFile(input,bytes);
    await assert.rejects(prepareDocumentOpen(input),/시작 서명/);assert.deepEqual(await fs.readFile(input),bytes);
  }
});

test('HWP and other extensions are not silently replaced by a blank HWPX',async t=>{
  const root=await fixture(t),input=path.join(root,'original.hwp'),bytes=Buffer.from([0x50,0x4b,0x03,0x04]);
  await fs.writeFile(input,bytes);await assert.rejects(prepareDocumentOpen(input),/HWPX/);
  assert.deepEqual(await fs.readdir(root),['original.hwp']);assert.deepEqual(await fs.readFile(input),bytes);
});

test('directories cannot be mistaken for a document file',async t=>{
  const root=await fixture(t),input=path.join(root,'folder.hwpx');await fs.mkdir(input);
  await assert.rejects(prepareDocumentOpen(input));assert.deepEqual(await fs.readdir(root),['folder.hwpx']);
});
