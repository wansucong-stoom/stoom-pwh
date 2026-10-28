import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalProvider, createCodexProvider, localApiBase} from './ai-providers.mjs';

test('local endpoint refuses remote hosts and credentials', () => {
  assert.equal(localApiBase('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  for (const url of ['https://example.com/v1','http://user:secret@localhost:11434/v1','http://192.168.1.2:11434/v1','http://localhost:11434/api']) assert.throws(() => localApiBase(url));
});
test('local provider lists models and sends a non-streaming completion', async () => {
  const calls=[];
  const fetchImpl=async (url, options) => { calls.push({url,options}); return new Response(JSON.stringify(url.endsWith('/models')?{data:[{id:'local-model'}]}:{choices:[{message:{content:'수정한 문장'}}]}),{status:200}); };
  const provider=createLocalProvider({model:'local-model',fetchImpl});
  assert.deepEqual((await provider.status()).models,[{id:'local-model',name:'local-model'}]);
  assert.equal((await provider.generate({prompt:'고쳐 줘'})).text,'수정한 문장');
  assert.equal(calls[1].url,'http://127.0.0.1:11434/v1/chat/completions');
  assert.deepEqual(JSON.parse(calls[1].options.body),{model:'local-model',messages:[{role:'user',content:'고쳐 줘'}],stream:false});
  assert.equal(calls[1].options.redirect,'error');
});
test('local provider reports unavailable server and invalid responses', async () => {
  const down=createLocalProvider({model:'m',fetchImpl:async()=>{throw Error('connection refused');}});
  await assert.rejects(down.status(),/연결하지 못했습니다/);
  const invalid=createLocalProvider({model:'m',fetchImpl:async()=>new Response('{}')});
  await assert.rejects(invalid.generate({prompt:'test'}),/응답을 사용할 수 없습니다/);
});
test('missing Codex reports installation guidance without affecting local editing',async()=>{
 const runtime={CodexConnection:class{},discoverCodex:async()=>null,reviewFilesystem:()=>({})};
 const provider=await createCodexProvider({runtime});const status=await provider.status();assert.equal(status.ready,false);assert.match(status.message,/Codex CLI/);
 await assert.rejects(provider.generate({prompt:'test'}),/로그인 상태/);
});
