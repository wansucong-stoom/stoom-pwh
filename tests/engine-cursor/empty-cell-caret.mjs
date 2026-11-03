import assert from 'node:assert/strict';
import {emptyCellCaretFixture,emptyCellCaretTwoSectionFixture} from './empty-cell-fixture.mjs';
const cases=[];
const check=(name,run)=>cases.push({name,run});
const json=s=>JSON.parse(s),near=(a,b,tol=.12)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
function requery(d,hit,hint){return json(d.getCursorRectByPathNear(hit.sectionIndex,hit.parentParaIndex,JSON.stringify(hit.cellPath),hit.charOffset,hint));}
function sameRect(a,b){assert.equal(a.pageIndex,b.pageIndex);near(a.x,b.x);near(a.y,b.y);near(a.height,b.height);}
// The legacy InCell API includes baseline leading; ByPath uses the run origin.
// This difference predates this fix. Both must identify the same real owner.
function sameLegacyOwner(a,b){assert.equal(a.pageIndex,b.pageIndex);near(a.x,b.x);near(a.height,b.height);}
function allSvg(d){return Array.from({length:d.pageCount()},(_,p)=>d.renderPageSvg(p));}
for(const opts of [{fontPoints:8},{fontPoints:24},{rightParagraphs:3},{nested:true},{nested:true,rightParagraphs:3},{verticalAlign:'BOTTOM'}])check('same-cell real text boundary '+JSON.stringify(opts),(core)=>{
 const bytes=emptyCellCaretFixture(opts),d=new core.HwpDocument(bytes);
 try{
  const initial=allSvg(d), n=d.pageCount(); assert.ok(n>1);
  // Select a fragment without the right-cell glyphs. The actual owner can precede or follow it.
  const layouts=Array.from({length:n},(_,p)=>json(d.getPageTextLayout(p)).runs);
  const blank=layouts.findIndex(runs=>!runs.some(r=>r.text.includes('RIGHT_')));assert.ok(blank>=0);
  const hit=json(d.hitTest(blank,300,50));assert.ok(hit.cellPath?.length);
  assert.ok(hit.cursorRect.height>0 && hit.cursorRect.height<=(opts.fontPoints||10)*96/72+.12);
  assert.notEqual(hit.cursorRect.pageIndex,blank,'blank continuation cannot invent an insertion position');
  const before=d.getTextInCellByPath(hit.sectionIndex,hit.parentParaIndex,JSON.stringify(hit.cellPath),0,10000);
  assert.ok(before.startsWith('RIGHT_'),before);assert.ok(hit.charOffset===0||hit.charOffset===before.length);
  sameRect(hit.cursorRect,requery(d,hit,blank));
  if(hit.cellPath.length===1){const entry=hit.cellPath[0];sameLegacyOwner(hit.cursorRect,json(d.getCursorRectInCell(hit.sectionIndex,hit.parentParaIndex,entry.controlIndex,entry.cellIndex,entry.cellParaIndex,hit.charOffset)));}
  assert.deepEqual(allSvg(d),initial,'hit/query must not mutate layout');
  // A para0 query with a blank-fragment hint still finds para0's real owner.
  const p0=hit.cellPath.map(p=>({...p}));p0.at(-1).cellParaIndex=0;
  const p0rect=json(d.getCursorRectByPathNear(hit.sectionIndex,hit.parentParaIndex,JSON.stringify(p0),0,blank));
  assert.notEqual(p0rect.pageIndex,blank);
  d.insertTextInCellByPath(hit.sectionIndex,hit.parentParaIndex,JSON.stringify(hit.cellPath),hit.charOffset,'X');
  assert.equal(d.getTextInCellByPath(hit.sectionIndex,hit.parentParaIndex,JSON.stringify(hit.cellPath),0,10000),before.slice(0,hit.charOffset)+'X'+before.slice(hit.charOffset));
  d.deleteTextInCellByPath(hit.sectionIndex,hit.parentParaIndex,JSON.stringify(hit.cellPath),hit.charOffset,1);
  assert.equal(d.getTextInCellByPath(hit.sectionIndex,hit.parentParaIndex,JSON.stringify(hit.cellPath),0,10000),before);
  const reopened=new core.HwpDocument(d.exportHwpx());try{assert.deepEqual(allSvg(reopened),allSvg(d));}finally{reopened.free()}
  return{pages:n,clickPage:blank,hit};
 }finally{d.free()}
});
for(const opts of [{empty:true,fontPoints:8},{empty:true,fontPoints:24},{empty:true,nested:true},{empty:true,verticalAlign:'CENTER'},{empty:true,verticalAlign:'BOTTOM'},{empty:true,textDirection:'VERTICAL'}])check('true empty cell uses style '+JSON.stringify(opts),(core)=>{
 const d=new core.HwpDocument(emptyCellCaretFixture(opts));try{
  const p=Math.min(1,d.pageCount()-1),hit=json(d.hitTest(p,300,50));assert.ok(hit.cellPath?.length);
  assert.equal(hit.cursorRect.pageIndex,p);near(hit.cursorRect.height,(opts.fontPoints||10)*96/72,.12);sameRect(hit.cursorRect,requery(d,hit,p));
  assert.ok(hit.cursorRect.y>=0&&hit.cursorRect.y+hit.cursorRect.height<=120.2);
  for(let i=d.pageCount()-1;i>=0;i--)d.renderPageSvg(i);sameRect(hit.cursorRect,json(d.hitTest(p,300,50)).cursorRect);
  return{pages:d.pageCount(),hit};
 }finally{d.free()}
});
for(const opts of [{empty:true,fontPoints:8},{empty:true,fontPoints:24},{empty:true,nested:true}])check('existing zero-character run remains authoritative '+JSON.stringify(opts),(core)=>{
 const d=new core.HwpDocument(emptyCellCaretFixture(opts));try{const hit=json(d.hitTest(0,300,20));sameRect(hit.cursorRect,requery(d,hit,0));return{hit};}finally{d.free()}
});
check('empty cell custom DPI uses one unit system',(core)=>{
 const d=new core.HwpDocument(emptyCellCaretFixture({empty:true,fontPoints:24}));try{
  d.setDpi(144);const hit=json(d.hitTest(1,450,75));near(hit.cursorRect.height,48,.12);sameRect(hit.cursorRect,requery(d,hit,1));return{hit};
 }finally{d.free()}
});
check('foreign section hint cannot borrow same-index cell bounds',async(core)=>{
 const d=new core.HwpDocument(emptyCellCaretTwoSectionFixture());try{
  assert.equal(d.pageCount(),2);const h=json(d.hitTest(0,300,20));assert.equal(h.sectionIndex,0);const q=requery(d,h,1);assert.equal(q.pageIndex,0);return{query:q};
 }finally{d.free()}
});

export {cases as emptyCellCaretCases};
