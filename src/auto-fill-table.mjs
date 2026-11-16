import {planAutoFill} from './auto-fill-pattern.mjs';
const parsed=value=>typeof value==='string'?JSON.parse(value):value;
const checked=value=>{const result=parsed(value);if(!result?.ok)throw Error('셀 내용을 채우지 못했습니다.');return result;};
export function autoFillTableAccess(wasm,position){
 const sec=position.sectionIndex,ppi=position.parentParaIndex,ci=position.controlIndex;
 if(!Number.isInteger(ppi)||!Number.isInteger(ci))throw Error('표의 셀을 선택하세요.');
 const path=position.cellPath?.map(entry=>({...entry})),nested=(path?.length??0)>1;
 const cellPath=(cell,para=0)=>{const copy=path.map(entry=>({...entry}));copy[copy.length-1]={...copy.at(-1),cellIndex:cell,cellParaIndex:para};return JSON.stringify(copy);};
 const call=(flat,byPath,cell,para,...args)=>nested?
  wasm[byPath](sec,ppi,cellPath(cell,para),...args):wasm[flat](sec,ppi,ci,cell,para,...args);
 const dimensions=parsed(nested?wasm.getTableDimensionsByPath(sec,ppi,cellPath(0)):wasm.getTableDimensions(sec,ppi,ci));
 const cells=Array.from({length:dimensions.cellCount},(_,index)=>({index,...parsed(nested?
  wasm.getCellInfoByPath(sec,ppi,cellPath(index)):wasm.getCellInfo(sec,ppi,ci,index))}));
 const cache=new Map();
 function read(cell){
  if(cache.has(cell))return cache.get(cell);
  const count=nested?wasm.getCellParagraphCountByPath(sec,ppi,cellPath(cell)):wasm.getCellParagraphCount(sec,ppi,ci,cell);
  if(count!==1)throw Error('여러 문단이나 개체가 있는 셀은 자동으로 덮어쓰지 않습니다.');
  const length=call('getCellParagraphLength','getCellParagraphLengthByPath',cell,0);
  const text=call('getTextInCell','getTextInCellByPath',cell,0,0,length);
  if(length>24000||Array.from(text).length!==length||/[\r\n\u0000-\u001f\ufffc]/.test(text))
   throw Error('개체나 제어 문자가 있는 셀은 자동으로 덮어쓰지 않습니다.');
  const value={length,text};cache.set(cell,value);return value;
 }
 return {
  dimensions,cells,read,
  plan(range,options={}){return planAutoFill({...dimensions,cells,range,getText:cell=>read(cell).text,...options});},
  prepare(plan){return plan.edits.map(edit=>{
   const old=read(edit.cellIndex),format=parsed(call('getCellCharPropertiesAt','getCellCharPropertiesAtByPath',edit.cellIndex,0,0));
   if(typeof edit.text!=='string'||edit.text.length>24000||!Number.isInteger(format.charShapeId))throw Error('자동 채우기 내용이나 글자 모양을 확인하세요.');
   return {...edit,old,shape:format.charShapeId};
  });},
  apply(prepared){
   // All destination cells have been checked before the first mutation. The
   // caller owns one history snapshot; a failed operation rolls it all back.
   const mutate=()=>{
    for(const edit of prepared){
     if(edit.old.text===edit.text)continue;
     if(edit.old.length)checked(call('deleteTextInCell','deleteTextInCellByPath',edit.cellIndex,0,0,edit.old.length));
     if(edit.text){
      checked(call('insertTextInCell','insertTextInCellByPath',edit.cellIndex,0,0,edit.text));
      checked(call('setCharShapeIdInCell','setCharShapeIdInCellByPath',edit.cellIndex,0,0,Array.from(edit.text).length,edit.shape));
     }
    }
   };
   if(typeof wasm.runInBatch==='function')wasm.runInBatch(mutate);
   else if(typeof wasm.beginBatch==='function'){wasm.beginBatch();try{mutate();}finally{wasm.endBatch();}}
   else mutate();
   cache.clear();
   for(const edit of prepared)if(read(edit.cellIndex).text!==edit.text)throw Error('자동 채우기 결과가 일치하지 않습니다.');
  },
 };
}
