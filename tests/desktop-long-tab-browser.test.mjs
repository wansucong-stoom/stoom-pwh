import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('a long document tab keeps its close button visible and working',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Set Desktop, core and browser paths':false,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-long-tab-'));process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
 const app=await createWorkspaceServer({updateServices:{check:async()=>null}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const doc=HwpDocument.createEmpty();doc.createBlankDocument();const bytes=Array.from(doc.exportHwpx());doc.free();
  const filename='2026학년도 혁신 아이디어 경진대회 운영계획을 검토하기 위한 아주 긴 문서 이름.hwpx';
  const page=await browser.newPage({viewport:{width:1200,height:850}});if(process.env.PWH_TAB_DEBUG)page.on('console',m=>console.log('BROWSER',m.type(),m.text()));await page.goto(app.url);
  await page.getByRole('button',{name:'새 문서 빈 문서에서 시작하기'}).click();
  const first=page.frameLocator('#documents iframe').first(),firstEditor=first.frameLocator('#editor');
  if(process.env.PWH_TAB_DEBUG){await page.waitForTimeout(5000);console.log('FRAMES',page.frames().map(f=>f.url()));for(const f of page.frames())console.log('FRAME',f.url(),(await f.locator('body').innerText().catch(()=>'' )).slice(0,400));}
  await firstEditor.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});
  await first.locator('body').evaluate((_,{bytes,filename})=>{
   const file=new File([Uint8Array.from(bytes)],filename,{type:'application/octet-stream'});
   window.parent.postMessage({type:'pwh-workspace-drop',files:[file]},new URL(location.href).searchParams.get('workspaceOrigin'));
  },{bytes,filename});
  await page.waitForFunction(()=>document.querySelectorAll('#documents iframe').length===2,null,{timeout:30000});
  const second=page.frameLocator('#documents iframe').nth(1),editor=second.frameLocator('#editor');
  const tab=editor.locator('.pwh-desktop-tab[aria-selected="true"]');await tab.locator('.pwh-desktop-tab-name').filter({hasText:filename}).waitFor({timeout:60000});
  await editor.locator('body').evaluate(async()=>{for(let i=0;i<600;i++){if(window.pwhRecoveryReady?.()===true)return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('editor did not finish loading');});
  const close=tab.locator('.pwh-desktop-tab-close');
  for(const width of [1200,800,650]){
   await page.setViewportSize({width,height:850});
   const geometry=await editor.locator('body').evaluate(async(_,filename)=>{let result;for(let i=0;i<100;i++){const el=document.querySelector('.pwh-desktop-tab[aria-selected="true"] .pwh-desktop-tab-close'),item=el?.closest('.pwh-desktop-tab'),strip=el?.closest('[role=tablist]'),name=item?.querySelector('.pwh-desktop-tab-name');if(el&&item&&strip&&name&&name.title.startsWith(filename)){const button=el.getBoundingClientRect(),tab=item.getBoundingClientRect(),list=strip.getBoundingClientRect();result={button:{left:button.left,right:button.right,width:button.width},tab:{left:tab.left,right:tab.right},list:{left:list.left,right:list.right},overflow:name.scrollWidth>name.clientWidth,title:name.title};if(button.right<=list.right+1)break;}await new Promise(resolve=>setTimeout(resolve,50));}return result;},filename);
   assert.ok(geometry,'active tab is available');
   assert.ok(geometry.button.width>=20,'close button keeps a usable width');
   assert.ok(geometry.button.right<=geometry.tab.right+1,'close stays inside the tab');
   assert.ok(geometry.button.right<=geometry.list.right+1,'close is not clipped by the tab strip');
   assert.equal(geometry.overflow,true,'long file name is ellipsized');assert.ok(geometry.title.startsWith(filename),'full file name remains available');
  }
  await page.setViewportSize({width:1200,height:850});await close.click();
  await page.waitForFunction(()=>document.querySelectorAll('#documents iframe').length===1,null,{timeout:15000});
 }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
