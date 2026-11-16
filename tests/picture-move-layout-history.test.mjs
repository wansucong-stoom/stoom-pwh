import test from 'node:test';import assert from 'node:assert/strict';
import {loadCore} from './engine-source-ownership/shape-transparency-fixture.mjs';
import {emptyCellCaretFixture} from './engine-cursor/empty-cell-fixture.mjs';
import {declaredNestedFixture} from './engine-source-ownership/declared-nested-fixture.mjs';
import {zipEntries} from '../scripts/setup.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';
const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires actual core paths':false;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');
const ok=value=>{const result=JSON.parse(value);assert.equal(result.ok,true);return result;};
function state(doc){return{pages:doc.pageCount(),view:Array.from({length:doc.pageCount()},(_,p)=>[doc.getPageTextLayout(p),doc.getPageControlLayout(p),doc.renderPageSvgWithProfile(p,'print')]),xml:zipEntries(Buffer.from(doc.exportHwpx())).filter(e=>e.name.endsWith('.xml')||e.name==='META-INF/rhwp-source-layout-history.json').map(e=>[e.name,e.read().toString('utf8')]).sort(([a],[b])=>a.localeCompare(b))};}
for(const fixture of [{name:'flat cell across pages',bytes:()=>emptyCellCaretFixture({paragraphs:12,rightParagraphs:4}),marker:'RIGHT_0_END'},{name:'nested table cell',bytes:()=>declaredNestedFixture({inlineInner:true,objectFirst:true}),marker:'INNER_0'}]){
 test(`live picture checkpoint preserves layout, redo and reopened source: ${fixture.name}`,{skip},async()=>{
  const core=await loadCore(),seed=new core.HwpDocument(fixture.bytes());let doc;
  try{
   const owner=Array.from({length:seed.pageCount()},(_,p)=>JSON.parse(seed.getPageTextLayout(p)).runs).flat().find(run=>run.text===fixture.marker);assert.ok(owner?.cellPath?.length);
   ok(seed.insertPicture(owner.secIdx,owner.parentParaIdx,0,'[]',png,3000,3000,1,1,'png','synthetic stamp'));
   // Native floating insertion creates a body anchor. This fixture deliberately
   // places the picture control inside the cell's own OWPML paragraph.
   const bytes=mapHwpxMember(seed.exportHwpx(),'Contents/section0.xml',xml=>{const pictures=xml.match(/<hp:pic\b[\s\S]*?<\/hp:pic>/g);assert.equal(pictures?.length,1);const anchor='<hp:t>'+fixture.marker+'</hp:t>';assert.equal(xml.split(anchor).length,2);return xml.replace(pictures[0],'').replace(anchor,pictures[0]+anchor);});
   doc=new core.HwpDocument(bytes);
   const picture=Array.from({length:doc.pageCount()},(_,p)=>JSON.parse(doc.getPageControlLayout(p)).controls).flat().find(control=>control.type==='image');assert.ok(picture?.cellPath?.length);
   const args=[picture.secIdx,picture.paraIdx,JSON.stringify(picture.cellPath),picture.controlIdx];ok(doc.setCellPicturePropertiesByPath(...args,JSON.stringify({treatAsChar:false,restrictInPage:true,vertOffset:1000,horzOffset:2000})));
   let preserved=doc.exportHwpx();doc.free();doc=null;
   if(fixture.name==='flat cell across pages')preserved=mapHwpxMember(preserved,'Contents/section0.xml',xml=>{let changed=0;const result=xml.replace(/<hp:tc\b(?:(?!<hp:tc\b)[\s\S])*?<\/hp:tc>/g,cell=>{if(!cell.includes('<hp:pic'))return cell;changed++;return cell.replace(/(<hp:cellSz\b[^>]*\bheight=")(\d+)(")/,(_all,start,height,end)=>start+(Number(height)+30000)+end);});assert.equal(changed,1);return result;});
   doc=new core.HwpDocument(preserved);const before=state(doc),beforeBytes=doc.exportHwpx(),beforeId=doc.saveSnapshot();let afterId=null;
   try{
    if(fixture.name==='flat cell across pages'){
     const original=JSON.parse(doc.getCellPicturePropertiesByPath(...args));
     const cell=JSON.parse(doc.getCellOwnPropertiesByPath(picture.secIdx,picture.paraIdx,args[2],picture.cellPath.at(-1).cellIndex));
     ok(doc.setCellPicturePropertiesByPath(...args,JSON.stringify({vertOffset:cell.height+3000})));
     ok(doc.setCellPicturePropertiesByPath(...args,JSON.stringify({vertOffset:original.vertOffset,horzOffset:original.horzOffset})));
     assert.notDeepEqual(state(doc),before,'Coordinate-only Undo does not restore the complete cell expansion state');
     doc.restoreSnapshot(beforeId);assert.deepEqual(state(doc),before);
    }
    for(const patch of [{vertOffset:-7000},{vertOffset:18000,horzOffset:4500},{vertOffset:7000}])ok(doc.setCellPicturePropertiesByPath(...args,JSON.stringify(patch)));
    const edited=state(doc);assert.notDeepEqual(edited,before);afterId=doc.saveSnapshot();
    for(let cycle=0;cycle<3;cycle++){
     doc.restoreSnapshot(beforeId);assert.deepEqual(state(doc),before,'Undo restores stored geometry and formatting');
     const reopened=new core.HwpDocument(doc.exportHwpx()),baseline=new core.HwpDocument(beforeBytes);try{assert.deepEqual(state(reopened),state(baseline),'The restored state survives save and reopen');}finally{reopened.free();baseline.free();}
     doc.restoreSnapshot(afterId);assert.deepEqual(state(doc),edited,'Redo restores exactly the state after the gesture');
    }
   }finally{doc.discardSnapshot(beforeId);if(afterId!==null)doc.discardSnapshot(afterId);}
  }finally{doc?.free();seed.free();}
 });
}
