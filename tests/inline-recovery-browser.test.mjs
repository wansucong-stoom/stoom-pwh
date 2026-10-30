import {waitForInlineEditor} from './helpers/editor-ready.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {setTimeout as pause} from 'node:timers/promises';
import {clientViewerHtml,registerClientDocument} from '../src/client-assets.mjs';
import {handleRequest} from '../src/server.mjs';
import {editorState,editorTableInsert,editorResult} from '../src/editor-session.mjs';

test('closing recovery leaves the draft intact even after a new edit',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'?'Set browser and WASM paths':false,timeout:60000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-recovery-browser-')),filename=path.join(dir,'draft.hwpx');
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();await fs.writeFile(filename,doc.exportHwpx());doc.insertText(0,0,0,'임시 복구 내용');const draft=Buffer.from(doc.exportHwpx());doc.free();
 const registered=await registerClientDocument(filename),html=await clientViewerHtml(),draftSha=createHash('sha256').update(draft).digest('hex'),key=registered.source+'|'+registered.sourceSha256;let sessionId;
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/editor'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(req.url==='/rpc'){let body='';for await(const part of req)body+=part;const request=JSON.parse(body);if(request.params?.name==='pwh_editor_poll')sessionId=request.params.arguments.sessionId;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await handleRequest(request)));return;}
  res.setHeader('Content-Type','text/html');res.end(`<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe id="editor"></iframe><script>
   addEventListener('message',async e=>{const m=e.data;if(m?.jsonrpc!=='2.0')return;if(m.method==='ui/notifications/initialized'){e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(registered)}}},location.origin);return;}if(m.id===undefined)return;const r=m.method==='ui/initialize'?{jsonrpc:'2.0',id:m.id,result:{hostCapabilities:{}}}:await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();e.source.postMessage(r,location.origin);});
   const request=indexedDB.open('pwh-inline-recovery',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'key'});request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readwrite');const bytes=Uint8Array.from(atob(${JSON.stringify(draft.toString('base64'))}),c=>c.charCodeAt(0));tx.objectStore('drafts').put({key:${JSON.stringify(key)},bytes:bytes.buffer,sha256:${JSON.stringify(draftSha)},savedAt:Date.now(),source:${JSON.stringify(registered.source)}});tx.oncomplete=()=>{db.close();document.getElementById('editor').src='/editor';};};</script>`);
 }catch(error){res.statusCode=500;res.end(String(error.stack));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:900,height:750}});await page.goto(`http://127.0.0.1:${server.address().port}`);
  for(let i=0;i<100&&!page.frames().some(f=>f.url().endsWith('/editor'));i++)await pause(100);
  const frame=page.frames().find(f=>f.url().endsWith('/editor'));assert.ok(frame);
  const dialog=frame.getByRole('dialog',{name:'미저장 편집 내용 복구'});await dialog.getByRole('button',{name:'닫기'}).click({timeout:15000});
  for(let i=0;i<200&&!sessionId;i++)await pause(100);assert.ok(sessionId,'editor loads after close');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).blankDocument,true,'saved source stays open');
  const state=editorState({sessionId}),ticket=await editorTableInsert({sessionId,expected:state.context,table:{rows:1,columns:1,cells:[{row:0,column:0,paragraphs:['new']} ]}});
  let receipt;for(let i=0;i<200;i++){receipt=editorResult(ticket);if(receipt.status!=='pending')break;await pause(100);}assert.equal(receipt.status,'applied');await pause(3000);
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).documentState.dirty,true);
  const stored=await frame.evaluate(async key=>{const draft=await recoveryStore('get',key);return draft&&{sha256:draft.sha256,bytes:Array.from(new Uint8Array(draft.bytes))};},key);
  assert.equal(stored.sha256,draftSha);assert.deepEqual(Buffer.from(stored.bytes),draft,'dismissed draft is not overwritten by a new checkpoint');
  await frame.evaluate(()=>{window.__recoveryChoice=promptRecovery(true);});
  assert.ok(await dialog.getByText('원본 경로는 확인할 수 없으므로',{exact:false}).isVisible());await page.keyboard.press('Escape');
  assert.equal(await frame.evaluate(()=>window.__recoveryChoice),'dismiss');
  await frame.evaluate(()=>{window.__recoveryChoice=promptRecovery(false);});await dialog.getByRole('button',{name:'저장본 열기'}).click();assert.equal(await frame.evaluate(()=>window.__recoveryChoice),'source');
  await frame.evaluate(()=>{window.__recoveryChoice=promptRecovery(false);});await dialog.getByRole('button',{name:'복구하기'}).click();assert.equal(await frame.evaluate(()=>window.__recoveryChoice),'recover');
  await frame.evaluate(()=>window.pwhEditor.saved());await frame.goto(`http://127.0.0.1:${server.address().port}/editor`);
  await waitForInlineEditor(frame);assert.equal(await dialog.count(),0,'a dismissed unchanged recovery does not reappear after reopening');
  await frame.evaluate(()=>{window.__manualRecovery=window.pwhShowRecovery();});await dialog.getByRole('button',{name:'복구하기'}).click({timeout:5000});await frame.evaluate(()=>window.__manualRecovery);
  const recovered=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));try{assert.equal(recovered.getTextRange(0,0,0,8),'임시 복구 내용');}finally{recovered.free();}
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
