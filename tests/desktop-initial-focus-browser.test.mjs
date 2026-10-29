import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('Desktop restores initial editor focus without taking focus from chat', {
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop build and browser paths':false,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-initial-focus-'));process.env.PWH_STANDALONE_DATA=path.join(temp,'data');
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
 const app=await createWorkspaceServer({nativeBranding:{token:'1234567890abcdef1234567890abcdef',complete:true},updateServices:{check:async()=>null}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  // Reproduce an editor trying to focus while its native window is not ready.
  await page.addInitScript(()=>{const focus=HTMLElement.prototype.focus;window.__pwhTestFocusAllowed=false;HTMLElement.prototype.focus=function(...args){if(this.getAttribute('aria-label')==='문서 편집 입력'&&!window.__pwhTestFocusAllowed)return;return focus.apply(this,args);};});
  await page.goto(app.url);
  const child=page.frameLocator('#documents iframe').first(),editor=child.frameLocator('#editor');
  await editor.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});await child.locator('#status').filter({hasText:'조판기 준비 완료'}).waitFor({timeout:60000});
  await editor.locator('body').evaluate(()=>window.__pwhTestFocusAllowed=true);
  if(process.env.PWH_FOCUS_DEBUG){console.log('root',await page.evaluate(()=>({has:document.hasFocus(),active:document.activeElement?.tagName})));console.log('child',await child.locator('body').evaluate(()=>({has:document.hasFocus(),active:document.activeElement?.id})));console.log('editor',await editor.locator('body').evaluate(()=>({has:document.hasFocus(),active:document.activeElement?.tagName,ready:window.pwhEditor?.context?.().ready,recovery:window.pwhRecoveryReady?.(),dialogs:[...document.querySelectorAll('dialog[open],.modal-overlay')].map(x=>x.outerHTML.slice(0,100))})));}
  await editor.locator('body').evaluate(async()=>{const input=document.querySelector('[aria-label="문서 편집 입력"]');for(let i=0;i<40;i++){if(document.activeElement===input&&document.hasFocus())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('editor focus was not restored');});
  await page.keyboard.type('initial');assert.equal(await editor.locator('body').evaluate(()=>window.pwhEditor.context().paragraph.text),'initial');
  await editor.getByRole('button',{name:'새 문서 탭'}).click();await page.waitForFunction(()=>document.querySelectorAll('#documents iframe').length===2,null,{timeout:60000});
  const child2=page.frameLocator('#documents iframe').nth(1),editor2=child2.frameLocator('#editor');await editor2.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});await child2.locator('#status').filter({hasText:'조판기 준비 완료'}).waitFor({timeout:60000});
  await child2.locator('#prompt').focus();await editor2.locator('body').evaluate(()=>window.__pwhTestFocusAllowed=true);await page.waitForTimeout(600);
  assert.equal(await child2.locator('#prompt').evaluate(el=>document.activeElement===el),true,'chat retains focus');await page.keyboard.type('chat');assert.equal(await child2.locator('#prompt').inputValue(),'chat');
 }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));}
});
