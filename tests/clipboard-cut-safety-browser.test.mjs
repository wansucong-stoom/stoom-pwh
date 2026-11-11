import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {emptyCellCaretTwoSectionFixture} from './engine-cursor/empty-cell-fixture.mjs';

test('trusted Cut waits for rich clipboard success and preserves originals on failure or stale selection', {
  skip: process.env.PWH_BROWSER_TESTS !== '1' || !process.env.PWH_DESKTOP_SOURCE_ROOT ? 'Set browser and Desktop paths' : false,
  timeout: 120000,
}, async () => {
  const {chromium} = await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
  const doc = core.HwpDocument.createEmpty(); doc.createBlankDocument();
  const table = JSON.parse(doc.createTable(0, 0, 0, 2, 2)); assert.equal(table.ok, true);
  doc.insertTextInCell(0, 0, table.controlIdx, 0, 0, 0, 'Clipboard safety fixture');
  const bytes = doc.exportHwpx(); doc.free();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-cut-safety-'));
  process.env.PWH_STANDALONE_DATA = path.join(work, 'profile');
  const {createAppServer} = await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT, 'host.mjs')));
  const app = await createAppServer({initialBytes: Buffer.from(bytes)});
  const browser = await chromium.launch({headless: true, ...(process.env.PWH_BROWSER_EXECUTABLE ? {executablePath: process.env.PWH_BROWSER_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 1300, height: 950}});
    await page.goto(app.url);
    await page.waitForFunction(() => document.querySelector('#editor')?.contentWindow?.pwhRecoveryReady?.() === true, null, {timeout: 60000});
    const frame = page.frames().find(f => /\/editor\?/.test(f.url()));
    await frame.evaluate(() => {
      const button = document.createElement('button'); button.id = 'cut-focus-test'; button.textContent = 'Synthetic focus target';
      Object.assign(button.style, {position: 'fixed', right: '10px', bottom: '10px', zIndex: '99999'}); document.body.append(button);
      window.cutTest = {writes: 0};
      Object.defineProperty(navigator.clipboard, 'write', {configurable: true, value: items => {
        window.cutTest.writes++;
        window.cutTest.types = items[0].types;
        return new Promise((resolve, reject) => { window.cutTest.resolve = resolve; window.cutTest.reject = () => reject(new Error('Synthetic clipboard rejection')); });
      }});
    });
    const state = () => frame.evaluate(() => {
      const ih = window.rhwpStudio.plugins.deps.getInputHandler();
      return {bytes: Array.from(window.pwhEditor.export().bytes), pending: !!ih.cancelPendingObjectCut, selected: ih.isInTableObjectSelection(), writes: window.cutTest.writes};
    });
    const select = async () => {
      await frame.getByRole('textbox', {name: '문서 편집 입력'}).focus();
      await frame.evaluate(ci => {
        const ih = window.rhwpStudio.plugins.deps.getInputHandler();
        ih.cursor.enterTableObjectSelectionDirect(0, 0, ci);
      }, table.controlIdx);
    };
    const before = (await state()).bytes;
    for (const reason of ['rejection', 'focus', 'focus-return', 'selection', 'mutation', 'deactivate']) {
      await select(); const previousWrites = (await state()).writes;
      await page.keyboard.press('Control+x');
      await frame.waitForFunction(n => window.cutTest.writes === n + 1, previousWrites);
      assert.deepEqual((await state()).bytes, before, 'pending Cut preserves original');
      await page.keyboard.press('Control+x'); assert.equal((await state()).writes, previousWrites + 1, 'duplicate pending Cut is ignored');
      if (reason === 'focus' || reason === 'focus-return') await frame.locator('#cut-focus-test').click();
      if (reason === 'focus-return') await frame.getByRole('textbox', {name: '문서 편집 입력'}).focus();
      if (reason === 'selection') await frame.evaluate(ci => window.rhwpStudio.plugins.deps.getInputHandler().cursor.enterTableObjectSelectionDirect(0, 0, ci), table.controlIdx);
      if (reason === 'mutation') await frame.evaluate(() => window.rhwpStudio.plugins.deps.getInputHandler().eventBus.emit('document-mutated'));
      if (reason === 'deactivate') await frame.evaluate(() => window.rhwpStudio.plugins.deps.getInputHandler().deactivate());
      await frame.evaluate(reject => reject ? window.cutTest.reject() : window.cutTest.resolve(), reason === 'rejection');
      await frame.waitForFunction(() => !window.rhwpStudio.plugins.deps.getInputHandler().cancelPendingObjectCut);
      assert.deepEqual((await state()).bytes, before, reason + ' preserves original');
      if (reason === 'deactivate') await frame.evaluate(() => window.rhwpStudio.plugins.deps.getInputHandler().activateWithCaretPosition());
    }
    // Cancellation releases the slot before a hung native write ever settles.
    await select(); await page.keyboard.press('Control+x');
    await frame.evaluate(() => {window.cutTest.oldResolve = window.cutTest.resolve;});
    await frame.locator('#cut-focus-test').click();
    assert.equal((await state()).pending, false, 'hung write does not retain the Cut lock after cancellation');
    await select(); const count = (await state()).writes; await page.keyboard.press('Control+x');
    await frame.waitForFunction(n => window.cutTest.writes === n + 1, count);
    await frame.evaluate(() => window.cutTest.oldResolve());
    await frame.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal((await state()).pending, true, 'old write completion cannot clear a new Cut');
    await frame.locator('#cut-focus-test').click(); await frame.evaluate(() => window.cutTest.resolve());
    assert.deepEqual((await state()).bytes, before);
    await select(); await page.keyboard.press('Control+x');
    await frame.waitForFunction(() => !!window.rhwpStudio.plugins.deps.getInputHandler().cancelPendingObjectCut);
    assert.deepEqual(await frame.evaluate(() => [...window.cutTest.types].sort()), ['text/html', 'text/plain']);
    await frame.evaluate(() => window.cutTest.resolve());
    await frame.waitForFunction(() => !window.rhwpStudio.plugins.deps.getInputHandler().cancelPendingObjectCut);
    assert.notDeepEqual((await state()).bytes, before, 'successful rich write cuts once');
    await page.keyboard.press('Control+z'); assert.deepEqual((await state()).bytes, before, 'one Undo restores full table');
    await page.keyboard.press('Control+Shift+z'); assert.notDeepEqual((await state()).bytes, before, 'Redo cuts again');
    await page.keyboard.press('Control+z');
    // Native text Cut event with a failed DataTransfer write must also keep text.
    await frame.evaluate(ci => {
      const ih = window.rhwpStudio.plugins.deps.getInputHandler();
      ih.cursor.exitTableObjectSelection();
      ih.cursor.moveTo({sectionIndex: 0, paragraphIndex: 0, parentParaIndex: 0, controlIndex: ci, cellIndex: 0, cellParaIndex: 0, charOffset: 0});
      ih.cursor.setAnchor(); ih.cursor.moveTo({...ih.cursor.getPosition(), charOffset: 9}); ih.updateCaret(); ih.focusTextarea();
      window.cutTest.originalSetData = DataTransfer.prototype.setData;
      DataTransfer.prototype.setData = () => { throw new Error('Synthetic DataTransfer failure'); };
    }, table.controlIdx);
    const textBefore = (await state()).bytes;
    await page.keyboard.press('Control+x'); assert.deepEqual((await state()).bytes, textBefore, 'failed native text Cut preserves original');
    await frame.evaluate(() => {
      DataTransfer.prototype.setData = window.cutTest.originalSetData;
      const ih = window.rhwpStudio.plugins.deps.getInputHandler();
      ih.wasm.exportSelectionInCellHtml = () => { throw new Error('Synthetic HTML export failure'); };
    });
    await page.keyboard.press('Control+x'); assert.deepEqual((await state()).bytes, textBefore, 'failed rich text serialization preserves original');
  } finally { await browser.close(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
});

