import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('AI settings is reachable at the top right when the chat is closed',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop build and browser paths':false,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-settings-button-'));process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));const app=await createWorkspaceServer({updateServices:{check:async()=>null}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:900,height:800}});await page.goto(app.url);await page.getByRole('button',{name:'새 문서 빈 문서에서 시작하기'}).click();
  const child=page.frameLocator('#documents iframe').first(),editor=child.frameLocator('#editor');
  await editor.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});
  await child.locator('#close-ai').click();await child.locator('main.ai-closed').waitFor({state:'attached'});
  const edit=await editor.getByRole('button',{name:'AI 수정 요청'}).boundingBox(),open=await editor.getByRole('button',{name:'AI 대화 열기'}).boundingBox();
  assert.ok(edit&&open);assert.equal(edit.width,open.width);assert.equal(edit.height,open.height);assert.equal(edit.x,open.x);
  const button=editor.getByRole('button',{name:'AI 설정'}),header=editor.locator('#pwh-header');const b=await button.boundingBox(),h=await header.boundingBox();
  assert.ok(b&&h&&b.x+b.width<=h.x+h.width&&h.x+h.width-(b.x+b.width)<25,'settings button remains at the header right edge');
  await button.click();const dialog=child.getByRole('dialog',{name:'AI 연결'});await dialog.waitFor({state:'visible'});
  assert.equal(await dialog.getByRole('radio',{name:'설치된 Codex(비공식 실험 환경)'}).count(),1);
  await child.locator('#settings-close').click();await dialog.waitFor({state:'hidden'});assert.equal(await editor.locator('#editor-area').isVisible(),true);
 }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
