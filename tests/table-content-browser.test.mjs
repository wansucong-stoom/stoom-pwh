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
import {editorState,editorTables,editorTableFill,editorTableInsert,editorTableTitle,editorResult} from '../src/editor-session.mjs';

test('full editor imports and fills a merged table through MCP queue, renders, and undoes in one step',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'?'Set PWH_BROWSER_TESTS and explicit WASM/Playwright paths':false,timeout:90000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-table-browser-')),filename=path.join(temp,'synthetic.hwpx');
 process.env.PWH_COLOR_PREFERENCES_DIR=path.join(temp,'preferences');
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();await fs.writeFile(filename,doc.exportHwpx());doc.free();
 const registered=await registerClientDocument(filename),html=await clientViewerHtml();
 let sessionId,nativeReads=0,nativeFixture=null;
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/editor'){res.setHeader('Content-Type','text/html');res.end(html.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="img-src data:">'));return;}
   if(req.url==='/rpc'){
    let body='';for await(const part of req)body+=part;const request=JSON.parse(body);
    if(request.params?.name==='pwh_client_clipboard'){
     nativeReads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{content:[],_meta:{'pwh/clipboard':nativeFixture||{html:'Version:0.9\r\nStartHTML:00000099\r\n<html><body><table><tr><td><p>수국</p><p>민들레</p></td></tr></table></body></html>',text:'수국\r\n민들레',formats:['HTML Format','UnicodeText']}}}}));return;
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
  // Only the editor-side chord is verified here. Native hosts may reserve Ctrl+N
  // before an embedded page receives the event.
  await frame.evaluate(()=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'n',code:'KeyN',ctrlKey:true,bubbles:true,cancelable:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'t',code:'KeyT',bubbles:true,cancelable:true}));});
  const createDialog=frame.getByRole('dialog',{name:'표 만들기'});await createDialog.waitFor({state:'visible',timeout:5000});
  await createDialog.getByRole('button',{name:'취소'}).click();
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
   const pasteStatus=await frame.evaluate(()=>document.getElementById('pwh-status').textContent);assert.ok(!pasteStatus.includes('붙여넣기:'),pasteStatus);
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
  const borders=Object.fromEntries(['Left','Right','Top','Bottom'].map(side=>[side,{type:0,width:0,color:'#000000'}]));
  const titleTicket=await editorTableTitle({sessionId,expected:current.context,planId:plan.planId,tableIndex:0,title:'동물 소개',borders});const titleReceipt=await wait(titleTicket);assert.equal(titleReceipt.result.undoSteps,1);
  const titled=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));try{const ref=plan.tables[0].source;const dim=JSON.parse(titled.getTableDimensions(ref.sec,ref.ppi,ref.ci));assert.equal(dim.rowCount,12);assert.equal(JSON.parse(titled.getCellInfo(ref.sec,ref.ppi,ref.ci,0)).colSpan,3);assert.equal(titled.getTextInCell(ref.sec,ref.ppi,ref.ci,0,0,0,5),'동물 소개');assert.equal(titled.getTextInCell(ref.sec,ref.ppi,ref.ci,1,0,0,2),'동물');const props=JSON.parse(titled.getCellProperties(ref.sec,ref.ppi,ref.ci,0));for(const side of Object.keys(borders))assert.equal(props['border'+side].type,0);}finally{titled.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');for(let i=0;i<100;i++){const state=editorState({sessionId});if(state.context.documentState.changeSeq!==(titleReceipt.result.context?.documentState?.changeSeq))break;await pause(100);}
  // Select the first body cell through the actual rendered surface, then copy
  // with the real keyboard path. The source context locates a synthetic cell.
  const point=await frame.evaluate(()=>{
   for(let y=220;y<700;y+=7)for(let x=180;x<900;x+=13){const hit=window.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y});if(hit.position?.cellIndex===1)return{x:x+3,y:y+3};}
   return null;
  });assert.ok(point,'Rendered body cell found');
  const box=await page.locator('iframe').boundingBox();
  const second=await frame.evaluate(()=>{for(let y=220;y<700;y+=7)for(let x=180;x<900;x+=13){const hit=window.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y});if(hit.position?.cellIndex===2)return{x:x+3,y:y+3};}return null;});
  assert.ok(second,'Adjacent rendered cell found');
  await page.mouse.move(box.x+point.x,box.y+point.y);await page.mouse.down();await page.mouse.move(box.x+second.x,box.y+second.y,{steps:12});await page.mouse.up();
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).kind,'cell_block');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells.length,2,'Mouse drag selects both cells');
  // The physical keys belong to the selected cells, including in Korean IME
  // mode; opening the dialogs must not insert characters in the document.
  const beforeShortcuts=await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes));
  await page.keyboard.press('l');
  const borderDialog=frame.locator('.tcp-border-bg-dialog');
  await borderDialog.waitFor({state:'visible',timeout:5000});
  assert.equal(await borderDialog.locator('svg.pwh-border-preview line').count(),6);
  await frame.waitForFunction(()=>document.querySelector('.tcp-border-bg-dialog select[aria-label="선 종류"] option[value="6"]')?.textContent.includes('━━'));
  assert.match(await borderDialog.getByLabel('선 종류').locator('option[value="6"]').textContent(),/긴 파선.*━/);
  await borderDialog.getByLabel('선 종류').selectOption('6');
  await borderDialog.getByRole('button',{name:'안쪽',exact:true}).click();
  await borderDialog.getByLabel('선 색').click();const palette=frame.getByRole('dialog',{name:'색상 선택'});await palette.waitFor({state:'visible'});
  await palette.locator('.pwh-color-standards button[data-color="#ff0000"]').click();
  assert.equal(await borderDialog.locator('line[data-edge="insideVertical"]').getAttribute('stroke'),'#ff0000','Inside line preview follows selected color');
  assert.equal(await borderDialog.locator('line[data-edge="insideVertical"]').getAttribute('stroke-dasharray'),'12 4','Long dash preview matches the selected line');
  await borderDialog.locator('.dialog-tab[data-tab="background"]').click();
  await borderDialog.locator('.dialog-tab-panel[data-tab="background"] input[type="color"]').first().click();await palette.waitFor({state:'visible'});
  await palette.locator('.pwh-color-recents button[data-color="#ff0000"]').waitFor({state:'visible'});await page.keyboard.press('Escape');
  assert.equal(await palette.count(),0,'Escape closes the color menu without closing the parent dialog');
  await borderDialog.locator('.dialog-tab[data-tab="border"]').click();
  await borderDialog.locator('.dialog-footer button').filter({hasText:'설정'}).click();
  const borderApplied=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;const border=JSON.parse(borderApplied.getCellOwnProperties(ref.sec,ref.ppi,ref.ci,1)).borderRight;assert.equal(border.color.toLowerCase(),'#ff0000');assert.equal(border.type,6);}finally{borderApplied.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  await page.mouse.move(box.x+point.x,box.y+point.y);await page.mouse.down();await page.mouse.move(box.x+second.x,box.y+second.y,{steps:12});await page.mouse.up();
  await page.keyboard.press('l');await borderDialog.waitFor({state:'visible'});await borderDialog.locator('.dialog-tab[data-tab="background"]').click();
  const bgPanel=borderDialog.locator('.dialog-tab-panel[data-tab="background"]');await bgPanel.locator('input[type="color"]').first().click();
  await palette.getByLabel('색상 코드').fill('#ABCDEF');await palette.getByRole('button',{name:'적용',exact:true}).click();
  await bgPanel.locator('input[type="color"]').nth(1).click();await palette.locator('.pwh-color-recents button[data-color="#ff0000"]').click();await bgPanel.locator('select').selectOption('1');
  await borderDialog.locator('.dialog-footer button').filter({hasText:'설정'}).click();
  const filled=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;for(const index of [1,2]){const p=JSON.parse(filled.getCellOwnProperties(ref.sec,ref.ppi,ref.ci,index));assert.equal(p.fillColor.toLowerCase(),'#abcdef');assert.equal(p.patternColor.toLowerCase(),'#ff0000');assert.equal(p.patternType,1);}}finally{filled.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  await page.mouse.move(box.x+point.x,box.y+point.y);await page.mouse.down();await page.mouse.move(box.x+second.x,box.y+second.y,{steps:12});await page.mouse.up();
  await page.keyboard.press('l');await borderDialog.waitFor({state:'visible'});await borderDialog.locator('.dialog-tab[data-tab="diagonal"]').click();
  assert.equal(await borderDialog.locator('.tcp-diag-btn[data-kind="slash"]').count(),2,'Only clear and supported one-line diagonal are offered');
  assert.equal(await borderDialog.locator('.tcp-diag-btn[data-kind="backSlash"]').count(),2);
  await borderDialog.locator('.tcp-diag-btn[data-kind="slash"][data-bits="2"]').click();assert.equal(await borderDialog.locator('.tcp-diag-preview-svg line').count(),1);
  await borderDialog.locator('.dialog-footer button').filter({hasText:'설정'}).click();
  const diagonal=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;for(const index of [1,2]){const p=JSON.parse(diagonal.getCellOwnProperties(ref.sec,ref.ppi,ref.ci,index));assert.equal(p.diagonalSlash,2);assert.equal(p.diagonalLine,1);}}finally{diagonal.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  await page.mouse.move(box.x+point.x,box.y+point.y);await page.mouse.down();await page.mouse.move(box.x+second.x,box.y+second.y,{steps:12});await page.mouse.up();
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).kind,'cell_block');
  await page.keyboard.press('c');
  const cellDialog=frame.locator('.modal-overlay .tcp-dialog');await cellDialog.waitFor({state:'visible',timeout:5000});
  await cellDialog.locator('.dialog-tab-panel.active').getByRole('button',{name:'아래쪽',exact:true}).click();
  await cellDialog.locator('.dialog-btn-primary').click();
  const cellApplied=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;for(const index of [1,2])assert.equal(JSON.parse(cellApplied.getCellProperties(ref.sec,ref.ppi,ref.ci,index)).verticalAlign,2,'Cell properties apply to each selected cell');}finally{cellApplied.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  assert.deepEqual(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes)),beforeShortcuts);
  await page.mouse.move(box.x+point.x,box.y+point.y);await page.mouse.down();await page.mouse.move(box.x+second.x,box.y+second.y,{steps:12});await page.mouse.up();
  const consumed=await frame.evaluate(()=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');const e=new KeyboardEvent('keydown',{key:'Process',code:'KeyL',keyCode:229,isComposing:true,bubbles:true,cancelable:true});return !input.dispatchEvent(e);});
  assert.ok(consumed,'Korean IME physical L is consumed');await borderDialog.waitFor({state:'visible'});
  await frame.evaluate(()=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'ㅣ',inputType:'insertCompositionText',isComposing:true}));input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'ㅣ'}));});
  await borderDialog.locator('.dialog-footer button').filter({hasText:'취소'}).click();
  assert.deepEqual(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes)),beforeShortcuts,'IME follow-up must not type into the document');
  await page.mouse.move(box.x+point.x,box.y+point.y);await page.mouse.down();await page.mouse.move(box.x+second.x,box.y+second.y,{steps:12});await page.mouse.up();
  await page.mouse.click(box.x+second.x,box.y+second.y,{button:'right'});
  const contextMenu=frame.locator('.context-menu');await contextMenu.waitFor({state:'visible'});
  const menuText=await contextMenu.innerText();assert.ok(menuText.indexOf('셀 속성')<menuText.indexOf('셀 테두리/배경(L)'),menuText);
  await contextMenu.getByText('셀 테두리/배경(L)...',{exact:true}).click();
  await borderDialog.waitFor({state:'visible'});await borderDialog.locator('.dialog-footer button').filter({hasText:'취소'}).click();
  await page.mouse.click(box.x+point.x,box.y+point.y);await page.keyboard.press('F5');
  await page.keyboard.press('F5');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells.length,3,'whole row selected');
  await page.keyboard.press('Delete');
  await frame.getByRole('alertdialog').getByRole('button',{name:'선택한 줄 지우기'}).click({timeout:5000});
  const rowDeleted=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;assert.equal(JSON.parse(rowDeleted.getTableDimensions(ref.sec,ref.ppi,ref.ci)).rowCount,10);assert.equal(rowDeleted.getTextInCell(ref.sec,ref.ppi,ref.ci,1,0,0,1),'양');}finally{rowDeleted.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  const restoredRow=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;assert.equal(JSON.parse(restoredRow.getTableDimensions(ref.sec,ref.ppi,ref.ci)).rowCount,11);assert.equal(restoredRow.getTextInCell(ref.sec,ref.ppi,ref.ci,1,0,0,1),'말');}finally{restoredRow.free();}
  await page.keyboard.press('Escape');await page.mouse.click(box.x+point.x,box.y+point.y);await page.keyboard.press('F5');
  await page.keyboard.press('ArrowUp');
  assert.deepEqual((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells.map(c=>c.cellIndex),[0]);
  await page.keyboard.press('Delete');
  await frame.getByRole('alertdialog').getByRole('button',{name:'선택한 줄 지우기'}).click({timeout:5000});
  const mergedRowDeleted=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;assert.equal(JSON.parse(mergedRowDeleted.getTableDimensions(ref.sec,ref.ppi,ref.ci)).rowCount,10);assert.equal(mergedRowDeleted.getTextInCell(ref.sec,ref.ppi,ref.ci,0,0,0,1),'말');}finally{mergedRowDeleted.free();}
  await page.keyboard.press('Escape');await pause(800);
  const firstCell=await frame.evaluate(()=>{for(let y=220;y<700;y+=7)for(let x=180;x<900;x+=13){const a=window.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y});if(a.position?.cellIndex===3)return{x:x+3,y:y+3};}return null;});
  assert.ok(firstCell,'first column cell after deleting merged row');
  await page.mouse.click(box.x+firstCell.x,box.y+firstCell.y);await page.keyboard.press('F5');await page.keyboard.press('ArrowUp');await page.keyboard.press('F5');
  for(let i=0;i<9;i++)await page.keyboard.press('ArrowDown');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells.length,10,'whole column selected');
  await page.keyboard.press('Delete');
  await frame.getByRole('alertdialog').getByRole('button',{name:'선택한 칸 지우기'}).click({timeout:5000});
  const colDeleted=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;const dim=JSON.parse(colDeleted.getTableDimensions(ref.sec,ref.ppi,ref.ci));assert.equal(dim.colCount,2);assert.equal(dim.rowCount,10);assert.equal(colDeleted.getTextInCell(ref.sec,ref.ppi,ref.ci,0,0,0,1),'소');}finally{colDeleted.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  const colRestored=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;assert.equal(JSON.parse(colRestored.getTableDimensions(ref.sec,ref.ppi,ref.ci)).colCount,3);assert.equal(colRestored.getTextInCell(ref.sec,ref.ppi,ref.ci,0,0,0,1),'말');}finally{colRestored.free();}
  await page.keyboard.press('Escape');await page.mouse.click(box.x+firstCell.x,box.y+firstCell.y);await page.keyboard.press('F5');await page.keyboard.press('ArrowUp');await page.keyboard.press('F5');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells.length,6,'two complete rows selected');
  await page.keyboard.press('Delete');await frame.getByRole('alertdialog').getByRole('button',{name:'선택한 줄 지우기'}).click({timeout:5000});
  const twoRowsDeleted=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;assert.equal(JSON.parse(twoRowsDeleted.getTableDimensions(ref.sec,ref.ppi,ref.ci)).rowCount,8);assert.equal(twoRowsDeleted.getTextInCell(ref.sec,ref.ppi,ref.ci,0,0,0,1),'오');}finally{twoRowsDeleted.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  await page.keyboard.press('Escape');await page.mouse.click(box.x+firstCell.x,box.y+firstCell.y);await page.keyboard.press('F5');await page.keyboard.press('ArrowUp');await page.keyboard.press('F5');
  await page.keyboard.press('ArrowRight');for(let i=0;i<9;i++)await page.keyboard.press('ArrowDown');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells.length,20,'two complete columns selected');
  await page.keyboard.press('Delete');await frame.getByRole('alertdialog').getByRole('button',{name:'선택한 칸 지우기'}).click({timeout:5000});
  const twoColsDeleted=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;assert.equal(JSON.parse(twoColsDeleted.getTableDimensions(ref.sec,ref.ppi,ref.ci)).colCount,1);assert.equal(twoColsDeleted.getTextInCell(ref.sec,ref.ppi,ref.ci,0,0,0,1),'돼');}finally{twoColsDeleted.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  await page.keyboard.press('Escape');await page.mouse.click(box.x+point.x,box.y+point.y);await page.keyboard.press('F5');
  await page.keyboard.press('Delete');
  await frame.getByRole('alertdialog').getByRole('button',{name:'취소'}).click();
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).kind,'cell_block','cancel retains cell selection');
  await page.keyboard.press('Delete');
  await frame.getByRole('alertdialog').getByRole('button',{name:'내용만 지우기'}).click();
  const cleared=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source;assert.equal(cleared.getTextInCell(ref.sec,ref.ppi,ref.ci,1,0,0,1),'');}finally{cleared.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');
  await pause(300);
  await page.keyboard.press('Control+c');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells.length,1,'Ctrl+C must preserve the selected cell block');
  const copied=await frame.evaluate(()=>{const data=new DataTransfer();document.querySelector('[aria-label="문서 편집 입력"]').dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return{html:data.getData('text/html'),text:data.getData('text/plain')};});
  assert.equal(copied.text,'말');assert.equal((copied.html.match(/<td /g)||[]).length,1,'Copy must exclude the other 30 cells');
  await page.keyboard.press('Escape');
  const destination=await frame.evaluate(()=>{for(let y=220;y<700;y+=7)for(let x=180;x<900;x+=13){const hit=window.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y});if(hit.position?.cellIndex===2)return{x:x+3,y:y+3};}return null;});assert.ok(destination);await page.mouse.click(box.x+destination.x,box.y+destination.y);
  // Paste that one-cell HTML into another existing cell, preserving its table.
  await page.keyboard.press('F5');await page.keyboard.press('Control+v');
  await frame.getByRole('dialog',{name:'셀 붙이기'}).getByRole('button',{name:'기존 셀에 붙이기'}).click({timeout:5000});
  await pause(200);
  assert.ok((await frame.evaluate(()=>document.getElementById('pwh-status').textContent)).includes('완료'));
  const cellPaste=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));try{const ref=plan.tables[0].source;assert.equal(JSON.parse(cellPaste.getTableDimensions(ref.sec,ref.ppi,ref.ci)).cellCount,31);assert.equal(cellPaste.getTextInCell(ref.sec,ref.ppi,ref.ci,2,0,0,1),'말');}finally{cellPaste.free();}
  // The cell paste is a single undo, so the following existing tool test still
  // starts at the original document state and the inspected plan remains valid.
  await page.keyboard.press('Control+z');
  for(let i=0;i<100;i++){const fresh=await frame.evaluate(()=>window.pwhEditor.context());if(fresh.documentState.changeSeq===editorState({sessionId}).context.documentState.changeSeq)break;await pause(100);}
  await page.keyboard.press('Escape');await page.mouse.click(box.x+destination.x,box.y+destination.y);
  await frame.evaluate(({html,text})=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');input.focus();const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',text);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},copied);
  await frame.getByRole('dialog',{name:'셀 붙이기'}).getByRole('button',{name:'셀 안에 표로 넣기'}).click({timeout:5000});await pause(500);
  const htmlNested=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source,path=[{controlIndex:ref.ci,cellIndex:2,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}];assert.equal(JSON.parse(htmlNested.getTableDimensionsByPath(ref.sec,ref.ppi,JSON.stringify(path))).cellCount,1);assert.equal(htmlNested.getTextInCellByPath(ref.sec,ref.ppi,JSON.stringify(path),0,1),'말');}finally{htmlNested.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  await page.mouse.click(box.x+destination.x,box.y+destination.y);await page.keyboard.press('F5');
  assert.equal(nativeReads,0,'Do not read the OS clipboard in the background');
  await frame.getByRole('button',{name:'한글 표·셀 가져오기'}).click();
  await frame.getByRole('dialog',{name:'셀 붙이기'}).getByRole('button',{name:'기존 셀에 붙이기'}).click({timeout:5000});
  await frame.locator('#pwh-status').filter({hasText:'한글 표·셀을 가져왔습니다.'}).waitFor();assert.equal(nativeReads,1);
  const nativePaste=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));try{const ref=plan.tables[0].source;assert.equal(nativePaste.getCellParagraphCount(ref.sec,ref.ppi,ref.ci,2),2);assert.equal(nativePaste.getTextInCell(ref.sec,ref.ppi,ref.ci,2,1,0,3),'민들레');}finally{nativePaste.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');
  for(let i=0;i<100;i++){const fresh=await frame.evaluate(()=>window.pwhEditor.context());if(fresh.documentState.changeSeq===editorState({sessionId}).context.documentState.changeSeq)break;await pause(100);}
  if(process.env.PWH_HANCOM_CLIPBOARD){
   const copied=JSON.parse((await fs.readFile(process.env.PWH_HANCOM_CLIPBOARD,'utf8')).replace(/^\uFEFF/,''));
   await page.keyboard.press('Escape');await page.mouse.click(box.x+destination.x,box.y+destination.y);
   await frame.evaluate(({html,text})=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');input.focus();const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',text);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},copied);
   const dialog=frame.getByRole('dialog',{name:'셀 붙이기'});await dialog.getByRole('button',{name:'취소'}).click({timeout:5000});
   const cancelled=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{assert.equal(JSON.parse(cancelled.getControls()).filter(c=>c.ctrlId==='tbl').length,1,'cancel changes nothing');}finally{cancelled.free();}
   await frame.evaluate(({html,text})=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');input.focus();const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',text);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},copied);
   await dialog.getByRole('button',{name:'셀 안에 표로 넣기'}).click({timeout:5000});
   await pause(1000);const nestedStatus=await frame.evaluate(()=>document.getElementById('pwh-status').textContent);assert.ok(nestedStatus.includes('셀 안에 표를 넣었습니다.'),nestedStatus);
   const nestedResult=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{
    const ref=plan.tables[0].source,path=[{controlIndex:ref.ci,cellIndex:2,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}];
    const dimensions=JSON.parse(nestedResult.getTableDimensionsByPath(ref.sec,ref.ppi,JSON.stringify(path)));
    assert.ok(dimensions.rowCount>0&&dimensions.colCount>0,'pasted table remains structured');
    assert.equal(nestedResult.getTextInCell(ref.sec,ref.ppi,ref.ci,2,0,0,1),'소','original target text remains');
   }finally{nestedResult.free();}
   assert.equal(await frame.evaluate(()=>document.querySelector('[data-cmd="view:toggle-clip"]').classList.contains('active')),false,'pasted nested content is clipped to its outer cell');
   if(process.env.PWH_NESTED_SCREENSHOT)await page.screenshot({path:process.env.PWH_NESTED_SCREENSHOT});
   const nestedPoint=await frame.evaluate(()=>{for(let y=300;y<780;y+=4)for(let x=350;x<680;x+=4){const hit=window.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y});if((hit.position?.cellPath?.length||0)>1)return{x:x+1,y:y+1};}return null;});
   assert.ok(nestedPoint,'a visible nested cell can be hit');await page.mouse.click(box.x+nestedPoint.x,box.y+nestedPoint.y);
   const nestedCursor=await frame.evaluate(()=>window.pwhEditor.context().cursor);assert.ok(nestedCursor.cellPath?.length>1,'click enters the nested cell');
   const textBefore=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   let priorLength;try{priorLength=textBefore.getCellParagraphLengthByPath(nestedCursor.sectionIndex,nestedCursor.parentParaIndex,JSON.stringify(nestedCursor.cellPath));}finally{textBefore.free();}
   await page.keyboard.type('Z');await pause(300);
   const textEdited=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{assert.equal(textEdited.getCellParagraphLengthByPath(nestedCursor.sectionIndex,nestedCursor.parentParaIndex,JSON.stringify(nestedCursor.cellPath)),priorLength+1,'nested cell is editable');}finally{textEdited.free();}
   await page.keyboard.press('Control+z');await pause(300);
   const widthBeforeDoc=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   let widthBefore;try{widthBefore=JSON.parse(widthBeforeDoc.getCellPropertiesByPath(nestedCursor.sectionIndex,nestedCursor.parentParaIndex,JSON.stringify(nestedCursor.cellPath),nestedCursor.cellPath.at(-1).cellIndex)).width;}finally{widthBeforeDoc.free();}
   await page.keyboard.press('F5');await page.keyboard.press('Control+ArrowLeft');await pause(300);
   const resizedDoc=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{assert.notEqual(JSON.parse(resizedDoc.getCellPropertiesByPath(nestedCursor.sectionIndex,nestedCursor.parentParaIndex,JSON.stringify(nestedCursor.cellPath),nestedCursor.cellPath.at(-1).cellIndex)).width,widthBefore,'nested cell width can be adjusted');}finally{resizedDoc.free();}
   await page.keyboard.press('Control+z');await page.keyboard.press('Escape');await pause(300);
   await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
   const undone=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{assert.equal(JSON.parse(undone.getControls()).filter(c=>c.ctrlId==='tbl').length,1,'one undo removes the pasted table');}finally{undone.free();}
   nativeFixture=copied;
   await page.keyboard.press('Escape');await page.mouse.click(box.x+destination.x,box.y+destination.y);
   await frame.getByRole('button',{name:'한글 표·셀 가져오기'}).click();
   await frame.getByRole('dialog',{name:'셀 붙이기'}).getByRole('button',{name:'셀 안에 표로 넣기'}).click({timeout:5000});
   await pause(1000);const nativeStatus=await frame.evaluate(()=>document.getElementById('pwh-status').textContent);assert.ok(nativeStatus.includes('셀 안에 표를 넣었습니다.'),nativeStatus);
   const nativeNested=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{assert.ok(JSON.parse(nativeNested.getControls()).filter(c=>c.ctrlId==='tbl').length>=2,'native Hancom clipboard adds the table');}finally{nativeNested.free();}
   await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);nativeFixture=null;
  }
  await page.keyboard.press('Escape');await page.mouse.click(box.x+point.x,box.y+point.y);await page.keyboard.press('F5');await page.keyboard.press('F5');await page.keyboard.press('F5');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells.length,31,'entire original table selected');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Escape');await page.mouse.click(box.x+destination.x,box.y+destination.y);await page.keyboard.press('Control+v');
  await frame.getByRole('dialog',{name:'셀 붙이기'}).getByRole('button',{name:'셀 안에 표로 넣기'}).click({timeout:5000});
  await pause(1000);const ownStatus=await frame.evaluate(()=>document.getElementById('pwh-status').textContent);assert.ok(ownStatus.includes('셀 안에 표를 넣었습니다.'),ownStatus);
  const ownNested=new HwpDocument(Uint8Array.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{const ref=plan.tables[0].source,path=[{controlIndex:ref.ci,cellIndex:2,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}];const d=JSON.parse(ownNested.getTableDimensionsByPath(ref.sec,ref.ppi,JSON.stringify(path)));assert.equal(d.rowCount,11);assert.equal(d.colCount,3);assert.equal(d.cellCount,31);assert.equal(JSON.parse(ownNested.getCellInfoByPath(ref.sec,ref.ppi,JSON.stringify(path))).colSpan,3);}finally{ownNested.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
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
