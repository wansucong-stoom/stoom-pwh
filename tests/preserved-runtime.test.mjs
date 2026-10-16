import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readRuntimeArchive,validateRuntimeLock,installPreservedRuntime} from '../scripts/preserved-runtime.mjs';
import {zipEntries,childPath} from '../scripts/setup.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function zip(entries){const local=[],central=[];let offset=0,cdSize=0;
 for(const[name,data]of entries){const n=Buffer.from(name),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;cdSize+=c.length+n.length;}
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cdSize,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,...central,end]);}
function fixture(change=()=>{}){
 const files=new Map(Object.entries({'rhwp/rhwp.exe':'synthetic-cli','core/rhwp_bg.wasm':'synthetic-wasm','editor-sdk/index.js':'sdk','studio/index.html':'studio','studio-inline/editor.js':'inline'}).map(([n,v])=>[n,Buffer.from(v)]));
 for(const comp of ['rhwp','core','editor-sdk','studio','studio-inline'])files.set(comp+'/LICENSE',Buffer.from('synthetic license'));
 const lock={schemaVersion:1,id:'rhwp-0.8.7-pwh-r1',platform:'win32-x64',upstreamCommit:'pinned',runtime:{file:'pwh-runtime-fixture.zip',url:'https://github.com/wansucong-stoom/stoom-pwh/releases/download/test/pwh-runtime-fixture.zip'}};
 const manifest={schemaVersion:1,id:lock.id,upstreamCommit:'pinned',files:[...files].map(([p,b])=>({path:p,size:b.length,sha256:sha(b)}))};
 let entries=[...files,['runtime-manifest.json',Buffer.from(JSON.stringify(manifest))]];change(entries,manifest);
 const bytes=zip(entries);lock.runtime.sha256=sha(bytes);return{bytes,lock,files};
}
test('preserved runtime verifies both archive identity and every inner file',()=>{
 const {bytes,lock}=fixture();assert.equal(readRuntimeArchive(bytes,lock,zipEntries).files.size,10);
 assert.throws(()=>readRuntimeArchive(Buffer.concat([bytes,Buffer.from('changed')]),lock,zipEntries),/digest mismatch/);
 const corrupted=fixture(entries=>{entries[0]=[entries[0][0],Buffer.from('corrupt bytes')];});assert.throws(()=>readRuntimeArchive(corrupted.bytes,corrupted.lock,zipEntries),/size mismatch|digest mismatch/);
 assert.throws(()=>validateRuntimeLock({...lock,runtime:{...lock.runtime,url:'https://github.com/other/engine/releases/download/test/'+lock.runtime.file}}),/preserved pwh release/);
});
test('unsafe and duplicate archive members are rejected even with the correct archive hash',()=>{
 for(const bad of ['../escape','core/CON.txt','core/file:ads','core/space.']){const f=fixture(e=>e.push([bad,Buffer.from('bad')]));assert.throws(()=>readRuntimeArchive(f.bytes,f.lock,zipEntries),/Unsafe/);}
 const duplicate=fixture(e=>e.push(['CORE/RHWP_BG.WASM',Buffer.from('duplicate')]));assert.throws(()=>readRuntimeArchive(duplicate.bytes,duplicate.lock,zipEntries),/Duplicate/);
});
test('offline install is idempotent and refuses an existing modified engine before publishing new components',{skip:process.platform!=='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-preserved-test-'));t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});});
 const {bytes,lock}=fixture();let downloads=0;const archive=path.join(root,'fixture.zip');await fs.writeFile(archive,bytes);
 const helpers={zipEntries,childPath,download:async()=>{downloads++;return archive;},installNanum:async()=>{throw Error('not requested');}};
 const target=path.join(root,'fresh'),options={runtimeRoot:target,skipDownload:true,runtimeArchive:archive};
 await installPreservedRuntime(options,lock,helpers);assert.equal(await fs.readFile(path.join(target,'studio-inline/editor.js'),'utf8'),'inline');
 await installPreservedRuntime(options,lock,helpers);assert.equal(downloads,2);
 await fs.writeFile(path.join(target,'rhwp/rhwp.exe'),'user-modified');
 const other=path.join(root,'partial');await fs.mkdir(path.join(other,'rhwp'),{recursive:true});await fs.cp(path.join(target,'rhwp'),path.join(other,'rhwp'),{recursive:true});
 await assert.rejects(installPreservedRuntime({...options,runtimeRoot:other},lock,helpers),/differs/);await assert.rejects(fs.stat(path.join(other,'core')),{code:'ENOENT'});
 assert.equal(await fs.readFile(path.join(other,'rhwp/rhwp.exe'),'utf8'),'user-modified');
});
