import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {once} from 'node:events';
import {runStdio} from '../src/server.mjs';

async function exchange(chunks){
  const input=new PassThrough(),responses=[];
  const output=new Writable({write(bytes,_encoding,done){responses.push(bytes.toString());done();}});
  const transport=runStdio(input,output),ended=once(input,'end');
  for(const chunk of chunks)input.write(chunk);input.end();await ended;await transport.done();
  return responses.join('').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
const init=id=>JSON.stringify({jsonrpc:'2.0',id,method:'initialize',params:{protocolVersion:'2025-11-25'}});

test('stdio preserves split UTF-8 JSON and the final unterminated request',async()=>{
  const bytes=Buffer.from(init('한글😀'));
  const result=await exchange([bytes.subarray(0,25),bytes.subarray(25,28),bytes.subarray(28)]);
  assert.equal(result.length,1);assert.equal(result[0].id,'한글😀');assert.equal(result[0].result.serverInfo.name,'pwh');
});
test('stdio recovers after malformed input and ignores blank lines',async()=>{
  const result=await exchange(['\nnot-json\n  \n'+init(7)+'\n']);
  assert.equal(result.length,2);assert.equal(result[0].error.code,-32700);assert.equal(result[1].id,7);
});
test('stdio discards an oversized line and resumes at the next newline',async()=>{
  const result=await exchange(['x'.repeat(16*1024*1024+1),'discarded\n'+init(8)+'\n']);
  assert.equal(result.length,2);assert.equal(result[0].error.code,-32600);assert.equal(result[1].id,8);
});
test('stdio delivers independent requests and serialized requests exactly once',async()=>{
  const fast={jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'pwh_editor_poll',arguments:{}}};
  const result=await exchange([init(1)+'\n'+JSON.stringify(fast)+'\n'+init(3)+'\n']);
  assert.deepEqual(result.map(row=>row.id).sort(),[1,2,3]);
});
