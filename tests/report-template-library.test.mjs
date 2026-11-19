import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareReportFill,applyTextEdits,createTextSearchPlan} from '../src/text-edit.mjs';

test('built-in and uploaded report presets preserve their source and fill a working copy',{skip:!process.env.PWH_RUNTIME_ROOT,timeout:60000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-report-template-'));
 t.after(async()=>{assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});});
 const common=path.join(dir,'release-source'),publicSource=new URL('../desktop/standalone-pwh/',import.meta.url),desktop=path.join(dir,'desktop');
 await fs.mkdir(desktop);
 for(const file of ['report-templates.mjs','convert-hwp.mjs'])await fs.copyFile(new URL(file,publicSource),path.join(desktop,file));
 await fs.symlink(fileURLToPath(new URL('..',import.meta.url)),common,process.platform==='win32'?'junction':'dir').catch(async()=>{
  await fs.cp(new URL('../src/',import.meta.url),path.join(common,'src'),{recursive:true});
 });
 const {createReportTemplateLibrary,readDraftTemplate}=await import(pathToFileURL(path.join(desktop,'report-templates.mjs')).href);
 const lib=createReportTemplateLibrary(path.join(dir,'profile')),base=await lib.list();
 assert.equal(base.length,10);
 const files=await Promise.all(base.map(preset=>lib.prepare(preset.id)));
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS).href);await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 for(const [i,draft] of files.entries()){
  const info=await readDraftTemplate(draft.file),doc=new HwpDocument(await fs.readFile(draft.file));
  try{assert.equal(info.name,base[i].name);assert.equal(info.fields.length,base[i].fields.length);assert.ok(doc.pageCount()>0);}finally{doc.free();}
 }
 const original=path.join(dir,'기관 보고.hwpx'),doc=HwpDocument.createEmpty();
 try{
  doc.createBlankDocument();doc.pasteHtml(0,0,0,'<p><span style="font-size:23pt;color:#125377"><strong>기관 보고</strong></span></p><table><tr><td>사업명</td><td></td></tr><tr><td>그대로 유지</td><td>원래 내용</td></tr></table><p><span style="font-size:15pt"><strong>추진 개요</strong></span></p><p>재사용 대상이 아닌 기존 예시입니다.</p><p>{{요약}}</p>');
  const paper=JSON.parse(doc.getPageDef(0));paper.marginTop=7200;doc.setPageDef(0,JSON.stringify(paper));
  await fs.writeFile(original,doc.exportHwpx());
 }finally{doc.free();}
 const source=await fs.readFile(original),record=await lib.register(original,{organization:'합성 기관',name:'사업 양식'});
 assert.equal(record.organization,'합성 기관');assert.deepEqual(record.fields,['요약','사업명']);
 const listAfterRestart=await createReportTemplateLibrary(path.join(dir,'profile')).list();
 assert.equal(listAfterRestart.at(-1).id,record.id);
 await assert.rejects(lib.prepare('../report.hwpx'),/등록된 양식/);
 const draft=await lib.prepare(record.id),untouched=await lib.prepare(record.id),bytes=await fs.readFile(draft.file);
 const working=new HwpDocument(bytes),context={documentState:{documentEpoch:1,changeSeq:0,documentSha256:'draft'}};
 const data=await readDraftTemplate(draft.file);
 try{
  const prior=working.saveSnapshot();
  assert.throws(()=>prepareReportFill(working,[{marker:'{{없는 항목}}',text:'값'}],context),/작성 위치/);
  const entries=data.fields.map(field=>({marker:field.marker,text:field.name==='사업명'?'교육 프로그램':'운영 결과를 정리했습니다.'}));
  assert.deepEqual(applyTextEdits(working,prepareReportFill(working,entries,context)),{ranges:2,paragraphs:2});
  assert.equal(createTextSearchPlan(working,context,'교육 프로그램').refs[0].source.cellPath.length,1);
  assert.equal(createTextSearchPlan(working,context,'원래 내용').refs.length,1);
  assert.equal(createTextSearchPlan(working,context,'{{요약}}').refs.length,0);
  working.restoreSnapshot(prior);working.discardSnapshot(prior);
  assert.equal(createTextSearchPlan(working,context,'{{요약}}').refs.length,1);
 }finally{working.free();}
 const adapted=await lib.prepare(record.id,'adapt'),preset=await readDraftTemplate(adapted.file),report=new HwpDocument(await fs.readFile(adapted.file));
 try{
  assert.equal(preset.mode,'adapt');
  assert.ok(preset.headings.includes('추진 개요'));
  assert.equal(JSON.parse(report.getPageDef(0)).marginTop,7200);
  assert.equal(JSON.parse(report.getCharPropertiesAt(0,0,0)).fontSize,2300);
  assert.equal(JSON.parse(report.getCharPropertiesAt(0,0,0)).textColor.toLowerCase(),'#125377');
  assert.equal(createTextSearchPlan(report,context,'재사용 대상이 아닌 기존 예시입니다.').refs.length,0);
  assert.equal(createTextSearchPlan(report,context,'{{사업명}}').refs[0].source.cellPath.length,1);
 }finally{report.free();}
 assert.deepEqual(await fs.readFile(original),source);
 assert.deepEqual(await fs.readFile(untouched.file),bytes);
});
