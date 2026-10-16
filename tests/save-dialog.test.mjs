import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {selectClientSaveDestination,registerClientDocument,saveClientDocument} from '../src/client-assets.mjs';
import {documentResult} from '../src/server.mjs';
test('save chooser cancellation writes nothing and destination is tied to the original source',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-dialog-'));
 try{
  const file=path.join(dir,'source.hwpx');await fs.writeFile(file,'PKtest');const doc=await registerClientDocument(file);
  const args={documentId:doc.documentId,expectedSourceSha256:doc.sourceSha256};
  assert.deepEqual(await selectClientSaveDestination(args,{},async()=>({cancelled:true})),{cancelled:true});
  assert.deepEqual(await fs.readdir(dir),['source.hwpx']);
  await assert.rejects(selectClientSaveDestination(args,{},async()=>({path:file})),/overwritten/);
  const choice=await selectClientSaveDestination(args,{},async()=>({path:path.join(dir,'chosen.hwpx')}));
  assert.equal(choice.path,path.join(dir,'chosen.hwpx'));assert.ok(choice.saveTicket);
  await assert.rejects(saveClientDocument({...args,saveTicket:'forged',base64:Buffer.from('PKtest').toString('base64'),documentSha256:doc.sourceSha256,revision:1}),/destination/);
  await fs.appendFile(file,'changed');await assert.rejects(selectClientSaveDestination(args,{},async()=>{throw Error('must not open');}),/Source changed/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('document output instructs the host to open the actual file at the right, without claiming it opened',()=>{
 const target=path.resolve('draft.hwpx');const result=documentResult({path:target});
 assert.deepEqual(result.structuredContent.nextAction.arguments,{target:{type:'file',path:target},placement:'right'});
 assert.equal(result.structuredContent.nextAction.awaitingHostOpen,true);
 assert.equal(documentResult({path:'document.pdf'}).structuredContent.nextAction,undefined);
});
