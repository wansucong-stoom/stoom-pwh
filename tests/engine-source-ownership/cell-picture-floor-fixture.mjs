import {emptyCellCaretFixture} from '../engine-cursor/empty-cell-fixture.mjs';
import {declaredNestedFixture} from './declared-nested-fixture.mjs';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';
import {zipEntries} from '../../scripts/setup.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');
export function cellPictureFloorFixture(core,{nested=false}={}){
 const marker=nested?'INNER_0':'RIGHT_0_END';
 const seed=new core.HwpDocument(nested?declaredNestedFixture({inlineInner:true,objectFirst:true}):emptyCellCaretFixture({paragraphs:3,rightParagraphs:1}));
 let bytes;
 try{
  const owner=Array.from({length:seed.pageCount()},(_,p)=>JSON.parse(seed.getPageTextLayout(p)).runs).flat().find(run=>run.text===marker);
  seed.insertPicture(owner.secIdx,owner.parentParaIdx,0,'[]',png,3000,3000,1,1,'png','synthetic stamp');
  bytes=mapHwpxMember(seed.exportHwpx(),'Contents/section0.xml',xml=>{const picture=xml.match(/<hp:pic\b[\s\S]*?<\/hp:pic>/)[0],anchor='<hp:t>'+marker+'</hp:t>';return xml.replace(picture,'').replace(anchor,picture+anchor);});
 }finally{seed.free();}
 let doc=new core.HwpDocument(bytes);
 try{
  const picture=Array.from({length:doc.pageCount()},(_,p)=>JSON.parse(doc.getPageControlLayout(p)).controls).flat().find(c=>c.type==='image');
  const args=[picture.secIdx,picture.paraIdx,JSON.stringify(picture.cellPath),picture.controlIdx];
  doc.setCellPicturePropertiesByPath(...args,JSON.stringify({treatAsChar:false,restrictInPage:true,vertOffset:3000,horzOffset:0}));
  bytes=mapHwpxMember(doc.exportHwpx(),'Contents/section0.xml',xml=>xml.replace(/(<hp:cellSz\b[^>]*\bheight=")(\d+)(")/g,(_s,a,h,b)=>a+Math.max(Number(h),12000)+b));
  return {bytes,args,cellIndex:picture.cellPath.at(-1).cellIndex};
 }finally{doc.free();}
}
export function sourceCellHeights(doc){const xml=zipEntries(Buffer.from(doc.exportHwpx())).find(e=>e.name==='Contents/section0.xml').read().toString('utf8');return [...xml.matchAll(/<hp:cellSz\b[^>]*\bheight="(\d+)"/g)].map(m=>Number(m[1]));}
