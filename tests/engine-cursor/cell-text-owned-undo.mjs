import assert from 'node:assert/strict';
import {emptyCellCaretFixture,emptyCellCaretTwoSectionFixture} from './empty-cell-fixture.mjs';
import {declaredNestedFixture} from '../engine-source-ownership/declared-nested-fixture.mjs';
import {mapHwpxMember} from '../engine-source-ownership/hwpx-fixture-utils.mjs';
import {zipEntries} from '../../scripts/setup.mjs';

const json = value => JSON.parse(value);
const ok = value => {const result=json(value);assert.equal(result.ok,true);return result;};
const runs = doc => Array.from({length:doc.pageCount()},(_,page)=>json(doc.getPageTextLayout(page)).runs).flat();
const locate = (doc,marker='RIGHT_0_END') => {
  const run=runs(doc).find(run=>run.text===marker);
  assert.ok(run?.cellPath?.length,marker);
  return run;
};
function state(doc) {
  return {
    pages:doc.pageCount(),scan:doc.getScanItems(),
    view:Array.from({length:doc.pageCount()},(_,page)=>({
      svg:doc.renderPageSvgWithProfile(page,'print'),layout:doc.getPageTextLayout(page),
    })),
    xml:zipEntries(Buffer.from(doc.exportHwpx()))
      .filter(entry=>entry.name.endsWith('.xml')||entry.name==='META-INF/rhwp-source-layout-history.json')
      .map(entry=>[entry.name,entry.read().toString('utf8')])
      .sort(([a],[b])=>a.localeCompare(b)),
  };
}
function args(owner,offset) {
  const cell=owner.cellPath[0];
  return [owner.secIdx,owner.parentParaIdx,cell.controlIndex,cell.cellIndex,cell.cellParaIndex,offset];
}
function insert(doc,owner,offset,text) {
  // Nested ByPath has no deferred mutation API. Its existing immediate path is
  // also checked so the Studio guard need not infer a different cell owner.
  return owner.cellPath.length===1
    ? ok(doc.insertTextInCellDeferredPagination(...args(owner,offset),text))
    : ok(doc.insertTextInCellByPath(owner.secIdx,owner.parentParaIdx,JSON.stringify(owner.cellPath),offset,text));
}
function remove(doc,owner,offset,count) {
  return owner.cellPath.length===1
    ? ok(doc.deleteTextInCell(...args(owner,offset),count))
    : ok(doc.deleteTextInCellByPath(owner.secIdx,owner.parentParaIdx,JSON.stringify(owner.cellPath),offset,count));
}
const compare = (a,b,label) => assert.deepEqual(state(a),state(b),label);

export const cellTextOwnedUndoCases = [
  {name:'flat short tail',text:'z'},
  {name:'flat middle insertion',text:'z',at:2},
  {name:'flat wrapping text',text:' lengthy text '.repeat(28)},
  {name:'Korean and supplementary scalar text',text:'한글😀𐐀'},
  {name:'empty right cell',text:'z',empty:true},
  {name:'pending job begun',text:' word'.repeat(70),job:true},
  {name:'pending job stepped',text:' word'.repeat(70),job:true,step:true},
  {name:'HWP5 first edit',text:'z',hwp:true},
  {name:'HWP5 wrapping text',text:' word'.repeat(70),hwp:true},
  {name:'two sections',text:'z',two:true},
  {name:'nested table inside edited cell',text:'z',declared:true,marker:'HEADER'},
  {name:'deep nested ByPath immediate path',text:'z',declared:true,marker:'INNER_0'},
  {name:'nested wrapping ByPath immediate path',text:' word'.repeat(20),declared:true,marker:'INNER_0'},
  {name:'invalid target after pending cancel recovers',text:' word'.repeat(70),job:true,failure:true},
];

