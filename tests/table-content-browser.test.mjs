import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {setTimeout as pause} from 'node:timers/promises';
import {clientViewerHtml,registerClientDocument} from '../src/client-assets.mjs';
import {handleRequest} from '../src/server.mjs';
import {editorState,editorTables,editorTableFill,editorTableInsert,editorResult} from '../src/editor-session.mjs';

test('full editor imports and fills a merged table through MCP queue, renders, and undoes in one step',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'?'Set PWH_BROWSER_TESTS and explicit WASM/Playwright paths':false,timeout:90000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-table-browser-')),filename=path.join(temp,'synthetic.hwpx');
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();await fs.writeFile(filename,doc.exportHwpx());doc.free();
 const registered=await registerClientDocument(filename),html=await clientViewerHtml();
 let sessionId,nativeReads=0;
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/editor'){res.setHeader('Content-Type','text/html');res.end(html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="img-src data:">'));return;}
   if(req.url==='/rpc'){
    let body='';for await(const part of req)body+=part;const request=JSON.parse(body);
    if(request.params?.name==='pwh_client_clipboard'){
     nativeReads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{content:[],_meta:{'pwh/clipboard':{html:'Version:0.9\r\nStartHTML:00000099\r\n<html><body><table><tr><td><p>수국</p><p>민들레</p></td></tr></table></body></html>',text:'수국\r\n민들레',formats:['HTML Format','UnicodeText']}}}}));return;
    }
    if(request.params?.name==='pwh_editor_poll')sessionId=request.params.arguments.sessionId;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await handleRequest(request)));return;
   }
   res.setHeader('Content-Type','text/html');res.end(`<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe src="/editor"></iframe><script>
   addEventListener('message',async e=>{const m=e.data;if(m?.jsonrpc!=='2.0')return;
    if(m.method==='ui/notifications/initialized'){e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(registered)}}},location.origin);return;}
    if(m.id===undefined)return;let r;
    if(m.method==='ui/initialize')r={jsonrpc:'2.0',id:m.id,result:{hostCapabilities:{}}};
    else r=await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();
    e.source.postMessage(r,location.origin);
   });</script>`);
  }catch(error){res.statusCode=500;res.end(String(error.stack));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1000}});await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame=page.frames().find(f=>f.url().endsWith('/editor'));
  const wait=async(ticket)=>{for(let i=0;i<400;i++){const r=editorResult(ticket);if(r.status!=='pending'){assert.equal(r.status,'applied',JSON.stringify(r));return r;}await pause(100);}throw Error('Editor receipt timed out');};
  for(let i=0;i<400&&!sessionId;i++)await pause(100);assert.ok(sessionId,'Editor loaded and polled');
  let current=editorState({sessionId});assert.equal(current.context.blankDocument,true);assert.equal(current.capabilities.tableContent,true);
  if(process.env.PWH_HANCOM_SAMPLE){
   const sample=await fs.readFile(process.env.PWH_HANCOM_SAMPLE,'utf8');
   await frame.evaluate(html=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');input.focus();const data=new DataTransfer();data.setData('text/html',html);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},sample);
   await pause(1200);
   const result=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{const tables=JSON.parse(result.getControls()).filter(c=>c.ctrlId==='tbl');assert.equal(tables.length,1);const t=tables[0];assert.equal(JSON.parse(result.getTableDimensions(0,t.para,t.controlIndex)).cellCount,15);assert.equal(JSON.parse(result.getCellProperties(0,t.para,t.controlIndex,0)).fillColor.toLowerCase(),'#215a85');}finally{result.free();}
   await page.keyboard.press('Control+z');for(let i=0;i<100;i++){if(editorState({sessionId}).context.blankDocument)break;await pause(100);}
   current=editorState({sessionId});assert.equal(current.context.blankDocument,true);
  }
  if(process.env.PWH_HANCOM_MIXED){
   const sample=JSON.parse(await fs.readFile(process.env.PWH_HANCOM_MIXED,'utf8'));
   await frame.evaluate(({html,text})=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');input.focus();const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',text);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},sample);
   await pause(1500);
   const result=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{const controls=JSON.parse(result.getControls());assert.equal(controls.filter(c=>c.ctrlId==='tbl').length,1);assert.equal(controls.filter(c=>c.ctrlId==='gso').length,1);assert.equal(result.getParagraphCount(0),17);}finally{result.free();}
   await page.keyboard.press('Control+z');for(let i=0;i<100;i++){if(editorState({sessionId}).context.blankDocument)break;await pause(100);}
   current=editorState({sessionId});assert.equal(current.context.blankDocument,true);
  }
  {
   await frame.evaluate(()=>{
    const input=document.querySelector('[aria-label="문서 편집 입력"]');input.focus();
    const data=new DataTransfer();data.setData('text/html','<html><body><table><tr><td colspan="2" style="background-color:#235780;text-align:center"><span style="color:#ffffff;font-weight:bold">한글 표</span></td></tr><tr><td>말</td><td>소</td></tr></table></body></html>');data.setData('text/plain','한글 표\n말\t소');
    const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII='),c=>c.charCodeAt(0));data.items.add(new File([png],'table-preview.png',{type:'image/png'}));
    input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
   });
   await pause(1200);
   const pasted=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{const tables=JSON.parse(pasted.getControls()).filter(c=>c.ctrlId==='tbl');assert.equal(tables.length,1,'HTML table must take precedence over the bitmap preview under image CSP');const table=tables[0];assert.equal(JSON.parse(pasted.getTableDimensions(0,table.para,table.controlIndex)).cellCount,3);assert.equal(pasted.getTextInCell(0,table.para,table.controlIndex,0,0,0,4),'한글 표');assert.equal(JSON.parse(pasted.getCellProperties(0,table.para,table.controlIndex,0)).fillColor.toLowerCase(),'#235780');assert.equal(JSON.parse(pasted.getCellParaPropertiesAt(0,table.para,table.controlIndex,0,0)).alignment,'center');assert.equal(JSON.parse(pasted.getCellCharPropertiesAt(0,table.para,table.controlIndex,0,0,0)).textColor.toLowerCase(),'#ffffff');}finally{pasted.free();}
   await page.keyboard.press('Control+z');
   for(let i=0;i<100;i++){
    const fresh=await frame.evaluate(()=>window.pwhEditor.context());
    if(fresh.documentState.changeSeq===editorState({sessionId}).context.documentState.changeSeq&&fresh.blankDocument)break;
    await pause(100);
   }
   current=editorState({sessionId});assert.equal(current.context.blankDocument,true);
   await frame.evaluate(()=>{
    const input=document.querySelector('[aria-label="문서 편집 입력"]');input.focus();const data=new DataTransfer();
    const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;canvas.getContext('2d').fillRect(0,0,8,8);
    const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));data.items.add(new File([bytes],'only-image.png',{type:'image/png'}));
    input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
   });
   await pause(1200);
   const picture=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{assert.equal(JSON.parse(picture.getControls()).filter(c=>c.ctrlId==='gso').length,1,'Image-only paste must decode without a blocked blob URL');}finally{picture.free();}
   await page.keyboard.press('Control+z');
   for(let i=0;i<100;i++){const fresh=await frame.evaluate(()=>window.pwhEditor.context());if(fresh.documentState.changeSeq===editorState({sessionId}).context.documentState.changeSeq&&fresh.blankDocument)break;await pause(100);}
   current=editorState({sessionId});assert.equal(current.context.blankDocument,true);
  }
  const animals=['말','소','돼지','양','염소','닭','오리','거위','토끼','개','고양이','햄스터','사자','호랑이','표범','코끼리','기린','얼룩말','원숭이','고릴라','침팬지','곰','여우','늑대','사슴','고라니','노루','캥거루','코알라','판다'];
  const table={rows:11,columns:3,cells:[{row:0,column:0,columnSpan:3,paragraphs:['동물']},...animals.map((a,i)=>({row:1+Math.floor(i/3),column:i%3,paragraphs:[a]}))]};
  let receipt=await wait(await editorTableInsert({sessionId,expected:current.context,table}));assert.equal(receipt.result.undoSteps,1);assert.equal(receipt.result.changes.cellCount,31);
  current=editorState({sessionId});assert.equal(current.context.blankDocument,false);
  const plan=(await wait(editorTables({sessionId,expected:current.context}))).result.tablePlan;assert.equal(plan.tables[0].cells[0].colSpan,3);assert.equal(plan.tables[0].cells[30].paragraphs[0],'판다');
  // Select the first body cell through the actual rendered surface, then copy
  // with the real keyboard path. The source context locates a synthetic cell.
  const point=await frame.evaluate(()=>{
   for(let y=220;y<700;y+=7)for(let x=180;x<900;x+=13){const hit=window.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y});if(hit.position?.cellIndex===1)return{x:x+3,y:y+3};}
   return null;
  });assert.ok(point,'Rendered body cell found');
  const box=await page.locator('iframe').boundingBox();await page.mouse.click(box.x+point.x,box.y+point.y);await page.keyboard.press('F5');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).kind,'cell_block');
  await page.keyboard.press('Control+c');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells.length,1,'Ctrl+C must preserve the selected cell block');
  const copied=await frame.evaluate(()=>{const data=new DataTransfer();document.querySelector('[aria-label="문서 편집 입력"]').dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return{html:data.getData('text/html'),text:data.getData('text/plain')};});
  assert.equal(copied.text,'말');assert.equal((copied.html.match(/<td /g)||[]).length,1,'Copy must exclude the other 30 cells');
  await page.keyboard.press('Escape');
  const destination=await frame.evaluate(()=>{for(let y=220;y<700;y+=7)for(let x=180;x<900;x+=13){const hit=window.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y});if(hit.position?.cellIndex===2)return{x:x+3,y:y+3};}return null;});assert.ok(destination);await page.mouse.click(box.x+destination.x,box.y+destination.y);
  // Paste that one-cell HTML into another existing cell, preserving its table.
  await page.keyboard.press('F5');await page.keyboard.press('Control+v');
  await pause(200);
  assert.ok((await frame.evaluate(()=>document.getElementById('pwh-status').textContent)).includes('완료'));
  const cellPaste=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));try{const ref=plan.tables[0].source;assert.equal(JSON.parse(cellPaste.getTableDimensions(ref.sec,ref.ppi,ref.ci)).cellCount,31);assert.equal(cellPaste.getTextInCell(ref.sec,ref.ppi,ref.ci,2,0,0,1),'말');}finally{cellPaste.free();}
  // The cell paste is a single undo, so the following existing tool test still
  // starts at the original document state and the inspected plan remains valid.
  await page.keyboard.press('Control+z');
  for(let i=0;i<100;i++){const fresh=await frame.evaluate(()=>window.pwhEditor.context());if(fresh.documentState.changeSeq===editorState({sessionId}).context.documentState.changeSeq)break;await pause(100);}
  assert.equal(nativeReads,0,'Do not read the OS clipboard in the background');
  await frame.getByRole('button',{name:'한글 표·셀 가져오기'}).click();
  await frame.getByRole('status').filter({hasText:'한글 표·셀을 가져왔습니다.'}).waitFor();assert.equal(nativeReads,1);
  const nativePaste=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));try{const ref=plan.tables[0].source;assert.equal(nativePaste.getCellParagraphCount(ref.sec,ref.ppi,ref.ci,2),2);assert.equal(nativePaste.getTextInCell(ref.sec,ref.ppi,ref.ci,2,1,0,3),'민들레');}finally{nativePaste.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');
  for(let i=0;i<100;i++){const fresh=await frame.evaluate(()=>window.pwhEditor.context());if(fresh.documentState.changeSeq===editorState({sessionId}).context.documentState.changeSeq)break;await pause(100);}
  await wait(await editorTableFill({sessionId,expected:editorState({sessionId}).context,planId:plan.planId,tableIndex:0,edits:[{cellIndex:0,paragraphs:['동물 목록']},{cellIndex:1,paragraphs:['얼룩말']}]}));
  const inspect=async()=>{const state=editorState({sessionId});return (await wait(editorTables({sessionId,expected:state.context}))).result.tablePlan.tables[0];};
  assert.equal((await inspect()).cells[0].paragraphs[0],'동물 목록');
  if(process.env.PWH_TABLE_SCREENSHOT)await page.screenshot({path:process.env.PWH_TABLE_SCREENSHOT});
  const input=frame.getByRole('textbox',{name:'문서 편집 입력'});await input.focus();await page.keyboard.press('Control+z');
  // Direct capture reads the actual UI state; poll waits until the undo is published.
  for(let i=0;i<100;i++){const c=await frame.evaluate(()=>window.pwhEditor.context());if(c.documentState.changeSeq!==editorState({sessionId}).context.documentState.changeSeq){await pause(100);continue;}break;}
  const undo=(await frame.evaluate(()=>window.pwhEditor.export().bytes)).length;assert.ok(undo>0);
  const bytes=await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes));const reopened=new HwpDocument(Uint8Array.from(bytes));
  try{const ref=plan.tables[0].source;assert.equal(reopened.getTextInCell(ref.sec,ref.ppi,ref.ci,0,0,0,2),'동물');assert.equal(reopened.getTextInCell(ref.sec,ref.ppi,ref.ci,1,0,0,1),'말');}finally{reopened.free();}
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
});
