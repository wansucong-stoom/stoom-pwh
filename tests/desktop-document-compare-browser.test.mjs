import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {waitForInlineEditor} from './helpers/editor-ready.mjs';

test('comparing two files leaves the edited tab and its undo history intact', {
  skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT||!process.env.PWH_CORE_JS,
  timeout:120000,
},async()=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  function documentBytes(text, legacy=false){
    const doc=core.HwpDocument.createEmpty();
    try {
      doc.createBlankDocument();
      doc.insertText(0,0,0,text);
      return Buffer.from(legacy?doc.exportHwp():doc.exportHwpx());
    } finally {doc.free();}
  }
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-compare-test-'));
  process.env.PWH_STANDALONE_DATA=path.join(temp,'profile');
  const left=path.join(temp,'비교 원본.hwp'),right=path.join(temp,'비교 수정본.hwpx');
  const leftBytes=documentBytes('Comparison text before the documentation change',true);
  const rightBytes=documentBytes('Comparison text after the documentation change');
  await fs.writeFile(left,leftBytes);
  await fs.writeFile(right,rightBytes);
  const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  const app=await createAppServer({initialBytes:documentBytes('Working document')});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(app.url);
    const editor=page.frameLocator('#editor');
    await waitForInlineEditor(editor);
    const input=editor.getByRole('textbox',{name:'문서 편집 입력'});
    await input.press('End');
    await page.keyboard.insertText(' with unsaved edits');
    const state=()=>editor.locator('body').evaluate(()=>{
      const {paragraph,documentState}=window.pwhEditor.context();
      return {text:paragraph.text,documentState};
    });
    const before=await state();
    assert.equal(before.text,'Working document with unsaved edits');
    await editor.locator('[data-menu="tool"] .menu-title').click();
    await editor.getByRole('button',{name:'문서 비교',exact:true}).click();
    const dialog=editor.getByRole('dialog',{name:'문서 비교',exact:true});
    const picks=dialog.locator('.compare-row button');
    async function choose(index){
      const chooser=page.waitForEvent('filechooser');
      await picks.nth(index).click();
      return chooser;
    }
    const cancelled=await choose(0);
    await cancelled.element().evaluate(input=>input.dispatchEvent(new Event('cancel')));
    await (await choose(0)).setFiles(left);
    await dialog.getByText('비교 원본.hwp',{exact:true}).waitFor();
    await (await choose(1)).setFiles(right);
    await dialog.getByText('비교 수정본.hwpx',{exact:true}).waitFor();
    await dialog.locator('.compare-actions button').first().click();
    await dialog.locator('.compare-result-item').first().waitFor();
    assert.deepEqual(await state(),before);
    await page.setViewportSize({width:420,height:750});
    assert.equal(await dialog.evaluate(node=>{
      const rect=node.getBoundingClientRect();
      return rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight;
    }),true,'the comparison controls fit inside a narrow editor');
    await page.setViewportSize({width:1440,height:900});
    await dialog.locator('.compare-result-item').first().click();
    await editor.locator('.compare-inspector-window').waitFor();
    assert.deepEqual(await state(),before);
    await editor.locator('.compare-inspector-window .dialog-close').click();
    await dialog.locator('.dialog-close').click();
    await input.focus();
    await page.keyboard.press('Control+z');
    assert.equal((await state()).text,'Working document');
    assert.deepEqual(await fs.readFile(left),leftBytes);
    assert.deepEqual(await fs.readFile(right),rightBytes);
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();
    await new Promise(resolve=>app.server.close(resolve));
    await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
