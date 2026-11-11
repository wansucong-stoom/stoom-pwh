import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {nestedPropertiesFixture,requireOk} from './helpers/nested-properties-fixture.mjs';

test('table and cell properties share flat and nested rules without modifying an ancestor or sibling',{
  skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Set PWH_CORE_JS and PWH_CORE_WASM':false,
},async()=>{
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  const {HwpDocument}=core,{doc,outer,rootPath,innerPath,deepPath}=nestedPropertiesFixture(HwpDocument);
  const props=(document,path)=>JSON.parse(document.getTablePropertiesByPath(0,outer.paraIdx,JSON.stringify(path)));
  const cell=(document,path,index)=>JSON.parse(document.getCellPropertiesByPath(0,outer.paraIdx,JSON.stringify(path),index));
  try{
    for(const method of ['getTablePropertiesByPath','setTablePropertiesByPath','setCellPropertiesByPath'])assert.equal(typeof doc[method],'function',method);
    assert.deepEqual(props(doc,rootPath),JSON.parse(doc.getTableProperties(0,outer.paraIdx,outer.controlIdx)));
    const parent=props(doc,rootPath),sibling=cell(doc,rootPath,1),innerBefore=props(doc,innerPath),deepBefore=props(doc,deepPath);
    const before=doc.exportHwpx();
    requireOk(doc.setTablePropertiesByPath(0,outer.paraIdx,JSON.stringify(innerPath),JSON.stringify({paddingLeft:420,paddingBottom:260,outerTop:90,pageBreak:1,repeatHeader:true})));
    assert.equal(props(doc,innerPath).paddingLeft,420);assert.equal(props(doc,innerPath).outerTop,90);
    assert.equal(props(doc,innerPath).repeatHeader,true);assert.equal(props(doc,innerPath).pageBreak,1);
    assert.deepEqual(props(doc,rootPath),parent);assert.deepEqual(props(doc,deepPath),deepBefore);assert.deepEqual(cell(doc,rootPath,1),sibling);
    requireOk(doc.setCellPropertiesByPath(0,outer.paraIdx,JSON.stringify(deepPath),0,JSON.stringify({height:4200,applyInnerMargin:true,paddingLeft:350,verticalAlign:1,fillType:'solid',fillColor:'#d7ebff'})));
    assert.equal(cell(doc,deepPath,0).height,4200);assert.equal(cell(doc,deepPath,0).paddingLeft,350);assert.equal(cell(doc,deepPath,0).verticalAlign,1);
    assert.deepEqual(props(doc,rootPath),parent);assert.deepEqual(cell(doc,rootPath,1),sibling);
    const reopened=new HwpDocument(doc.exportHwpx()),restored=new HwpDocument(before);
    try{
      assert.equal(props(reopened,innerPath).paddingLeft,420);assert.equal(cell(reopened,deepPath,0).height,4200);
      assert.equal(cell(reopened,deepPath,0).paddingLeft,350);assert.deepEqual(props(restored,innerPath),innerBefore);
      assert.deepEqual(props(restored,deepPath),deepBefore);
    }finally{reopened.free();restored.free();}
    const intact=Buffer.from(doc.exportHwpx());
    const invalid=[...innerPath,{controlIndex:9999,cellIndex:0,cellParaIndex:0}];
    assert.throws(()=>doc.setTablePropertiesByPath(0,outer.paraIdx,JSON.stringify(invalid),JSON.stringify({paddingLeft:999})));
    assert.throws(()=>doc.setCellPropertiesByPath(0,outer.paraIdx,JSON.stringify(invalid),0,JSON.stringify({fillType:'solid',fillColor:'#ff0000'})));
    assert.deepEqual(Buffer.from(doc.exportHwpx()),intact,'invalid paths leave the whole document intact');
  }finally{doc.free();}
});

test('empty nested tables expose source-owned paths and cell geometry without text-run discovery',{
  skip:!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Set PWH_CORE_JS and PWH_CORE_WASM':false,
},async()=>{
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  const {doc,outer,innerPath,deepPath}=nestedPropertiesFixture(core.HwpDocument,{empty:true});
  try{
    const tables=JSON.parse(doc.getPageControlLayout(0)).controls.filter(item=>item.type==='table');
    for(const path of [innerPath,deepPath]){
      const table=tables.find(item=>item.cellPath?.length===path.length);
      assert.ok(table,'table path is present even without any text');
      assert.deepEqual(table.cellPath,path);
      assert.equal(table.parentParaIdx,outer.paraIdx);assert.equal(table.outerTableControlIdx,outer.controlIdx);
      const cells=JSON.parse(doc.getTableCellBboxesByPath(0,outer.paraIdx,JSON.stringify(path)));
      assert.ok(cells.length>0);assert.ok(cells.every(cell=>cell.pageIndex===0&&Number.isFinite(cell.x)&&cell.h>0));
    }
  }finally{doc.free();}
});
