import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {waitForInlineEditor} from './helpers/editor-ready.mjs';

const simulatedAgent="\nimport assert from 'node:assert/strict';\nconst {port,initialPath,mode}=Object.fromEntries(['port','initialPath','mode'].map((key,index)=>[key,process.argv[index+2]]));\nconst {createAppServer}=await import(process.env.PWH_TEMPLATE_TEST_HOST);\ntry{\n const {server,url}=await createAppServer({port:Number(port),initialPath,report:mode==='report',imported:mode==='report'||mode==='imported',async createAgentSession({mcpUrl,bearerToken}){\n  const call=async(method,params={})=>{\n   const res=await fetch(mcpUrl,{method:'POST',headers:{authorization:'Bearer '+bearerToken,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return res.json();\n  };\n  return {threadId:'synthetic',close(){},async send({note,reportTemplate,sessionId}){\n   assert.match(note,/양식에 맞춰/);\n   assert.equal(reportTemplate.rules,'결론 먼저');\n   assert.equal(reportTemplate.mode,'exact');\n   const listed=await call('tools/list');\n   assert.ok(listed.result.tools.some(tool=>tool.name==='pwh_desktop_fill_report'));\n   assert.ok(!listed.result.tools.some(tool=>tool.name==='pwh_editor_text_edit'));\n   const forbidden=await call('tools/call',{name:'pwh_editor_text_edit',arguments:{sessionId}});\n   assert.equal(forbidden.error.code,-32601);\n   const read=await call('tools/call',{name:'pwh_desktop_read_scan',arguments:{sessionId}});\n   assert.match(JSON.stringify(read.result),/교육 과정/);\n   const filled=await call('tools/call',{name:'pwh_desktop_fill_report',arguments:{sessionId,answers:[{marker:'{{사업명}}',text:'교육 과정'},{marker:'{{주요 결과}}',text:'실습을 마쳤습니다.'}]}});\n   assert.equal(filled.result?.structuredContent?.prepared,true,JSON.stringify(filled.error||{}));\n   return {text:'양식에 맞춰 작성했습니다.'};\n  }};\n }});\n process.stdout.write(JSON.stringify({url})+'\\n');\n process.stdin.on('end',()=>{server.close();server.closeAllConnections?.();});\n process.stdin.resume();\n}catch(error){process.stdout.write(JSON.stringify({errorCode:error.code||'START_FAILED'})+'\\n');process.exitCode=1;}\n";
test('registered templates attach to a request and typeset a separate document after AI prepares it',{
 skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT,timeout:120000,
},async()=>{
 const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE);
 const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-templates-ui-')),profile=path.join(dir,'profile');
 process.env.PWH_STANDALONE_DATA=profile;
 await fs.mkdir(profile);
 await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({provider:'codex'}));
 const fakeChild=path.join(dir,'synthetic-agent-child.mjs');await fs.writeFile(fakeChild,simulatedAgent);
 const file=path.join(dir,'합성 양식.hwpx'),doc=core.HwpDocument.createEmpty();
 try{doc.createBlankDocument();doc.pasteHtml(0,0,0,'<p>업무 결과</p><table><tr><td>사업명</td><td></td></tr></table><p>{{주요 결과}}</p>');await fs.writeFile(file,doc.exportHwpx());}finally{doc.free();}
 const original=await fs.readFile(file),root=process.env.PWH_DESKTOP_SOURCE_ROOT;
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(root,'workspace-shell.mjs')));
 const app=await createWorkspaceServer({
  chooseFile:async()=>({cancelled:false,path:file}),updateServices:{check:async()=>null},
  spawnImpl(exe,args,options){return spawn(exe,[fakeChild,...args.slice(1)],{...options,env:{...options.env,PWH_TEMPLATE_TEST_HOST:pathToFileURL(path.join(root,'host.mjs')).href}});},
 });
 const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1240,height:850}});
  await page.route('**/ai/status',route=>route.fulfill({json:{ready:true,installed:true,models:[]}}));
  await page.goto(app.url);
  await page.getByRole('button',{name:/자주 쓰는 양식 등록한 양식/}).click();
  const library=page.locator('#report-templates');
  await library.getByText('등록한 양식이 없습니다.').waitFor();
  assert.equal(await library.locator('.report-template-row').count(),0);
  assert.equal(await library.getByRole('radio',{name:/형식 준용/}).isVisible(),false);
  await library.getByRole('button',{name:'양식 창 닫기'}).click();
  await page.locator('#home-new').click();
  const child=index=>page.frameLocator('#documents iframe').nth(index);
  const editor=index=>child(index).frameLocator('#editor');
  await waitForInlineEditor(editor(0));
  const input=editor(0).getByRole('textbox',{name:'문서 편집 입력'});
  await input.focus();await page.keyboard.insertText('교육 과정 실습을 마쳤습니다.');
  await editor(0).locator('[data-menu="format"] .menu-title').click();
  const left=editor(0).locator('#pwh-ribbon-panel-format .pwh-ribbon-section').first();
  assert.equal(await left.getAttribute('aria-label'),'양식');
  await left.getByRole('button',{name:'양식 등록'}).click();
  await library.getByRole('heading',{name:'양식 등록'}).waitFor();
  assert.equal(await library.getByRole('radio',{name:/형식 준용/}).isVisible(),false);
  await page.setViewportSize({width:450,height:800});
  assert.ok(await library.evaluate(element=>element.scrollWidth<=element.clientWidth+1));
  await page.setViewportSize({width:1240,height:850});
  await library.getByRole('textbox',{name:'기관·회사'}).fill('합성 기관');
  await library.getByRole('textbox',{name:'양식 이름'}).fill('기관 결과보고');
  await library.getByRole('textbox',{name:/작성 기준/}).fill('결론 먼저');
  await library.getByRole('button',{name:'HWP·HWPX 파일 선택'}).click();
  const selected=library.getByRole('button',{name:'기관 결과보고',exact:true});
  await selected.waitFor();
  await library.getByRole('button',{name:'양식 창 닫기'}).click();

  const prompt=child(0).getByRole('textbox',{name:'요청 내용'});
  await prompt.fill('이 문서를 양식에 맞춰 작성해 줘');
  const pick=async()=>{
   await child(0).getByRole('button',{name:'첨부 및 자주 쓰는 양식'}).click();
   await child(0).getByRole('button',{name:'양식 선택',exact:true}).click();
   await selected.waitFor();
  };
  await pick();
  await selected.click();
  await library.getByRole('radio',{name:/양식 그대로/}).check();
  await library.getByRole('button',{name:'요청에 첨부'}).click();
  await child(0).getByText('기관 결과보고 · 양식 그대로').waitFor();
  assert.equal(await page.locator('#documents iframe').count(),1,'choosing never opens the template');
  assert.equal(await prompt.inputValue(),'이 문서를 양식에 맞춰 작성해 줘');
  const before=await editor(0).locator('body').evaluate(()=>window.pwhEditor.context().documentState);
  const sent=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/ai/send'));
  await child(0).getByRole('button',{name:'요청 보내기'}).click();
  const result=await (await sent).json();
  assert.ok(result.reportId,JSON.stringify(result));
  await waitForInlineEditor(editor(1));
  assert.equal(await page.locator('#documents iframe').count(),2);
  const exported=await editor(1).locator('body').evaluate(()=>Array.from(window.pwhEditor.export().bytes));
  const edited=new core.HwpDocument(Uint8Array.from(exported));
  try{
   assert.equal(JSON.parse(edited.searchAllText('교육 과정',true,true)).length,1);
   assert.equal(JSON.parse(edited.searchAllText('실습을 마쳤습니다.',true,true)).length,1);
  }finally{edited.free();}
  assert.deepEqual(await editor(0).locator('body').evaluate(()=>window.pwhEditor.context().documentState),before);
  await child(1).getByRole('button',{name:'첨부 및 자주 쓰는 양식'}).click();
  await child(1).getByRole('button',{name:'양식 선택',exact:true}).click();
  await library.getByRole('button',{name:'기관 결과보고 삭제'}).click();
  await library.getByRole('button',{name:'취소'}).click();
  await selected.waitFor();
  await library.getByRole('button',{name:'기관 결과보고 삭제'}).click();
  await library.getByRole('button',{name:'양식 삭제',exact:true}).click();
  await library.getByText('등록한 양식이 없습니다.').waitFor();
  assert.equal(await page.locator('#documents iframe').count(),2);
  assert.deepEqual(await fs.readFile(file),original);
 }finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
