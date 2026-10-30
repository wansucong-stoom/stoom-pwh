import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('Desktop records the original opened document and the final save-as destination', {
  skip:!process.env.PWH_DESKTOP_SOURCE_ROOT||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM,
  timeout:60000,
}, async () => {
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-recent-host-'));process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
  const original=path.join(dir,'원본.hwpx'),copy=path.join(dir,'새 이름.hwpx');
  const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();doc.insertText(0,0,0,'저장 시험');const bytes=Buffer.from(doc.exportHwpx());doc.free();await fs.writeFile(original,bytes);
  const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  const {createRecentDocuments}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'recent-documents.mjs')));
  const app=await createAppServer({initialPath:original,chooseFile:async({mode})=>({cancelled:false,path:mode==='Save'?copy:original})});
  const origin=new URL(app.url).origin;
  const call=async(route,body,headers={})=>{
    const response=await fetch(app.url+route,{method:'POST',headers:{origin,'x-pwh-request':'1',...headers},body});
    const result=await response.json();if(!response.ok)throw Error(result.error);return result;
  };
  try {
    const current=(await call('initialize','{}',{'content-type':'application/json'})).document;
    const prepared=await call('file/prepare',JSON.stringify({mode:'save-as',documentId:current.documentId}),{'content-type':'application/json'});
    await call('file/write',bytes,{'x-pwh-ticket':prepared.ticket,'x-pwh-document':current.documentId});
    const entries=await createRecentDocuments(process.env.PWH_STANDALONE_DATA).list();
    // Windows can return a long canonical path after a native save dialog.
    assert.deepEqual(new Set(await Promise.all(entries.map(item=>fs.realpath(item.path)))),new Set(await Promise.all([original,copy].map(item=>fs.realpath(item)))));
    assert.deepEqual(await fs.readFile(original),bytes);
    assert.deepEqual(await fs.readFile(copy),bytes);
  } finally {
    app.server.closeAllConnections?.();await new Promise(resolve=>app.server.close(resolve));
    await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
