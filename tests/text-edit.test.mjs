import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {zipEntries} from '../scripts/setup.mjs';
import {textRevision,assertTextRevision,createTextSearchPlan,replacementShapeIds,prepareTextEdits,applyTextEdits,textEditCursor} from '../src/text-edit.mjs';

// Fully synthetic fixtures only. Use the same core paths as the engine
// regression suite; these tests never open an installed application or a user file.
const configured=Boolean(process.env.PWH_CORE_JS&&process.env.PWH_CORE_WASM);
const integration={skip:configured?false:'Set PWH_CORE_JS and PWH_CORE_WASM to a built real engine.'};
let corePromise;
async function core(){
 return corePromise??=(async()=>{
  const module=await import(pathToFileURL(path.resolve(process.env.PWH_CORE_JS)).href);
  await module.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return module;
 })();
}
const context={documentState:{documentEpoch:17,changeSeq:3,documentSha256:'synthetic-source-revision'}};
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const ok=value=>{const result=parse(value);assert.equal(result?.ok,true,JSON.stringify(result));return result;};
const scan=d=>parse(d.getScanItems()).map(item=>item.text||'').join('');
const paragraph=(d,source)=>{
 const p=source.cellPath&&JSON.stringify(source.cellPath),n=p?d.getCellParagraphLengthByPath(source.section,source.paragraph,p):d.getParagraphLength(source.section,source.paragraph);
 return p?d.getTextInCellByPath(source.section,source.paragraph,p,0,n):d.getTextRange(source.section,source.paragraph,0,n);
};
const props=(d,source,offset)=>parse(source.cellPath?d.getCellCharPropertiesAtByPath(source.section,source.paragraph,JSON.stringify(source.cellPath),offset):d.getCharPropertiesAt(source.section,source.paragraph,offset));
const semanticProps=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['charShapeId','borderFillId'].includes(key)));
function format(d,ref,start,end,value){
 ok(ref.source.cellPath?d.applyCharFormatInCellByPath(ref.source.section,ref.source.paragraph,JSON.stringify(ref.source.cellPath),ref.start+start,ref.start+end,JSON.stringify(value)):d.applyCharFormat(ref.source.section,ref.source.paragraph,ref.start+start,ref.start+end,JSON.stringify(value)));
}
function search(d,query='alpha😀',options){return createTextSearchPlan(d,context,query,options);}
const edit=(ref,replacement,searchId='search')=>({searchId,matchId:ref.id,replacement});
async function fixture(){
 const {HwpDocument}=await core(),d=HwpDocument.createEmpty();d.createBlankDocument();
 try{
  ok(d.pasteHtml(0,0,0,'<p>body alpha😀 beta alpha😀 omega</p><table><tr><td>level1 alpha😀<table><tr><td>level2 alpha😀<table><tr><td>level3 alpha😀</td></tr></table> tail2</td><td>inner sibling untouched</td></tr></table> tail1</td><td>outer sibling untouched</td></tr></table><p>ending untouched</p>'));
  // A real inline picture before the first edited phrase exercises the engine's
  // logical text offsets in a paragraph that also owns a non-text control.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');
  ok(d.insertPicture(0,0,0,'[]',png,1200,900,1,1,'png','synthetic one-pixel picture'));
  return d;
 }catch(error){d.free();throw error;}
}
function protectedStructure(d){
 const bytes=d.exportHwpx(),entries=zipEntries(Buffer.from(bytes));
 const binaries=entries.filter(e=>e.name.startsWith('BinData/')).map(e=>[e.name,Buffer.from(e.read()).toString('base64')]);
 const xml=entries.find(e=>e.name==='Contents/section0.xml').read().toString('utf8');
 const pictures=[...xml.matchAll(/<hp:pic\b[\s\S]*?<\/hp:pic>/g)].map(m=>m[0]);
 assert.equal(pictures.length,1,'fixture must contain a real picture control');assert.equal(binaries.length,1,'fixture must embed one image binary');
 const plan=search(d),paths=plan.refs.filter(r=>r.source.cellPath).map(r=>r.source);
 const cells=paths.map(source=>({source,properties:parse(d.getCellPropertiesByPath(source.section,source.paragraph,JSON.stringify(source.cellPath),source.cellPath.at(-1).cellIndex)),dimensions:parse(d.getTableDimensionsByPath(source.section,source.paragraph,JSON.stringify(source.cellPath)))}));
 return {binaries,pictures,cells};
}

