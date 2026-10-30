import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('many-page cell selection carries page hints and editing avoids whole-document font rendering',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop, browser and core paths':false,timeout:180000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-many-page-')),file=path.join(dir,'synthetic.hwpx');
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();const ok=json=>{const value=JSON.parse(json);assert.equal(value.ok,true);return value;};
 for(let i=0;i<12;i++){
  if(i)ok(doc.insertParagraph(0,i));
  ok(doc.applyParaFormat(0,i,JSON.stringify({pageBreakBefore:i>0})));
  const table=ok(doc.createTable(0,i,0,2,2));
  for(let cell=0;cell<4;cell++)ok(doc.insertTextInCell(0,table.paraIdx,table.controlIdx,cell,0,0,'선택 단어 테스트'));
 }
 assert.ok(JSON.parse(doc.getDocumentInfo()).pageCount>=10,'fixture spans many pages');await fs.writeFile(file,doc.exportHwpx());doc.free();
 process.env.PWH_STANDALONE_DATA=path.join(dir,'data');process.env.PWH_FONT_ROOT=path.join(dir,'fonts');
 const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));const server=await createAppServer({initialPath:file});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1250,height:900}});await page.goto(server.url);
  const editor=page.frames().find(frame=>/\/editor\?/.test(frame.url()));assert.ok(editor);await editor.waitForFunction(()=>window.pwhRecoveryReady?.()===true,null,{timeout:120000});
  const box=await page.locator('#editor').boundingBox();
  const point=await editor.evaluate(()=>{for(let y=190;y<650;y+=4)for(let x=150;x<1050;x+=4){if(!document.elementFromPoint(x,y)?.closest('#scroll-content'))continue;const hit=window.rhwpStudio.collaboration.hitTest({clientX:x,clientY:y}),p=hit.position,r=p?.cursorRect;if(p?.parentParaIndex!==undefined&&p.charOffset===1&&r&&hit.y>r.y+3&&hit.y<r.y+r.height-3)return{x,y};}return null;});assert.ok(point);
  await editor.evaluate(()=>{const w=window.rhwpStudio.plugins.deps.wasm;window.__perf={trees:0,inventory:0,queries:[]};for(const name of ['getPageLayerTreeObject','getDocumentInfo','getSelectionRectsInCell','getSelectionRectsInCellByPath']){const original=w[name];w[name]=function(...args){if(name==='getPageLayerTreeObject')window.__perf.trees++;else if(name==='getDocumentInfo')window.__perf.inventory++;else window.__perf.queries.push(args.at(-1));return original.apply(this,args);};}});
  await page.mouse.click(box.x+point.x,box.y+point.y);await page.mouse.dblclick(box.x+point.x,box.y+point.y);let context=await editor.evaluate(()=>window.pwhEditor.context());if(process.env.PWH_PERF_DEBUG)console.log(point,{kind:context.kind,selected:context.selectedText.text});assert.equal(context.selectedText.text,'선택');
  let perf=await editor.evaluate(()=>window.__perf);assert.ok(perf.queries.length>=1);for(const hint of perf.queries)assert.ok(Number.isInteger(hint?.startPageHint)&&Number.isInteger(hint?.endPageHint),'every cell rectangle query is scoped to exact endpoint pages');
  await page.keyboard.press('ArrowRight');const before=await editor.evaluate(()=>window.pwhEditor.context().paragraph.text);
  await page.keyboard.type('X');assert.notEqual(await editor.evaluate(()=>window.pwhEditor.context().paragraph.text),before);await page.keyboard.press('Control+z');assert.equal(await editor.evaluate(()=>window.pwhEditor.context().paragraph.text),before);
  perf=await editor.evaluate(()=>window.__perf);assert.ok(perf.inventory>0,'test exercises actual host font preparation');assert.equal(perf.trees,0,'font preparation never builds every page to discover font families');
 }finally{await browser.close();await new Promise(resolve=>server.server.close(resolve));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
