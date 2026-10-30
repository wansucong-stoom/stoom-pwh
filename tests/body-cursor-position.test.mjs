import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyPositionFromLogical,bodyPositionToLogical,hasBodyCursorAffinity} from '../src/body-cursor-position.mjs';

const doc={
 logicalToTextOffset(_s,_p,offset){return offset>0?offset-1:0;},
 textToLogicalOffset(_s,_p,offset){return offset>0?offset+1:0;},
 getFootnoteAtCursor(_s,_p,offset,direction){return JSON.stringify({hit:offset===(direction==='forward'?0:1)});},
};
test('note geometry retains before/after affinity without changing text offsets',()=>{
 const before=bodyPositionFromLogical(doc,{sectionIndex:0,paragraphIndex:0,charOffset:0});
 const after=bodyPositionFromLogical(doc,{sectionIndex:0,paragraphIndex:0,charOffset:1});
 assert.equal(before.charOffset,0);assert.equal(after.charOffset,0);
 assert.equal(bodyPositionToLogical(doc,before),0);assert.equal(bodyPositionToLogical(doc,after),1);
 const text=bodyPositionFromLogical(doc,{sectionIndex:0,paragraphIndex:0,charOffset:3});
 assert.equal(text.charOffset,2);assert.equal(bodyPositionToLogical(doc,text),3);
});
test('typing or changing a paragraph invalidates the previous boundary affinity',()=>{
 const after=bodyPositionFromLogical(doc,{sectionIndex:0,paragraphIndex:0,charOffset:1});
 const typed={...after,charOffset:1};assert.equal(hasBodyCursorAffinity(typed),false);assert.equal(bodyPositionToLogical(doc,typed),2);
 const changed={...after,paragraphIndex:1};assert.equal(hasBodyCursorAffinity(changed),false);assert.equal(bodyPositionToLogical(doc,changed),1);
});
test('table, nested cell and text box offsets remain in their own address spaces',()=>{
 for(const extra of [{parentParaIndex:0},{cellPath:[{controlIndex:2,cellIndex:1,cellParaIndex:0}]},{isTextBox:true}]){
  const pos={sectionIndex:0,paragraphIndex:0,charOffset:3,...extra};
  assert.strictEqual(bodyPositionFromLogical(doc,pos),pos);assert.equal(bodyPositionToLogical(doc,pos),3);
 }
});
