import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('print opens one native workflow while preview and image export stay separate',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop build and browser paths':false,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-print-'));
 process.env.PWH_STANDALONE_DATA=path.join(dir,'data');const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
 const app=await createWorkspaceServer({updateServices:{check:async()=>null}}),browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:850}});await page.context().addInitScript(()=>{window.print=()=>{window.__pwhPrintCalls=(window.__pwhPrintCalls||0)+1;};});
  await page.goto(app.url);await page.getByRole('button',{name:'새 문서 빈 문서에서 시작하기'}).click();
  const child=page.frameLocator('#documents iframe').first(),editor=child.frameLocator('#editor');
  await editor.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});
  await editor.locator('body').evaluate(async()=>{for(let i=0;i<600;i++){if(window.pwhRecoveryReady?.())return;await new Promise(r=>setTimeout(r,100));}throw Error('editor not ready');});
  const direct=async action=>{const next=page.waitForEvent('popup');await action();const printed=await next;await printed.waitForFunction(()=>window.__pwhPrintCalls===1,null,{timeout:30000});assert.equal(await printed.locator('.page svg').count(),1);assert.equal(await child.locator('#output-dialog[open]').count(),0);const closed=printed.waitForEvent('close');await printed.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await closed;};
  await editor.locator('[data-menu="file"] .menu-title').click();assert.equal(await editor.locator('[data-cmd="file:print"] .md-shortcut').textContent(),'Alt+P');
  await direct(()=>editor.locator('[data-cmd="file:print"]').click());
  for(const key of ['Alt+p','Control+p']){await editor.getByRole('textbox',{name:'문서 편집 입력'}).focus();await direct(()=>page.keyboard.press(key));}
  await editor.locator('[data-menu="file"] .menu-title').click();const next=page.waitForEvent('popup');await editor.locator('[data-pwh-file="print-preview"]').click();const preview=await next;
  await preview.locator('.page svg').first().waitFor({state:'attached'});await preview.locator('#print-btn').waitFor({state:'hidden'});assert.equal(await preview.evaluate(()=>window.__pwhPrintCalls||0),0);await preview.close();
  await editor.locator('[data-menu="file"] .menu-title').click();await editor.locator('[data-pwh-file="image-export"]').click();
  const dialog=child.getByRole('dialog',{name:'그림으로 저장'});await dialog.waitFor({state:'visible'});const size=await dialog.evaluate(el=>({dialog:el.getBoundingClientRect().height,content:el.querySelector('.output-content').getBoundingClientRect().height}));assert.ok(size.dialog<=size.content+4);await dialog.getByRole('button',{name:'취소'}).click();
 }finally{await browser.close();await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
