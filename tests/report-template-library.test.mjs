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
 assert.match(prompt,/text에 빈 문자열을 전달/);
 assert.match(prompt,/원본의 형식·목차·디자인과 제목·항목의 순서를 유지/);
 assert.match(prompt,/실제 본문 폭에 맞추고/);
 assert.match(prompt,/새 신청서·평가표 등 빈 양식을 만드는 요청에는 pwh_desktop_fill_report의 form/);
 const procedure=['요청과 자료를 확인','참고 양식에서 각 요소의 역할','내용을 쓰기 전에 문서 구조','선택한 작업과 맞는 입력','본문과 표를 실제 본문 폭','조판 도구의 prepared'];
 const steps=procedure.map((step,index)=>prompt.indexOf((index+1)+'. '+step));
 assert.ok(steps.every((step,index)=>step>(steps[index-1]??order[2])));
 assert.match(prompt,/writingLayout의 항목을 따라 해당 소제목에 targetId/);
 assert.match(prompt,/pwh_desktop_read_scan에 target=draft/);
 assert.match(prompt,/id를 지정해 pwh_desktop_read_report_figure/);
 assert.match(prompt,/업무 흐름도와 운영체계도는 pwh_desktop_draw_report_diagram으로 먼저/);
 assert.match(prompt,/referenceId와 assetId를 보내 기존 틀을 유지하면서 교체/);
 assert.match(prompt,/작성 지침으로 취급하지 마세요/);
 const noRules=buildReportPrompt({...base,reportTemplate:{mode:'adapt',rules:'',fields:[]}});
 assert.doesNotMatch(noRules,/2순위 사용자가/);
 assert.match(noRules,/3순위 공통 작성 기준/);
 assert.match(noRules,/새 요청의 목적과 자료에서 목차·소제목·항목 순서를 정합니다/);
 assert.match(noRules,/데이터 표는 table의 headers와 rows/);
});

