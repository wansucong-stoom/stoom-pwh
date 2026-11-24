/* global document, window */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {waitForInlineEditor} from '../tests/helpers/editor-ready.mjs';
import {directConnection,initializeDirect} from '../desktop/standalone-pwh/official-codex-runtime.mjs';

const exec=promisify(execFile);

export async function verifyMacDesktop(app){
 const playwright=process.env.PWH_MACOS_TEST_PLAYWRIGHT;
 if(!playwright||!path.isAbsolute(playwright))throw Error('Set PWH_MACOS_TEST_PLAYWRIGHT to the Playwright module file');
 const {_electron}=await import(pathToFileURL(playwright).href);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-mac-app-test-'));
 const contents=path.join(app,'Contents');
 const runtimeRoot=path.join(contents,'Resources','app');
 const cli=path.join(runtimeRoot,'engine','rhwp','rhwp');
 const hwpx=path.join(directory,'맥 편집 시험.hwpx');
 const hwp=path.join(directory,'이전 형식.hwp');
 let electron;
 try{
  const standalone=path.join(runtimeRoot,'standalone-pwh');
  const runtime=await import(pathToFileURL(path.join(standalone,'codex-native-host.mjs')).href);
  const client=await directConnection({runtime,root:path.join(standalone,'codex-runtime'),home:path.join(directory,'ai-runtime'),accessToken:'packaging-test-placeholder'});
  try{await initializeDirect(client);}finally{client.close();}

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
  await visibleTab().locator('#provider-label').filter({hasText:/^ChatGPT$/}).waitFor({state:'attached'});
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
  await visibleTab().locator('#document-notice').filter({hasText:'HWP 원본 보존 · HWPX로 저장'}).waitFor({state:'attached'});
  await waitForInlineEditor(editor());
  await page.waitForFunction(()=>document.body.classList.contains('integrated-tabs'));
  assert.equal(await editor().locator('body').evaluate(()=>window.pwhEditor.context().paragraph?.text),'Mac HWP import');
  assert.deepEqual(await fs.readFile(hwp),hwpBefore);

  await electron.evaluate(({shell})=>{
   shell.openExternal=async url=>{globalThis.pwhTestLoginUrl=url;};
  });
  await visibleTab().getByRole('button',{name:'대화 설정 열기'}).click();
  const settings=visibleTab().locator('#settings-dialog');
  await settings.getByRole('radio',{name:'설치된 Codex(비공식 실험 환경)'}).waitFor();
  assert.equal(await electron.evaluate(()=>globalThis.pwhTestLoginUrl??null),null);
  await settings.locator('#connection-chatgpt-login').click();
  const accountStatus=settings.locator('#chatgpt-status');
  await accountStatus.filter({hasText:'브라우저에서 로그인을 완료해 주세요.'}).waitFor();
  const authorize=new URL(await electron.evaluate(()=>globalThis.pwhTestLoginUrl));
  assert.equal(authorize.origin,'https://auth.openai.com');
  assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
  const paths=await page.locator('#documents iframe').evaluateAll(frames=>frames.map(frame=>frame.src));
  assert.equal(paths.length,2);
  const statusFromTab=async url=>{
   const endpoint=new URL('chatgpt/status',url);
   const response=await fetch(endpoint,{method:'POST',headers:{origin:endpoint.origin,'x-pwh-request':'1', 'content-type':'application/json'},body:'{}'});
   assert.equal(response.status,200);
   return response.json();
  };
  for(const url of paths)assert.equal((await statusFromTab(url)).pending,true);
  const callback=new URL(authorize.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname,'127.0.0.1');
  assert.equal(callback.pathname,'/auth/callback');
  callback.searchParams.set('state',authorize.searchParams.get('state'));
  callback.searchParams.set('error','access_denied');
  assert.equal((await fetch(callback)).status,400);
  await accountStatus.filter({hasText:'승인이 취소되었습니다.'}).waitFor();
  for(const url of paths)assert.equal((await statusFromTab(url)).pending,false);
  const credentialFile=path.join(directory,'data','chatgpt-auth','credentials.dat');
  const encrypted=await fs.readFile(credentialFile);
  assert.ok(encrypted.length>0);
  assert.ok(!encrypted.includes(Buffer.from(authorize.searchParams.get('ext_agent_host_id'))));
  const restored=await electron.evaluate(async({safeStorage},bytes)=>{
   const {result}=await safeStorage.decryptStringAsync(Buffer.from(bytes,'base64'));
   return JSON.parse(result).hostId;
  },encrypted.toString('base64'));
  assert.equal(restored,authorize.searchParams.get('ext_agent_host_id'));
  return {electronWindow:true,newDocument:true,koreanText:true,commandSave:true,savedAndReopenedHwpx:true,openedLegacyHwp:true,originalPreserved:true,codexConnectionVisible:true,bundledChatgptRuntime:true,sharedChatgptLogin:true,macKeychainEncryption:true};
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
