import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {groupedTextboxFixture} from './helpers/grouped-textbox-fixture.mjs';

test('trusted group text entry and inline table range delete retain undo and bounded carets',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT,timeout:180000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const fixture=groupedTextboxFixture(core),work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-inline-object-'));
 process.env.PWH_STANDALONE_DATA=path.join(work,'profile');
 const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
 const app=await createAppServer({initialBytes:fixture.bytes});
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
  await page.waitForFunction(()=>document.querySelector('#editor')?.contentWindow?.pwhRecoveryReady?.()===true,null,{timeout:90000});
  const frame=page.frames().find(f=>f.url().includes('/editor?'));assert.ok(frame);
  const group=fixture.group;
  const point=await frame.evaluate(({paraIdx,controlIdx})=>{
   const ih=window.rhwpStudio.plugins.deps.getInputHandler(),b=ih.wasm.getShapeBBox(0,paraIdx,controlIdx),s=ih.container.querySelector('#scroll-content'),sr=s.getBoundingClientRect(),fr=window.frameElement.getBoundingClientRect(),z=ih.viewportManager.getZoom();
   window.__inlineObjectKeys=[];ih.textarea.addEventListener('keydown',e=>window.__inlineObjectKeys.push({key:e.key,trusted:e.isTrusted}));
   return {x:fr.x+sr.x+ih.virtualScroll.getPageLeftResolved(0,s.clientWidth)+(b.x+30)*z,y:fr.y+sr.y+ih.virtualScroll.getPageOffset(0)+(b.y+15)*z};
  },group);
  await page.mouse.click(point.x,point.y);await page.mouse.click(point.x,point.y);
  const text=()=>frame.evaluate(({paraIdx,controlIdx})=>window.rhwpStudio.plugins.deps.wasm.getTextInCell(0,paraIdx,controlIdx,0,0,0,100),group);
  assert.equal(await frame.evaluate(()=>window.rhwpStudio.plugins.deps.getInputHandler().cursor.isInTextBox()),true);
  const original=await text();await page.keyboard.type('X');assert.equal((await text()).length,original.length+1);await page.keyboard.press('Control+z');assert.equal(await text(),original);await page.keyboard.press('Control+Shift+z');assert.equal((await text()).length,original.length+1);await page.keyboard.press('Control+z');
  const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();const t=JSON.parse(doc.createTable(0,0,0,2,2));doc.setTableProperties(0,t.paraIdx,t.controlIdx,JSON.stringify({treatAsChar:true}));doc.insertTextInCell(0,t.paraIdx,t.controlIdx,0,0,0,'Synthetic table');const bytes=[...doc.exportHwpx()];doc.free();
  await frame.evaluate(b=>window.pwhEditor.load(new Uint8Array(b),'TEST-inline-table.hwpx'),bytes);
  const edge=await frame.evaluate(()=>{const ih=window.rhwpStudio.plugins.deps.getInputHandler(),t=ih.wasm.getPageControlLayout(0).controls.find(c=>c.type==='table'),s=ih.container.querySelector('#scroll-content'),sr=s.getBoundingClientRect(),fr=window.frameElement.getBoundingClientRect(),z=ih.viewportManager.getZoom();return {x:fr.x+sr.x+ih.virtualScroll.getPageLeftResolved(0,s.clientWidth)+t.x*z-4,y:fr.y+sr.y+ih.virtualScroll.getPageOffset(0)+(t.y+t.h/2)*z};});
  await page.mouse.click(edge.x,edge.y);await page.keyboard.press('Shift+End');
  const range=await frame.evaluate(()=>{const c=window.rhwpStudio.plugins.deps.getInputHandler().cursor;return {selection:c.getSelection(),rect:c.getRect()};});assert.equal(range.selection.anchor.bodyCursor.logicalOffset,0);assert.equal(range.selection.focus.bodyCursor.logicalOffset,1);assert.ok(range.rect.height<30);
  const count=()=>frame.evaluate(()=>window.rhwpStudio.plugins.deps.wasm.getPageControlLayout(0).controls.filter(c=>c.type==='table').length);
  await page.keyboard.press('Delete');assert.equal(await count(),0);await page.keyboard.press('Control+z');assert.equal(await count(),1);
  assert.ok((await frame.evaluate(()=>window.__inlineObjectKeys)).every(e=>e.trusted));assert.deepEqual(errors,[]);
 }finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
});
