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
import {extractHancomTableModel} from '../src/nested-table-paste.mjs';

test('Hancom table pasted into a Hancom-imported final paragraph provides visible feedback and undo',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_HANCOM_TARGET?'Set browser, WASM and an explicitly authorized clipboard fixture':false,timeout:90000,
},async()=>{
 const copied=JSON.parse((await fs.readFile(process.env.PWH_HANCOM_TARGET,'utf8')).replace(/^\uFEFF/,'')),model=extractHancomTableModel(copied.html);assert.ok(model);
 const nestedCopied=process.env.PWH_HANCOM_CLIPBOARD?JSON.parse((await fs.readFile(process.env.PWH_HANCOM_CLIPBOARD,'utf8')).replace(/^\uFEFF/,'')):copied;
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-hancom-cell-')),filename=path.join(tmp,'synthetic.hwpx');
 const target=HwpDocument.createEmpty();target.createBlankDocument();assert.equal(JSON.parse(target.pasteHwpJson(0,0,0,model)).ok,true);
 const src=JSON.parse(target.getControls()).find(c=>c.ctrlId==='tbl'&&c.list===0);assert.ok(src);assert.equal(target.getParagraphCount(0),1,'source table is anchored in last paragraph');
 const dimensions=JSON.parse(target.getTableDimensions(0,src.para,src.controlIndex)),originalCells=Array.from({length:dimensions.cellCount},(_,i)=>{
  const count=target.getCellParagraphCount(0,src.para,src.controlIndex,i);return Array.from({length:count},(_,p)=>{const len=target.getCellParagraphLength(0,src.para,src.controlIndex,i,p);return target.getTextInCell(0,src.para,src.controlIndex,i,p,0,len);});
 });
 const len=target.getCellParagraphLength(0,src.para,src.controlIndex,0,0),original=originalCells[0][0];
 if(len)target.deleteTextInCell(0,src.para,src.controlIndex,0,0,0,len);target.insertTextInCell(0,src.para,src.controlIndex,0,0,0,'X');
 await fs.writeFile(filename,target.exportHwpx());target.free();
 const registered=await registerClientDocument(filename),html=await clientViewerHtml();let sessionId;
 const server=createServer(async(req,res)=>{try{
  if(req.url==='/editor'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(req.url==='/rpc'){let body='';for await(const part of req)body+=part;const request=JSON.parse(body);if(request.params?.name==='pwh_editor_poll')sessionId=request.params.arguments.sessionId;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await handleRequest(request)));return;}
  res.setHeader('Content-Type','text/html');res.end(`<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe src="/editor"></iframe><script>addEventListener('message',async e=>{const m=e.data;if(m?.jsonrpc!=='2.0')return;if(m.method==='ui/notifications/initialized'){e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(registered)}}},location.origin);return;}if(m.id===undefined)return;const r=m.method==='ui/initialize'?{jsonrpc:'2.0',id:m.id,result:{hostCapabilities:{}}}:await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();e.source.postMessage(r,location.origin);});</script>`);
 }catch(error){res.statusCode=500;res.end(String(error.stack));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:620,height:900}});await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame=page.frames().find(f=>f.url().endsWith('/editor'));for(let i=0;i<400&&!sessionId;i++)await pause(100);assert.ok(sessionId);
  const box=await page.locator('iframe').boundingBox();
  const select=async cell=>{const point=await frame.evaluate(cell=>{for(let y=150;y<790;y+=5)for(let x=5;x<600;x+=5){const at=(dx,dy)=>window.rhwpStudio.collaboration.hitTest({clientX:x+dx,clientY:y+dy}).position?.cellIndex;if(at(0,0)===cell&&at(8,0)===cell&&at(0,8)===cell&&at(8,8)===cell)return{x:x+4,y:y+4};}return null;},cell);assert.ok(point,`cell ${cell} visible`);await page.mouse.click(box.x+point.x,box.y+point.y);if((await frame.evaluate(()=>window.pwhEditor.context())).kind==='table_object')await page.mouse.click(box.x+point.x,box.y+point.y);};
  const paste=async(choice,fixture=copied)=>{await frame.evaluate(({html,text})=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');input.focus();const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',text);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},fixture);await frame.getByRole('dialog',{name:'셀 붙이기'}).getByRole('button',{name:choice}).click({timeout:5000});};
  const exported=async()=>Buffer.from(await frame.evaluate(()=>Array.from(window.pwhEditor.export().bytes)));
  await select(13);const before=createHash('sha256').update(await exported()).digest('hex');await paste('기존 셀에 붙이기');
  await frame.locator('#rhwp-toast-container').getByText('복사한 표가 대상 표의 바깥으로 벗어납니다.',{exact:false}).waitFor({timeout:10000});
  assert.equal(createHash('sha256').update(await exported()).digest('hex'),before,'failed overwrite leaves document intact');
  await select(13);await paste('셀 안에 표로 넣기',nestedCopied);await frame.locator('#rhwp-toast-container').getByText('셀 안에 표를 넣었습니다.',{exact:false}).waitFor({timeout:10000});
  const nested=new HwpDocument(await exported());try{const p=[{controlIndex:src.controlIndex,cellIndex:13,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}];const dims=JSON.parse(nested.getTableDimensionsByPath(0,src.para,JSON.stringify(p)));assert.equal(dims.rowCount,5);assert.equal(dims.colCount,3);}finally{nested.free();}
  await frame.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');await pause(300);
  await page.keyboard.press('F5');for(let i=0;i<4;i++)await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowLeft');
  assert.equal((await frame.evaluate(()=>window.pwhEditor.context())).table.selectedCells[0].cellIndex,0,'first cell selected as overwrite anchor');await paste('기존 셀에 붙이기');
  await pause(1000);const lastStatus=await frame.evaluate(()=>document.getElementById('pwh-status').textContent);assert.ok(lastStatus.includes('표·셀 붙여넣기를 완료했습니다.'),lastStatus);
  const overwritten=new HwpDocument(await exported());try{
   assert.equal(overwritten.getTextInCell(0,src.para,src.controlIndex,0,0,0,Array.from(original).length),original);
   for(let i=0;i<originalCells.length;i++){const count=overwritten.getCellParagraphCount(0,src.para,src.controlIndex,i);assert.equal(count,originalCells[i].length);for(let p=0;p<count;p++){const n=overwritten.getCellParagraphLength(0,src.para,src.controlIndex,i,p);assert.equal(overwritten.getTextInCell(0,src.para,src.controlIndex,i,p,0,n),originalCells[i][p]);}}
  }finally{overwritten.free();}
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fs.rm(tmp,{recursive:true,force:true});}
});
