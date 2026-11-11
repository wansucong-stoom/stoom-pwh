import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {emptyCellCaretFixture} from './engine-cursor/empty-cell-fixture.mjs';
import {storedInlineFrameFixture} from './engine-source-ownership/stored-inline-frame-fixture.mjs';

const enabled = process.env.PWH_BROWSER_TESTS === '1' && process.env.PWH_DESKTOP_SOURCE_ROOT;
for (const fixture of [
  {name:'flat',bytes:() => emptyCellCaretFixture({paragraphs:12}),marker:'RIGHT_0_END'},
  {name:'nested mixed host',bytes:storedInlineFrameFixture,marker:'TITLE'},
]) test('trusted cell layout history: ' + fixture.name,{skip:enabled ? false : 'Set Desktop and browser paths',timeout:180000},async () => {
  const {chromium} = await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'pwh-cell-history-'));
  process.env.PWH_STANDALONE_DATA = path.join(temp,'data');
  const {createAppServer} = await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  const app = await createAppServer({initialBytes:fixture.bytes()});
  const browser = await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  try {
    const page = await browser.newPage();await page.goto(app.url);
    await page.frameLocator('#editor').locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:120000});
    const editor = page.frames().find(f => /\/editor\?/.test(f.url()));
    await editor.waitForFunction(() => window.pwhRecoveryReady?.() === true,null,{timeout:120000});
    // Prepare the logical owner; mutations and Undo/Redo below use real browser
    // key input. Pointer geometry has its own independent regression tests.
    await editor.evaluate(marker => {
      const ih = window.rhwpStudio.plugins.deps.getInputHandler(),doc = ih.wasm.doc;
      const run = Array.from({length:doc.pageCount()},(_,i) => JSON.parse(doc.getPageTextLayout(i)).runs).flat().find(r => r.text === marker);
      if (!run?.cellPath?.length) throw Error('Missing cell marker');
      const first = run.cellPath[0];
      ih.cursor.moveTo({sectionIndex:run.secIdx,paragraphIndex:run.paraIdx,charOffset:2,parentParaIndex:run.parentParaIdx,
        controlIndex:first.controlIndex,cellIndex:first.cellIndex,cellParaIndex:first.cellParaIndex,cellPath:run.cellPath});
      ih.textarea.focus();ih.updateCaret();window.__cellHistoryEvents = [];
      for (const type of ['keydown','compositionstart','compositionend']) document.addEventListener(type,e => window.__cellHistoryEvents.push({type:e.type,key:e.key,ctrl:e.ctrlKey,shift:e.shiftKey,trusted:e.isTrusted}),true);
    },fixture.marker);
    const settle = () => editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = () => editor.evaluate(() => {
      const ih = window.rhwpStudio.plugins.deps.getInputHandler(),doc = ih.wasm.doc;
      return {pages:doc.pageCount(),text:doc.getTextFileText(),view:Array.from({length:doc.pageCount()},(_,i) => [doc.renderPageSvgWithProfile(i,'print'),doc.getPageTextLayout(i)])};
    });
    const before = await state();
    await page.keyboard.type('ab');await settle();const typed = await state();
    assert.notEqual(typed.text,before.text);
    const resources = await editor.evaluate(() => window.rhwpStudio.plugins.deps.getInputHandler().history.peekUndoTop().fragmentIds.length);
    assert.equal(resources,1,'Merged typing retains only its first checkpoint');
    await page.keyboard.press('Control+z');await settle();assert.deepEqual(await state(),before);
    await page.keyboard.press('Control+Shift+z');await settle();assert.deepEqual(await state(),typed);
    await page.keyboard.press('Control+z');await settle();assert.deepEqual(await state(),before);
    await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');await settle();
    const erased = await state();assert.notEqual(erased.text,before.text);
    await page.keyboard.press('Control+z');await settle();assert.deepEqual(await state(),before,'Consecutive Backspaces share one layout-preserving Undo');
    await page.keyboard.press('Control+Shift+z');await settle();assert.deepEqual(await state(),erased);
    await page.keyboard.press('Control+z');await settle();assert.deepEqual(await state(),before);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition',{text:'한',selectionStart:1,selectionEnd:1});
    await cdp.send('Input.insertText',{text:'한'});await settle();
    assert.notEqual((await state()).text,before.text,'Browser IME actually edits the cell');
    await page.keyboard.press('Control+z');await settle();assert.deepEqual(await state(),before,'IME Undo restores the stored layout');
    await cdp.send('Input.imeSetComposition',{text:'가',selectionStart:1,selectionEnd:1});await settle();
    assert.notEqual((await state()).text,before.text,'Cancelling a live composition exercises the rollback');
    await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});await settle();
    assert.deepEqual(await state(),before,'Cancelling IME restores text and layout without a history entry');
    const result = await editor.evaluate(() => {
      const ih = window.rhwpStudio.plugins.deps.getInputHandler();
      return {focus:document.activeElement === ih.textarea,events:window.__cellHistoryEvents};
    });
    assert.ok(result.focus);
    assert.ok(result.events.some(e => e.type === 'compositionstart' && e.trusted),'Chromium started a real composition');
    // Chromium's DevTools commit/cancel delivers compositionend with
    // isTrusted=false. This proves the browser composition path, not Win32 IME.
    assert.ok(result.events.some(e => e.type === 'compositionend'),'Chromium ended the composition');
    const undoKeys = result.events.filter(e => e.type === 'keydown' && e.ctrl && !e.shift && e.key === 'z');
    assert.equal(undoKeys.length,5);assert.ok(undoKeys.every(e => e.trusted),'Undo goes through trusted keyboard events');
  } finally {await browser.close();await new Promise(resolve => app.server.close(resolve));}
});
