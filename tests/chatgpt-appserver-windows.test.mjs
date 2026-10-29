import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createCodexSession} from '../desktop/standalone-pwh/codex-session.mjs';
import {officialRuntimeFiles,verifyOfficialRuntime} from '../desktop/standalone-pwh/official-codex-runtime.mjs';

test('official standalone app-server starts and resumes the same scoped document thread', {skip:process.platform!=='win32'||!process.env.PWH_TEST_CODEX_RUNTIME,timeout:120000},async()=>{
 const runtimeRoot=path.resolve(process.env.PWH_TEST_CODEX_RUNTIME),home=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-plan-runtime-'));
 const mcp=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const m=JSON.parse(Buffer.concat(chunks));if(req.headers.authorization!=='Bearer test-document-token'){res.writeHead(401);return res.end();}if(m.method==='notifications/initialized'){res.writeHead(202);return res.end();}const result=m.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}:m.method==='tools/list'?{tools:[{name:'pwh_test',description:'test document tool',inputSchema:{type:'object',properties:{}}}]}:{};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});
 await new Promise(resolve=>mcp.listen(0,'127.0.0.1',resolve));
 const debugSpawn=(exe,args,options)=>{const p=spawn(exe,args,options);if(process.env.PWH_TEST_DEBUG==='1'){p.stdout.on('data',data=>{for(const line of data.toString().split('\n'))try{const m=JSON.parse(line);if(m.error)console.error('RPC failure',m.id,JSON.stringify(m.error));}catch{}});p.stderr.on('data',data=>console.error('app-server diagnostic:',data.toString()));}return p;};
 const params={stoomModule:fileURLToPath(new URL('../desktop/standalone-pwh/codex-native-host.mjs',import.meta.url)),mcpUrl:`http://127.0.0.1:${mcp.address().port}/mcp`,bearerToken:'test-document-token',spawnImpl:debugSpawn,direct:{runtimeRoot,home,accessToken:'fake-access-token'}};
 try{
  await verifyOfficialRuntime(runtimeRoot);assert.ok(Object.keys(officialRuntimeFiles).length>=6);
  const first=await createCodexSession(params);const threadId=first.threadId;assert.ok(threadId);
  // A persistent rollout is created when the first turn starts, not at thread/start.
  const pending=first.send({note:'synthetic local test',requestId:'test-request',sessionId:'test-session'}).catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,800));await first.interrupt().catch(()=>{});await pending;first.close();
  const second=await createCodexSession({...params,direct:{...params.direct,threadId,accessToken:'fake-rotated-access-token'}});assert.equal(second.threadId,threadId);second.close();
 }finally{mcp.closeAllConnections?.();await new Promise(resolve=>mcp.close(resolve));await fs.rm(home,{recursive:true,force:true,maxRetries:15,retryDelay:300});}
});
