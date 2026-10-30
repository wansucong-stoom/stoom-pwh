import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('note cursor keeps text input, arrow movement, cancel, deletion and undo in the correct source position',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop, browser and core paths':false,timeout:180000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-note-delete-')),file=path.join(dir,'notes.hwpx'),doc=HwpDocument.createEmpty();doc.createBlankDocument();
 const targets=[{para:0,at:0,kind:'Endnote'},{para:1,at:1,kind:'Footnote'},{para:2,at:4,kind:'Endnote'}];
 for(const t of targets){if(t.para)doc.insertParagraph(0,t.para);doc.insertText(0,t.para,0,'ABCD');doc.applyCharFormat(0,t.para,1,3,JSON.stringify({bold:true,textColor:'#123456'}));doc['insert'+t.kind](0,t.para,t.at);}
 await fs.writeFile(file,doc.exportHwpx());doc.free();process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
 const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));const app=await createAppServer({initialPath:file});const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1300,height:950}});await page.goto(app.url);const editor=page.frames().find(f=>/\/editor\?/.test(f.url()));await editor.waitForFunction(()=>window.pwhRecoveryReady?.()===true,null,{timeout:120000});
  if(!await editor.evaluate(()=>window.rhwpStudio.plugins.deps.wasm.getShowControlCodes()))await editor.locator('button[data-cmd="view:ctrl-mark"]').click();
  const box=await page.locator('#editor').boundingBox();
  for(const target of targets){
   const before=await editor.evaluate(t=>{const w=window.rhwpStudio.plugins.deps.wasm;return w.getCharShapeRuns(0,t.para,0,4);},target);
   const point=await editor.evaluate(t=>{const ih=window.rhwpStudio.plugins.deps.getInputHandler(),w=ih.wasm,r=w.getBodyCursorRect({sectionIndex:0,paragraphIndex:t.para,charOffset:t.at,bodyCursor:{sectionIndex:0,paragraphIndex:t.para,textOffset:t.at,logicalOffset:t.at+1}}),zoom=ih.viewportManager.getZoom(),sc=ih.container.querySelector('#scroll-content'),b=sc.getBoundingClientRect();return{x:b.x+ih.virtualScroll.getPageLeftResolved(r.pageIndex,sc.clientWidth)+(r.x-.1)*zoom,y:b.y+ih.virtualScroll.getPageOffset(r.pageIndex)+(r.y+Math.min(6,r.height/2))*zoom};},target);
   await page.mouse.click(box.x+point.x,box.y+point.y);let c=await editor.evaluate(()=>window.pwhEditor.context());assert.equal(c.cursor.paragraphIndex,target.para);assert.equal(c.cursor.charOffset,target.at);
   await page.keyboard.type('X');assert.equal(await editor.evaluate(t=>window.rhwpStudio.plugins.deps.wasm.getTextRange(0,t.para,0,5),target),'ABCD'.slice(0,target.at)+'X'+'ABCD'.slice(target.at),'typing after a note uses the text coordinate');
   await page.keyboard.press('Control+z');
   await page.keyboard.press('ArrowLeft');c=await editor.evaluate(()=>window.pwhEditor.context());assert.equal(c.cursor.charOffset,target.at);assert.equal(c.cursor.bodyCursor.logicalOffset,target.at,'left moves before the same note');
   await page.keyboard.press('Delete');let forwardConfirm=editor.locator('.modal-overlay .dialog-wrap').last();await forwardConfirm.waitFor({state:'visible'});await forwardConfirm.getByRole('button',{name:'취소',exact:true}).click();
   await page.keyboard.press('ArrowRight');c=await editor.evaluate(()=>window.pwhEditor.context());assert.equal(c.cursor.charOffset,target.at);assert.equal(c.cursor.bodyCursor.logicalOffset,target.at+1,'right moves after the same note');
   if(target.at<4){
    await page.keyboard.press('ArrowRight');await page.keyboard.press('Backspace');
    assert.equal(await editor.evaluate(t=>window.rhwpStudio.plugins.deps.wasm.getTextRange(0,t.para,0,4),target),'ABCD'.slice(0,target.at)+'ABCD'.slice(target.at+1));
    await page.keyboard.type('Y');assert.equal(await editor.evaluate(t=>window.rhwpStudio.plugins.deps.wasm.getTextRange(0,t.para,0,4),target),'ABCD'.slice(0,target.at)+'Y'+'ABCD'.slice(target.at+1),'editing adjacent text preserves the note side');
    await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');
    assert.equal(await editor.evaluate(t=>window.rhwpStudio.plugins.deps.wasm.getTextRange(0,t.para,0,4),target),'ABCD');
    c=await editor.evaluate(()=>window.pwhEditor.context());assert.equal(c.cursor.charOffset,target.at+1);
    await page.keyboard.press('ArrowLeft');c=await editor.evaluate(()=>window.pwhEditor.context());assert.equal(c.cursor.charOffset,target.at);assert.equal(c.cursor.bodyCursor.logicalOffset,target.at+1,'undoing text retains the source note boundary');
   }
   await page.keyboard.press('Backspace');const confirm=editor.locator('.modal-overlay .dialog-wrap').last();await confirm.waitFor({state:'visible'});assert.match(await confirm.innerText(),/각주·미주/);await confirm.getByRole('button',{name:'취소',exact:true}).click();
   assert.equal(await editor.evaluate(t=>window.rhwpStudio.plugins.deps.wasm.getFootnoteAtCursor(0,t.para,t.at+1,'backward').hit,target),true);
   await page.keyboard.press('Backspace');await confirm.waitFor({state:'visible'});await confirm.locator('.dialog-btn-primary').click();await confirm.waitFor({state:'detached'});
   assert.equal(await editor.evaluate(t=>window.rhwpStudio.plugins.deps.wasm.getTextRange(0,t.para,0,4),target),'ABCD');assert.deepEqual(await editor.evaluate(t=>window.rhwpStudio.plugins.deps.wasm.getCharShapeRuns(0,t.para,0,4),target),before);
   await page.keyboard.press('Control+z');assert.equal(await editor.evaluate(t=>window.rhwpStudio.plugins.deps.wasm.getFootnoteAtCursor(0,t.para,t.at+1,'backward').hit,target),true,'undo restores the note');
  }
 }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
