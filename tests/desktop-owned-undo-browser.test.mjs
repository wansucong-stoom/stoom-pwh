import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {emptyCellCaretFixture} from './engine-cursor/empty-cell-fixture.mjs';

const enabled=process.env.PWH_BROWSER_TESTS==='1'&&process.env.PWH_DESKTOP_SOURCE_ROOT;
test('plain cell typing Undo owns one complete pagination and preserves failed-mutation recovery', {
  skip:enabled?false:'Set Desktop and browser paths',timeout:180000,
},async()=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-owned-undo-'));
  process.env.PWH_STANDALONE_DATA=path.join(temp,'data');
  const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  // More than 30 pages keeps the normal large-document pending barrier alive.
  // The document is wholly synthetic and the public keyboard path is unchanged.
  const app=await createAppServer({initialBytes:emptyCellCaretFixture({paragraphs:260})});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:700}});
    await page.goto(app.url);
    await page.frameLocator('#editor').locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:120000});
    const editor=page.frames().find(frame=>/\/editor\?/.test(frame.url()));
    await editor.waitForFunction(()=>window.pwhRecoveryReady?.()===true,null,{timeout:120000});
    const settle=()=>editor.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const setup=await editor.evaluate(()=>{
      const d=window.rhwpStudio.plugins.deps,ih=d.getInputHandler(),sc=document.getElementById('scroll-content');
      const run=JSON.parse(d.wasm.doc.getPageTextLayout(0)).runs.find(r=>r.text.includes('RIGHT_0_END'));
      if(!run)throw Error('Synthetic right cell text missing');
      const b=sc.getBoundingClientRect(),z=ih.viewportManager.getZoom();
      window.__undoBoundaryCalls=[];window.__undoTrustedKeys=[];
      for(const [obj,name,label]of [[d.wasm,'flushDeferredPagination','flush'],[d.wasm,'restoreDeleteFragment','restore'],[ih,'cancelDeferredPaginationForOwnedMutation','cancel']]){
        const original=obj[name];obj[name]=function(...args){window.__undoBoundaryCalls.push(label);return original.apply(this,args);};
      }
      document.addEventListener('keydown',event=>window.__undoTrustedKeys.push({key:event.key,trusted:event.isTrusted}),true);
      return {pages:d.wasm.doc.pageCount(),text:d.wasm.doc.getTextFileText(),
        x:b.left+ih.virtualScroll.getPageLeftResolved(0,sc.clientWidth)+(run.x+20)*z,
        y:b.top+ih.virtualScroll.getPageOffset(0)+(run.y+run.h/2)*z};
    });
    assert.ok(setup.pages>30);
    const box=await page.locator('#editor').boundingBox();await page.mouse.click(box.x+setup.x,box.y+setup.y);
    // Establish live metrics once before the same-flow insertion under test.
    await page.keyboard.type('w');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await settle();
    const before=await editor.evaluate(()=>{const doc=window.rhwpStudio.plugins.deps.wasm.doc;return {text:doc.getTextFileText(),view:Array.from({length:doc.pageCount()},(_,i)=>[doc.renderPageSvgWithProfile(i,'print'),doc.getPageTextLayout(i)])};});
    setup.text=before.text;
    await page.waitForTimeout(350); // Keep warm-up outside the editor's 300 ms typing merge window.
    await page.keyboard.type('z');await settle();
    const pending=await editor.evaluate(()=>{const ih=window.rhwpStudio.plugins.deps.getInputHandler();return {pending:ih.hasDeferredPaginationPending(),eligible:ih.history.peekUndoTop()?.canUndoWithoutPaginationFlush?.(),text:ih.wasm.doc.getTextFileText()};});
    assert.ok(pending.pending);assert.equal(pending.eligible,true);assert.notEqual(pending.text,setup.text);
    await editor.evaluate(()=>window.__undoBoundaryCalls=[]);
    await page.keyboard.press('Control+z');await settle();
    const undone=await editor.evaluate(()=>{const ih=window.rhwpStudio.plugins.deps.getInputHandler();return {pending:ih.hasDeferredPaginationPending(),calls:window.__undoBoundaryCalls,text:ih.wasm.doc.getTextFileText(),pages:ih.wasm.doc.pageCount(),focused:document.activeElement===ih.textarea};});
    assert.equal(undone.pending,false);assert.deepEqual(undone.calls,['cancel','restore']);
    assert.ok(undone.text===setup.text,'Undo restores exactly the text before the tested insertion');assert.equal(undone.pages,setup.pages);assert.ok(undone.focused);
    assert.deepEqual(await editor.evaluate(()=>{const doc=window.rhwpStudio.plugins.deps.wasm.doc;return Array.from({length:doc.pageCount()},(_,i)=>[doc.renderPageSvgWithProfile(i,'print'),doc.getPageTextLayout(i)]);}),before.view,'Trusted Undo restores its pre-edit SVG and text geometry');
    await page.keyboard.press('Control+Shift+z');await settle();
    assert.equal(await editor.evaluate(()=>window.rhwpStudio.plugins.deps.wasm.doc.getTextFileText()),pending.text);

    // Only simple real cell insertions opt in. Contexts that may restore a
    // fragment or use another editing API must keep the ordinary boundary.
    const guards=await editor.evaluate(()=>{
      const c=window.rhwpStudio.plugins.deps.getInputHandler().history.peekUndoTop(),C=c.constructor,p=c.position;
      const cases=[['plain',p,'a'],['merged',p,'abcd'],['body',{sectionIndex:0,paragraphIndex:0,charOffset:0},'a'],
        ['nested',{...p,cellPath:[{controlIndex:1,cellIndex:0,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}]},'a'],
        ['caption',{...p,cellIndex:65534},'a'],['empty',p,''],['newline',p,'a\nb'],['tab',p,'a\tb'],
        ['formatted',p,'a',{}],['replaced',p,'a',undefined,'b'],['fragment',p,'a',undefined,'',[7]]];
      return cases.map(([name,pos,text,format,replaced='',fragments=[]])=>({name,value:new C(pos,text,undefined,format,replaced,fragments).canUndoWithoutPaginationFlush()}));
    });
    for(const guard of guards)assert.equal(guard.value,['plain','merged'].includes(guard.name),guard.name);

    // A failed owned mutation leaves the pending barrier intact. The next
    // actual navigation key must finish it and keep subsequent input editable.
    await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await page.keyboard.type('v');await settle();
    const beforeFailure=await editor.evaluate(()=>{const d=window.rhwpStudio.plugins.deps;return {pending:d.getInputHandler().hasDeferredPaginationPending(),text:d.wasm.doc.getTextFileText()};});
    assert.ok(beforeFailure.pending);
    await editor.evaluate(()=>{const d=window.rhwpStudio.plugins.deps;window.__restoreOwnedFragment=d.wasm.restoreDeleteFragment;d.wasm.restoreDeleteFragment=()=>{throw Error('Synthetic owned mutation failure');};window.__undoBoundaryCalls=[];});
    await page.keyboard.press('Control+z');await settle();
    const failed=await editor.evaluate(()=>{const d=window.rhwpStudio.plugins.deps;d.wasm.restoreDeleteFragment=window.__restoreOwnedFragment;return {pending:d.getInputHandler().hasDeferredPaginationPending(),text:d.wasm.doc.getTextFileText()};});
    assert.ok(failed.pending);assert.ok(failed.text===beforeFailure.text);
    await page.keyboard.press('ArrowLeft');await settle();
    assert.equal(await editor.evaluate(()=>window.rhwpStudio.plugins.deps.getInputHandler().hasDeferredPaginationPending()),false);
    await page.keyboard.type('q');await settle();await page.keyboard.press('Control+z');await settle();
    assert.equal(await editor.evaluate(()=>window.rhwpStudio.plugins.deps.wasm.doc.getTextFileText()),beforeFailure.text);
    assert.ok((await editor.evaluate(()=>window.__undoTrustedKeys)).every(event=>event.trusted));
  } finally {
    await browser.close();await new Promise(resolve=>app.server.close(resolve));
  }
});
