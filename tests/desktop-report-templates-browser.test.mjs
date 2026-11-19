import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {waitForInlineEditor} from './helpers/editor-ready.mjs';

test('Desktop registers and selects a report through the chat plus menu, then typesets the draft', {
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-reports-ui-'));
 process.env.PWH_STANDALONE_DATA=path.join(dir,'profile');
 const file=path.join(dir,'합성 양식.hwpx'),doc=core.HwpDocument.createEmpty();
 try{
  doc.createBlankDocument();
  doc.pasteHtml(0,0,0,'<h1>업무 결과 보고</h1><table><tr><td>사업명</td><td></td></tr></table><p>{{주요 결과}}</p>');
  await fs.writeFile(file,doc.exportHwpx());
 }finally{doc.free();}
 const original=await fs.readFile(file);
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'workspace-shell.mjs')));
 const app=await createWorkspaceServer({chooseFile:async()=>({cancelled:false,path:file}),updateServices:{check:async()=>null}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1240,height:850}});await page.goto(app.url);
  await page.locator('#home-templates').click();
  const library=page.getByRole('dialog',{name:'보고서 양식'});
  await library.getByRole('button',{name:/주간업무 보고/}).waitFor();
  assert.equal(await library.locator('#report-template-list button').count(),10);
  await library.getByRole('radio',{name:/형식 준용/}).check();assert.equal(await library.getByRole('radio',{name:/형식 준용/}).isChecked(),true);
  await library.getByRole('radio',{name:/양식 그대로/}).check();
  await page.setViewportSize({width:450,height:800});
  assert.ok(await library.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
  await page.setViewportSize({width:1240,height:850});
  await library.getByRole('button',{name:'양식 등록'}).click();
  await library.getByRole('textbox',{name:'기관·회사'}).fill('합성 기관');
  await library.getByRole('textbox',{name:'양식 이름'}).fill('기관 결과보고');
  await library.getByRole('button',{name:'HWP·HWPX 파일 선택'}).click();
  await library.getByRole('button',{name:/기관 결과보고/}).waitFor();
  await library.getByRole('button',{name:'양식 목록 닫기'}).click();

  await page.locator('#home-new').click();
  const child=index=>page.frameLocator('#documents iframe').nth(index);
  const editor=index=>child(index).frameLocator('#editor');
  await waitForInlineEditor(editor(0));
  await child(0).locator('#prompt').fill('사업명은 교육 과정이고 결과는 실습을 마쳤어.');
  await child(0).getByRole('button',{name:'첨부 및 보고서 양식'}).click();
  await child(0).getByRole('button',{name:'양식 선택',exact:true}).click();
  await library.getByRole('searchbox',{name:'양식 검색'}).fill('합성 기관');
  await library.getByRole('button',{name:/기관 결과보고/}).click();
  await waitForInlineEditor(editor(1));
  assert.equal(await page.locator('#documents iframe').count(),2);
  await child(1).locator('#prompt').waitFor({state:'visible'});
  assert.equal(await child(1).locator('#prompt').inputValue(),'사업명은 교육 과정이고 결과는 실습을 마쳤어.');
  const data=await editor(1).locator('body').evaluate(async()=>{
   const editor=window.pwhEditor,expected=editor.context().documentState;
   const result=await editor.textEdit({type:'desktopReportFill',expected,answers:[{marker:'{{사업명}}',text:'교육 과정'},{marker:'{{주요 결과}}',text:'실습을 마쳤습니다.'}]});
   return {result,bytes:Array.from(editor.export().bytes)};
  });
  assert.equal(data.result.undoSteps,1);assert.equal(data.result.changes.ranges,2);
  const edited=new core.HwpDocument(Uint8Array.from(data.bytes));
  try{
   assert.equal(JSON.parse(edited.searchAllText('교육 과정',true,true)).length,1);
   assert.equal(JSON.parse(edited.searchAllText('실습을 마쳤습니다.',true,true)).length,1);
   assert.equal(JSON.parse(edited.getControls()).filter(control=>control.ctrlId==='tbl').length,1);
  }finally{edited.free();}
  await editor(1).getByRole('textbox',{name:'문서 편집 입력'}).focus();await page.keyboard.press('Control+z');
  const undo=await editor(1).locator('body').evaluate(()=>Array.from(window.pwhEditor.export().bytes));
  const reverted=new core.HwpDocument(Uint8Array.from(undo));
  try{assert.equal(JSON.parse(reverted.searchAllText('{{사업명}}',true,true)).length,1);}finally{reverted.free();}
  await child(1).getByRole('button',{name:'첨부 및 보고서 양식'}).click();
  await child(1).getByRole('button',{name:'양식 선택',exact:true}).click();
  await library.getByRole('radio',{name:/형식 준용/}).check();
  await library.getByRole('button',{name:/기관 결과보고/}).click();
  await waitForInlineEditor(editor(2));
  assert.match(await child(2).locator('#document-notice').textContent(),/^형식 준용/);
  assert.deepEqual(await fs.readFile(file),original);
 }finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
