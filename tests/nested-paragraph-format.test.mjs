import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {nestedPropertiesFixture,requireOk} from './helpers/nested-properties-fixture.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM;
async function runtime(){const c=await import(pathToFileURL(process.env.PWH_CORE_JS));await c.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return c;}
const key=JSON.stringify,j=JSON.parse;
test('nested paragraph format owns its full path, partial border style and undo IDs',{skip},async()=>{
  const c=await runtime(),{doc,outer,rootPath,innerPath,deepPath}=nestedPropertiesFixture(c.HwpDocument);
  try {
    for(const name of ['getCellParaPropertiesAtByPath','applyParaFormatInCellByPath','setCellParaShapeIdByPath'])assert.equal(typeof doc[name],'function',name);
    const get=(d,path)=>j(d.getCellParaPropertiesAtByPath(0,outer.paraIdx,key(path)));
    const apply=(path,props)=>requireOk(doc.applyParaFormatInCellByPath(0,outer.paraIdx,key(path),key(props)));
    const parent=get(doc,rootPath),inner=get(doc,innerPath),deep=get(doc,deepPath);
    const untouched=innerPath.map((entry,i)=>i===innerPath.length-1?{...entry,cellIndex:1}:{...entry});
    const sibling=get(doc,untouched);
    for(const path of [innerPath,deepPath]) {
      const before=get(doc,path);
      const borders=p=>Object.fromEntries(['borderLeft','borderRight','borderTop','borderBottom'].map(k=>[k,p[k]]));
      apply(path,{spacingBefore:1000,fillType:'none',patternType:-1});
      assert.deepEqual(borders(get(doc,path)),borders(before),'spacing must not create a paragraph box');
      apply(path,{borderLeft:{type:2,width:3,color:'#123456'},borderTop:{type:1,width:2,color:'#567890'},fillType:'solid',fillColor:'#ddeeff',patternType:2,patternColor:'#112233'});
      const styled=get(doc,path);
      apply(path,{fillType:'solid',fillColor:'#abcdef'});
      assert.deepEqual(borders(get(doc,path)),borders(styled));
      assert.equal(get(doc,path).patternType,styled.patternType);
      apply(path,{borderLeft:{color:'#ff0000'}});
      assert.equal(get(doc,path).borderLeft.type,styled.borderLeft.type);
      assert.equal(get(doc,path).borderLeft.width,styled.borderLeft.width);
      assert.deepEqual(get(doc,path).borderTop,styled.borderTop);
      for(const alignment of ['center','right','left','justify']) {apply(path,{alignment});assert.equal(get(doc,path).alignment,alignment);}
      apply(path,{spacingBefore:1500,spacingAfter:600,marginLeft:400,indent:200});
      const after=get(doc,path);assert.notEqual(after.paraShapeId,before.paraShapeId);assert.ok(after.spacingBefore>before.spacingBefore);
      const saved=new c.HwpDocument(doc.exportHwpx());
      try {assert.equal(get(saved,path).alignment,get(doc,path).alignment);assert.equal(get(saved,path).spacingBefore,after.spacingBefore);} finally {saved.free();}
      requireOk(doc.setCellParaShapeIdByPath(0,outer.paraIdx,key(path),before.paraShapeId));
      assert.deepEqual(get(doc,path),before,'restore raw style ID instead of applying UI px values');
    }
    assert.deepEqual(get(doc,rootPath),parent);assert.deepEqual(get(doc,untouched),sibling);assert.deepEqual(get(doc,innerPath),inner);assert.deepEqual(get(doc,deepPath),deep);
    const intact=Buffer.from(doc.exportHwpx()),bad=[...deepPath,{controlIndex:999,cellIndex:0,cellParaIndex:0}];
    for(const path of [[],bad])assert.throws(()=>doc.applyParaFormatInCellByPath(0,outer.paraIdx,key(path),key({alignment:'right',fillColor:'#ff0000'})));
    assert.throws(()=>doc.setCellParaShapeIdByPath(0,outer.paraIdx,key(deepPath),65535));
    assert.deepEqual(Buffer.from(doc.exportHwpx()),intact,'invalid targets must not modify styles or another table');
  } finally {doc.free();}
});
