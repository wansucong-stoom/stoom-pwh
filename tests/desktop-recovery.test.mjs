import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PassThrough,Readable} from 'node:stream';
import {createDesktopRecovery} from '../desktop/standalone-pwh/desktop-recovery.mjs';

test('large drafts use the original Word identity and survive a rejected checkpoint',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-recovery-disk-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const first=createDesktopRecovery(root);
  const original={docxSource:path.join(root,'document.docx'),docxSha256:'1'.repeat(64)};
  const doc={...original,source:path.join(root,'first','document.hwpx'),sourceSha256:'2'.repeat(64)};
  const reopened={...original,source:path.join(root,'second','document.hwpx'),sourceSha256:'3'.repeat(64)};
  const bytes=Buffer.alloc(9*1024*1024,0x4a);
  bytes.write('PK');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const chunks=()=>Readable.from([bytes.subarray(0,1),bytes.subarray(1,4*1024*1024),bytes.subarray(4*1024*1024)]);
  await first.write(doc,chunks(),sha256,bytes.length,()=>true);
  await assert.rejects(first.write(doc,chunks(),'0'.repeat(64),bytes.length,()=>true),/검증/);

  const second=createDesktopRecovery(root),draft=await second.info(reopened);
  assert.equal(draft.size,bytes.length);
  assert.equal(draft.sha256,sha256);
  assert.equal(await second.info({...reopened,docxSha256:'4'.repeat(64)}),null);
  const stream=new PassThrough(),seen=createHash('sha256');
  stream.writeHead=(status,headers)=>assert.equal(headers['Content-Length'],bytes.length);
  stream.on('data',data=>seen.update(data));
  await second.read(reopened,stream,draft);
  assert.equal(seen.digest('hex'),sha256);

  assert.equal(await second.acknowledge(reopened,draft,true),true);
  assert.equal(await second.info(reopened),null);
  assert.deepEqual(await second.info(reopened,{includeDismissed:true}),draft);
  assert.equal(await second.acknowledge(reopened,draft,false),true);
  assert.deepEqual(await second.info(reopened),draft);
  await second.removeOwn(reopened);
  assert.deepEqual(await second.info(reopened),draft);
  await first.removeOwn(doc);
  assert.equal(await second.info(reopened),null);
});
