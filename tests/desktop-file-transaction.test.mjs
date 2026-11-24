import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createDesktopFileManager} from '../desktop/standalone-pwh/desktop-files.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

for(const type of ['hwpx','docx']){
  test('two tabs cannot both replace the same original '+type,async t=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-save-race-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    const original=Buffer.from('PK original');
    const revisions=[Buffer.from('PK first editor version'),Buffer.from('PK second editor version')];
    const target=path.join(dir,'document.'+type);
    await fs.writeFile(target,original);
    let pending=0,unblock;
    const together=new Promise(resolve=>{unblock=resolve;});
    async function waitForBoth(){
      if(++pending===2)unblock();
      await together;
    }
    const tabs=revisions.map((bytes,index)=>{
      const manager=createDesktopFileManager({
        verify:async()=>{await waitForBoth();return {format:'hwpx'};},
        register:async file=>({sourceSha256:hash(await fs.readFile(file))}),
        prepareDocx:async()=>{await waitForBoth();return {bytes,document:{name:String(index)}};},
      });
      manager.setTarget(target,hash(original));
      return manager;
    });
    const tickets=await Promise.all(tabs.map((manager,i)=>manager.prepare({mode:'save',documentId:String(i)})));
    const saved=await Promise.allSettled(tabs.map((manager,i)=>manager.write({
      ticket:tickets[i].ticket,documentId:String(i),bytes:revisions[i],
    })));
    const winner=saved.findIndex(result=>result.status==='fulfilled');
    assert.ok(winner>=0);
    assert.equal(saved[1-winner].status,'rejected');
    assert.match(saved[1-winner].reason.message,/다른 곳에서 변경/);
    assert.deepEqual(await fs.readFile(target),revisions[winner]);
    assert.deepEqual(await fs.readdir(dir),[path.basename(target)]);
  });
}
