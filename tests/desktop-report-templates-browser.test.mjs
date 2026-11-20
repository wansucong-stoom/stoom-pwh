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
  return {threadId:'synthetic',close(){},async send({note,reportTemplate,sessionId,reportRecovery,history,imageAssetId}){
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
   if(note==='원래 목차에 맞춰 새 교육 내용을 작성해 줘'){
    assert.equal(reportTemplate.mode,'exact');
    assert.deepEqual(reportTemplate.fields,[]);
    assert.ok(reportTemplate.writingLayout.some(group=>group.heading==='학습 목표'));
    return {text:'# 새 교육 계획\n\n## 학습 목표\n문제를 찾고 실험합니다.\n배운 점을 발표합니다.\n'};
   }
   if(note==='양식 그대로 학생축제 활성화방안을 작성하고 절차 그림도 갱신해 줘'){
    assert.equal(reportTemplate.mode,'exact');
    assert.equal(imageAssetId,undefined);
    const [reference]=reportTemplate.figures;
    const listed=(await call('tools/list')).result.tools;
    assert.ok(listed.some(item=>item.name==='pwh_desktop_draw_report_diagram'));
    const failed=await tool('pwh_desktop_draw_report_diagram',{sessionId,referenceId:reference.id,diagram:{title:'',steps:[]}});
    assert.equal(failed.result.isError,true);
    const draw=await tool('pwh_desktop_draw_report_diagram',{sessionId,referenceId:reference.id,diagram:{
     title:'학생축제 운영 흐름',layout:'flow',accent:'#295884',
     steps:[{label:'의견 수렴',detail:'참여 수요와 개선사항 파악'},{label:'기획·공모',detail:'학생 주도 프로그램 모집'},
      {label:'현장 운영',detail:'안전 안내와 행사 지원'},{label:'성과 환류',detail:'참여 의견을 다음 행사에 반영'}],
    }});
    const image=draw.result?.structuredContent;
    assert.ok(image?.assetId,JSON.stringify(draw));
    assert.ok(image.width>800&&image.height>400);
    assert.ok(Math.abs(image.width/image.height-reference.widthMm/reference.heightMm)<0.02);
    const prepared=await tool('pwh_desktop_fill_report',{sessionId,phase:'complete',
     figures:[{referenceId:reference.id,assetId:image.assetId,description:'학생축제 운영 흐름'}],
     draft:{title:'학생축제 활성화방안',paragraphs:[
      {role:'heading',text:'학습 목표',level:1},
      {role:'body',text:'학생 기획팀을 중심으로 의견을 수렴하고 참여 프로그램을 공모합니다.'},
     ]}});
    assert.equal(prepared.result?.structuredContent?.figuresReplaced,1,JSON.stringify(prepared));
    const checked=await tool('pwh_desktop_read_report_figure',{sessionId,target:'draft',id:reference.id});
    assert.equal(checked.result.structuredContent.figure.description,'학생축제 운영 흐름');
    const png=Buffer.from(checked.result.content.find(item=>item.type==='image').data,'base64');
    assert.equal(png.readUInt32BE(16),image.width);
    assert.equal(png.readUInt32BE(20),image.height);
    return {text:'학생축제 운영 흐름도를 새로 그려 조판했습니다.'};
   }
   if(note==='형식을 준용해 프로그램 운영안을 작성해 줘'){
    assert.equal(reportTemplate.mode,'adapt');
    assert.ok(imageAssetId);
    const [reference]=reportTemplate.figures;
    const listed=(await call('tools/list')).result.tools;
    assert.ok(listed.some(item=>item.name==='pwh_desktop_generate_image'));
    const review=await tool('pwh_desktop_read_report_figure',{sessionId,target:'template',id:reference.id});
    assert.equal(review.result.structuredContent.figure.description,'예전 절차 그림');
    const oldImage=review.result.content.find(item=>item.type==='image');
    assert.equal(oldImage.mimeType,'image/png');
    const prepared=await tool('pwh_desktop_fill_report',{sessionId,phase:'complete',draft:{title:'새 프로그램 운영안',paragraphs:[
     {role:'heading',text:'추진 절차',level:1},
     {role:'body',text:'신청을 접수하고 결과를 안내합니다.'},
     {role:'table',headers:['업무','담당'],rows:[['접수','운영팀']]},
     {role:'figure',referenceId:reference.id,assetId:imageAssetId,description:'갱신한 절차 그림'},
    ]}});
    assert.equal(prepared.result.structuredContent.figuresInserted,1);
    const inventory=await tool('pwh_desktop_read_report_figure',{sessionId,target:'draft'});
    const [updated]=inventory.result.structuredContent.figures;
    assert.equal(updated.description,'갱신한 절차 그림');
    const checked=await tool('pwh_desktop_read_report_figure',{sessionId,target:'draft',id:updated.id});
    const updatedImage=checked.result.content.find(item=>item.type==='image');
    assert.notEqual(updatedImage.data,oldImage.data);
    return {text:'새 운영안과 그림을 조판했습니다.'};
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
   const submit=async(title,fields,phase='draft')=>tool('pwh_desktop_fill_report',{sessionId,phase,useMode:'adapt',form:{title,sections:fields}});
   if(reportRecovery==='missing'){
    const missing=await tool('pwh_desktop_read_scan',{sessionId,target:'draft'});
    assert.match(missing.error,/작업본이 아직 없습니다/);
    const form={title:'장학금 신청서 초안',sections:[{fields:[{label:'이름'}]}]};
    const kept=await tool('pwh_desktop_fill_report',{sessionId,phase:'draft',form});
    assert.equal(kept.result?.isError,true);
    assert.match(kept.result.content[0].text,/형식·목차·디자인을 유지/);
    const first=await submit(form.title,form.sections);
    assert.equal(first.result?.structuredContent?.draftRevision,1,JSON.stringify(first));
    return {text:'항목을 더 확인합니다.'};
   }
   assert.equal(reportRecovery,'partial');
   const earlier=(await tool('pwh_desktop_read_scan',{sessionId,target:'draft'})).result.structuredContent;
   assert.equal(earlier.draftRevision,1);
   assert.equal(earlier.nextCursor,null);
   assert.ok(earlier.items.some(item=>item.text.includes('장학금 신청서 초안')));
   const revised=final?await tool('pwh_desktop_fill_report',{sessionId,phase:'complete',useMode:'adapt',applyStyle:{pageSetup:true}})
    :await submit('학생 장학금 신청서',sections);
   assert.equal(revised.result?.structuredContent?.draftRevision,2,JSON.stringify(revised));
   if(final){
    assert.equal(revised.result.structuredContent.phase,'complete');
    assert.equal(revised.result.structuredContent.kind,'applied_style');
    const scan=(await tool('pwh_desktop_read_scan',{sessionId,target:'draft'})).result.structuredContent;
    assert.equal(scan.draftRevision,2);
    assert.ok(scan.items.some(item=>item.text.includes('신청자 기본 정보')));
    const page=(await tool('pwh_desktop_read_page',{sessionId,target:'draft',page:1})).result.structuredContent;
    assert.equal(page.draftRevision,scan.draftRevision);
    assert.equal(page.pageCount,revised.result.structuredContent.pages);
    assert.match(page.runs.map(run=>run.text).join(''),/학생\s*장학금\s*신청서/);
    return {text:'참고 양식의 서식을 적용했습니다.'};
   }
   const rejected=await tool('pwh_desktop_fill_report',{sessionId,phase:'draft',useMode:'adapt',form:{title:'잘못된 조판',sections:[]}});
   assert.equal(rejected.result?.isError,true);
   const scan=(await tool('pwh_desktop_read_scan',{sessionId,target:'draft'})).result.structuredContent;
   assert.equal(scan.draftRevision,2);
   assert.ok(scan.items.some(item=>item.text.includes('신청 사유')));
   assert.ok(!scan.items.some(item=>item.text.includes('교육 과정')));
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
 const macPreview=process.env.PWH_TEMPLATE_BROWSER_PLATFORM==='macos';
 process.env.PWH_STANDALONE_DATA=profile;
 await fs.mkdir(profile);
 await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({provider:macPreview?'chatgpt':'codex'}));
 const fakeChild=path.join(dir,'synthetic-agent-child.mjs');await fs.writeFile(fakeChild,simulatedAgent);
 const file=path.join(dir,'합성 양식.hwpx'),doc=core.HwpDocument.createEmpty();
 const previousPicture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');
 const newPicture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAIAAABhdOiYAAAAZElEQVR4nO3QMQ0AIADAMCRyIwflOICTHU0mYOmYe+nS+H4QDxAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQP06ABAvRk88VQZjgAAAABJRU5ErkJggg==','base64');
 try{
  doc.createBlankDocument();
  doc.pasteHtml(0,0,0,'<p><strong style="font-size:23pt">이전 추천 양식</strong></p><p><strong style="font-size:16pt">학습 목표</strong></p><p>이전 목표 내용</p><table><tr><td>업무명</td><td>기관 예시</td><td>예시 결과</td></tr></table><p>참고 그림 안내</p>');
  const at=doc.getParagraphCount(0)-1,inserted=JSON.parse(doc.insertPicture(0,at,0,'[]',previousPicture,12000,6000,1,1,'png','예전 절차 그림'));
  assert.equal(inserted.ok,true);
  assert.equal(JSON.parse(doc.setPictureProperties(0,at,inserted.controlIdx,JSON.stringify({treatAsChar:true}))).ok,true);
  await fs.writeFile(file,doc.exportHwpx());
 }finally{doc.free();}
 const original=await fs.readFile(file),root=process.env.PWH_DESKTOP_SOURCE_ROOT;
 const {createWorkspaceServer}=await import(pathToFileURL(path.join(root,'workspace-shell.mjs')));
 const app=await createWorkspaceServer({
  chooseFile:async()=>({cancelled:false,path:file}),updateServices:{check:async()=>null},
  spawnImpl(exe,args,options){return spawn(exe,[fakeChild,...args.slice(1)],{...options,env:{...options.env,PWH_TEMPLATE_TEST_HOST:pathToFileURL(path.join(root,'host.mjs')).href,
   ...(macPreview?{PWH_DESKTOP_DISTRIBUTION:'macos-preview'}:{})}});},
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
  await child(0).locator('#provider-label').filter({hasText:/^Codex$/}).waitFor({state:'attached'});
  if(macPreview){
   await child(0).getByRole('button',{name:'대화 설정 열기'}).click({force:true});
   const panel=child(0).getByRole('dialog',{name:'AI 연결'});
   await panel.waitFor();
   assert.equal(await panel.getByRole('tab',{name:'ChatGPT 계정'}).count(),0);
   await panel.getByRole('button',{name:'설정 닫기'}).click();
  }
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
  await selected.click();
  await library.getByRole('radio',{name:/양식 그대로/}).check();
  await library.getByRole('button',{name:'요청에 첨부'}).click();
  await child(2).getByRole('textbox',{name:'요청 내용'}).fill('원래 목차에 맞춰 새 교육 내용을 작성해 줘');
  const exactResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/ai/send'));
  await child(2).getByRole('button',{name:'요청 보내기'}).click();
  const exact=await (await exactResponse).json();
  assert.ok(exact.reportId,JSON.stringify(exact));
  assert.match(exact.text,/원본 목차 아래에 조판했습니다/);
  await waitForInlineEditor(editor(3));
  const originalStyle=new core.HwpDocument(Uint8Array.from(await editor(3).locator('body').evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{
   const hit=text=>JSON.parse(originalStyle.searchAllText(text,true,true));
   assert.equal(hit('학습 목표').length,1);
   assert.equal(hit('이전 목표 내용').length,0);
   assert.equal(hit('문제를 찾고 실험합니다.').length,1);
   assert.equal(hit('배운 점을 발표합니다.').length,1);
  }finally{originalStyle.free();}
  await child(3).getByRole('button',{name:'첨부 및 자주 쓰는 양식'}).click();
  await child(3).getByRole('button',{name:'양식 선택',exact:true}).click();
  await selected.click();
  await library.getByRole('radio',{name:/형식 준용/}).check();
  await library.getByRole('button',{name:'요청에 첨부'}).click();
  await child(3).locator('#image-file').setInputFiles({name:'업데이트한 절차.png',mimeType:'image/png',buffer:newPicture});
  await child(3).getByText('업데이트한 절차.png',{exact:true}).waitFor();
  await child(3).getByRole('textbox',{name:'요청 내용'}).fill('형식을 준용해 프로그램 운영안을 작성해 줘');
  const adaptResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/ai/send'));
  await child(3).getByRole('button',{name:'요청 보내기'}).click();
  const adapted=await (await adaptResponse).json();
  assert.ok(adapted.reportId,JSON.stringify(adapted));
  assert.equal(adapted.text,'새 운영안과 그림을 조판했습니다.');
  await waitForInlineEditor(editor(4));
  const adaptedDoc=new core.HwpDocument(Uint8Array.from(await editor(4).locator('body').evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{
   const hit=text=>JSON.parse(adaptedDoc.searchAllText(text,true,true));
   assert.equal(hit('새 프로그램 운영안').length,1);
   assert.equal(hit('추진 절차').length,1);
   assert.equal(hit('학습 목표').length,0);
   assert.ok(hit('운영팀')[0].cellContext);
   const {para,controlIndex}=JSON.parse(adaptedDoc.getControls()).find(item=>item.ctrlId==='gso');
   assert.deepEqual(Buffer.from(adaptedDoc.getControlImageData(0,para,'[]',controlIndex)),newPicture);
  }finally{adaptedDoc.free();}
  await child(4).getByRole('button',{name:'첨부 및 자주 쓰는 양식'}).click();
  await child(4).getByRole('button',{name:'양식 선택',exact:true}).click();
  await selected.click();
  await library.getByRole('radio',{name:/양식 그대로/}).check();
  await library.getByRole('button',{name:'요청에 첨부'}).click();
  await child(4).getByRole('textbox',{name:'요청 내용'}).fill('양식 그대로 학생축제 활성화방안을 작성하고 절차 그림도 갱신해 줘');
  const festivalResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/ai/send'));
  await child(4).getByRole('button',{name:'요청 보내기'}).click();
  const festival=await (await festivalResponse).json();
  assert.ok(festival.reportId,JSON.stringify(festival));
  assert.equal(festival.text,'학생축제 운영 흐름도를 새로 그려 조판했습니다.');
  await waitForInlineEditor(editor(5));
  const festivalDoc=new core.HwpDocument(Uint8Array.from(await editor(5).locator('body').evaluate(()=>Array.from(window.pwhEditor.export().bytes))));
  try{
   const hit=text=>JSON.parse(festivalDoc.searchAllText(text,true,true));
   assert.equal(hit('학생축제 활성화방안').length,1);
   assert.equal(hit('학습 목표').length,1);
   const sourceDiagram=new core.HwpDocument(original);
   let originalProps;
   try{
    const originalFigure=JSON.parse(sourceDiagram.getControls()).find(item=>item.ctrlId==='gso');
    originalProps=JSON.parse(sourceDiagram.getPictureProperties(0,originalFigure.para,originalFigure.controlIndex));
   }finally{sourceDiagram.free();}
   const {para,controlIndex}=JSON.parse(festivalDoc.getControls()).find(item=>item.ctrlId==='gso');
   const properties=JSON.parse(festivalDoc.getPictureProperties(0,para,controlIndex));
   assert.deepEqual(properties,{...originalProps,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,description:'학생축제 운영 흐름'});
   const pic=Buffer.from(festivalDoc.getControlImageData(0,para,'[]',controlIndex));
   assert.ok(pic.readUInt32BE(16)>800);
   assert.ok(JSON.parse(festivalDoc.getPageControlLayout(0)).controls.some(item=>item.type==='image'));
  }finally{festivalDoc.free();}
  await child(5).getByRole('button',{name:'첨부 및 자주 쓰는 양식'}).click();
  await child(5).getByRole('button',{name:'양식 선택',exact:true}).click();
  await library.getByRole('button',{name:'기관 결과보고 삭제'}).click();
  await library.getByRole('button',{name:'취소'}).click();
  await selected.waitFor();
  await library.getByRole('button',{name:'기관 결과보고 삭제'}).click();
  await library.getByRole('button',{name:'양식 삭제',exact:true}).click();
  await library.getByText('등록한 양식이 없습니다.').waitFor();
  assert.equal(await page.locator('#documents iframe').count(),6);
  assert.deepEqual(await fs.readFile(file),original);
 }finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
