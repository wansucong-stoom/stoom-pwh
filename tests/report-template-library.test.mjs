import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildReportPrompt} from '../desktop/standalone-pwh/codex-session.mjs';

test('template writing instructions give each current user request priority over stored and common rules',()=>{
 const base={note:'날짜가 없으면 비워 주세요.',requestId:'fixture',sessionId:'fixture'};
 const prompt=buildReportPrompt({...base,reportTemplate:{mode:'exact',rules:'누락 날짜는 별도 문구를 씁니다.',fields:[]}});
 const order=['1순위 이번 사용자 요청','2순위 사용자가 이 양식에 저장한 작성 기준','3순위 공통 작성 기준'].map(title=>prompt.indexOf(title));
 assert.ok(order[0]>=0&&order[0]<order[1]&&order[1]<order[2]);
 assert.match(prompt,/숫자가 작은 높은 순위의 지침을 적용/);
 assert.match(prompt,/text를 빈 문자열로 전달/);
 assert.match(prompt,/소제목 추가는 형식 준용에서 지원/);
 assert.match(prompt,/새 신청서·평가표 등 빈 양식을 만드는 요청에는 pwh_desktop_fill_report의 form/);
 const noRules=buildReportPrompt({...base,reportTemplate:{mode:'adapt',rules:'',fields:[]}});
 assert.doesNotMatch(noRules,/2순위 사용자가/);
 assert.match(noRules,/3순위 공통 작성 기준/);
 assert.match(noRules,/sections에 소제목/);
});

