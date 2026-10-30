import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createElectronController} from '../desktop/standalone-pwh/electron-controller.mjs';

test('the native launcher pipe starts and closes its own Electron window',{
 skip:!process.env.PWH_ELECTRON_EXE||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set isolated Electron and Desktop build paths':false,timeout:45000,
},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-native-launch-'));process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
 let readyResolve,readyReject,diagnostic='',child;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const controller=await createElectronController({onReady:readyResolve,onFailure:readyReject});
 const app=await createWorkspaceServer({dataRoot:path.join(dir,'data'),nativeBranding:{token:'b'.repeat(32),complete:true,ready(){},closing(){},requestClose:controller.requestClose},updateServices:{check:async()=>null}});
 try{
  child=spawn(process.env.PWH_ELECTRON_EXE,[path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'electron-shell.cjs'),'--pwh-url='+app.url,'--pwh-host-pipe='+controller.pipe,'--pwh-host-token='+controller.token],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PWH_STANDALONE_DATA:path.join(dir,'data'),PWH_ELECTRON_TEST_HIDDEN:'1'}});
  controller.attachProcess(child);child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-2000);});
  child.once('exit',code=>{if(code)readyReject(Error(diagnostic||'Electron startup failed'));});
  await ready;const exited=new Promise(resolve=>child.once('exit',resolve));controller.requestClose();assert.equal(await exited,0);
 }finally{controller.close();if(child&&child.exitCode===null)child.kill();await new Promise(r=>app.server.close(r));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('bundled desktop shell opens, previews, and protects unsaved documents without Edge',{
 skip:!process.env.PWH_ELECTRON_EXE||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set isolated Electron and Desktop build paths':false,timeout:150000,
},async t=>{
 const { _electron:electron }=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-electron-shell-'));
 process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
 let running,childProcess,diagnostic='';const nativeBranding={token:'a'.repeat(32),complete:true,ready(){},closing(){},requestClose(){void running?.evaluate(({app})=>app.exit(0)).catch(()=>{});}};
 const server=await createWorkspaceServer({nativeBranding,updateServices:{check:async()=>null}});
 try{
  running=await electron.launch({executablePath:process.env.PWH_ELECTRON_EXE,args:[path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'electron-shell.cjs'),'--pwh-url='+server.url],env:{...process.env,PWH_STANDALONE_DATA:path.join(dir,'data'),PWH_ELECTRON_TEST_HIDDEN:'1','ProgramFiles(x86)':path.join(dir,'no-edge'),ProgramFiles:path.join(dir,'no-edge')}});
  childProcess=running.process();childProcess.stderr?.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4000);});
  const page=await running.firstWindow();await page.waitForLoadState();
  t.diagnostic('owned Electron window loaded');
  assert.equal(await page.evaluate(()=>typeof window.pwhNative.printDocument),'function');
  await assert.rejects(page.evaluate(()=>window.pwhNative.printDocument({printer:'not-a-printer',copies:1})),/인쇄 창/);
  await page.getByRole('button',{name:'새 문서 빈 문서에서 시작하기'}).click();
  const child=page.frameLocator('#documents iframe').first(),editor=child.frameLocator('#editor');
  await editor.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});
  await editor.locator('body').evaluate(async()=>{for(let i=0;i<600;i++){if(window.pwhRecoveryReady?.())return;await new Promise(r=>setTimeout(r,100));}throw Error('editor did not become ready');});
  await editor.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('Pwh print preview test');
  // Keep the physical printer boundary mocked; the real shell, IPC and rendered
  // document still run. A test must never submit paper or a PDF save job.
  await running.evaluate(({app})=>{globalThis.__pwhPrintJobs=[];app.on('web-contents-created',(_event,contents)=>{contents.getPrintersAsync=async()=>[{name:'Pwh Test Printer',displayName:'Pwh 시험 프린터',isDefault:true,status:0}];contents.print=(options,done)=>{void contents.executeJavaScript('({pages:document.querySelectorAll("#pwh-print-output .page svg").length,sheets:document.querySelectorAll("#pwh-print-output .pwh-print-sheet").length,title:document.title})').then(result=>{globalThis.__pwhPrintJobs.push({options,...result});done(false,'Print job canceled');});};});});
  const printWindow=running.waitForEvent('window');await editor.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Alt+p');const print=await printWindow;
  await print.getByRole('button',{name:'인쇄',exact:true}).waitFor({state:'visible',timeout:30000});
  await print.waitForFunction(()=>!document.getElementById('pwh-print-submit').disabled);
  assert.equal(await print.title(),'인쇄');assert.equal(await running.evaluate(()=>globalThis.__pwhPrintJobs.length),0,'showing preview never submits a print job');
  assert.equal(await print.locator('.pwh-print-paper-holder .page svg').count(),1);
  assert.equal((await print.locator('.pwh-print-paper-holder .page svg').textContent()).replace(/\s+/g,''),'Pwhprintpreviewtest');
  assert.equal(await print.locator('#pwh-range-field').isVisible(),false);
  await print.locator('#pwh-range').selectOption('custom');await print.locator('#pwh-range-text').fill('999');assert.equal(await print.getByRole('button',{name:'인쇄',exact:true}).isDisabled(),true);
  await print.locator('#pwh-range').selectOption('all');await print.locator('#pwh-copies').fill('2');await print.locator('#pwh-orientation').selectOption('landscape');
  if(process.env.PWH_PRINT_SCREENSHOT)await print.screenshot({path:process.env.PWH_PRINT_SCREENSHOT});
  await print.getByRole('button',{name:'인쇄',exact:true}).click();await print.getByRole('alert').filter({hasText:'인쇄를 취소했습니다.'}).waitFor();
  const jobs=await running.evaluate(()=>globalThis.__pwhPrintJobs);assert.equal(jobs.length,1);assert.equal(jobs[0].options.silent,true);assert.equal(jobs[0].options.copies,2);assert.equal(jobs[0].options.landscape,true);assert.deepEqual(jobs[0].options.pageSize,{width:210000,height:297000});assert.equal(jobs[0].pages,1);assert.equal(jobs[0].title,'document.hwpx');
  assert.equal(await child.locator('#output-dialog[open]').count(),0,'Alt+P uses only the combined preview window');
  await print.getByRole('button',{name:'취소',exact:true}).click();await child.locator('#status').filter({hasText:'인쇄를 취소했습니다.'}).waitFor({timeout:30000});
  await editor.locator('[data-menu="file"] .menu-title').click();
  const popup=running.waitForEvent('window');await editor.locator('[data-pwh-file="print-preview"]').click();const preview=await popup;
  await preview.locator('.page svg').first().waitFor({state:'attached',timeout:60000});await preview.locator('#print-btn').waitFor({state:'hidden'});await preview.close();
  await editor.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('test');
  await running.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().startsWith('Pwh Desktop'))?.close());
  const save=page.getByRole('dialog',{name:'변경 내용 저장'});await save.waitFor({state:'visible',timeout:30000});
  assert.ok((await save.boundingBox()).height<350,'save confirmation fits its content');await save.getByRole('button',{name:'취소'}).click();
  assert.equal(await editor.locator('#editor-area').isVisible(),true);
 }catch(error){if(diagnostic)t.diagnostic(diagnostic);throw error;}finally{
  if(running){await running.evaluate(({app})=>app.exit(0)).catch(()=>{});await Promise.race([running.close().catch(()=>{}),new Promise(r=>setTimeout(r,5000))]);if(childProcess?.exitCode===null)childProcess.kill();}
  await new Promise(resolve=>server.server.close(resolve));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
