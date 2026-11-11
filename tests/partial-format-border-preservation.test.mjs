import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const enabled=!!process.env.PWH_CORE_JS&&!!process.env.PWH_CORE_WASM;
const ok=result=>{const value=JSON.parse(result);assert.equal(value.ok,true);return value;};
const borders=p=>Object.fromEntries(['borderLeft','borderRight','borderTop','borderBottom'].map(k=>[k,p[k]]));
async function core(){const c=await import(pathToFileURL(process.env.PWH_CORE_JS));await c.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return c;}
function target(doc,kind){
  if(kind==='body')return {get:()=>JSON.parse(doc.getParaPropertiesAt(0,0)),set:p=>ok(doc.applyParaFormat(0,0,JSON.stringify(p)))};
  if(kind==='cell'){
    const t=ok(doc.createTable(0,0,0,1,2));return {get:()=>JSON.parse(doc.getCellParaPropertiesAt(0,t.paraIdx,t.controlIdx,0,0)),set:p=>ok(doc.applyParaFormatInCell(0,t.paraIdx,t.controlIdx,0,0,JSON.stringify(p)))};
  }
  if(kind==='header'||kind==='footer'){
    const h=kind==='header';ok(doc.createHeaderFooter(0,h,0));return {get:()=>JSON.parse(doc.getParaPropertiesInHf(0,h,0,0)),set:p=>ok(doc.applyParaFormatInHf(0,h,0,0,JSON.stringify(p)))};
  }
  const n=ok(kind==='footnote'?doc.insertFootnote(0,0,0):doc.insertEndnote(0,0,0));
  return {get:()=>JSON.parse(doc.getParaPropertiesInFootnote(0,0,n.controlIdx,0)),set:p=>ok(doc.applyParaFormatInFootnote(0,0,n.controlIdx,0,JSON.stringify(p)))};
}

for(const kind of ['body','cell','header','footer','footnote','endnote'])test(kind+': partial spacing/fill/border changes preserve untouched paragraph formatting',{
  skip:enabled?false:'Set PWH_CORE_JS and PWH_CORE_WASM',
},async()=>{
  const c=await core(),doc=c.HwpDocument.createEmpty();doc.createBlankDocument();
  try{
    const t=target(doc,kind),before=t.get();
    t.set({spacingBefore:2000,fillType:'none',patternType:-1});
    assert.deepEqual(borders(t.get()),borders(before),'inactive fill fields must not create a box');
    t.set({borderLeft:{type:2,width:3,color:'#123456'},borderRight:{type:0,width:0,color:'#000000'},borderTop:{type:1,width:2,color:'#567890'},borderBottom:{type:0,width:0,color:'#000000'},fillType:'solid',fillColor:'#ddeeff',patternColor:'#112233',patternType:2});
    const styled=t.get();
    t.set({fillType:'solid',fillColor:'#abcdef'});
    const recolored=t.get();assert.deepEqual(borders(recolored),borders(styled));assert.equal(recolored.patternType,styled.patternType);assert.equal(recolored.patternColor,styled.patternColor);assert.equal(recolored.fillColor.toLowerCase(),'#abcdef');
    t.set({borderLeft:{color:'#ff0000'}});
    const oneSide=t.get();assert.equal(oneSide.borderLeft.type,styled.borderLeft.type);assert.equal(oneSide.borderLeft.width,styled.borderLeft.width);assert.deepEqual(oneSide.borderTop,styled.borderTop);assert.equal(oneSide.fillColor.toLowerCase(),'#abcdef');
    t.set({spacingAfter:600});assert.deepEqual(borders(t.get()),borders(oneSide));
    // Reopening must retain the effective paragraph style, not just live paint.
    const bytes=doc.exportHwpx(),reopened=new c.HwpDocument(bytes);
    try{assert.equal(reopened.pageCount(),doc.pageCount());assert.equal(reopened.getTextFileText(),doc.getTextFileText());}
    finally{reopened.free();}
  }finally{doc.free();}
});