test('replacement shape mapping retains distinct Unicode character owners and bounds large rewrites',()=>{
 assert.deepEqual(replacementShapeIds('alpha😀','alZpha!😀',[10,11,12,13,14,15]),[10,11,12,12,13,14,14,15]);
 assert.deepEqual(replacementShapeIds('alpha😀','',[10,11,12,13,14,15]),[]);
 assert.deepEqual(replacementShapeIds('unchanged😀','unchanged😀',[...Array(10).keys()]),[...Array(10).keys()]);
 assert.throws(()=>replacementShapeIds('😀','x',[]),/서식 길이/);
 assert.throws(()=>replacementShapeIds('a'.repeat(2001),'b'.repeat(2001),Array(2001).fill(1)),/너무 깁니다/);
});

test('all three revision fields must match, including the document identity',()=>{
 assert.deepEqual(textRevision(context),context.documentState);assert.doesNotThrow(()=>assertTextRevision(textRevision(context),context));
 for(const field of ['documentEpoch','changeSeq','documentSha256'])assert.throws(()=>assertTextRevision({...textRevision(context),[field]:'different'},context),/변경/);
 assert.throws(()=>assertTextRevision(null,context),/변경/);
});

test('cursor remapping keeps text-end affinity for shortening, expansion and adjacent ranges',()=>{
 const body={section:0,paragraph:2},cursor={sectionIndex:0,paragraphIndex:2,charOffset:10};
 const prepared=(source,parts,expectedText)=>({groups:[{source,parts,expectedText}]});
 assert.equal(textEditCursor(prepared(body,[{start:0,length:10,replacement:'x'}],'x'),cursor).charOffset,1);
 assert.equal(textEditCursor(prepared(body,[{start:0,length:10,replacement:'abcdefghijMORE'}],'abcdefghijMORE'),cursor).charOffset,14,'a caret at the replaced span end must follow expanded text');
 const two=prepared(body,[{start:6,length:2,replacement:'Q'},{start:1,length:2,replacement:'WXYZ'}],'aWXYZdefQij');
 assert.equal(textEditCursor(two,{...cursor,charOffset:8}).charOffset,9);assert.equal(textEditCursor(two,cursor).charOffset,11);
 const adjacent=prepared(body,[{start:2,length:2,replacement:'Z'},{start:0,length:2,replacement:'WXYZ'}],'WXYZZ');
 assert.equal(textEditCursor(adjacent,{...cursor,charOffset:2}).charOffset,4,'adjacent replacements must retain the boundary between their resulting text');
 assert.equal(textEditCursor(prepared(body,[{start:3,length:5,replacement:'q'}],'abcqij'),{...cursor,charOffset:0}).charOffset,0);
 assert.equal(textEditCursor(prepared(body,[{start:3,length:5,replacement:'q'}],'abcqij'),{...cursor,charOffset:6}).charOffset,4);
});

test('cursor remapping distinguishes nested source paths and ignores object member ordering',()=>{
 const source={section:0,paragraph:7,cellPath:[{controlIndex:0,cellIndex:1,cellParaIndex:2},{controlIndex:0,cellIndex:3,cellParaIndex:0}]};
 const cursor={sectionIndex:0,paragraphIndex:0,parentParaIndex:7,controlIndex:0,cellIndex:1,cellParaIndex:2,charOffset:10,cellPath:[{cellParaIndex:2,cellIndex:1,controlIndex:0},{cellParaIndex:0,cellIndex:3,controlIndex:0}]};
 const prepared={groups:[{source,parts:[{start:0,length:10,replacement:'x'}],expectedText:'x'}]};
 assert.equal(textEditCursor(prepared,cursor).charOffset,1);
 const sibling={...cursor,cellPath:[source.cellPath[0],{...source.cellPath[1],cellIndex:4}]};assert.deepEqual(textEditCursor(prepared,sibling),sibling,'another nested cell must retain its cursor');
 const body={sectionIndex:0,paragraphIndex:7,charOffset:10};assert.deepEqual(textEditCursor(prepared,body),body,'body and cell source locations must remain distinct');
 const otherParagraph={...cursor,parentParaIndex:8};assert.deepEqual(textEditCursor(prepared,otherParagraph),otherParagraph);
});

