import test from 'node:test';import assert from 'node:assert/strict';
import {loadCore} from './engine-source-ownership/shape-transparency-fixture.mjs';
import {groupedTextboxFixture,groupMember} from './helpers/grouped-textbox-fixture.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires explicit candidate core paths':false;
for(const nested of [false,true])test(`a ${nested?'nested ':' '}group with one text story supports click, insert, delete and roundtrip`,{skip},async()=>{
  const core=await loadCore(),{bytes,group}=groupedTextboxFixture(core,{nested}),doc=new core.HwpDocument(bytes);
  try{
    const {paraIdx:pi,controlIdx:ci}=group;
    assert.equal(doc.getCellParagraphLength(0,pi,ci,0,0),'Grouped heading'.length);
    const before=groupMember(doc.exportHwpx()),svg=doc.renderPageSvgWithProfile(0,'print');
    const textLayout=JSON.parse(doc.getPageTextLayout(0));
    const text=JSON.stringify(textLayout);assert.match(text,/Grouped heading/);
    const box=JSON.parse(doc.getShapeBBox(0,pi,ci));
    let hit=null;
    for(let y=box.y+5;y<box.y+box.height-3&&!hit;y+=2)for(let x=box.x+10;x<box.x+box.width-10;x+=8){const h=JSON.parse(doc.hitTest(0,x,y));if(h.isTextBox&&h.parentParaIndex===pi&&h.controlIndex===ci){hit=h;break;}}
    assert.ok(hit,'A visible inner glyph must resolve to the unique source textbox');
    assert.ok(hit.cursorRect.height<box.height,'Caret follows the text line');
    assert.equal(JSON.parse(doc.insertTextInCell(0,pi,ci,0,0,7,'NEW ')).ok,true);
    assert.equal(doc.getCellParagraphLength(0,pi,ci,0,0),19);
    const saved=doc.exportHwpx(),xml=groupMember(saved);assert.match(xml,/GroupedNEW {2}heading/);
    assert.equal((xml.match(/<hp:container\b/g)||[]).length,(before.match(/<hp:container\b/g)||[]).length,'Editing must preserve grouping');
    const reopened=new core.HwpDocument(saved);try{assert.equal(reopened.getCellParagraphLength(0,pi,ci,0,0),19);}finally{reopened.free();}
    assert.equal(JSON.parse(doc.deleteTextInCell(0,pi,ci,0,0,7,4)).ok,true);
    assert.equal(doc.renderPageSvgWithProfile(0,'print'),svg,'Removing only inserted text restores the original print');
  }finally{doc.free();}
});
for(const nested of [false,true])test(`ambiguous ${nested?'nested ':''}group stories never alias the first textbox`,{skip},async()=>{
  const core=await loadCore(),{bytes,group}=groupedTextboxFixture(core,{multiple:true,nested}),doc=new core.HwpDocument(bytes);
  try{const before=groupMember(doc.exportHwpx());assert.throws(()=>doc.getCellParagraphLength(0,group.paraIdx,group.controlIdx,0,0));assert.throws(()=>doc.insertTextInCell(0,group.paraIdx,group.controlIdx,0,0,0,'WRONG'));assert.equal(groupMember(doc.exportHwpx()),before);}finally{doc.free();}
});
