import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('Desktop exposes Hancom table import from the edit menu',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop build and browser paths':false,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-native-menu-'));process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
 const app=await createWorkspaceServer({updateServices:{check:async()=>null}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:850}});await page.goto(app.url);
  await page.getByRole('button',{name:'새 문서 빈 문서에서 시작하기'}).click();
  const editor=page.frameLocator('#documents iframe').first().frameLocator('#editor');
  await editor.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});
  await editor.locator('body').evaluate(async()=>{for(let i=0;i<600;i++){if(window.pwhRecoveryReady?.()===true)return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('editor did not finish loading');});
  // Observe the menu route without reading or changing the OS clipboard.
  await editor.locator('body').evaluate(()=>{window.__nativeTableMenuTest=0;window.addEventListener('pwh-import-native-table',e=>{window.__nativeTableMenuTest++;e.stopImmediatePropagation();},true);});
  await editor.locator('[data-menu="edit"] .menu-title').click();
  await editor.locator('[data-pwh-native-table]').click();
  assert.equal(await editor.locator('body').evaluate(()=>window.__nativeTableMenuTest),1);
 }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
