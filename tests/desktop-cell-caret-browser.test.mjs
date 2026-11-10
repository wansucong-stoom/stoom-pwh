import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {emptyCellCaretFixture} from './engine-cursor/empty-cell-fixture.mjs';

test('blank continued cells reveal their logical caret and preserve typing, undo and same-page selection', {
  skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop and browser paths':false,
  timeout:180000,
}, async()=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-cell-caret-'));
  process.env.PWH_STANDALONE_DATA=path.join(temp,'data');
  const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  const app=await createAppServer({initialBytes:emptyCellCaretFixture()});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:500}});
    await page.goto(app.url);
    const editor=page.frames().find(frame=>/\/editor\?/.test(frame.url()));
    await editor.waitForFunction(()=>window.pwhRecoveryReady?.()===true,null,{timeout:120000});
    const settle=()=>editor.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const box=await page.locator('#editor').boundingBox();
    const point=async(pageIndex,x,y)=>editor.evaluate(({pageIndex,x,y})=>{
      const ih=window.rhwpStudio.plugins.deps.getInputHandler(),sc=document.getElementById('scroll-content');
      const b=sc.getBoundingClientRect(),z=ih.viewportManager.getZoom();
      const clientX=b.left+ih.virtualScroll.getPageLeftResolved(pageIndex,sc.clientWidth)+x*z;
      const clientY=b.top+ih.virtualScroll.getPageOffset(pageIndex)+y*z;
      return {x:clientX,y:clientY,hit:window.rhwpStudio.collaboration.hitTest({clientX,clientY}),scrollTop:ih.container.scrollTop};
    },{pageIndex,x,y});
    const state=()=>editor.evaluate(()=>{
      const ih=window.rhwpStudio.plugins.deps.getInputHandler(),caret=document.querySelector('.caret');
      return {position:ih.cursor.getPosition(),rect:ih.cursor.getRect(),selection:ih.cursor.getSelection(),scrollTop:ih.container.scrollTop,
        caret:caret.getBoundingClientRect().toJSON(),viewport:ih.container.getBoundingClientRect().toJSON(),focused:document.activeElement===ih.textarea};
    });
    await editor.evaluate(()=>{
      const ih=window.rhwpStudio.plugins.deps.getInputHandler();
      ih.container.scrollTop=ih.virtualScroll.getPageOffset(2);
      window.__cellCaretKeys=[];
      document.addEventListener('keydown',event=>window.__cellCaretKeys.push({key:event.key,trusted:event.isTrusted}),true);
    });
    await settle();
    const continuation=await point(2,300,50);
    assert.equal(continuation.hit.position.cellIndex,1,'the blank continuation belongs to the right cell');
    assert.equal(continuation.hit.position.cursorRect.pageIndex,0,'the right cell text ends on the first physical page');
    await page.mouse.click(box.x+continuation.x,box.y+continuation.y);await settle();
    const moved=await state();
    assert.equal(moved.rect.pageIndex,0);
    assert.ok(moved.caret.top>=moved.viewport.top&&moved.caret.bottom<=moved.viewport.bottom,'resolved insertion caret is visible');
    assert.ok(moved.caret.height>0&&moved.caret.height<40,'caret uses the text line height');
    assert.ok(moved.focused,'editor input retains DOM focus');

    // P opens object properties only for an object selection. Cell text must
    // retain P/C/L typing even though the ribbon can open table properties.
    for(const letter of ['p','c','l']) {
      const before=await editor.evaluate(()=>{
        const d=window.rhwpStudio.plugins.deps,p=d.getInputHandler().cursor.getPosition();
        return {position:p,text:d.wasm.doc.getTextInCellByPath(p.sectionIndex,p.parentParaIndex,JSON.stringify(p.cellPath),0,65535),scan:d.wasm.doc.getTextFileText()};
      });
      await page.keyboard.type(letter);await settle();
      const text=await editor.evaluate(p=>window.rhwpStudio.plugins.deps.wasm.doc.getTextInCellByPath(p.sectionIndex,p.parentParaIndex,JSON.stringify(p.cellPath),0,65535),before.position);
      assert.equal(text,before.text.slice(0,before.position.charOffset)+letter+before.text.slice(before.position.charOffset));
      assert.equal(await editor.locator('.modal-overlay').count(),0,'plain cell text does not open a property dialog');
      await page.keyboard.press('Control+z');await settle();
      assert.equal(await editor.evaluate(()=>window.rhwpStudio.plugins.deps.wasm.doc.getTextFileText()),before.scan,'undo restores the document text');
    }

    await editor.evaluate(()=>{window.rhwpStudio.plugins.deps.getInputHandler().container.scrollTop=0;});await settle();
    const same=await point(0,30,30);
    await page.mouse.click(box.x+same.x,box.y+same.y);await settle();
    const sameAfter=await state();assert.equal(sameAfter.rect.pageIndex,0);assert.equal(sameAfter.scrollTop,same.scrollTop);
    const height=()=>editor.evaluate(()=>{
      const d=window.rhwpStudio.plugins.deps,p=d.getInputHandler().cursor.getPosition();
      return JSON.parse(d.wasm.doc.getCellProperties(p.sectionIndex,p.parentParaIndex,p.controlIndex,p.cellIndex)).height;
    });
    const initialHeight=await height();
    await page.keyboard.press('F5');await settle();
    assert.ok(await editor.locator('.cell-selection-highlight').count(),'F5 highlights the selected cell');
    await page.keyboard.press('Control+ArrowDown');await settle();
    const enlargedHeight=await height();
    assert.ok(enlargedHeight>initialHeight,'Ctrl+Down increases the saved row height');
    await page.keyboard.press('Control+ArrowUp');await settle();
    assert.equal(await height(),initialHeight,'Ctrl+Up reverses the resize');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');await settle();
    assert.equal(await height(),enlargedHeight,'Undo restores the preceding height');
    await page.keyboard.press('Control+z');await settle();
    assert.equal(await height(),initialHeight,'Undo restores the original row height');
    await page.mouse.click(box.x+same.x,box.y+same.y);await settle();
    const end=await point(0,90,30);
    await page.mouse.move(box.x+same.x,box.y+same.y);await page.mouse.down();
    await page.mouse.move(box.x+end.x,box.y+end.y,{steps:8});await page.mouse.up();await settle();
    const dragged=await state();assert.ok(dragged.selection,'same-page text drag still selects text');assert.equal(dragged.scrollTop,sameAfter.scrollTop);

    // Direct selection is setup only; the property shortcut is a real key.
    await editor.evaluate(()=>{
      const ih=window.rhwpStudio.plugins.deps.getInputHandler();ih.cursor.clearSelection();
      ih.cursor.enterTableObjectSelection();ih.textarea.focus();
    });
    await page.keyboard.press('p');
    const dialog=editor.locator('.modal-overlay .tcp-dialog');await dialog.waitFor({state:'visible',timeout:5000});
    await dialog.getByRole('button',{name:'취소',exact:true}).click();
    assert.ok((await editor.evaluate(()=>window.__cellCaretKeys)).filter(event=>['p','c','l'].includes(event.key)).every(event=>event.trusted));
  } finally {
    await browser.close();await new Promise(resolve=>app.server.close(resolve));
  }
});
