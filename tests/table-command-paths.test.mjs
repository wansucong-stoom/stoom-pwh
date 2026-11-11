import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {zipEntries} from '../scripts/setup.mjs';

const enabled=!!process.env.PWH_CORE_JS&&!!process.env.PWH_CORE_WASM;
const j=JSON.parse,p=JSON.stringify;
async function core() {
  const runtime=await import(pathToFileURL(process.env.PWH_CORE_JS));
  await runtime.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return runtime;
}
function ok(result) {const value=j(result);assert.equal(value.ok,true,p(value));return value;}
function blank(runtime) {const doc=runtime.HwpDocument.createEmpty();doc.createBlankDocument();return doc;}
function insert(doc,outer,path,rows=2,cols=2,options={}) {
  const result=ok(doc.createTableEx(p({sectionIdx:0,parentParaIdx:outer.paraIdx,cellPath:path,charOffset:0,rowCount:rows,colCount:cols,...options})));
  return [...path,{controlIndex:result.controlIdx,cellIndex:0,cellParaIndex:0}];
}
const last=(path,cell,para=0)=>path.map((entry,i)=>i===path.length-1?{...entry,cellIndex:cell,cellParaIndex:para}:{...entry});

test('cell table creation preserves text/anchor order, explicit dimensions and clipboard at arbitrary depth', {skip:!enabled},async()=>{
  const runtime=await core(),doc=blank(runtime);
  try {
    const outer=ok(doc.createTable(0,0,0,2,2)),root=[{controlIndex:outer.controlIdx,cellIndex:2,cellParaIndex:0}],ppi=outer.paraIdx;
    ok(doc.insertTextInCell(0,ppi,outer.controlIdx,3,0,0,'CLIPBOARD-KEPT'));
    ok(doc.copyControl(0,ppi,'[]',outer.controlIdx));
    const clipboard=doc.getClipboardText();
    ok(doc.insertTextInCell(0,ppi,outer.controlIdx,2,0,0,'앞😀뒤'));
    ok(doc.splitParagraphInCellByPath(0,ppi,p(root),2));
    const destination=last(root,2,1);
    ok(doc.insertTextInCellByPath(0,ppi,p(destination),0,'LEFT-RIGHT'));
    for(const treatAsChar of [true,false]) {
      const result=ok(doc.createTableEx(p({sectionIdx:0,parentParaIdx:ppi,cellPath:destination,charOffset:5,rowCount:2,colCount:2,treatAsChar,colWidths:[1200,1400],rowHeights:[900,1100]})));
      const path=[...destination,{controlIndex:result.controlIdx,cellIndex:0,cellParaIndex:0}];
      const props=j(doc.getTablePropertiesByPath(0,ppi,p(path)));
      assert.equal(props.treatAsChar,treatAsChar);
      assert.equal(j(doc.getCellPropertiesByPath(0,ppi,p(path),0)).width,1200);
      const deep=insert(doc,outer,last(path,3),1,2,{treatAsChar:true});
      assert.equal(j(doc.getTableDimensionsByPath(0,ppi,p(deep))).colCount,2);
      assert.ok(j(doc.getTableCellBboxesByPath(0,ppi,p(path))).some(cell=>cell.w>0&&cell.h>0));
    }
    assert.equal(doc.getTextInCellByPath(0,ppi,p(destination),0,100),'LEFT-RIGHT뒤');
    assert.equal(doc.getClipboardText(),clipboard,'nested creation does not use or replace internal clipboard');
    const section=zipEntries(Buffer.from(doc.exportHwpx())).find(entry=>entry.name==='Contents/section0.xml').read().toString('utf8');
    const left=section.indexOf('LEFT-'),right=section.indexOf('RIGHT뒤');
    assert.ok(left>=0&&right>left);
    assert.match(section.slice(left,right),/<hp:tbl\b/,'tables stay between the two source text runs');
    const reopened=new runtime.HwpDocument(doc.exportHwpx());
    try {assert.equal(reopened.getTextInCellByPath(0,ppi,p(destination),0,100),'LEFT-RIGHT뒤');assert.equal(j(reopened.getTableDimensions(0,ppi,outer.controlIdx)).cellCount,4);}
    finally {reopened.free();}
  } finally {doc.free();}
});

