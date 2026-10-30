import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createServer as createTcpServer} from 'node:net';
import {clientViewerHtml,registerClientDocument} from '../src/client-assets.mjs';
import {handleRequest} from '../src/server.mjs';

test('empty paste preserves the selection and text replacement keeps undo and formatting',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'?'Set browser and WASM paths':false,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));
 await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-paste-editor-'));
 const file=path.join(dir,'fixture.hwpx');const doc=HwpDocument.createEmpty();doc.createBlankDocument();const inCell=process.env.PWH_PASTE_CELL==='1';let cell;
 const check=result=>{const value=JSON.parse(result);assert.equal(value.ok,true,JSON.stringify(value));return value;};
 if(inCell){cell=check(doc.createTable(0,0,0,1,1));check(doc.insertTextInCell(0,cell.paraIdx,cell.controlIdx,0,0,0,'Original text'));check(doc.applyCharFormatInCell(0,cell.paraIdx,cell.controlIdx,0,0,0,13,JSON.stringify({bold:true,fontSize:1200,textColor:'#245b82'})));}
 else{check(doc.insertText(0,0,0,'Original text'));check(doc.applyCharFormat(0,0,0,13,JSON.stringify({bold:true,fontSize:1200,textColor:'#245b82'})));}
 await fs.writeFile(file,doc.exportHwpx());doc.free();
 const registered=await registerClientDocument(file),html=await clientViewerHtml();
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/editor'){res.setHeader('content-type','text/html');return res.end(html);}
  if(req.url==='/rpc'){let body='';for await(const chunk of req)body+=chunk;res.setHeader('content-type','application/json');return res.end(JSON.stringify(await handleRequest(JSON.parse(body))));}
  res.setHeader('content-type','text/html');res.end(`<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe src="/editor"></iframe><script>addEventListener('message',async e=>{const m=e.data;if(m?.jsonrpc!=='2.0')return;if(m.method==='ui/notifications/initialized'){e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(registered)}}},location.origin);return;}if(m.id===undefined)return;const r=m.method==='ui/initialize'?{jsonrpc:'2.0',id:m.id,result:{hostCapabilities:{}}}:await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();e.source.postMessage(r,location.origin);});</script>`);
 }catch(error){res.statusCode=500;res.end(String(error.stack));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let privateProcess;
 const browser=process.env.PWH_PRIVATE_CLIPBOARD_HELPER?await (async()=>{
  const probe=createTcpServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  privateProcess=spawn(process.env.PWH_PRIVATE_CLIPBOARD_HELPER,[process.env.PWH_BROWSER_EXECUTABLE,String(port),path.join(dir,'browser-profile')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let errors='';privateProcess.stderr.on('data',chunk=>{errors+=chunk.toString();});
  for(let i=0;i<100;i++){try{return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);}catch{if(privateProcess.exitCode!==null)throw Error('Private clipboard browser failed: '+errors);await new Promise(resolve=>setTimeout(resolve,100));}}
  throw Error('Private clipboard browser did not start: '+errors);
 })():await chromium.launch({headless:true,...process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{}});
 try{
  const context=await browser.newContext({viewport:{width:1150,height:900},...privateProcess?{permissions:['clipboard-read','clipboard-write']}:{}});
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame=page.frames().find(f=>f.url().endsWith('/editor'));
  await frame.waitForFunction(()=>window.pwhRecoveryReady?.()===true,null,{timeout:60000});
  const outer=await page.locator('iframe').boundingBox();
  const point=await frame.evaluate(inCell=>{
   for(let y=140;y<800;y+=5)for(let x=100;x<1050;x+=5){
    if(!document.elementFromPoint(x,y)?.closest('#scroll-content'))continue;
    const h=window.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y}),p=h.position,r=p?.cursorRect;
    if(p?.paragraphIndex===0&&(inCell?p.parentParaIndex!==undefined:p.parentParaIndex===undefined)&&p.charOffset>=1&&r&&h.y>=r.y&&h.y<r.y+r.height)return {x,y};
   }return null;
  },inCell);
  assert.ok(point,'synthetic text is visible');await page.mouse.click(outer.x+point.x,outer.y+point.y);
  if(inCell&&(await frame.evaluate(()=>window.pwhEditor.context())).kind==='table_object')await page.mouse.click(outer.x+point.x,outer.y+point.y);
  await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
  const selection=()=>frame.evaluate(()=>window.pwhEditor.context());
  assert.equal((await selection()).selectedText.text,'Original text');
  const snapshot=async()=>{const d=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));try{return inCell?{text:d.getTextInCell(0,cell.paraIdx,cell.controlIdx,0,0,0,d.getCellParagraphLength(0,cell.paraIdx,cell.controlIdx,0,0)),count:d.getCellParagraphCount(0,cell.paraIdx,cell.controlIdx,0),format:JSON.parse(d.getCellCharPropertiesAt(0,cell.paraIdx,cell.controlIdx,0,0,0))}:{text:d.getTextRange(0,0,0,d.getParagraphLength(0,0)),count:d.getParagraphCount(0),format:JSON.parse(d.getCharPropertiesAt(0,0,0))};}finally{d.free();}};
  const before=await snapshot();
  await frame.evaluate(()=>{const t=new DataTransfer();document.activeElement.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:t}));});
  assert.equal((await snapshot()).text,'Original text');assert.equal((await selection()).selectedText.text,'Original text');
  if(privateProcess){
   await page.evaluate(()=>navigator.clipboard.writeText('Replacement'));
   await frame.evaluate(()=>{window.__pwhPasteTrust=[];window.addEventListener('paste',e=>window.__pwhPasteTrust.push(e.isTrusted),true);});
   await page.keyboard.press('Control+v');
   assert.deepEqual(await frame.evaluate(()=>window.__pwhPasteTrust),[true],'the actual paste event is trusted');
  }else await frame.evaluate(()=>{const t=new DataTransfer();t.setData('text/plain','Replacement');document.activeElement.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:t}));});
  const after=await snapshot();assert.equal(after.text,'Replacement');
  assert.equal(after.format.bold,before.format.bold);assert.equal(after.format.fontSize,before.format.fontSize);assert.equal(after.format.textColor,before.format.textColor);
  await page.keyboard.press('Control+z');assert.equal((await snapshot()).text,'Original text','one undo restores the replaced selection');
  await page.keyboard.press('End');
  await frame.evaluate(()=>{const t=new DataTransfer();t.setData('text/plain',' A\nB');document.activeElement.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:t}));});
  const multiline=await snapshot();assert.equal(multiline.text,'Original text A');assert.equal(multiline.count,before.count+1);
  await page.keyboard.press('Control+z');const undone=await snapshot();assert.equal(undone.text,'Original text','one undo removes a multiline paste');assert.equal(undone.count,before.count);
 }finally{await browser.close();if(privateProcess&&!privateProcess.killed)privateProcess.kill();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
});
