import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createChatgptAuth} from '../desktop/standalone-pwh/chatgpt-auth.mjs';
import {createCodexSession} from '../desktop/standalone-pwh/codex-session.mjs';

test('authorized ChatGPT can call the isolated document MCP tool', {skip:process.env.PWH_CHATGPT_LIVE!=='1'||!process.env.PWH_TEST_CODEX_RUNTIME||!process.env.PWH_TEST_CHATGPT_DATA,timeout:180000},async()=>{
 const auth=createChatgptAuth({dataRoot:path.resolve(process.env.PWH_TEST_CHATGPT_DATA)}),home=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-chatgpt-live-'));let calls=0;
 const mcp=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const m=JSON.parse(Buffer.concat(chunks));if(req.headers.authorization!=='Bearer test-document-token'){res.writeHead(401);return res.end();}if(m.method==='notifications/initialized'){res.writeHead(202);return res.end();}let result={};if(m.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'pwh-test',version:'1'}};if(m.method==='tools/list')result={tools:[{name:'pwh_test',description:'시험 문서 확인 도구입니다. 호출하면 문서 테스트 결과를 반환합니다.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}]};if(m.method==='tools/call'&&m.params?.name==='pwh_test'){calls++;result={content:[{type:'text',text:'Pwh tool test succeeded'}]};}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});await new Promise(resolve=>mcp.listen(0,'127.0.0.1',resolve));
 let session;try{const token=await auth.getAccessToken();session=await createCodexSession({stoomModule:fileURLToPath(new URL('../desktop/standalone-pwh/codex-native-host.mjs',import.meta.url)),mcpUrl:`http://127.0.0.1:${mcp.address().port}/mcp`,bearerToken:'test-document-token',direct:{runtimeRoot:path.resolve(process.env.PWH_TEST_CODEX_RUNTIME),home,accessToken:token.accessToken}});const result=await session.send({note:'다른 도구 대신 pwh_test 도구를 한 번 호출하고 나온 결과를 알려 주세요.',requestId:'synthetic-request',sessionId:'synthetic-session'});assert.ok(calls>0,'Pwh MCP tool was not called: '+result.text);assert.match(result.text,/Pwh|succeeded|성공|완료/i);}
 finally{session?.close();auth.close();mcp.closeAllConnections?.();await new Promise(resolve=>mcp.close(resolve));await fs.rm(home,{recursive:true,force:true,maxRetries:20,retryDelay:300});}
});
