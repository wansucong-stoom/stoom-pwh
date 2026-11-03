import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {forwardTailInlineFixture} from './stored-nested-forward-tail-fixture.mjs';
import {zipEntries} from '../../scripts/setup.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
export async function verifySourceHistory(core) {
const entry='META-INF/rhwp-source-layout-history.json',report={checks:[]};
const hash=v=>createHash('sha256').update(v).digest('hex');
const members=bytes=>new Map(zipEntries(Buffer.from(bytes)).map(e=>[e.name,e.read()]));
const text=doc=>JSON.parse(doc.getScanItems()).filter(i=>i.kind===0&&i.text).map(i=>i.text).join('');
const geometry=doc=>Array.from({length:doc.pageCount()},(_,i)=>hash(doc.renderPageSvgWithProfile(i,'print')));
const runs=doc=>Array.from({length:doc.pageCount()},(_,i)=>JSON.parse(doc.getPageTextLayout(i)).runs).flat();
function checkRoundtrip(doc,label){
 const before=geometry(doc),source=text(doc),bytes=doc.exportHwpx(),opened=new core.HwpDocument(bytes);
 try{assert.equal(text(opened),source,label+': source');assert.deepEqual(geometry(opened),before,label+': full geometry');report.checks.push(label);return bytes;}finally{opened.free();}
}
function withDoc(bytes,fn){const d=new core.HwpDocument(bytes);try{return fn(d);}finally{d.free();}}
function edit(doc,marker='INLINE_A',insertion='EDIT'){
 const hit=runs(doc).find(r=>r.text===marker);assert.ok(hit,'deep hit '+marker);
 const cp=JSON.stringify(hit.cellPath);doc.insertTextInCellByPath(hit.secIdx,hit.parentParaIdx,cp,hit.charStart,insertion);
 return()=>doc.deleteTextInCellByPath(hit.secIdx,hit.parentParaIdx,cp,hit.charStart,insertion.length);
}
const bytes=forwardTailInlineFixture(),doc=new core.HwpDocument(bytes);
try{
 const pristine=doc.exportHwpx();assert.ok(!members(pristine).has(entry));report.checks.push('pristine export has no history');
 const original=geometry(doc),snapshot=doc.saveSnapshot();
 const inverse=edit(doc);const edited=checkRoundtrip(doc,'deep edit save reopen');
 const parts=members(edited);assert.ok(parts.has(entry));
 const envelope=JSON.parse(parts.get(entry));assert.equal(envelope.version,1);assert.ok(envelope.sections.flatMap(s=>s.records).length>0);
 assert.equal(JSON.stringify(envelope).includes('INLINE_A'),false,'aux excludes document text');
 withDoc(edited,reopened=>{
  const second=checkRoundtrip(reopened,'second save reopen');
  assert.ok(members(second).has(entry),'second export retains validated lifecycle');
 });
 inverse();checkRoundtrip(doc,'inverse-delete undo save reopen');
 doc.restoreSnapshot(snapshot);doc.discardSnapshot(snapshot);assert.deepEqual(geometry(doc),original);
 assert.ok(!members(doc.exportHwpx()).has(entry),'snapshot undo clears history');report.checks.push('snapshot undo clears history');
 const invalid={version:x=>({...x,version:99}),sectionHash:x=>{x.sections[0].fingerprint[0]^=1;return x;},headerHash:x=>{x.header[0]^=1;return x;},duplicatePath:x=>{x.sections[0].records.push(x.sections[0].records[0]);return x;},duplicateSection:x=>{x.sections.push(x.sections[0]);return x;},outOfRange:x=>{x.sections[0].records.forEach(r=>r.path[0]=99999);return x;},wrongTarget:x=>{x.sections[0].records.forEach(r=>r.fingerprint[0]^=1);return x;},tooDeep:x=>{x.sections[0].records[0].path=Array(199).fill(0);return x;},unknownField:x=>({...x,unknown:1})};
 const absent=mapHwpxMember(edited,entry,()=>''),fallback=withDoc(absent,geometry);
 assert.notDeepEqual(fallback,withDoc(edited,geometry),'invalid metadata exercises original-proof fallback');
 for(const[name,mutate]of Object.entries(invalid)){
  const changed=mapHwpxMember(edited,entry,raw=>JSON.stringify(mutate(JSON.parse(raw))));
  withDoc(changed,opened=>{assert.deepEqual(geometry(opened),fallback,name+' ignored');assert.ok(!members(opened.exportHwpx()).has(entry),name+' not passed through');});
  report.checks.push('reject '+name);
 }
 const changedHeader=mapHwpxMember(edited,'Contents/header.xml',s=>s.replace('</hh:head>',' <!-- external edit --> </hh:head>'));
 withDoc(changedHeader,opened=>{assert.deepEqual(geometry(opened),fallback,'external header rewrite');assert.ok(!members(opened.exportHwpx()).has(entry));});report.checks.push('external header rewrite discards history');
 const changedSection=mapHwpxMember(edited,'Contents/section0.xml',s=>s.replace('</hs:sec>',' <!-- external edit --> </hs:sec>'));
 withDoc(changedSection,opened=>{assert.deepEqual(geometry(opened),fallback,'external section rewrite');assert.ok(!members(opened.exportHwpx()).has(entry));});report.checks.push('external section rewrite discards history');
}finally{doc.free();}
// Two separate top-level table owners in one section. Only the first is edited.
const double=mapHwpxMember(bytes,'Contents/section0.xml',xml=>{
 const start=xml.indexOf('<hp:p '),end=xml.lastIndexOf('</hp:p>')+7;
 let second=xml.slice(start,end).replace(/<hp:secPr\b[\s\S]*?<\/hp:secPr>/,'').replace('pageBreak="0"','pageBreak="1"');
 second=second.replace(/<hp:t>([\s\S]*?)<\/hp:t>/g,(_m,t)=>`<hp:t>${t?'SECOND_'+t:''}</hp:t>`);
 return xml.slice(0,end)+second+xml.slice(end);
});
withDoc(double,d=>{
 const secondBefore=runs(d).filter(r=>r.text.startsWith('SECOND_')).map(r=>({text:r.text,x:r.x,y:r.y}));
 edit(d);const saved=checkRoundtrip(d,'one of two independent owners edit reopen');
 const meta=JSON.parse(members(saved).get(entry));assert.ok(meta.sections.every(s=>s.records.every(r=>r.path[0]===0)),'only edited owner recorded');
 assert.deepEqual(runs(d).filter(r=>r.text.startsWith('SECOND_')).map(r=>({text:r.text,x:r.x,y:r.y})),secondBefore,'untouched owner geometry');
 report.checks.push('independent owner not marked or relaid out');
});
withDoc(bytes,d=>{
 const hit=runs(d).find(r=>r.text==='INLINE_A');const cp=JSON.stringify(hit.cellPath);
 d.splitParagraphInCellByPath(hit.secIdx,hit.parentParaIdx,cp,3);
 checkRoundtrip(d,'deep split save reopen');
 const second=structuredClone(hit.cellPath);second.at(-1).cellParaIndex+=1;
 d.mergeParagraphInCellByPath(hit.secIdx,hit.parentParaIdx,JSON.stringify(second));
 checkRoundtrip(d,'deep split-merge inverse save reopen');
});
const shuffled=mapHwpxMember(bytes,'Contents/section0.xml',xml=>{
 const nodes=[],stack=[];
 for(const token of xml.matchAll(/<\/?([\w:]+)\b[^>]*>/g)){
  const raw=token[0],name=token[1];
  if(raw.startsWith('</')){const node=stack.pop();node.end=token.index+raw.length;node.close=token.index;continue;}
  const node={name,start:token.index,openEnd:token.index+raw.length,children:[]};stack.at(-1)?.children.push(node);nodes.push(node);
  if(raw.endsWith('/>')){node.end=node.openEnd;}else stack.push(node);
 }
 for(const row of nodes.filter(n=>n.name==='hp:tr'&&n.children.filter(c=>c.name==='hp:tc').length===2).reverse()){
  const cells=row.children.filter(c=>c.name==='hp:tc');
  xml=xml.slice(0,row.openEnd)+cells.map(c=>xml.slice(c.start,c.end)).reverse().join('')+xml.slice(row.close);
 }
 return xml;
});
withDoc(shuffled,d=>{
 edit(d);const saved=d.exportHwpx();
 const positions=doc=>Array.from({length:doc.pageCount()},(_,page)=>JSON.parse(doc.getPageTextLayout(page)).runs.map(r=>({text:r.text,page,x:r.x,y:r.y}))).flat().sort((a,b)=>a.text.localeCompare(b.text));
 withDoc(saved,opened=>{assert.equal(text(opened).split('INLINE').length,text(d).split('INLINE').length);assert.deepEqual(positions(opened),positions(d),'serialized cell sorting preserves exact marker coordinates');});
 report.checks.push('row-col-span history survives cell vector reorder');
});
return report;
}
