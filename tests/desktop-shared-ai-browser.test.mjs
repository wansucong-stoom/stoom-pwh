import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';

test('AI pane visibility is shared across document tabs without sharing their drafts',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop build and browser paths':false,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-shared-ai-'));process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));const app=await createWorkspaceServer({updateServices:{check:async()=>null}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:850}});await page.goto(app.url);await page.getByRole('button',{name:'새 문서 빈 문서에서 시작하기'}).click();
  const child=index=>page.frameLocator('#documents iframe').nth(index),editor=index=>child(index).frameLocator('#editor');
  const ready=async index=>{await editor(index).locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});for(let attempt=0;attempt<4;attempt++){try{await editor(index).locator('body').evaluate(async()=>{for(let i=0;i<600;i++){if(window.pwhRecoveryReady?.()===true)return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('editor not ready');});return;}catch(error){if(attempt===3)throw error;}}};
  await ready(0);await child(0).locator('#prompt').fill('첫 번째 문서의 요청');
  await editor(0).getByRole('button',{name:'새 문서 탭'}).click();await page.waitForFunction(()=>document.querySelectorAll('#documents iframe').length===2);await ready(1);
  await child(1).locator('#prompt').fill('두 번째 문서의 요청');await child(1).locator('#close-ai').click();
  await child(0).locator('main.ai-closed').waitFor({state:'attached'});await child(1).locator('main.ai-closed').waitFor({state:'attached'});
  await editor(1).getByRole('button',{name:'AI 대화 열기'}).click();
  await child(0).locator('main.ai-closed').waitFor({state:'detached'});await child(1).locator('main.ai-closed').waitFor({state:'detached'});
  assert.equal(await child(0).locator('#prompt').inputValue(),'첫 번째 문서의 요청');assert.equal(await child(1).locator('#prompt').inputValue(),'두 번째 문서의 요청');
  await child(1).locator('#close-ai').click();await child(0).locator('main.ai-closed').waitFor({state:'attached'});
  await editor(1).getByRole('button',{name:'새 문서 탭'}).click();await page.waitForFunction(()=>document.querySelectorAll('#documents iframe').length===3);await ready(2);
  await child(2).locator('main.ai-closed').waitFor({state:'attached'});
 }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
