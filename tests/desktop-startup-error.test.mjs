import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createWorkspaceServer,documentTabStartupMessage} from '../desktop/standalone-pwh/workspace-shell.mjs';

test('missing packaged modules are named without exposing a truncated internal stack',()=>{
 const message=documentTabStartupMessage("node:internal/modules/esm/resolve:272\nError [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\Program Files\\WindowsApps\\Pwh\\standalone-pwh\\linux-credentials.mjs' imported from other.mjs\n at loader");
 assert.match(message,/linux-credentials\.mjs/);assert.match(message,/업데이트/);
 assert.doesNotMatch(message,/Program Files|node:internal|at loader/);
});
test('unknown startup failures refer to the diagnostic record',()=>{
 const message=documentTabStartupMessage('private internal details');assert.match(message,/진단 기록/);assert.doesNotMatch(message,/private internal details/);
});

test('a DOCX startup failure uses the current profile and records a safe error code',async t=>{
 const temp=await fs.realpath(os.tmpdir()),dataRoot=await fs.mkdtemp(path.join(temp,'pwh-startup-test-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(dataRoot)),temp);await fs.rm(dataRoot,{recursive:true,force:true});});
 const spawnImpl=(_exe,_args,options)=>{
  assert.equal(options.env.PWH_STANDALONE_DATA,dataRoot);
  const stream=()=>new PassThrough();
  const child=Object.assign(new EventEmitter(),{stdin:stream(),stdout:stream(),stderr:stream()});
  setImmediate(()=>{
   child.stderr.write('private raw filename and token');
   child.stdout.write('{"errorCode":"INVALID_DOCX"}\n');
   child.emit('close',1);
  });
  return child;
 };
 await assert.rejects(createWorkspaceServer({dataRoot,spawnImpl,initialPath:path.join(dataRoot,'private.docx')}),/Word DOCX/);
 const record=JSON.parse(await fs.readFile(path.join(dataRoot,'logs/document-startup.log'),'utf8'));
 assert.deepEqual(Object.keys(record).sort(),['code','time']);
 assert.equal(record.code,'INVALID_DOCX');
});
