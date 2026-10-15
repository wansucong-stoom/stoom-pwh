import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';

test('인증·연결 실패가 기존 미저장 공유 세션 기록을 바꾸지 않음', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-session-guard-'));
  t.after(() => fs.rm(directory, {recursive:true,force:true}));
  process.env.PWH_OUTPUT_ROOT=process.env.HWPXYZ_OUTPUT_ROOT=directory;
  const server=createServer((req,res)=>res.writeHead(401).end());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const host=`127.0.0.1:${server.address().port}`;
  const recorded=JSON.stringify({baseUrl:`http://${host}`,host,token:randomBytes(32).toString('hex'),sessionId:randomUUID(),pid:process.pid});
  const filename=path.join(directory,'live-session.json');
  await fs.writeFile(filename,recorded);
  const {describeLiveSession}=await import('../src/live.mjs');
  try{
    await assert.rejects(describeLiveSession(),/세션 기록을 보존/);
    assert.equal(await fs.readFile(filename,'utf8'),recorded);
  }finally{await new Promise(resolve=>server.close(resolve));}
  await assert.rejects(describeLiveSession(),/세션 기록을 보존/);
  assert.equal(await fs.readFile(filename,'utf8'),recorded);
});