test('real search paginates unambiguous body and 1/2/3-depth source addresses',integration,async()=>{
 const d=await fixture();try{
  const first=search(d,'alpha😀',{limit:2});assert.equal(first.result.totalMatches,5);assert.equal(first.result.nextCursor,2);assert.equal(first.result.truncated,true);
  const rest=search(d,'alpha😀',{cursor:first.result.nextCursor,limit:100}),hits=[...first.result.hits,...rest.result.hits];
  assert.deepEqual(hits.map(h=>h.depth),[0,0,1,2,3]);assert.equal(new Set(hits.map(h=>h.id)).size,5);assert.equal(rest.result.nextCursor,null);
  for(const hit of hits){assert.equal(Array.from(paragraph(d,hit.source)).slice(hit.start,hit.start+hit.length).join(''),'alpha😀');assert.equal(hit.length,6);assert.equal(hit.kind,hit.depth?'cell_text':'body_text');}
  assert.equal(search(d,'not present').result.totalMatches,0);
  for(const query of ['', 'line\nbreak', '\ufffc'])assert.throws(()=>search(d,query),/검색어/);
  assert.throws(()=>search(d,'alpha😀',{limit:101}),/검색어/);assert.throws(()=>search(d,'alpha😀',{cursor:-1}),/검색어/);
 }finally{d.free();}
});

test('ascending same-paragraph requests apply descending and preserve every retained character shape in nested cells',integration,async()=>{
 const d=await fixture();let reopened,baseline;try{
  let plan=search(d);const styles=[{textColor:'#112233'},{bold:true,textColor:'#2255aa'},{italic:true,textColor:'#228844'},{fontSize:1400,textColor:'#aa2233'},{underline:true,textColor:'#17394c'},{bold:true,textColor:'#772299'}];
  for(const ref of plan.refs)for(let i=0;i<styles.length;i++)format(d,ref,i,i+1,styles[i]);
  plan=search(d);const before=plan.refs.map(ref=>Array.from({length:ref.length},(_,i)=>props(d,ref.source,ref.start+i)));
  // Compare save/reopen with the same engine's unedited save/reopen baseline.
  // It normalizes unused pattern metadata while writing HWPX, independently
  // of text edits; do not hide that normalization by dropping more fields.
  const {HwpDocument}=await core();baseline=new HwpDocument(d.exportHwpx());
  const savedBefore=plan.refs.map(ref=>Array.from({length:ref.length},(_,i)=>semanticProps(props(baseline,ref.source,ref.start+i))));
  const originals=plan.refs.map(ref=>ref.paragraphText),snapshot=d.saveSnapshot();
  const replacements=['alZpha!😀','alpha😀 plus','alZpha!😀','alZpha!😀','alZpha!😀'];
  const prepared=prepareTextEdits(d,new Map([['search',plan]]),plan.refs.map((ref,i)=>edit(ref,replacements[i])),context);
  assert.deepEqual(prepared.groups[0].parts.map(part=>part.start),[17,5],'same paragraph must mutate from its final match backwards');
  assert.deepEqual(applyTextEdits(d,prepared),{ranges:5,paragraphs:4});
  assert.equal(paragraph(d,plan.refs[0].source),'body alZpha!😀 beta alpha😀 plus omega');
  assert.equal(paragraph(d,plan.refs[3].source),'level2 alZpha!😀');assert.equal(paragraph(d,plan.refs[4].source),'level3 alZpha!😀');
  // This mapping follows the fixture's retained characters, not the LCS implementation.
  const kept=[[0,0],[1,1],[2,3],[3,4],[4,5],[5,7]];
  for(const index of [0,2,3,4])for(const [oldOffset,newOffset]of kept)assert.deepEqual(props(d,plan.refs[index].source,plan.refs[index].start+newOffset),before[index][oldOffset],`shape owner changed at depth ${plan.refs[index].source.cellPath?.length||0}, offset ${oldOffset}`);
  // The second occurrence moved by two logical characters after the first edit.
  for(let i=0;i<6;i++)assert.deepEqual(props(d,plan.refs[1].source,19+i),before[1][i]);
  reopened=new HwpDocument(d.exportHwpx());assert.equal(scan(reopened),scan(d));
  for(const index of [0,2,3,4])for(const [oldOffset,newOffset]of kept)assert.deepEqual(semanticProps(props(reopened,plan.refs[index].source,plan.refs[index].start+newOffset)),savedBefore[index][oldOffset],'save/reopen changed retained formatting');
  ok(d.restoreSnapshot(snapshot));d.discardSnapshot(snapshot);
  for(const ref of plan.refs)assert.equal(paragraph(d,ref.source),ref.paragraphText);
  assert.deepEqual(plan.refs.map(ref=>paragraph(d,ref.source)),originals,'snapshot must restore all edited depths together');
  for(let i=0;i<plan.refs.length;i++)for(let offset=0;offset<6;offset++)assert.deepEqual(props(d,plan.refs[i].source,plan.refs[i].start+offset),before[i][offset]);
 }finally{baseline?.free();reopened?.free();d.free();}
});

