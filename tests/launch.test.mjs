import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {once} from 'node:events';import {createInterface} from 'node:readline';
import {materializeRelease} from '../scripts/launch.mjs';
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-release-')),source=path.join(dir,'cache');await fs.mkdir(path.join(source,'src'),{recursive:true});await fs.mkdir(path.join(source,'scripts'));await fs.writeFile(path.join(source,'package.json'),JSON.stringify({version:'1.0.0',type:'module'}));await fs.writeFile(path.join(source,'src','lazy.mjs'),"export const result='still working';");await fs.copyFile(new URL('../scripts/launch.mjs',import.meta.url),path.join(source,'scripts','launch.mjs'));return {dir,source,releaseRoot:path.join(dir,'releases')};}
test('running server keeps lazy imports after its original plugin cache is deleted',async()=>{
 const f=await fixture();let child;
 try{
  await fs.writeFile(path.join(f.source,'src','server.mjs'),"export function runStdio(){console.log('READY');process.stdin.once('data',async()=>{console.log((await import('./lazy.mjs')).result);process.stdin.pause();});}");
  child=spawn(process.execPath,[path.join(f.source,'scripts','launch.mjs'),'pwh'],{cwd:f.source,env:{...process.env,PWH_SERVER_RELEASE_ROOT:f.releaseRoot},stdio:['pipe','pipe','pipe'],windowsHide:true});
  const reader=createInterface({input:child.stdout});const lines=reader[Symbol.asyncIterator]();assert.equal((await lines.next()).value,'READY');
  assert.equal(path.relative(f.dir,f.source),'cache');await fs.rm(f.source,{recursive:true});
  child.stdin.write('go\n');assert.equal((await lines.next()).value,'still working');child.stdin.end();await once(child,'exit');
  assert.equal(child.exitCode,0);assert.ok((await fs.readdir(f.releaseRoot)).some(n=>n.startsWith('1.0.0-')));
 }finally{child?.kill();await fs.rm(f.dir,{recursive:true,force:true});}
});
test('persistent releases are reused by content and detect edited snapshot files',async()=>{
 const f=await fixture();try{
  await fs.writeFile(path.join(f.source,'src','server.mjs'),'export function runStdio(){}');
  await fs.mkdir(path.join(f.source,'client'));await fs.writeFile(path.join(f.source,'client','editor.js'),'versioned-client');
  const first=await materializeRelease(f.source,f.releaseRoot);assert.equal(await materializeRelease(f.source,f.releaseRoot),first);
  assert.equal(await fs.readFile(path.join(first,'client','editor.js'),'utf8'),'versioned-client');
  await fs.writeFile(path.join(first,'src','lazy.mjs'),'tampered');await assert.rejects(materializeRelease(f.source,f.releaseRoot),/integrity/);
 }finally{await fs.rm(f.dir,{recursive:true,force:true});}
});