test('path structural operations are atomic and preserve containing/sibling tables across save/reopen', {skip:!enabled},async()=>{
  const runtime=await core(),doc=blank(runtime);
  try {
    const outer=ok(doc.createTable(0,0,0,3,3)),ppi=outer.paraIdx,root=[{controlIndex:outer.controlIdx,cellIndex:4,cellParaIndex:0}];
    const path=insert(doc,outer,root,3,3,{treatAsChar:true});
    const sibling=insert(doc,outer,last(root,8),1,1,{treatAsChar:true});
    const ancestor=j(doc.getTableDimensions(0,ppi,outer.controlIdx)),siblingBefore=j(doc.getTablePropertiesByPath(0,ppi,p(sibling)));
    const edit=options=>ok(doc.editTableStructureByPath(0,ppi,p(path),p(options)));
    assert.equal(edit({operation:'insert-row-above',row:1,count:2}).rowCount,5);
    assert.equal(edit({operation:'insert-col-right',col:0,count:2}).colCount,5);
    assert.equal(edit({operation:'delete-row',row:3}).rowCount,4);
    assert.equal(edit({operation:'delete-col',col:3}).colCount,4);
    edit({operation:'merge-cells',row:0,col:0,endRow:1,endCol:1});
    assert.equal(j(doc.getCellInfoByPath(0,ppi,p(path))).rowSpan,2);
    edit({operation:'split-cell-into',row:0,col:0,rows:2,cols:2,equalRowHeight:true,mergeFirst:false});
    edit({operation:'split-cells-in-range',row:2,col:2,endRow:2,endCol:3,rows:1,cols:2,equalRowHeight:false});
    assert.deepEqual(j(doc.getTableDimensions(0,ppi,outer.controlIdx)),ancestor);
    assert.deepEqual(j(doc.getTablePropertiesByPath(0,ppi,p(sibling))),siblingBefore);
    const intact=Buffer.from(doc.exportHwpx());
    for(const options of [{operation:'insert-row-above',row:0,count:257},{operation:'delete-col',col:999},{operation:'merge-cells',row:0,col:0,endRow:90,endCol:90},{operation:'unknown'}]) {
      assert.throws(()=>edit(options));assert.deepEqual(Buffer.from(doc.exportHwpx()),intact);
    }
    assert.throws(()=>doc.editTableStructureByPath(0,ppi,p([...path,{controlIndex:99,cellIndex:0,cellParaIndex:0}]),p({operation:'delete-row',row:0})));
    for(const operation of ['delete-row','delete-col'])assert.throws(()=>doc.editTableStructureByPath(0,ppi,p(sibling),p({operation,row:0,col:0})),'the last cell cannot leave an invalid table');
    assert.deepEqual(Buffer.from(doc.exportHwpx()),intact);
    const reopened=new runtime.HwpDocument(doc.exportHwpx());
    try {assert.deepEqual(j(reopened.getTableDimensionsByPath(0,ppi,p(path))),j(doc.getTableDimensionsByPath(0,ppi,p(path))));assert.deepEqual(j(reopened.getTableDimensions(0,ppi,outer.controlIdx)),ancestor);}
    finally {reopened.free();}
  } finally {doc.free();}
});

test('nested zone properties preserve raw own borders and ancestor styles after serialization', {skip:!enabled},async()=>{
  const runtime=await core(),doc=blank(runtime);
  try {
    const outer=ok(doc.createTable(0,0,0,2,2)),ppi=outer.paraIdx,root=[{controlIndex:outer.controlIdx,cellIndex:1,cellParaIndex:0}];
    const path=insert(doc,outer,root,2,2,{treatAsChar:true});
    const ancestor=j(doc.getCellOwnProperties(0,ppi,outer.controlIdx,1));
    ok(doc.setCellPropertiesByPath(0,ppi,p(path),0,p({borderLeft:{type:1,width:4,color:'#aa0000'},fillType:'solid',fillColor:'#ffeeaa'})));
    const own=j(doc.getCellOwnPropertiesByPath(0,ppi,p(path),0));
    ok(doc.setCellZonePropertiesByPath(0,ppi,p(path),0,0,0,1,p({fillType:'solid',fillColor:'#ccddff'})));
    assert.deepEqual(j(doc.getCellOwnPropertiesByPath(0,ppi,p(path),0)),own,'zone does not overwrite individual cell source styles');
    assert.equal(j(doc.getCellPropertiesByPath(0,ppi,p(path),1)).fillColor,'#ccddff');
    assert.deepEqual(j(doc.getCellOwnProperties(0,ppi,outer.controlIdx,1)),ancestor);
    const reopened=new runtime.HwpDocument(doc.exportHwpx());
    try {assert.equal(j(reopened.getCellPropertiesByPath(0,ppi,p(path),1)).fillColor,'#ccddff');assert.equal(j(reopened.getCellOwnPropertiesByPath(0,ppi,p(path),0)).borderLeft.color,'#aa0000');}
    finally {reopened.free();}
  } finally {doc.free();}
});