test('editing host text preserves surrounding nested tables, sibling cells and inline picture bytes through save/reopen',integration,async()=>{
 const d=await fixture();let reopened;try{
  const protectedBefore=protectedStructure(d),plan=search(d),nestedBefore=plan.refs.filter(r=>r.source.cellPath).map(r=>paragraph(d,r.source));
  const prepared=prepareTextEdits(d,new Map([['search',plan]]),[edit(plan.refs[0],'a longer revised phrase😀')],context);applyTextEdits(d,prepared);
  assert.deepEqual(protectedStructure(d),protectedBefore,'text replacement modified a table property or picture source');
  assert.deepEqual(plan.refs.filter(r=>r.source.cellPath).map(r=>paragraph(d,r.source)),nestedBefore);
  assert.ok(scan(d).includes('inner sibling untouched'));assert.ok(scan(d).includes('outer sibling untouched'));assert.ok(scan(d).includes('ending untouched'));
  const {HwpDocument}=await core();reopened=new HwpDocument(d.exportHwpx());assert.equal(scan(reopened),scan(d));assert.deepEqual(protectedStructure(reopened),protectedBefore);
 }finally{reopened?.free();d.free();}
});

test('stale plans, overlapping ranges and invalid replacements reject before any mutation',integration,async()=>{
 const d=await fixture();try{
  const plan=search(d),plans=new Map([['search',plan]]),before=scan(d),bytes=Buffer.from(d.exportHwpx()),ref=plan.refs[0];
  const assertUnchanged=fn=>{assert.throws(fn);assert.equal(scan(d),before);assert.deepEqual(Buffer.from(d.exportHwpx()),bytes);};
  assertUnchanged(()=>prepareTextEdits(d,plans,[edit(ref,'valid')],{documentState:{...context.documentState,changeSeq:4}}));
  assertUnchanged(()=>prepareTextEdits(d,plans,[edit(ref,'valid','expired')],context));
  assertUnchanged(()=>prepareTextEdits(d,plans,[edit(ref,'one'),edit(ref,'two')],context));
  const longer=search(d,'alpha😀 beta'),overlap=search(d,'beta alpha😀'),overlapPlans=new Map([['a',longer],['b',overlap]]);
  assertUnchanged(()=>prepareTextEdits(d,overlapPlans,[edit(longer.refs[0],'one','a'),edit(overlap.refs[0],'two','b')],context));
  for(const replacement of ['line\nbreak','\ufffc',null])assertUnchanged(()=>prepareTextEdits(d,plans,[edit(ref,replacement)],context));
  ok(d.insertText(0,0,0,'external '));const changed=scan(d);
  assert.throws(()=>prepareTextEdits(d,plans,[edit(ref,'valid')],context),/문단이 변경/);assert.equal(scan(d),changed,'unchanged revision must not bypass source-text validation');
 }finally{d.free();}
});

test('empty replacement deletes only the selected text and remains snapshot-reversible',integration,async()=>{
 const d=await fixture();try{
  const plan=search(d),before=scan(d),protectedBefore=protectedStructure(d),snapshot=d.saveSnapshot();
  const ref=plan.refs.find(r=>r.source.cellPath?.length===3),prepared=prepareTextEdits(d,new Map([['search',plan]]),[edit(ref,'')],context);
  applyTextEdits(d,prepared);assert.equal(paragraph(d,ref.source),'level3 ');assert.equal(search(d).result.totalMatches,4);
  // Compare structure after undo too: an empty replacement is not a cell/table deletion.
  assert.equal(parse(d.getControls()).filter(c=>c.ctrlId==='tbl').length,3);
  ok(d.restoreSnapshot(snapshot));d.discardSnapshot(snapshot);assert.equal(scan(d),before);assert.deepEqual(protectedStructure(d),protectedBefore);
 }finally{d.free();}
});