test('registered templates keep their names and rules and verify separately typeset outputs',{skip:!process.env.PWH_RUNTIME_ROOT,timeout:60000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-report-template-'));
 t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});});
 const common=path.join(dir,'release-source'),publicSource=new URL('../desktop/standalone-pwh/',import.meta.url),desktop=path.join(dir,'desktop');
 await fs.mkdir(desktop);
 for(const file of ['report-templates.mjs','convert-hwp.mjs'])await fs.copyFile(new URL(file,publicSource),path.join(desktop,file));
 await fs.symlink(fileURLToPath(new URL('..',import.meta.url)),common,process.platform==='win32'?'junction':'dir').catch(async()=>{
  await fs.cp(new URL('../src/',import.meta.url),path.join(common,'src'),{recursive:true});
 });
 const {createReportTemplateLibrary,readDraftTemplate,fillPreparedTemplate,createPreparedForm,createPreparedDraft}=await import(pathToFileURL(path.join(desktop,'report-templates.mjs')).href);
 const profile=path.join(dir,'profile'),lib=createReportTemplateLibrary(profile);
 assert.deepEqual(await lib.list(),[]);
 await assert.rejects(lib.prepare('builtin-weekly'),/등록된 양식/);
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS).href);await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const original=path.join(dir,'기관 원본.hwpx'),doc=HwpDocument.createEmpty();
 try{
  doc.createBlankDocument();
  doc.pasteHtml(0,0,0,'<p><span style="font-size:23pt;color:#125377"><strong>기관 보고</strong></span></p><table><tr><td>사업명</td><td></td></tr><tr><td>그대로 유지</td><td>원래 내용</td></tr></table><p><span style="font-size:15pt"><strong>추진 개요</strong></span></p><p>옛 보고서 예시 문장</p><p>{{요약}}</p>');
  const paper=JSON.parse(doc.getPageDef(0));paper.marginTop=7200;doc.setPageDef(0,JSON.stringify(paper));
  await fs.writeFile(original,doc.exportHwpx());
 }finally{doc.free();}
 const source=await fs.readFile(original),record=await lib.register(original,{organization:'합성 기관',name:'사업 양식',rules:'결론을 먼저 씁니다.'});
 assert.deepEqual((await createReportTemplateLibrary(profile).list()).map(item=>item.name),['사업 양식']);
 await assert.rejects(lib.prepare('../report.hwpx'),/등록된 양식/);
 await assert.rejects(lib.remove('../report.hwpx'),/등록된 양식/);
 const draft=await lib.prepare(record.id),search=(document,query)=>JSON.parse(document.searchAllText(query,true,true));
 assert.equal(draft.template.rules,'결론을 먼저 씁니다.');
 await assert.rejects(fillPreparedTemplate(draft,[{marker:'{{사업명}}',text:'교육 프로그램'}],[{title:'추가',text:'본문'}]),/형식 준용/);
 const written=await fillPreparedTemplate(draft,[{marker:'{{사업명}}',text:'교육 프로그램'}]);
 assert.equal(written.changes.missing,1);
 const intentionallyBlank=await fillPreparedTemplate(draft,[{marker:'{{사업명}}',text:'교육 프로그램'},{marker:'{{요약}}',text:''}]);
 const blankResult=new HwpDocument(intentionallyBlank.bytes);
 try{assert.equal(intentionallyBlank.changes.missing,0);assert.equal(search(blankResult,'확인 필요').length,0);}finally{blankResult.free();}
 const reportId=await lib.saveResult(written),openedFile=await lib.openResult(reportId),data=await readDraftTemplate(openedFile);
 assert.equal(data.completed,true);
 const report=new HwpDocument(await fs.readFile(openedFile));
 try{
  assert.equal(search(report,'교육 프로그램')[0].cellContext.cellIdx,1);
  assert.equal(search(report,'원래 내용').length,1);
  assert.equal(search(report,'확인 필요').length,1);
  assert.equal(JSON.parse(report.getPageDef(0)).marginTop,7200);
 }finally{report.free();}
 const adapt=await lib.prepare(record.id,'adapt');
 const expanded=await fillPreparedTemplate(adapt,[{marker:'{{보고서 제목}}',text:'재구성한 문서'}],[{title:'추가 계획',text:'다음 달 준비'}]);
 const rebuilt=new HwpDocument(expanded.bytes);
 try{
  assert.equal(JSON.parse(rebuilt.getCharPropertiesAt(0,0,0)).fontSize,2300);
  assert.equal(JSON.parse(rebuilt.getCharPropertiesAt(0,0,0)).textColor.toLowerCase(),'#125377');
  assert.equal(search(rebuilt,'옛 보고서 예시 문장').length,0);
  assert.equal(search(rebuilt,'추가 계획').length,1);
  assert.equal(search(rebuilt,'다음 달 준비').length,1);
 }finally{rebuilt.free();}
 const blankFormSource=path.join(dir,'빈 입력 표시가 없는 양식.hwpx'),reference=HwpDocument.createEmpty();
 try{
  reference.createBlankDocument();
  reference.pasteHtml(0,0,0,'<p><span style="font-size:23pt;color:#125377"><strong>기존 추천서</strong></span></p><table><tr><td colspan="2" style="background-color:#dce8f0">기존 추천 대상</td><td colspan="2">예시 인명</td></tr></table><p>기존 안내문</p>');
  const paper=JSON.parse(reference.getPageDef(0));paper.marginTop=7200;reference.setPageDef(0,JSON.stringify(paper));
  await fs.writeFile(blankFormSource,reference.exportHwpx());
 }finally{reference.free();}
 const referenceBytes=await fs.readFile(blankFormSource),markerless=await lib.register(blankFormSource,{organization:'합성 기관',name:'추천서 양식'});
 assert.deepEqual(markerless.fields,[]);
 const recordPath=path.join(profile,'report-templates',markerless.id,'template.json');
 const oldRecord=JSON.parse(await fs.readFile(recordPath,'utf8'));delete oldRecord.analysis.version;delete oldRecord.analysis.structure.formTable;
 await fs.writeFile(recordPath,JSON.stringify(oldRecord));
 const legacyDraft=await lib.prepare(markerless.id,'exact');
 assert.deepEqual(legacyDraft.template.fields,[]);
 const formSpec={title:'학생 장학금 신청서',introduction:'증빙을 첨부하세요.',sections:[
  {heading:'신청인 정보',fields:[{label:'이름'},{label:'학번'}]},
  {heading:'신청 내용',guidance:'신청 사유를 적어 주세요.',fields:[{label:'신청 사유',lines:4}]},
 ]};
 await assert.rejects(createPreparedForm(legacyDraft,{...formSpec,sections:[]}),/구성/);
 const form=await createPreparedForm(legacyDraft,formSpec);
 assert.equal(form.template.mode,'adapt');
 assert.equal(form.template.name,formSpec.title);
 assert.equal(form.changes.fields,3);
 const composed=new HwpDocument(form.bytes);
 try{
  assert.equal(JSON.parse(composed.getCharPropertiesAt(0,0,0)).fontSize,2300);
  assert.equal(JSON.parse(composed.getCharPropertiesAt(0,0,0)).textColor.toLowerCase(),'#125377');
  assert.equal(JSON.parse(composed.getPageDef(0)).marginTop,7200);
  assert.equal(search(composed,'신청인 정보').length,1);
  assert.equal(search(composed,'기존 안내문').length,0);
  assert.equal(search(composed,'예시 인명').length,0);
  for(const {para,controlIndex} of JSON.parse(composed.getControls()).filter(item=>item.ctrlId==='tbl')){
   const dimensions=JSON.parse(composed.getTableDimensions(0,para,controlIndex));
   assert.equal(dimensions.colCount,2);
   for(let cellIndex=1;cellIndex<dimensions.cellCount;cellIndex+=2){
    const p=JSON.stringify([{controlIndex,cellIndex,cellParaIndex:0}]);
    assert.equal(composed.getCellParagraphLengthByPath(0,para,p),0);
   }
   assert.equal(JSON.parse(composed.getCellOwnProperties(0,para,controlIndex,0)).fillColor.toLowerCase(),'#dce8f0');
  }
 }finally{composed.free();}
 const fields=Array.from({length:103},(_,index)=>({label:'입력 항목 '+(index+1),lines:index===0?8:1}));
 const longForm=await createPreparedForm(legacyDraft,{title:'여러 쪽 신청 서식',introduction:'첫째 안내\n둘째 안내',sections:[{heading:'신청 내용',fields}]});
 assert.equal(longForm.changes.fields,fields.length);
 assert.ok(longForm.changes.pages>1);
 const longDoc=new HwpDocument(longForm.bytes);
 try{
  let shown='';
  for(let page=0;page<longDoc.pageCount();page++)shown+=JSON.parse(longDoc.getPageTextLayout(page)).runs.map(run=>run.text).join(' ');
  assert.match(shown,/입력 항목\s+103/);
  assert.match(shown,/둘째 안내/);
 }finally{longDoc.free();}
 const flexible=await createPreparedDraft(legacyDraft,{title:'참고 양식으로 쓴 본문',paragraphs:[{role:'heading',text:'주요 내용'},{role:'body',text:'신청 기간 미정\n마감일 확인 필요'}]});
 const styled=new HwpDocument(flexible.bytes);
 try{
  assert.equal(search(styled,'신청 기간 미정').length,1);
  assert.equal(search(styled,'마감일 확인 필요').length,1);
  assert.equal(JSON.parse(styled.getPageDef(0)).marginTop,7200);
 }finally{styled.free();}
 assert.deepEqual(await fs.readFile(blankFormSource),referenceBytes);
 assert.equal(JSON.parse(await fs.readFile(recordPath,'utf8')).analysis.version,undefined);
 await lib.remove(markerless.id);
 await lib.remove(record.id);
 assert.deepEqual(await lib.list(),[]);
 assert.equal(await lib.openResult(reportId),openedFile,'removing a template keeps generated documents');
 assert.deepEqual(await fs.readFile(original),source);
});
