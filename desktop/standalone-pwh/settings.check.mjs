import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultSettings,readSettings,validateSettings,writeSettings} from './settings.mjs';
import {rewriteSelection} from './rewrite.mjs';

test('settings round trip, reject remote endpoint, and do not persist extra fields',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-settings-test-'));
 try{
  const file=path.join(dir,'settings.json');
  assert.deepEqual(await readSettings(file),{...defaultSettings});
  await writeSettings(file,{provider:'local',localBaseUrl:'http://localhost:11434/v1/',localModel:'model',unknown:'ignored'});
  const saved=await readSettings(file);assert.equal(saved.localBaseUrl,'http://localhost:11434/v1');assert.equal(saved.localModel,'model');assert.equal('unknown' in saved,false);
  assert.throws(()=>validateSettings({...saved,localBaseUrl:'http://example.com/v1'}));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('selection rewrite uses the selected provider and waits for the editor receipt',async()=>{
 const context={selection:{},selectedText:{known:true,truncated:false,text:'원문'}};let submitted;
 const result=await rewriteSelection({request:{sessionId:'s',context,note:'다듬기'},generate:async({prompt})=>{assert.match(prompt,/원문/);return {text:'수정문'};},queue:async value=>{submitted=value;return {ticketId:'t'};},readResult:async()=>({status:'applied'}),wait:async()=>{}});
 assert.equal(result.status,'applied');assert.equal(submitted.replacement,'수정문');assert.equal(submitted.expected,context);
});
