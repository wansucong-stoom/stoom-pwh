import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('Desktop home preserves unsaved tabs and reopens real recent documents', {
  skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT||!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM,
  timeout:180000,
}, async () => {
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-home-ui-test-'));process.env.PWH_STANDALONE_DATA=path.join(dir,'data');
  const fixture=path.join(dir,'최근 업무.hwpx'), doc=core.HwpDocument.createEmpty();
  doc.createBlankDocument();doc.insertText(0,0,0,'최근 문서 시험');await fs.writeFile(fixture,doc.exportHwpx());doc.free();
  const before=await fs.readFile(fixture), {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
  let pickerCalls=0;
  const app=await createWorkspaceServer({nativeBranding:{token:'1234567890abcdef1234567890abcdef',complete:true},updateServices:{check:async()=>null},chooseFile:async({mode})=>{assert.equal(mode,'Open');pickerCalls++;return {cancelled:false,path:fixture};}});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(app.url);
    await page.getByRole('heading',{name:'어떤 문서를 작업할까요?'}).waitFor();
    await page.getByText('최근 문서가 없습니다').waitFor();assert.equal(await page.locator('#documents iframe').count(),0);
    if(process.env.PWH_HOME_SCREENSHOT)await page.screenshot({path:process.env.PWH_HOME_SCREENSHOT});
    for(const width of [700,420]){
      await page.setViewportSize({width,height:700});
      assert.ok(await page.locator('#home-view').evaluate(element=>element.scrollWidth<=element.clientWidth+1),`home screen overflows at ${width}px`);
      assert.equal(await page.locator('#home-new').isVisible(),true);assert.equal(await page.locator('#home-open').isVisible(),true);
    }
    await page.setViewportSize({width:1280,height:900});
    await page.getByRole('button',{name:'새 문서 빈 문서에서 시작하기'}).click();
    const child=page.frameLocator('#documents iframe').first(),editor=child.frameLocator('#editor');
    await editor.locator('#pwh-desktop-tabbar').waitFor({timeout:60000});await child.locator('#status').waitFor({state:'hidden',timeout:60000});
    await editor.getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.type('unsaved');
    await editor.getByRole('button',{name:'시작 화면'}).click();await page.getByRole('heading',{name:'어떤 문서를 작업할까요?'}).waitFor();
    assert.equal(await page.locator('#documents iframe').count(),1,'returning home keeps the open document');
    await page.locator('#tabs .tab-name').first().click();
    assert.equal(await editor.locator('body').evaluate(()=>window.pwhEditor.context().paragraph.text),'unsaved');
    await editor.getByRole('button',{name:/닫기$/}).first().click();
    const dialog=page.getByRole('dialog',{name:'변경 내용 저장'});await dialog.getByRole('button',{name:'취소'}).click();
    assert.equal(await editor.locator('body').evaluate(()=>window.pwhEditor.context().paragraph.text),'unsaved','cancel keeps the original text');
    await editor.getByRole('button',{name:/닫기$/}).first().click();await dialog.getByRole('button',{name:'저장하지 않음'}).click();
    await page.getByRole('heading',{name:'어떤 문서를 작업할까요?'}).waitFor();assert.equal(await page.locator('#documents iframe').count(),0);
    await page.getByRole('button',{name:'문서 열기 PC에서 HWP·HWPX 선택'}).click();
    await editor.getByRole('button',{name:'최근 업무.hwpx',exact:true}).waitFor({timeout:60000});assert.equal(pickerCalls,1);
    await editor.getByRole('button',{name:'시작 화면'}).click();
    await page.getByRole('button',{name:'최근 업무.hwpx 열기'}).waitFor({timeout:30000});
    const reopened=await createWorkspaceServer({dataRoot:process.env.PWH_STANDALONE_DATA,updateServices:{check:async()=>null}});
    const another=await browser.newPage();
    try{await another.goto(reopened.url);await another.getByRole('button',{name:'최근 업무.hwpx 열기'}).waitFor({timeout:30000});}
    finally{await another.close();await new Promise(resolve=>reopened.server.close(resolve));}
    await page.getByRole('button',{name:'최근 업무.hwpx 열기'}).click();await page.waitForFunction(()=>document.querySelectorAll('#documents iframe').length===2,null,{timeout:60000});
    const second=page.frameLocator('#documents iframe').nth(1).frameLocator('#editor');await second.getByRole('button',{name:'시작 화면'}).click();
    await page.getByRole('button',{name:'최근 업무.hwpx 최근 문서 목록에서 제거'}).click();await page.getByText('최근 문서가 없습니다').waitFor();
    assert.deepEqual(await fs.readFile(fixture),before,'removing a recent entry never deletes or modifies the document');
  } finally {
    await browser.close();await new Promise(resolve=>app.server.close(resolve));
    await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
