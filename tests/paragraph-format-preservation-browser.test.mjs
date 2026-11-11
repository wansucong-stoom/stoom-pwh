import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

test('trusted paragraph dialog input preserves borders, uses physical points and retains undo/reopen',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set browser and Desktop paths':false,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const d=core.HwpDocument.createEmpty();d.createBlankDocument();d.insertText(0,0,0,'Anchor line');d.insertParagraph(0,1);d.insertText(0,1,0,'Paragraph property target');d.insertParagraph(0,2);d.insertText(0,2,0,'Following paragraph');const bytes=d.exportHwpx();d.free();
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-para-properties-'));process.env.PWH_STANDALONE_DATA=path.join(work,'profile');
 const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));const app=await createAppServer({initialBytes:Buffer.from(bytes)});
 const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1300,height:1000}});await page.goto(app.url);await page.waitForFunction(()=>document.querySelector('#editor')?.contentWindow?.pwhRecoveryReady?.()===true,null,{timeout:60000});
  const frame=page.frames().find(f=>/\/editor\?/.test(f.url())),box=await page.locator('#editor').boundingBox();
  const target=await frame.evaluate(()=>{const ih=window.rhwpStudio.plugins.deps.getInputHandler(),run=JSON.parse(ih.wasm.doc.getPageTextLayout(0)).runs.find(r=>r.paraIdx===1),sc=document.querySelector('#scroll-content'),r=sc.getBoundingClientRect(),z=ih.viewportManager.getZoom();return {x:r.x+ih.virtualScroll.getPageLeftResolved(0,sc.clientWidth)+(run.x+12)*z,y:r.y+ih.virtualScroll.getPageOffset(0)+(run.y+run.h/2)*z};});
  await page.mouse.click(box.x+target.x,box.y+target.y);
  const state=()=>frame.evaluate(()=>{const doc=window.rhwpStudio.plugins.deps.wasm.doc;return {props:JSON.parse(doc.getParaPropertiesAt(0,1)),y:JSON.parse(doc.getPageTextLayout(0)).runs.find(r=>r.paraIdx===1).y,bytes:Array.from(window.pwhEditor.export().bytes)};});
  const before=await state();await page.keyboard.press('Alt+t');await frame.locator('.ps-dialog').waitFor({state:'visible'});
  await frame.getByRole('spinbutton',{name:'문단 위 간격(pt)'}).fill('20');await frame.locator('.ps-dialog .dialog-btn-primary').click();
  const changed=await state();for(const key of ['borderLeft','borderRight','borderTop','borderBottom','fillType','patternType','patternColor'])assert.deepEqual(changed.props[key],before.props[key],key+' is unchanged');
  assert.ok(Math.abs(changed.y-before.y-20*96/72)<.2,'20 points advance text by 26.67 CSS pixels');
  await page.keyboard.press('Alt+t');await frame.locator('.ps-dialog').waitFor({state:'visible'});assert.equal(await frame.getByRole('spinbutton',{name:'문단 위 간격(pt)'}).inputValue(),'20.0');await frame.locator('.ps-dialog .dialog-btn-primary').click();
  assert.deepEqual((await state()).bytes,changed.bytes,'confirming unchanged dialog preserves document bytes');
  await page.keyboard.press('Control+z');assert.deepEqual((await state()).props,before.props,'one undo restores the original style');
  await page.keyboard.press('Control+Shift+z');const redone=await state();assert.deepEqual(redone.props,changed.props);
  const reopened=new core.HwpDocument(Uint8Array.from(redone.bytes));try{assert.deepEqual(JSON.parse(reopened.getParaPropertiesAt(0,1)),changed.props);}finally{reopened.free();}
 }finally{await browser.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));}
});