test('registered templates keep their names and rules and verify separately typeset outputs',{skip:!process.env.PWH_RUNTIME_ROOT,timeout:60000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-report-template-'));
 t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});});
 const common=path.join(dir,'release-source'),publicSource=new URL('../desktop/standalone-pwh/',import.meta.url),desktop=path.join(dir,'desktop');
 await fs.mkdir(desktop);
 for(const file of ['report-templates.mjs','convert-hwp.mjs','desktop-body-style.mjs','report-outline.mjs','report-figures.mjs'])await fs.copyFile(new URL(file,publicSource),path.join(desktop,file));
 await fs.symlink(fileURLToPath(new URL('..',import.meta.url)),common,process.platform==='win32'?'junction':'dir').catch(async()=>{
  await fs.cp(new URL('../src/',import.meta.url),path.join(common,'src'),{recursive:true});
  await fs.cp(new URL('../scripts/',import.meta.url),path.join(common,'scripts'),{recursive:true});
 });
 const {inspectBodyFlow}=await import(pathToFileURL(path.join(desktop,'desktop-body-style.mjs')).href);
 const {outlineDraftFromText}=await import(pathToFileURL(path.join(desktop,'report-outline.mjs')).href);
 const {createReportTemplateLibrary,readDraftTemplate,fillPreparedTemplate,createPreparedForm,createPreparedDraft,createPreparedExactDraft,applyPreparedReportStyle,analyzeReportTemplate,getPreparedReportFigure,getDraftReportFigures}=await import(pathToFileURL(path.join(desktop,'report-templates.mjs')).href);
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
  assert.equal(search(report,'추진 개요').length,1);
  assert.equal(search(report,'확인 필요').length,1);
  assert.equal(JSON.parse(report.getPageDef(0)).marginTop,7200);
 }finally{report.free();}
 const adapt=await lib.prepare(record.id,'adapt');
 assert.ok(draft.template.outline.some(item=>item.text==='추진 개요'));
 assert.equal(adapt.template.outline,undefined);
 assert.deepEqual(adapt.template.fields,[]);
 const expanded=await fillPreparedTemplate(adapt,[{marker:'{{보고서 제목}}',text:'재구성한 문서'}],[{title:'추가 계획',text:'다음 달 준비'}]);
 const rebuilt=new HwpDocument(expanded.bytes);
 try{
  assert.equal(JSON.parse(rebuilt.getCharPropertiesAt(0,0,0)).fontSize,2300);
  assert.equal(JSON.parse(rebuilt.getCharPropertiesAt(0,0,0)).textColor.toLowerCase(),'#125377');
  assert.equal(search(rebuilt,'옛 보고서 예시 문장').length,0);
  assert.equal(search(rebuilt,'추진 개요').length,0);
  assert.equal(search(rebuilt,'사업명').length,0);
  assert.equal(search(rebuilt,'추가 계획').length,1);
  assert.equal(search(rebuilt,'다음 달 준비').length,1);
 }finally{rebuilt.free();}
 const detailed=await createPreparedDraft(adapt,{title:'학생 지원 실행계획',paragraphs:[
  {role:'heading',level:1,text:'지원 운영'},
  {role:'heading',level:2,text:'모집 절차'},
  {role:'body',text:'학기별 신청을 받습니다.'},
  {role:'caption',text:'접수 계획'},
  {role:'table',headers:['항목','일정','담당'],rows:Array.from({length:68},(_,index)=>['업무 '+(index+1),'확인 필요','학생지원팀'])},
  {role:'note',text:'확정 일정은 공고로 안내합니다.'},
 ]});
 const designed=new HwpDocument(detailed.bytes);
 try{
  const size=text=>JSON.parse(designed.getCharPropertiesAt(0,search(designed,text)[0].para,0)).fontSize;
  assert.equal(size('학생 지원 실행계획'),2300);
  assert.equal(size('지원 운영'),1500);
  assert.ok(size('모집 절차')<size('지원 운영'));
  assert.ok(size('확정 일정은 공고로 안내합니다.')<size('학기별 신청을 받습니다.'));
  assert.equal(search(designed,'업무 68').length,1);
  const tables=JSON.parse(designed.getControls()).filter(control=>control.ctrlId==='tbl');
  assert.ok(tables.length>1);
  for(const {para,controlIndex} of tables){
   assert.equal(JSON.parse(designed.getTableDimensions(0,para,controlIndex)).colCount,3);
   assert.equal(JSON.parse(designed.getCellOwnProperties(0,para,controlIndex,0)).isHeader,true);
   assert.equal(designed.getTextInCellByPath(0,para,JSON.stringify([{controlIndex,cellIndex:0,cellParaIndex:0}]),0,2),'항목');
  }
  assert.deepEqual(inspectBodyFlow(designed).overflows,[]);
 }finally{designed.free();}
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
  assert.deepEqual(inspectBodyFlow(longDoc).overflows,[]);
 }finally{longDoc.free();}
 const flexible=await createPreparedDraft(legacyDraft,{title:'참고 양식으로 쓴 본문',marginsMm:{bottom:10},paragraphs:[{role:'heading',text:'주요 내용'},{role:'body',text:'신청 기간 미정\n마감일 확인 필요'}]});
 const styled=new HwpDocument(flexible.bytes);
 try{
  assert.equal(search(styled,'신청 기간 미정').length,1);
  assert.equal(search(styled,'마감일 확인 필요').length,1);
  assert.equal(JSON.parse(styled.getPageDef(0)).marginTop,7200);
  assert.equal(JSON.parse(styled.getPageDef(0)).marginBottom,2835);
  assert.deepEqual(inspectBodyFlow(styled).overflows,[]);
 }finally{styled.free();}
 const sourceDoc=HwpDocument.createEmpty();
 let content;
 try{
  sourceDoc.createBlankDocument();
  sourceDoc.pasteHtml(0,0,0,'<p>현재 신청서 머리말</p><p>유지할 본문</p><table><tr><td>제출 기한</td><td>미정</td></tr></table>');
  content=Buffer.from(sourceDoc.exportHwpx());
 }finally{sourceDoc.free();}
 const restyled=await applyPreparedReportStyle(legacyDraft,content,{pageSetup:true});
 const applied=new HwpDocument(restyled.bytes);
 try{
  assert.equal(restyled.changes.kind,'applied_style');
  assert.equal(search(applied,'현재 신청서 머리말').length,1);
  assert.equal(search(applied,'유지할 본문').length,1);
  assert.equal(search(applied,'미정')[0].cellContext.cellIdx,1);
  assert.equal(search(applied,'기존 추천 대상').length,0);
  assert.equal(JSON.parse(applied.getCharPropertiesAt(0,0,0)).fontSize,2300);
  assert.equal(JSON.parse(applied.getPageDef(0)).marginTop,7200);
  assert.deepEqual(inspectBodyFlow(applied).overflows,[]);
 }finally{applied.free();}
 const pairedRef=HwpDocument.createEmpty();
 try{
  pairedRef.createBlankDocument();
  pairedRef.pasteHtml(0,0,0,'<p>참고 신청서</p><table><tr><td style="background-color:#b0b0b0">직급</td><td>예시</td><td style="background-color:#b0b0b0">소속</td><td>예시</td></tr></table>');
  const analyzed=analyzeReportTemplate(pairedRef);
  assert.equal(analyzed.structure.formTable.pairsPerRow,2);
  const paired=await createPreparedForm({...legacyDraft,analysis:analyzed},{title:'신청서',sections:[{fields:[{label:'성명'},{label:'학번'},{label:'신청 사유',lines:5}]}]});
  const rows=new HwpDocument(paired.bytes);
  try{
   const {para,controlIndex}=JSON.parse(rows.getControls()).find(item=>item.ctrlId==='tbl');
   assert.equal(JSON.parse(rows.getTableDimensions(0,para,controlIndex)).colCount,4);
   assert.equal(JSON.parse(rows.getCellInfo(0,para,controlIndex,5)).colSpan,3);
   assert.equal(paired.changes.fields,3);
   assert.deepEqual(inspectBodyFlow(rows).overflows,[]);
  }finally{rows.free();}
 }finally{pairedRef.free();}
 assert.deepEqual(await fs.readFile(blankFormSource),referenceBytes);
 assert.equal(JSON.parse(await fs.readFile(recordPath,'utf8')).analysis.version,undefined);
 const outlineSource=path.join(dir,'본래 순서.hwpx'),outlineDoc=HwpDocument.createEmpty();
 try{
  outlineDoc.createBlankDocument();
  outlineDoc.pasteHtml(0,0,0,'<p><strong style="font-size:23pt">원본 교육안</strong></p><p>원본 안내</p><p><strong style="font-size:16pt">학습 목표</strong></p><p>기존 목표 본문</p><p><strong style="font-size:16pt">강의 구성</strong></p><table><tr><th>순서</th><th>활동</th></tr><tr><td>기존 번호</td><td>기존 내용</td></tr></table>');
  await fs.writeFile(outlineSource,outlineDoc.exportHwpx());
 }finally{outlineDoc.free();}
 const originalOutline=await fs.readFile(outlineSource),outlineRecord=await lib.register(outlineSource,{organization:'합성 기관',name:'기존 개요'});
 assert.deepEqual(outlineRecord.fields,[]);
 const outlinePrepared=await lib.prepare(outlineRecord.id,'exact');
 assert.deepEqual(outlinePrepared.template.writingLayout.flatMap(group=>group.heading||[]),['학습 목표','강의 구성']);
 const recovered=outlineDraftFromText(['# 창업 프로그램','','## 강의 구성','교육 소개','','| 단계 | 방법 |','| --- | --- |','| 첫 활동 | 고객 인터뷰 |','| 추가 활동 | 결과 발표 |','','## 학습 목표','문제를 확인합니다.','팀과 배운 점을 나눕니다.'].join('\n'));
 const exact=await createPreparedExactDraft(outlinePrepared,recovered);
 const filledOutline=new HwpDocument(exact.bytes);
 try{
  assert.equal(exact.template.mode,'exact');
  const position=value=>search(filledOutline,value)[0].para;
  assert.ok(position('학습 목표')<position('문제를 확인합니다.'));
  assert.ok(position('팀과 배운 점을 나눕니다.')<position('강의 구성'));
  assert.equal(search(filledOutline,'창업 프로그램').length,1);
  assert.equal(search(filledOutline,'기존 목표 본문').length,0);
  assert.equal(search(filledOutline,'고객 인터뷰')[0].cellContext.cellIdx,3);
  assert.equal(search(filledOutline,'결과 발표').length,1);
  assert.equal(search(filledOutline,'활동').some(item=>item.cellContext?.cellIdx===1),true);
 }finally{filledOutline.free();}
 assert.deepEqual(await fs.readFile(outlineSource),originalOutline);
 const originalFigure=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAIAAABhdOiYAAAAZElEQVR4nO3QMQ0AIADAMGxgCHWIxgGc7GgyAUvHXFuXxveDeIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBwgQIAAAQoHCBAgQIDCAQIECBCgcIAAAQIEKBygRwfscIbxWbPlUAAAAABJRU5ErkJggg==','base64');
 const newFigure=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAIAAABhdOiYAAAAZElEQVR4nO3QMQ0AIADAMCRyIwflOICTHU0mYOmYe+nS+H4QDxAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQP06ABAvRk88VQZjgAAAABJRU5ErkJggg==','base64');
 const imageSource=path.join(dir,'그림이 있는 양식.hwpx'),pictureDoc=new HwpDocument(originalOutline);
 try{
  const inserted=JSON.parse(pictureDoc.insertPicture(0,3,0,'[]',originalFigure,12600,6300,96,48,'png','이전 운영 절차'));
  assert.equal(inserted.ok,true);
  assert.equal(JSON.parse(pictureDoc.setPictureProperties(0,3,inserted.controlIdx,JSON.stringify({treatAsChar:true}))).ok,true);
  await fs.writeFile(imageSource,pictureDoc.exportHwpx());
 }finally{pictureDoc.free();}
 const imageOriginal=await fs.readFile(imageSource);
 const imageRecord=await lib.register(imageSource,{organization:'합성 기관',name:'그림 양식'});
 const imageExact=await lib.prepare(imageRecord.id);
 const [{id:referenceId,nearbyText}]=imageExact.template.figures;
 assert.ok(nearbyText.includes('학습 목표'));
 assert.deepEqual((await getPreparedReportFigure(imageExact,referenceId)).bytes,originalFigure);
 const resolveImage=id=>{
  assert.equal(id,'new-figure');
  return {bytes:newFigure,metadata:{width:96,height:48,extension:'png'}};
 };
 const exactWithFigure=await createPreparedExactDraft(imageExact,recovered,{figures:[{referenceId,assetId:'new-figure',description:'갱신한 운영 절차'}],resolveImage});
 assert.equal(exactWithFigure.changes.figuresReplaced,1);
 const updatedFigure=await getDraftReportFigures(exactWithFigure.bytes,referenceId);
 assert.deepEqual(updatedFigure.bytes,newFigure);
 assert.equal(updatedFigure.figure.description,'갱신한 운영 절차');
 // A frame smaller than the source bitmap must show all replacement pixels.
 const fittedRef=new HwpDocument(imageOriginal);
 try{
  const ref=JSON.parse(fittedRef.getControls()).find(item=>item.ctrlId==='gso');
  assert.equal(JSON.parse(fittedRef.setPictureProperties(0,ref.para,ref.controlIndex,JSON.stringify({width:3600,height:1800}))).ok,true);
  const fittedSource=path.join(dir,'작은 그림 틀.hwpx');
  await fs.writeFile(fittedSource,fittedRef.exportHwpx());
  const fittedRecord=await lib.register(fittedSource,{organization:'합성 기관',name:'작은 그림 틀'});
  const fittedPrepared=await lib.prepare(fittedRecord.id);
  const fittedId=fittedPrepared.template.figures[0].id;
  const rendered=await createPreparedExactDraft(fittedPrepared,recovered,{
   figures:[{referenceId:fittedId,assetId:'new-figure'}],
   resolveImage:id=>({...resolveImage(id),frameReferenceId:fittedId}),
  });
  const result=new HwpDocument(rendered.bytes);
  try{
   const [display]= (await getDraftReportFigures(rendered.bytes)).figures;
   const svg=result.renderPageSvg(display.page-1);
   const marker=svg.indexOf('href="data:image/png;base64,'+newFigure.toString('base64'));
   assert.ok(marker>=0,'the saved page must render the replacement PNG');
   const picture=svg.slice(svg.lastIndexOf('<image',marker),marker);
   assert.match(picture,/\bx="[^"]+"\s+y="[^"]+"\s+width="48"\s+height="24"/,'the full raster must fill the original 48 by 24 pixel frame');
  }finally{result.free();}
  await lib.remove(fittedRecord.id);
 }finally{fittedRef.free();}
 const adaptWithFigure=await createPreparedDraft(await lib.prepare(imageRecord.id,'adapt'),{title:'장학금 지원 운영안',paragraphs:[
  {role:'caption',text:'장학금 심사 흐름'},
  {role:'figure',referenceId,assetId:'new-figure',description:'새 심사 도식'},
  {role:'body',text:'신청 후 심사 결과를 안내합니다.'},
  {role:'figure',referenceId,description:'공통 안내 그림'},
 ]},'styled_draft',resolveImage);
 assert.equal(adaptWithFigure.changes.figuresInserted,2);
 const {figures}=await getDraftReportFigures(adaptWithFigure.bytes);
 const figureReadback=new HwpDocument(adaptWithFigure.bytes);
 try{
  const controls=JSON.parse(figureReadback.getControls());
  const drawn=Array.from({length:figureReadback.pageCount()},(_,page)=>JSON.parse(figureReadback.getPageControlLayout(page)).controls);
  assert.deepEqual(figures.map(item=>item.description),['새 심사 도식','공통 안내 그림'],JSON.stringify({controls,drawn}));
 }finally{figureReadback.free();}
 assert.deepEqual((await getDraftReportFigures(adaptWithFigure.bytes,figures[0].id)).bytes,newFigure);
 assert.deepEqual((await getDraftReportFigures(adaptWithFigure.bytes,figures[1].id)).bytes,originalFigure);
 assert.deepEqual(await fs.readFile(imageSource),imageOriginal);
 await lib.remove(imageRecord.id);
 const graphic=HwpDocument.createEmpty();
 try{
  graphic.createBlankDocument();
  graphic.pasteHtml(0,0,0,'<table><tr><td style="background-color:#c75252"></td></tr><tr><td><strong style="font-size:20pt">원본 표지 제목</strong></td></tr><tr><td style="background-color:#315f97"></td></tr></table><table><tr><td style="background-color:#00478d"><strong style="font-size:18pt;color:#ffffff">1</strong></td><td></td><td><strong style="font-size:16pt">기존 장제목</strong></td></tr></table><p><span style="font-size:11pt">형식 분석에 사용할 원본 본문</span></p>');
  const analyzed=analyzeReportTemplate(graphic);
  assert.equal(analyzed.structure.title.text,'원본 표지 제목');
  assert.equal(analyzed.structure.headings[0].text,'기존 장제목');
  assert.equal(analyzed.structure.formTable,null);
  const design=await createPreparedDraft({...adapt,analysis:analyzed},{title:'새 보고서',paragraphs:[
   {role:'heading',level:1,text:'새 운영계획'},
   {role:'body',text:'새 본문 설명입니다.'},
   {role:'table',headers:['항목','내용'],rows:[['대상','재학생']]},
  ]});
  const decorated=new HwpDocument(design.bytes);
  try{
   assert.equal(search(decorated,'새 운영계획').length,1);
   assert.equal(search(decorated,'기존 장제목').length,0);
   const [cover,banner,data]=JSON.parse(decorated.getControls()).filter(control=>control.ctrlId==='tbl');
   const own=(table,index)=>JSON.parse(decorated.getCellOwnProperties(0,table.para,table.controlIndex,index));
   const font=(table,index)=>JSON.parse(decorated.getCellCharPropertiesAtByPath(0,table.para,JSON.stringify([{controlIndex:table.controlIndex,cellIndex:index,cellParaIndex:0}]),0)).fontSize;
   assert.equal(own(cover,0).fillColor.toLowerCase(),'#c75252');
   assert.equal(own(cover,2).fillColor.toLowerCase(),'#315f97');
   assert.equal(own(banner,0).fillColor.toLowerCase(),'#00478d');
   assert.equal(font(banner,0),1800);
   assert.equal(font(data,3),1100);
  }finally{decorated.free();}
 }finally{graphic.free();}
 await lib.remove(outlineRecord.id);
 await lib.remove(markerless.id);
 await lib.remove(record.id);
 assert.deepEqual(await lib.list(),[]);
 assert.equal(await lib.openResult(reportId),openedFile,'removing a template keeps generated documents');
 assert.deepEqual(await fs.readFile(original),source);
});
