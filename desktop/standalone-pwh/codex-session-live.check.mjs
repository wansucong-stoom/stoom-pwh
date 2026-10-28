import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {createCodexSession} from './codex-session.mjs';

test('app-server preserves context across two turns', {skip:process.env.PWH_CODEX_SESSION_LIVE!=='1',timeout:240000},async()=>{
 let calls=0;const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');let body='';req.on('data',c=>body+=c);req.on('end',()=>{const message=JSON.parse(body);if(message.method==='notifications/initialized'){res.statusCode=202;return res.end();}if(message.method==='initialize')return res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'pwh-test',version:'1'}}}));if(message.method==='tools/list')return res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{tools:[{name:'pwh_editor_state',description:'현재 문서의 테스트 상태를 읽습니다.',annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},inputSchema:{type:'object',properties:{sessionId:{type:'string'}},required:['sessionId']}},{name:'pwh_editor_compose',description:'명시적으로 요청한 테스트 문서를 편집합니다.',annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},inputSchema:{type:'object',properties:{sessionId:{type:'string'}},required:['sessionId']}}]}}));if(message.method==='tools/call'){calls++;return res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:'문서 테스트 표식: 감나무'}]}}));}res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{}}));});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let session;const events=[];
 try{
  session=await createCodexSession({stoomModule:resolve('standalone-pwh/codex-native-host.mjs'),mcpUrl:`http://127.0.0.1:${server.address().port}/mcp`,bearerToken:'test-token',notify:event=>events.push(event)});
  const first=await session.send({note:'이 대화에서 기억할 단어는 자두나무입니다. 단어만 답하세요.',requestId:'test',sessionId:'test'});assert.match(first.text,/자두나무/);
  const second=await session.send({note:'내가 방금 기억해 달라고 한 단어만 답하세요.',requestId:'test',sessionId:'test'});assert.match(second.text,/자두나무/);
  assert.ok(events.some(event=>event.type==='text'&&event.text),'대화 응답이 실시간으로 전달되지 않았습니다.');
  const third=await session.send({note:'반드시 pwh_editor_state 도구를 호출하여 문서 테스트 표식만 답하세요.',requestId:'test',sessionId:'test'});assert.match(third.text,/감나무/);assert.ok(calls>0);
  const before=calls;const fourth=await session.send({note:'반드시 pwh_editor_compose 도구로 테스트 문서를 편집하고 결과를 알려주세요.',requestId:'test',sessionId:'test'});assert.ok(calls>before,fourth.text);
 }finally{session?.close();await new Promise(resolve=>server.close(resolve));}
});
