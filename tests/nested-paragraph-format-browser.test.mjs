import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nestedPropertiesFixture,requireOk} from './helpers/nested-properties-fixture.mjs';

test('trusted nested paragraph keys/dialog and picture deletion preserve ancestors, styles and undo',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT,timeout:180000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const {doc,outer,rootPath,innerPath,deepPath}=nestedPropertiesFixture(core.HwpDocument);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');
 requireOk(doc.insertText(0,1,0,'ABCD'));requireOk(doc.applyCharFormat(0,1,0,2,JSON.stringify({bold:true})));
 const picture=requireOk(doc.insertPicture(0,1,2,'[]',png,4000,3000,1,1,'png','synthetic'));
 const bytes=Buffer.from(doc.exportHwpx());doc.free();assert.equal(bytes.subarray(0,2).toString(),'PK');
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-upstream-format-'));process.env.PWH_STANDALONE_DATA=path.join(work,'profile');
 const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));const app=await createAppServer({initialBytes:bytes});
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
  await page.waitForFunction(()=>document.querySelector('#editor')?.contentWindow?.pwhRecoveryReady?.()===true,null,{timeout:90000});
  const frame=page.frames().find(f=>f.url().includes('/editor?'));
  const state=()=>frame.evaluate(({ppi,paths})=>{
   const w=window.rhwpStudio.plugins.deps.wasm;
   return {props:paths.map(p=>w.getCellParaPropertiesAtByPath(0,ppi,JSON.stringify(p))),bytes:Array.from(window.pwhEditor.export().bytes)};
  },{ppi:outer.paraIdx,paths:[rootPath,innerPath,deepPath]});
  await frame.evaluate(()=>{const ih=window.rhwpStudio.plugins.deps.getInputHandler();window.__upstreamKeys=[];ih.textarea.addEventListener('keydown',e=>window.__upstreamKeys.push({key:e.key,trusted:e.isTrusted}));});
  for(const target of [innerPath,deepPath]) {
   await frame.evaluate(({ppi,path})=>{
    const ih=window.rhwpStudio.plugins.deps.getInputHandler(),first=path[0];ih.cursor.exitCellSelectionMode();ih.cursor.clearSelection();
    ih.cursor.moveTo({sectionIndex:0,paragraphIndex:0,parentParaIndex:ppi,controlIndex:first.controlIndex,cellIndex:first.cellIndex,cellParaIndex:first.cellParaIndex,charOffset:0,cellPath:path});ih.active=true;ih.updateCaret();ih.textarea.focus();
   },{ppi:outer.paraIdx,path:target});
   const before=await state(),index=target.length===2?1:2;
   await page.keyboard.press('F5');await page.keyboard.press('Control+Shift+c');
   assert.equal((await state()).props[index].alignment,'center');
   await page.keyboard.press('Control+z');assert.deepEqual((await state()).props,before.props);
   await page.keyboard.press('Control+Shift+z');assert.equal((await state()).props[index].alignment,'center');
   await page.keyboard.press('Alt+t');await frame.locator('.ps-dialog').waitFor({state:'visible'});
   await frame.getByRole('spinbutton',{name:'문단 위 간격(pt)'}).fill('20');await frame.locator('.ps-dialog .dialog-btn-primary').click();
   const changed=await state();assert.ok(changed.props[index].spacingBefore>before.props[index].spacingBefore);
   for(const key of ['borderLeft','borderRight','borderTop','borderBottom'])assert.deepEqual(changed.props[index][key],before.props[index][key]);
   assert.deepEqual(changed.props[0],before.props[0],'containing table paragraph remains unchanged');
   await page.keyboard.press('Control+z');assert.equal((await state()).props[index].alignment,'center');
   await page.keyboard.press('Control+z');assert.deepEqual((await state()).props,before.props);
  }
  await frame.evaluate(ci=>{const ih=window.rhwpStudio.plugins.deps.getInputHandler();ih.cursor.exitCellSelectionMode();ih.cursor.clearSelection();ih.selectPictureObject(0,1,ci,'image');ih.textarea.focus();},picture.controlIdx);
  const style=()=>frame.evaluate(()=>{const d=window.rhwpStudio.plugins.deps.wasm.doc;return [...'ABCD'].map((_,i)=>JSON.parse(d.getCharPropertiesAt(0,1,i)).bold);});
  const controlCount=()=>frame.evaluate(()=>JSON.parse(window.rhwpStudio.plugins.deps.wasm.doc.getControls()).length),beforeDelete=await controlCount();
  await page.keyboard.press('Delete');assert.equal(await controlCount(),beforeDelete-1);assert.deepEqual(await style(),[true,true,false,false]);
  await page.keyboard.press('Control+z');assert.equal(await controlCount(),beforeDelete);assert.deepEqual(await style(),[true,true,false,false]);
  await page.keyboard.press('Control+Shift+z');assert.equal(await controlCount(),beforeDelete-1);assert.deepEqual(await style(),[true,true,false,false]);
  const final=await state(),reopened=new core.HwpDocument(Uint8Array.from(final.bytes));
  try {assert.deepEqual([... 'ABCD'].map((_,i)=>JSON.parse(reopened.getCharPropertiesAt(0,1,i)).bold),[true,true,false,false]);}finally{reopened.free();}
  assert.deepEqual(errors,[]);assert.equal(await frame.evaluate(()=>window.__upstreamKeys.every(e=>e.trusted)),true);
 }finally {await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
});
