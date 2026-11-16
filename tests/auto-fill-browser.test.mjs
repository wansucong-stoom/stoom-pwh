import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('auto-fill uses the selected cells, one history step and modal-owned keyboard focus',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop build and browser paths':false,timeout:90000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
 await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
 const table=JSON.parse(doc.createTable(0,0,0,30,5));assert.equal(table.ok,true);
 for(const [cell,text]of [[0,'연번'],[5,'1'],[10,'2'],[15,'3']])
  assert.equal(JSON.parse(doc.insertTextInCell(0,table.paraIdx,table.controlIdx,cell,0,0,text)).ok,true);
 const initialBytes=Buffer.from(doc.exportHwpx());doc.free();
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-auto-fill-browser-'));
 process.env.PWH_STANDALONE_DATA=path.join(temp,'data');process.env.PWH_AUTOFILL_PREFERENCES_DIR=path.join(temp,'preferences');
 const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
 const app=await createAppServer({initialBytes});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(app.url);
  await page.waitForFunction(()=>!!document.querySelector('#editor')?.contentWindow?.pwhRecoveryReady,null,{timeout:60000});
  const editor=page.frames().find(frame=>/\/editor\?/.test(frame.url()));
  await editor.waitForFunction(()=>window.pwhRecoveryReady?.()===true,null,{timeout:60000});
  // Set only the fixture caret through the API; block selection and commands
  // below are real keyboard input, including the editor's history handlers.
  await editor.evaluate(()=>{
   const i=window.rhwpStudio.plugins.deps.getInputHandler(),t=i.wasm.getPageControlLayout(0).controls.find(c=>c.type==='table');
   window.__fillTable=t;
   window.__fillColumn=()=>Array.from({length:30},(_,r)=>i.wasm.getTextInCell(t.secIdx,t.paraIdx,t.controlIdx,r*5,0,0,i.wasm.getCellParagraphLength(t.secIdx,t.paraIdx,t.controlIdx,r*5,0)));
   i.cursor.moveTo({sectionIndex:t.secIdx,paragraphIndex:t.paraIdx,parentParaIndex:t.paraIdx,controlIndex:t.controlIdx,cellIndex:5,cellParaIndex:0,charOffset:0,cellPath:[{controlIndex:t.controlIdx,cellIndex:5,cellParaIndex:0}]});i.focus();i.updateCaret();
  });
  const before=await editor.evaluate(()=>window.__fillColumn());
  await page.keyboard.press('F5');await page.keyboard.press('F5');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  assert.deepEqual(await editor.evaluate(()=>window.rhwpStudio.plugins.deps.getInputHandler().getSelectedCellRange()),{startRow:1,startCol:0,endRow:3,endCol:0});
  await page.keyboard.press('a');await editor.waitForFunction(()=>document.querySelector('#rhwp-toast-container')?.textContent?.includes('빈 셀'));
  assert.deepEqual(await editor.evaluate(()=>window.__fillColumn()),before);
  for(let n=0;n<5;n++)await page.keyboard.press('ArrowDown');
  await page.keyboard.press('a');await editor.waitForFunction(()=>window.__fillColumn()[8]==='8');
  assert.equal((await editor.evaluate(()=>window.__fillColumn()))[0],'연번');
  assert.ok((await editor.evaluate(()=>window.__fillColumn())).slice(9).every(value=>value===''));
  await page.keyboard.press('Control+z');assert.deepEqual(await editor.evaluate(()=>window.__fillColumn()),before);
  await page.keyboard.press('Control+Shift+z');assert.equal((await editor.evaluate(()=>window.__fillColumn()))[8],'8');
  await page.keyboard.press('Control+z');await page.keyboard.press('s');
  const modal=editor.locator('.modal-overlay .dialog-wrap');await modal.waitFor({state:'visible'});
  assert.equal(await modal.evaluate(el=>el.contains(document.activeElement)),true);
  const visited=[];
  for(let n=0;n<10;n++){
   await page.keyboard.press('Tab');
   visited.push(await modal.evaluate(el=>({inside:el.contains(document.activeElement),disabled:document.activeElement.matches(':disabled'),text:document.activeElement.textContent.trim()})));
  }
  assert.ok(visited.every(step=>step.inside&&!step.disabled));assert.ok(visited.some(step=>step.text==='취소'));
  await page.keyboard.press('Shift+Tab');assert.equal(await modal.evaluate(el=>el.contains(document.activeElement)),true);
  const firstCheckbox=modal.locator('input[type="checkbox"]').first();await firstCheckbox.focus();
  const checked=await firstCheckbox.isChecked();await page.keyboard.press('Space');assert.equal(await firstCheckbox.isChecked(),!checked);
  await modal.getByRole('button',{name:'취소',exact:true}).focus();await page.keyboard.press('Enter');
  assert.equal(await modal.count(),0);assert.deepEqual(await editor.evaluate(()=>window.__fillColumn()),before);
  assert.equal(await editor.locator('textarea[aria-label="문서 편집 입력"]').evaluate(el=>el===document.activeElement),true);
  // A slow preference read must not fill a selection the user has cancelled.
  await editor.evaluate(()=>{window.__originalFillPreferences=window.pwhAutoFillLists;window.pwhAutoFillLists=()=>new Promise(resolve=>{window.__resolveFillPreferences=resolve;});});
  await page.keyboard.press('a');await editor.waitForFunction(()=>typeof window.__resolveFillPreferences==='function');
  await page.keyboard.press('Escape');
  await editor.evaluate(async()=>{window.__resolveFillPreferences([]);await new Promise(resolve=>setTimeout(resolve,0));window.pwhAutoFillLists=window.__originalFillPreferences;});
  assert.deepEqual(await editor.evaluate(()=>window.__fillColumn()),before);
 }finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  // temp was created by this test under the system temporary directory.
  assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));
  await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
