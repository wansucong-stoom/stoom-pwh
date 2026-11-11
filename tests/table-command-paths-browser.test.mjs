import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('trusted keys create and edit an inner table with one-step undo and intact ancestors',{
  skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT,
  timeout:180000,
},async()=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
  const table=JSON.parse(doc.createTable(0,0,0,2,2));
  doc.setTableProperties(0,0,table.controlIdx,JSON.stringify({treatAsChar:true}));
  doc.insertTextInCell(0,0,table.controlIdx,0,0,0,'SOURCE TEXT');
  doc.insertTextInCell(0,0,table.controlIdx,3,0,0,'KEEP SIBLING');
  const bytes=Buffer.from(doc.exportHwpx());doc.free();
  assert.equal(bytes.subarray(0,2).toString(),'PK','host receives a Node Buffer with an HWPX signature');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-command-paths-'));
  process.env.PWH_STANDALONE_DATA=path.join(temp,'profile');
  const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  const app=await createAppServer({initialBytes:bytes});
  const browser=await chromium.launch({headless:true,...(process.env.PWH_BROWSER_EXECUTABLE?{executablePath:process.env.PWH_BROWSER_EXECUTABLE}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);
    await page.waitForFunction(()=>document.querySelector('#editor')?.contentWindow?.pwhRecoveryReady?.()===true,null,{timeout:90000});
    const editor=page.frames().find(frame=>/\/editor(?:\?|$)/.test(frame.url()));
    await editor.evaluate(ci=>{
      const ih=window.rhwpStudio.plugins.deps.getInputHandler();
      ih.cursor.moveTo({sectionIndex:0,paragraphIndex:0,parentParaIndex:0,controlIndex:ci,cellIndex:2,cellParaIndex:0,charOffset:0,cellPath:[{controlIndex:ci,cellIndex:2,cellParaIndex:0}]});
      ih.active=true;ih.updateCaret();ih.textarea.focus();
      window.__commandKeys=[];ih.textarea.addEventListener('keydown',e=>window.__commandKeys.push({key:e.key,trusted:e.isTrusted}));
    },table.controlIdx);
    await page.keyboard.press('Control+n');await page.keyboard.press('t');
    const dialog=editor.getByRole('dialog',{name:'표 만들기'});
    await dialog.waitFor();await dialog.locator('input[type=number]').nth(0).fill('2');await dialog.locator('input[type=number]').nth(1).fill('2');
    await dialog.locator('input[type=checkbox]').check();await dialog.getByRole('button',{name:'만들기',exact:true}).click();
    const state=()=>editor.evaluate(ci=>{
      const w=window.rhwpStudio.plugins.deps.wasm,ih=window.rhwpStudio.plugins.deps.getInputHandler(),pos=ih.getCursorPosition();
      return {pos,outer:w.getTableDimensions(0,0,ci),inner:pos.cellPath?.length>1?w.getTableDimensionsByPath(0,0,JSON.stringify(pos.cellPath)):null,
        source:w.getTextInCell(0,0,ci,0,0,0,100),sibling:w.getTextInCell(0,0,ci,3,0,0,100),focus:document.activeElement===ih.textarea};
    },table.controlIdx);
    let current=await state();assert.equal(current.inner.rowCount,2);assert.equal(current.source,'SOURCE TEXT');assert.equal(current.sibling,'KEEP SIBLING');assert.equal(current.focus,true);
    await page.keyboard.press('Control+z');assert.equal((await state()).inner,null);
    await page.keyboard.press('Control+Shift+z');assert.equal((await state()).inner.rowCount,2);
    await page.keyboard.press('Control+Enter');assert.equal((await state()).inner.rowCount,3);assert.equal((await state()).outer.rowCount,2);
    await page.keyboard.press('Control+Backspace');assert.equal((await state()).inner.rowCount,2);
    assert.equal((await state()).pos.cellPath[0].cellIndex,2);
    await page.keyboard.press('Control+z');assert.equal((await state()).inner.rowCount,3);
    await page.keyboard.press('Control+Shift+z');assert.equal((await state()).inner.rowCount,2);
    await page.keyboard.press('F5');await page.keyboard.press('s');
    await editor.getByRole('button',{name:'나누기(D)',exact:true}).click();
    assert.equal((await state()).inner.cellCount,5);assert.equal((await state()).outer.cellCount,4);
    await page.keyboard.press('F5');await page.keyboard.press('l');
    await editor.locator('select[aria-label="선 굵기"]').selectOption('6');await editor.getByRole('button',{name:'왼쪽 선',exact:true}).click();
    await editor.getByRole('button',{name:'설정',exact:true}).click();
    const border=()=>editor.evaluate(()=>{
      const ih=window.rhwpStudio.plugins.deps.getInputHandler(),pos=ih.getCursorPosition(),w=window.rhwpStudio.plugins.deps.wasm;
      return w.getCellOwnPropertiesByPath(pos.sectionIndex,pos.parentParaIndex,JSON.stringify(pos.cellPath),pos.cellIndex).borderLeft.width;
    });
    assert.equal(await border(),6);await page.keyboard.press('Control+z');assert.equal(await border(),1);
    await editor.evaluate(()=>{
      const ih=window.rhwpStudio.plugins.deps.getInputHandler();
      ih.cursor.exitCellSelectionMode();ih.cursor.clearSelection();ih.focus();
    });
    await page.keyboard.type('TEST NUMBER');
    const cellText=()=>editor.evaluate(()=>{
      const ih=window.rhwpStudio.plugins.deps.getInputHandler(),pos=ih.getCursorPosition();
      return window.rhwpStudio.plugins.deps.wasm.getTextInCellByPath(pos.sectionIndex,pos.parentParaIndex,JSON.stringify(pos.cellPath),0,100);
    });
    assert.equal(await cellText(),'TEST NUMBER');await page.keyboard.press('F5');
    assert.equal(await editor.evaluate(()=>window.rhwpStudio.plugins.deps.getInputHandler().dispatcher.isEnabled('edit:delete')),true);
    await page.keyboard.press('Control+e');
    await editor.getByRole('button',{name:'내용만 지우기',exact:true}).click();
    assert.equal(await cellText(),'');
    await page.keyboard.press('Control+z');
    assert.equal(await cellText(),'TEST NUMBER');
    assert.equal((await state()).sibling,'KEEP SIBLING');
    const keys=await editor.evaluate(()=>window.__commandKeys);assert.ok(keys.some(e=>e.key==='n'&&e.trusted));assert.ok(keys.some(e=>e.key==='Backspace'&&e.trusted));
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>app.server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
});
