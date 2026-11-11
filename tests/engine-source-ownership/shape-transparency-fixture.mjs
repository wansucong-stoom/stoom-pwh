import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {mapHwpxMember} from './hwpx-fixture-utils.mjs';

const js=process.env.PWH_CORE_JS,wasm=process.env.PWH_CORE_WASM;
export async function loadCore(){const core=await import(pathToFileURL(js));await core.default({module_or_path:await fs.readFile(wasm)});return core;}
export function fixture(core,alpha,shape='rectangle',round=0){
 const doc=core.HwpDocument.createEmpty();doc.createBlankDocument();
 try{
  const result=JSON.parse(doc.createShapeControl(JSON.stringify({shapeType:shape,width:12000,height:6000,horzOffset:7200,vertOffset:7200,treatAsChar:false,textWrap:'InFrontOfText'})));
  doc.setShapeProperties(0,result.paraIdx,result.controlIdx,JSON.stringify({borderColor:0,borderWidth:300,fillBgColor:255,roundRate:round}));
  return mapHwpxMember(doc.exportHwpx(),'Contents/section0.xml',xml=>xml.replace(/(<hc:winBrush\b[^>]*\balpha=")[^"]*(")/,'$1'+alpha+'$2'));
 }finally{doc.free();}
}
