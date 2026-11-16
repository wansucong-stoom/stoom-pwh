import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('custom fill lists persist, serialize updates and preserve data after rejected writes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-fill-preferences-'));
 const previous=process.env.PWH_AUTOFILL_PREFERENCES_DIR;
 process.env.PWH_AUTOFILL_PREFERENCES_DIR=dir;
 const {autoFillPreferences:preferences}=await import('../src/auto-fill-preferences.mjs');
 const file=path.join(dir,'auto-fill-lists.json');
 try{
  assert.deepEqual(await preferences(),{lists:[]});
  await Promise.all(Array.from({length:4},(_,i)=>preferences({upsert:{id:'list-'+i,label:'목록 '+i,values:['기획','검토','완료']}})));
  assert.equal((await preferences()).lists.length,4);
  await preferences({upsert:{id:'list-1',label:'수정',values:['A','B']}});
  assert.equal((await preferences()).lists.length,4);
  const reloaded=await import('../src/auto-fill-preferences.mjs?reload');
  assert.deepEqual((await reloaded.autoFillPreferences()).lists.find(v=>v.id==='list-1').values,['A','B']);
  const before=await fs.readFile(file,'utf8');
  await assert.rejects(preferences({upsert:{id:'invalid',label:'',values:['A']}}));
  assert.equal(await fs.readFile(file,'utf8'),before);
  // A single valid list is under the cap; adding a fourth large Korean list
  // exceeds the byte budget and must leave all previous lists readable.
  for(let i=0;i<3;i++)await preferences({upsert:{id:'large-'+i,label:'긴 목록',values:Array(500).fill('가'.repeat(200))}});
  const saved=await fs.readFile(file,'utf8');
  await assert.rejects(preferences({upsert:{id:'large-3',label:'긴 목록',values:Array(500).fill('가'.repeat(200))}}),/용량/);
  assert.equal(await fs.readFile(file,'utf8'),saved);
  await preferences({remove:'list-1'});
  assert.equal((await preferences()).lists.some(v=>v.id==='list-1'),false);
  assert.deepEqual((await fs.readdir(dir)).sort(),['auto-fill-lists.json']);
 }finally{
  if(previous===undefined)delete process.env.PWH_AUTOFILL_PREFERENCES_DIR;else process.env.PWH_AUTOFILL_PREFERENCES_DIR=previous;
  await fs.unlink(file).catch(()=>{});await fs.rmdir(dir);
 }
});