test('cross-section typing and delete keys preserve document, selection and history', {
  skip: process.env.PWH_BROWSER_TESTS !== '1' || !process.env.PWH_DESKTOP_SOURCE_ROOT ? 'Set browser and Desktop paths' : false,
  timeout: 90000,
}, async () => {
  const {chromium} = await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-cross-section-'));
  process.env.PWH_STANDALONE_DATA = path.join(work, 'profile');
  const {createAppServer} = await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT, 'host.mjs')));
  const app = await createAppServer({initialBytes: emptyCellCaretTwoSectionFixture()});
  const browser = await chromium.launch({headless: true, ...(process.env.PWH_BROWSER_EXECUTABLE ? {executablePath: process.env.PWH_BROWSER_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 1300, height: 950}}), errors = [];
    page.on('pageerror', error => errors.push(error.message)); await page.goto(app.url);
    await page.waitForFunction(() => document.querySelector('#editor')?.contentWindow?.pwhRecoveryReady?.() === true, null, {timeout: 60000});
    const frame = page.frames().find(f => /\/editor\?/.test(f.url()));
    await frame.evaluate(() => {
      const ih = window.rhwpStudio.plugins.deps.getInputHandler();
      ih.cursor.moveTo({sectionIndex: 0, paragraphIndex: 0, charOffset: 0}); ih.cursor.setAnchor();
      ih.cursor.moveTo({sectionIndex: 1, paragraphIndex: 0, charOffset: 0}); ih.focusTextarea();
      window.crossSectionUndo = ih.history.peekUndoTop();
    });
    const state = () => frame.evaluate(() => {const ih = window.rhwpStudio.plugins.deps.getInputHandler();return {bytes: Array.from(window.pwhEditor.export().bytes), selection: ih.cursor.getSelectionOrdered(), historySame: ih.history.peekUndoTop() === window.crossSectionUndo};});
    const before = await state(); assert.notEqual(before.selection.start.sectionIndex, before.selection.end.sectionIndex);
    for (const key of ['Backspace', 'Delete', 'Enter', 'Tab', 'a', 'Control+x']) {
      await page.keyboard.press(key); assert.deepEqual(await state(), before, key + ' is rejected before mutation');
    }
    await frame.evaluate(() => window.rhwpStudio.plugins.deps.getInputHandler().performDelete());
    assert.deepEqual(await state(), before, 'menu Delete is rejected before mutation'); assert.deepEqual(errors, []);
  } finally {await browser.close(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));}
});
