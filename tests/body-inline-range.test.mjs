import test from 'node:test';import assert from 'node:assert/strict';
import {loadCore} from './engine-source-ownership/shape-transparency-fixture.mjs';
import {bodyPositionFromLogical,bodyPositionToLogical,compareBodyCursorAffinity} from '../src/body-cursor-position.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires explicit candidate core paths':false;
test('an inline table has distinct insertion sides, line endpoints, copy, delete and fragment undo',{skip},async()=>{
 const c=await loadCore(),d=c.HwpDocument.createEmpty();d.createBlankDocument();
 try{
  const t=JSON.parse(d.createTable(0,0,0,1,1));d.setTableProperties(0,t.paraIdx,t.controlIdx,JSON.stringify({treatAsChar:true}));d.insertTextInCell(0,t.paraIdx,t.controlIdx,0,0,0,'Title');
  const doc=new c.HwpDocument(d.exportHwpx());
  try{
   const sec=0,p=t.paraIdx,slots=JSON.parse(doc.getInlineControlPositions(sec,p));assert.deepEqual(slots,[{controlIndex:t.controlIdx,offset:0}]);
   const before=bodyPositionFromLogical(doc,{sectionIndex:sec,paragraphIndex:p,charOffset:0});
   const after=bodyPositionFromLogical(doc,{sectionIndex:sec,paragraphIndex:p,charOffset:1});
   assert.equal(before.charOffset,after.charOffset);assert.equal(compareBodyCursorAffinity(before,after),-1);
   assert.equal(bodyPositionToLogical(doc,before),0);assert.equal(bodyPositionToLogical(doc,after),1);
   const a=JSON.parse(doc.getCursorRect(sec,p,0)),b=JSON.parse(doc.getCursorRect(sec,p,1));assert.ok(b.x>a.x);assert.ok(a.height<30&&b.height<30);
   assert.equal(JSON.parse(doc.getLineInfo(sec,p,0)).charEnd,1);
   assert.equal(JSON.parse(doc.copySelectionLogical(sec,p,0,p,1)).ok,true);
   const beforeCount=JSON.parse(doc.getControls()).length,print=doc.renderPageSvgWithProfile(0,'print'),capture=doc.captureDeleteRange(sec,p,p);
   assert.equal(JSON.parse(doc.deleteRangeLogical(sec,p,0,p,1)).ok,true);
   assert.equal(JSON.parse(doc.getControls()).length,beforeCount-1);assert.equal(JSON.parse(doc.getInlineControlPositions(sec,p)).length,0);
   doc.restoreDeleteFragment(capture);assert.equal(JSON.parse(doc.getControls()).length,beforeCount);assert.equal(doc.renderPageSvgWithProfile(0,'print'),print);
  }finally{doc.free();}
 }finally{d.free();}
});
test('logical selection removes an inline object between styled letters without deleting either letter',{skip},async()=>{
 const c=await loadCore(),d=c.HwpDocument.createEmpty();d.createBlankDocument();
 try{
  const t=JSON.parse(d.createTable(0,0,0,1,1));d.setTableProperties(0,t.paraIdx,t.controlIdx,JSON.stringify({treatAsChar:true}));
  d.insertTextLogical(0,t.paraIdx,0,'A');d.insertTextLogical(0,t.paraIdx,2,'B');d.applyCharFormat(0,t.paraIdx,0,1,JSON.stringify({bold:true}));
  assert.deepEqual(JSON.parse(d.getInlineControlPositions(0,0)),[{controlIndex:t.controlIdx,offset:1}]);
  d.deleteRangeLogical(0,0,1,0,2);assert.equal(d.getTextRange(0,0,0,2),'AB');assert.equal(JSON.parse(d.getCharPropertiesAt(0,0,0)).bold,true);assert.equal(JSON.parse(d.getCharPropertiesAt(0,0,1)).bold,false);
  const reopened=new c.HwpDocument(d.exportHwpx());try{assert.equal(reopened.getTextRange(0,0,0,2),'AB');assert.deepEqual(JSON.parse(reopened.getInlineControlPositions(0,0)),[]);}finally{reopened.free();}
 }finally{d.free();}
});

test('the same logical selection preserves picture insertion sides and fragment undo',{skip},async()=>{
 const c=await loadCore(),d=c.HwpDocument.createEmpty();d.createBlankDocument();
 try{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');
  const picture=JSON.parse(d.insertPicture(0,0,0,'[]',png,4000,3000,1,1,'png','synthetic'));assert.equal(picture.ok,true);
  assert.equal(JSON.parse(d.setPictureProperties(0,0,picture.controlIdx,JSON.stringify({treatAsChar:true}))).ok,true);
  d.insertTextLogical(0,0,0,'A');d.insertTextLogical(0,0,2,'B');
  const slots=JSON.parse(d.getInlineControlPositions(0,0));assert.equal(slots.length,1);assert.equal(slots[0].offset,1);
  const before=bodyPositionFromLogical(d,{sectionIndex:0,paragraphIndex:0,charOffset:1}),after=bodyPositionFromLogical(d,{sectionIndex:0,paragraphIndex:0,charOffset:2});
  assert.equal(before.charOffset,1);assert.equal(after.charOffset,1);assert.equal(compareBodyCursorAffinity(before,after),-1);
  const print=d.renderPageSvgWithProfile(0,'print'),capture=d.captureDeleteRange(0,0,0);assert.equal(JSON.parse(d.copySelectionLogical(0,0,1,0,2)).ok,true);
  assert.equal(JSON.parse(d.deleteRangeLogical(0,0,1,0,2)).ok,true);assert.equal(d.getTextRange(0,0,0,2),'AB');assert.equal(JSON.parse(d.getInlineControlPositions(0,0)).length,0);
  d.restoreDeleteFragment(capture);assert.equal(d.renderPageSvgWithProfile(0,'print'),print);
 }finally{d.free();}
});