export function verifyCellTextOwnedUndo(core,definition) {
  let bytes=definition.declared ? declaredNestedFixture({inlineInner:true,objectFirst:true})
    : definition.two ? emptyCellCaretTwoSectionFixture()
    : emptyCellCaretFixture({empty:!!definition.empty});
  if(definition.job) {
    // A single root with multiple RowBreak rows meets the actual resumable-job
    // contract. Assertions below require Pending and a real processed fragment.
    bytes=mapHwpxMember(bytes,'Contents/section0.xml',xml=>{
      const row=xml.match(/<hp:tr>[\s\S]*?<\/hp:tr>/)?.[0];
      assert.ok(row);
      const rows=[1,2].map(index=>row.replace(/rowAddr="0"/g,`rowAddr="${index}"`)
        .replace(/(LEFT_|RIGHT_)/g,`ROW${index}_$1`)).join('');
      return xml.replace('rowCnt="1"','rowCnt="3"').replace(row,row+rows)
        .replace(/(<hp:sz[^>]*height=")24000"/,'$172000"');
    });
  }
  if(definition.hwp) {
    const converted=new core.HwpDocument(bytes);
    try {bytes=converted.exportHwp();} finally {converted.free();}
  }
  const baseline=new core.HwpDocument(bytes),candidate=new core.HwpDocument(bytes);
  try {
    let owner;
    if(definition.empty||definition.two) {
      const hit=json(baseline.hitTest(0,300,20));
      owner={...hit,secIdx:hit.sectionIndex,parentParaIdx:hit.parentParaIndex};
    } else owner=locate(baseline,definition.marker);
    const original=baseline.getTextInCellByPath(owner.secIdx,owner.parentParaIdx,JSON.stringify(owner.cellPath),0,10000);
    const offset=definition.at??Array.from(original).length;
    assert.deepEqual(insert(baseline,owner,offset,definition.text),insert(candidate,owner,offset,definition.text));
    if(definition.job) {
      const begin=json(baseline.beginDeferredPagination(1));
      assert.deepEqual(begin,json(candidate.beginDeferredPagination(1)));
      assert.equal(begin.status,'pending');
      if(definition.step) {
        const step=json(baseline.stepDeferredPagination(1));
        assert.deepEqual(step,json(candidate.stepDeferredPagination(1)));
        assert.equal(step.status,'pending');
        assert.ok(step.fragmentsProcessed>0);
      }
    }
    baseline.flushDeferredPagination();
    const cancelled=candidate.cancelDeferredPagination();
    if(definition.job) assert.equal(cancelled,true,'cancel an actual shadow job, not its source descriptor');
    if(definition.failure) {
      assert.throws(()=>baseline.deleteTextInCell(999,0,0,0,0,0,1));
      assert.throws(()=>candidate.deleteTextInCell(999,0,0,0,0,0,1));
      candidate.flushDeferredPagination();
      compare(baseline,candidate,'failed mutation leaves latest source recoverable');
      return;
    }
    const count=Array.from(definition.text).length;
    remove(baseline,owner,offset,count);remove(candidate,owner,offset,count);
    compare(baseline,candidate,'owned Undo after cancelling intermediate pagination');
    assert.equal(candidate.getTextInCellByPath(owner.secIdx,owner.parentParaIdx,JSON.stringify(owner.cellPath),0,10000),original);
    const reopenedBaseline=new core.HwpDocument(baseline.exportHwpx());
    const reopenedCandidate=new core.HwpDocument(candidate.exportHwpx());
    try {compare(reopenedBaseline,reopenedCandidate,'saved Undo state');}
    finally {reopenedBaseline.free();reopenedCandidate.free();}
    insert(baseline,owner,offset,definition.text);insert(candidate,owner,offset,definition.text);
    baseline.flushDeferredPagination();candidate.flushDeferredPagination();
    compare(baseline,candidate,'Redo');
    remove(baseline,owner,offset,count);remove(candidate,owner,offset,count);
    compare(baseline,candidate,'second Undo');
  } finally {baseline.free();candidate.free();}
}
