import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM;
const j=JSON.parse,ok=result=>{const x=j(result);assert.equal(x.ok,true,result);return x;};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');
async function runtime(){const c=await import(pathToFileURL(process.env.PWH_CORE_JS));await c.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return c;}
function fixture(c,kind,offset,range,objectFirst,text='앞글뒤글') {
  const doc=c.HwpDocument.createEmpty();doc.createBlankDocument();ok(doc.insertText(0,0,0,text));
  const bold=()=>ok(doc.applyCharFormat(0,0,range[0],range[1],JSON.stringify({bold:true,color:'#aa2200'})));
  if(!objectFirst)bold();let control;
  if(kind==='picture')control=ok(doc.insertPicture(0,0,offset,'[]',png,4000,3000,1,1,'png','synthetic')).controlIdx;
  if(kind==='equation')control=ok(doc.insertEquation(0,0,offset,'x+1',1000,0)).controlIdx;
  if(objectFirst)bold();return {doc,control};
}
const styles=(d,text)=>[...text].map((_,i)=>{const p=j(d.getCharPropertiesAt(0,0,i));return {bold:p.bold,color:p.color};});

for(const [name,kind,offset,range,objectFirst,text] of [
  ['picture in text','picture',2,[0,2],false,'앞글뒤글'],
  ['leading picture','picture',0,[2,3],false,'앞글뒤글'],
  ['leading equation','equation',0,[0,2],true,'앞글뒤글'],
  ['emoji and tab stream widths','picture',3,[0,3],false,'가😀\t나다'],
])test('deleting '+name+' preserves exact text style boundaries and saved formats',{skip},async()=>{
  const c=await runtime(),reference=fixture(c,null,offset,range,objectFirst,text),actual=fixture(c,kind,offset,range,objectFirst,text);
  try {
    const before=actual.doc.exportHwpx(),expected=styles(reference.doc,text);
    ok(kind==='picture'?actual.doc.deletePictureControl(0,0,actual.control):actual.doc.deleteEquationControl(0,0,actual.control));
    assert.deepEqual(styles(actual.doc,text),expected,'deleted control must not consume or extend a text style');
    for(const format of ['hwpx','hwp']) {
      const exportBytes=d=>format==='hwpx'?d.exportHwpx():d.exportHwp();
      const a=new c.HwpDocument(exportBytes(actual.doc)),b=new c.HwpDocument(exportBytes(reference.doc));
      try {assert.deepEqual(styles(a,text),styles(b,text),format+' roundtrip');} finally {a.free();b.free();}
    }
    const restored=new c.HwpDocument(before);
    try {assert.equal(restored.pageCount(),actual.doc.pageCount());assert.equal(j(restored.getControls()).some(item=>item.controlIndex===actual.control),true);} finally {restored.free();}
  } finally {reference.doc.free();actual.doc.free();}
});
