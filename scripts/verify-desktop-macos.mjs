/* global document, window */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {waitForInlineEditor} from '../tests/helpers/editor-ready.mjs';

const exec=promisify(execFile);

export async function verifyMacDesktop(app){
 const playwright=process.env.PWH_MACOS_TEST_PLAYWRIGHT;
 if(!playwright||!path.isAbsolute(playwright))throw Error('Set PWH_MACOS_TEST_PLAYWRIGHT to the Playwright module file');
 const {_electron}=await import(pathToFileURL(playwright).href);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-mac-app-test-'));
 const contents=path.join(app,'Contents');
 const cli=path.join(contents,'Resources','app','engine','rhwp','rhwp');
 const hwpx=path.join(directory,'맥 편집 시험.hwpx');
 const hwp=path.join(directory,'이전 형식.hwp');
 let electron;
 try{
  const spec=path.join(directory,'fixture.json'),seed=path.join(directory,'fixture.hwpx');
  await fs.writeFile(spec,JSON.stringify({version:'1',title:'Mac HWP import',blocks:[{type:'paragraph',text:'Mac HWP import'}]}));
  await exec(cli,['scaffold',spec,'-o',seed,'--json']);
  await exec(cli,['convert',seed,hwp,'--json']);
  const hwpBefore=await fs.readFile(hwp);
  assert.equal(hwpBefore.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');

  electron=await _electron.launch({
   executablePath:path.join(contents,'MacOS','Electron'),
   args:[],
   cwd:directory,
   timeout:30000,
   env:{...process.env,PWH_DESKTOP_DATA_ROOT:path.join(directory,'data'),PWH_ELECTRON_TEST_HIDDEN:'0'},
  });
  const page=await electron.firstWindow({timeout:30000});
  page.setDefaultTimeout(30000);
  await page.locator('#home-new').waitFor({state:'visible'});
  // Simulate the user's choice while exercising the real child IPC and save path.
  await electron.evaluate(({dialog},target)=>{
   dialog.showSaveDialog=async (_window,options)=>{
    if(options.title!=='문서 저장'||options.filters[0].extensions[0]!=='hwpx')throw Error('Unexpected save dialog options');
    return {canceled:false,filePath:target};
   };
  },hwpx);
  await page.locator('#home-new').click();
  const visibleTab=()=>page.frameLocator('#documents iframe:not([hidden])');
  const editor=()=>visibleTab().frameLocator('#editor');
  await waitForInlineEditor(editor());
  await page.waitForFunction(()=>document.body.classList.contains('integrated-tabs'));
  const text='맥용 Pwh 편집 시험';
  await editor().getByRole('textbox',{name:'문서 편집 입력'}).focus();
  await page.keyboard.insertText(text);
  assert.equal(await editor().locator('body').evaluate(()=>window.pwhEditor.context().paragraph?.text),text);
  await page.keyboard.press('Meta+s');
  await visibleTab().locator('#status').filter({hasText:'저장했습니다.'}).waitFor({state:'attached'});
  const saved=await fs.readFile(hwpx);
  assert.equal(saved.subarray(0,2).toString(),'PK');

  await editor().locator('.pwh-desktop-tab[aria-selected=true] .pwh-desktop-tab-close').click();
  await page.locator('#tabs [role=tab]').waitFor({state:'detached'});
  const openFile=file=>electron.evaluate(({app},file)=>app.emit('open-file',{preventDefault(){}},file),file);
  await openFile(hwpx);
  await waitForInlineEditor(editor());
  await page.waitForFunction(()=>document.body.classList.contains('integrated-tabs'));
  assert.equal(await editor().locator('body').evaluate(()=>window.pwhEditor.context().paragraph?.text),text);
  assert.deepEqual(await fs.readFile(hwpx),saved);

  await openFile(hwp);
  await visibleTab().getByText('HWP 원본 보존 · HWPX로 저장',{exact:true}).waitFor();
  await waitForInlineEditor(editor());
  await page.waitForFunction(()=>document.body.classList.contains('integrated-tabs'));
  assert.deepEqual(await fs.readFile(hwp),hwpBefore);
  return {electronWindow:true,newDocument:true,koreanText:true,commandSave:true,savedAndReopenedHwpx:true,openedLegacyHwp:true,originalPreserved:true};
 }finally{
  if(electron){
   const child=electron.process();
   if(child.exitCode===null&&child.signalCode===null){
    const closed=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');
    const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
    try{await closed;}finally{clearTimeout(timeout);}
   }
  }
  await fs.rm(directory,{recursive:true,force:true});
 }
}
