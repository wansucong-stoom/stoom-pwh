import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {emptyCellCaretFixture} from './engine-cursor/empty-cell-fixture.mjs';
import {declaredNestedFixture} from './engine-source-ownership/declared-nested-fixture.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires explicit PWH_CORE_JS and PWH_CORE_WASM paths':false;
const first='FIRST_PARA One two three four five six.';
const second='SECOND_PARA Seven eight nine.';
const paths=run=>run.cellPath?.at(-1);
function lines(doc,target){
  const owner=JSON.stringify(target.cellPath.slice(0,-1));
  const focus=paths(target);
  const found=new Map();
  for(let page=0;page<doc.pageCount();page++){
    for(const run of JSON.parse(doc.getPageTextLayout(page)).runs){
      const terminal=paths(run);
      if(run.cellPath?.length!==target.cellPath.length||run.parentParaIdx!==target.parentParaIdx||
          terminal.controlIndex!==focus.controlIndex||terminal.cellIndex!==focus.cellIndex||
          terminal.cellParaIndex>1||JSON.stringify(run.cellPath.slice(0,-1))!==owner)continue;
      const key=[page,terminal.cellParaIndex,run.y].join(':');
      const current=found.get(key)??{page,paragraph:terminal.cellParaIndex,y:run.y,h:0};
      current.h=Math.max(current.h,run.h);
      found.set(key,current);
    }
  }
  return [...found.values()];
}
function assertNoOverlap(rendered){
  const one=rendered.filter(line=>line.paragraph===0);
  const two=rendered.filter(line=>line.paragraph===1);
  assert.ok(one.length>1&&two.length>0,'narrowing makes the first paragraph wrap');
  const last=one.at(-1),next=two[0];
  assert.ok(next.page>last.page||next.y>=last.y+last.h-0.2,'the second paragraph starts below the first paragraph');
}
for(const nested of [false,true]){
  test('a resized '+(nested?'nested':'root')+' cell puts its following paragraph below the newly wrapped lines',{skip},async()=>{
    const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
    await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
    const source=nested?declaredNestedFixture({inlineInner:true,objectFirst:true}):emptyCellCaretFixture({paragraphs:3});
    const fixture=mapHwpxMember(source,'Contents/section0.xml',xml=>nested
      ? xml.replace('FIRST_0',first).replace('FIRST_1',second)
      : xml.replace('height="9000"','height="45000"').replace('LEFT_0',first).replace('LEFT_1',second));
    const doc=new core.HwpDocument(fixture);
    try{
      const locate=target=>Array.from({length:target.pageCount()},(_,page)=>JSON.parse(target.getPageTextLayout(page)).runs)
        .flat().find(run=>run.cellPath?.length===(nested?2:1)&&run.text.includes('FIRST'));
      const run=locate(doc);
      assert.ok(run);
      const initial=lines(doc,run),snapshot=doc.saveSnapshot();
      const selected=paths(run).cellIndex,other=selected===0?1:0,delta=nested?14500:7500;
      const edits=JSON.stringify([{cellIdx:selected,widthDelta:-delta},{cellIdx:other,widthDelta:delta}]);
      if(nested)doc.resizeTableCellsByPath(run.secIdx,run.parentParaIdx,JSON.stringify(run.cellPath),edits);
      else doc.resizeTableCells(run.secIdx,run.parentParaIdx,run.controlIdx,edits);
      const resized=lines(doc,run);
      assertNoOverlap(resized);
      const reopened=new core.HwpDocument(doc.exportHwpx());
      try{const reopenedRun=locate(reopened);assert.ok(reopenedRun);assertNoOverlap(lines(reopened,reopenedRun));}finally{reopened.free();}
      doc.restoreSnapshot(snapshot);
      assert.deepEqual(lines(doc,run),initial,'undo restores the original text geometry');
    }finally{doc.free();}
  });
}
