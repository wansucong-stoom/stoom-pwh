import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../src/server.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {packagePlugin} from '../scripts/package.mjs';
import {zipEntries} from '../scripts/setup.mjs';

test('modern stdio discovery probes fall back to the implemented legacy protocol',async()=>{
 const probe=await handleRequest({jsonrpc:'2.0',id:1,method:'server/discover',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}}});
 assert.equal(probe.error.code,-32601);
 assert.equal(probe.result,undefined);
 const init=await handleRequest({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'dual-era-client',version:'1'}}});
 assert.equal(init.result.protocolVersion,'2025-11-25');
 assert.equal(init.result.serverInfo.name,'pwh');
 assert.equal(init.result.resultType,undefined);
 const list=await handleRequest({jsonrpc:'2.0',id:3,method:'tools/list'});
 const opener=list.result.tools.find(t=>t.name==='pwh_open');
 assert.deepEqual(opener._meta['openai/ui'].entrypoints,[{type:'file',extensions:['.hwpx']}]);
 assert.equal(opener._meta.ui.resourceUri,`ui://pwh/inline-editor-${init.result.serverInfo.version}`);
 for(const name of ['pwh_editor_state','pwh_editor_open','pwh_editor_result'])assert.ok(list.result.tools.some(t=>t.name===name));
});

test('initialize continues to select only a supported legacy revision',async()=>{
 for(const requested of ['2024-11-05','2025-03-26','2025-06-18','2025-11-25','2026-07-28']){
  const response=await handleRequest({jsonrpc:'2.0',id:requested,method:'initialize',params:{protocolVersion:requested}});
  assert.equal(response.result.protocolVersion,requested==='2026-07-28'?'2025-11-25':requested);
 }
});

test('released archive discovers its real server, file entrypoint and viewer resource',{timeout:30000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-connection-')),archive=path.join(root,'plugin.zip');
 let child;t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});});
 await packagePlugin({output:archive});
 for(const e of zipEntries(await fs.readFile(archive))){
  const target=path.join(root,e.name),rel=path.relative(root,target);assert.ok(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel));
  if(e.name.endsWith('/'))await fs.mkdir(target,{recursive:true});else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,e.read());}
 }
 const source=path.join(root,'pwh'),pkg=JSON.parse(await fs.readFile(path.join(source,'package.json')));
 child=spawn(process.execPath,[path.join(source,'scripts/launch.mjs'),'pwh'],{cwd:source,windowsHide:true,env:{...process.env,PWH_SERVER_RELEASE_ROOT:path.join(root,'releases'),PWH_OUTPUT_ROOT:path.join(root,'outputs'),PWH_FONT_ROOT:path.join(root,'fonts')},stdio:['pipe','pipe','pipe']});
 let buffer='',seq=0;const pending=new Map();
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;for(let n;(n=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);const m=JSON.parse(line),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);p.resolve(m);}}});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('Packaged MCP timeout: '+method)),10000);pending.set(id,{resolve,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 assert.equal((await rpc('server/discover')).error.code,-32601);
 const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'package-check',version:'1'}});
 assert.equal(init.result.serverInfo.version,pkg.version);
 const tools=(await rpc('tools/list')).result.tools,opener=tools.find(t=>t.name==='pwh_open');assert.ok(opener);
 assert.deepEqual(opener._meta['openai/ui'].entrypoints,[{type:'file',extensions:['.hwpx']}]);
 const view=await rpc('resources/read',{uri:opener._meta.ui.resourceUri});
 assert.match(view.result.contents[0].mimeType,/mcp-app/);assert.match(view.result.contents[0].text,/pwhEditor/);
 child.stdin.end();
});
