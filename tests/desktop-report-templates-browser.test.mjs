import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {waitForInlineEditor} from './helpers/editor-ready.mjs';

const simulatedAgent=String.raw`
import assert from 'node:assert/strict';
const [port,initialPath,mode]=process.argv.slice(2);
const {createAppServer}=await import(process.env.PWH_TEMPLATE_TEST_HOST);
try{
 const {server,url}=await createAppServer({port:Number(port),initialPath,report:mode==='report',imported:mode==='report'||mode==='imported',async createAgentSession({mcpUrl,bearerToken}){
  const call=async(method,params={})=>{
   const res=await fetch(mcpUrl,{method:'POST',headers:{authorization:'Bearer '+bearerToken,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return res.json();
  };
  const tool=(name,args)=>call('tools/call',{name,arguments:args});
  async function ticket(name,args){
   const queued=(await tool(name,args)).result?.structuredContent;
   assert.ok(queued?.ticketId);
   const response=await tool(name==='pwh_desktop_page_flow'?'pwh_desktop_result':'pwh_editor_result',{ticketId:queued.ticketId});
   const receipt=response.result?.structuredContent;
   assert.equal(receipt?.status,'applied',JSON.stringify(response));
   return receipt.result;
  }
  return {threadId:'synthetic',close(){},async send({note,reportTemplate,sessionId,reportRecovery,history}){
   if(!reportTemplate){
    assert.equal(note,'신청 정보를 신청자 기본 정보로 바꿔 줘');
    assert.ok(history.some(item=>item.role==='user'&&item.text.includes('장학금 신청 서식')));
    assert.ok(history.some(item=>item.role==='assistant'&&item.text.includes('마지막으로 조판이 확인된')));
    const state=(await tool('pwh_editor_state',{sessionId})).result.structuredContent;
    const search=await ticket('pwh_editor_text_search',{sessionId,expected:state.context,query:'신청 정보'});
    assert.equal(search.textSearch.hits.length,1);
    await ticket('pwh_editor_text_edit',{sessionId,expected:state.context,edits:[{searchId:search.textSearch.searchId,matchId:search.textSearch.hits[0].id,replacement:'신청자 기본 정보'}]});
    const after=(await tool('pwh_editor_state',{sessionId})).result.structuredContent;
    const checked=await ticket('pwh_desktop_page_flow',{sessionId,expected:after.context.documentState,count:2});
    assert.deepEqual(checked.changes.overflows,[]);
    return {text:'신청자 기본 정보로 바꿨습니다.'};
   }
   assert.match(note,/장학금 신청 서식|참고 양식의 서식/);
   assert.equal(reportTemplate.rules,'결론 먼저');
   assert.equal(reportTemplate.mode,'exact');
   assert.deepEqual(reportTemplate.fields,[]);
   const listed=await call('tools/list');
   assert.ok(listed.result.tools.some(tool=>tool.name==='pwh_desktop_fill_report'));
   assert.ok(!listed.result.tools.some(tool=>tool.name==='pwh_editor_text_edit'));
   const forbidden=await tool('pwh_editor_text_edit',{sessionId});
   assert.equal(forbidden.error.code,-32601);
   const read=await tool('pwh_desktop_read_scan',{sessionId});
   const final=note.includes('최종본');
   assert.match(JSON.stringify(read.result),final?/학생 장학금 신청서/:/교육 과정/);
   if(!reportRecovery)return {text:'신청 서식의 구성을 확인했습니다.'};
   const sections=[{heading:'신청 정보',fields:[{label:'이름'},{label:'학번'},{label:'신청 사유',lines:7}]}];
   const submit=async(title,fields,phase='draft')=>tool('pwh_desktop_fill_report',{sessionId,phase,form:{title,sections:fields}});
   if(reportRecovery==='missing'){
    const first=await submit('장학금 신청서 초안',[{fields:[{label:'이름'}]}]);
    assert.equal(first.result?.structuredContent?.draftRevision,1,JSON.stringify(first));
    return {text:'항목을 더 확인합니다.'};
   }
   assert.equal(reportRecovery,'partial');
   const revised=final?await tool('pwh_desktop_fill_report',{sessionId,phase:'complete',applyStyle:{pageSetup:true}})
    :await submit('학생 장학금 신청서',sections);
   assert.equal(revised.result?.structuredContent?.draftRevision,2,JSON.stringify(revised));
   if(final){
    assert.equal(revised.result.structuredContent.phase,'complete');
    assert.equal(revised.result.structuredContent.kind,'applied_style');
    return {text:'참고 양식의 서식을 적용했습니다.'};
   }
   const rejected=await tool('pwh_desktop_fill_report',{sessionId,phase:'draft',form:{title:'잘못된 조판',sections:[]}});
   assert.equal(rejected.result?.isError,true);
   throw Error('Synthetic provider closed after verifying the draft');
  }};
 }});
 process.stdout.write(JSON.stringify({url})+'\n');
 process.stdin.on('end',()=>{server.close();server.closeAllConnections?.();});
 process.stdin.resume();
}catch(error){process.stdout.write(JSON.stringify({errorCode:error.code||'START_FAILED'})+'\n');process.exitCode=1;}
`;
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
 try{doc.createBlankDocument();doc.pasteHtml(0,0,0,'<p>이전 추천 양식</p><table><tr><td>업무명</td><td>기관 예시</td><td>예시 결과</td></tr></table>');await fs.writeFile(file,doc.exportHwpx());}finally{doc.free();}
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
  const rules=library.getByRole('textbox',{name:/작성 기준/});
  assert.equal(await rules.getAttribute('aria-describedby'),'report-template-rules-help');
  assert.match(await library.locator('#report-template-rules-help').textContent(),/비워 두면 공통 기준이 자동으로 적용됩니다/);
  await rules.fill('결론 먼저');
  await library.getByRole('button',{name:'HWP·HWPX 파일 선택'}).click();
  const selected=library.getByRole('button',{name:'기관 결과보고',exact:true});
  await selected.waitFor();
  await library.getByRole('button',{name:'양식 창 닫기'}).click();

  const prompt=child(0).getByRole('textbox',{name:'요청 내용'});
  await prompt.fill('이 양식을 참고해 학생 장학금 신청 서식을 만들어 줘');
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
  assert.equal(await prompt.inputValue(),'이 양식을 참고해 학생 장학금 신청 서식을 만들어 줘');
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
   assert.equal(JSON.parse(edited.searchAllText('학생 장학금 신청서',true,true)).length,1);
   assert.equal(JSON.parse(edited.searchAllText('신청 사유',true,true)).length,1);
   assert.equal(JSON.parse(edited.searchAllText('기관 예시',true,true)).length,0);
  }finally{edited.free();}
  assert.match(result.text,/마지막으로 조판이 확인된/);
  await child(1).getByText('이 양식을 참고해 학생 장학금 신청 서식을 만들어 줘',{exact:true}).waitFor();
  await child(1).getByRole('textbox',{name:'요청 내용'}).fill('신청 정보를 신청자 기본 정보로 바꿔 줘');
  const editResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/ai/send'));
  await child(1).getByRole('button',{name:'요청 보내기'}).click();
  const followup=await (await editResponse).json();
  assert.equal(followup.text,'신청자 기본 정보로 바꿨습니다.',JSON.stringify(followup));
  assert.deepEqual(followup.layout.remaining,[]);
  const revised=new core.HwpDocument(Uint8Array.from(await editor(1).locator('body').evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{assert.equal(JSON.parse(revised.searchAllText('신청자 기본 정보',true,true)).length,1);}finally{revised.free();}
  assert.equal(await page.locator('#documents iframe').count(),2,'follow-up applies to the draft without opening another tab');
  assert.deepEqual(await editor(0).locator('body').evaluate(()=>window.pwhEditor.context().documentState),before);
  await child(1).getByRole('button',{name:'첨부 및 자주 쓰는 양식'}).click();
  await child(1).getByRole('button',{name:'양식 선택',exact:true}).click();
  await selected.click();
  await library.getByRole('radio',{name:/양식 그대로/}).check();
  await library.getByRole('button',{name:'요청에 첨부'}).click();
  await child(1).getByRole('textbox',{name:'요청 내용'}).fill('지금 문서에 참고 양식의 서식을 적용해 최종본을 만들어 줘');
  const finalResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/ai/send'));
  await child(1).getByRole('button',{name:'요청 보내기'}).click();
  const completed=await (await finalResponse).json();
  assert.ok(completed.reportId);
  assert.equal(completed.text,'참고 양식의 서식을 적용했습니다.');
  await waitForInlineEditor(editor(2));
  const finalDoc=new core.HwpDocument(Uint8Array.from(await editor(2).locator('body').evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
   try{assert.equal(JSON.parse(finalDoc.searchAllText('신청자 기본 정보',true,true)).length,1);}finally{finalDoc.free();}
  await child(2).getByRole('button',{name:'첨부 및 자주 쓰는 양식'}).click();
  await child(2).getByRole('button',{name:'양식 선택',exact:true}).click();
  await library.getByRole('button',{name:'기관 결과보고 삭제'}).click();
  await library.getByRole('button',{name:'취소'}).click();
  await selected.waitFor();
  await library.getByRole('button',{name:'기관 결과보고 삭제'}).click();
  await library.getByRole('button',{name:'양식 삭제',exact:true}).click();
  await library.getByText('등록한 양식이 없습니다.').waitFor();
  assert.equal(await page.locator('#documents iframe').count(),3);
  assert.deepEqual(await fs.readFile(file),original);
 }finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
