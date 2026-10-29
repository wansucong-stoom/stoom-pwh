// Map preview edges to the real edges of the selected rectangular cell range.
// Merged cells must be wholly selected; a shared edge cannot be split midway.
const sides=['Left','Right','Top','Bottom'];
const edgeNames=['left','right','top','bottom','insideVertical','insideHorizontal'];
const fillKeys=['fillType','fillColor','patternColor','patternType','diagonalLine','diagonalSlash','diagonalBackSlash','diagonalWidth','diagonalColor','centerLine'];
function retainBorderFill(old){const props={};for(const name of fillKeys)if(old[name]!==undefined)props[name]=old[name];for(const side of sides)props['border'+side]=old['border'+side];return props;}
export function planCellBorders(boxes,range,actions){
 if(!Array.isArray(boxes)||!range||!actions)throw Error('셀 선택 범위를 확인할 수 없습니다.');
 const {startRow:r0,endRow:r1,startCol:c0,endCol:c1}=range;
 if(![r0,r1,c0,c1].every(Number.isInteger)||r0>r1||c0>c1)throw Error('셀 선택 범위를 확인할 수 없습니다.');
 for(const [name,b] of Object.entries(actions)){
  if(!edgeNames.includes(name)||!b||!Number.isInteger(b.type)||b.type<0||b.type>8||!Number.isInteger(b.width)||b.width<0||b.width>15||!/^#[0-9a-f]{6}$/i.test(b.color))throw Error('선 모양을 확인해 주세요.');
 }
 const selected=boxes.filter(b=>b.row<=r1&&b.row+b.rowSpan-1>=r0&&b.col<=c1&&b.col+b.colSpan-1>=c0);
 if(!selected.length)throw Error('선택된 셀이 없습니다.');
 if(selected.some(b=>b.row<r0||b.col<c0||b.row+b.rowSpan-1>r1||b.col+b.colSpan-1>c1))throw Error('병합 셀 전체를 선택한 뒤 다시 시도해 주세요.');
 const result=[];
 for(const b of selected){
  const edge={Left:b.col===c0?'left':'insideVertical',Right:b.col+b.colSpan-1===c1?'right':'insideVertical',Top:b.row===r0?'top':'insideHorizontal',Bottom:b.row+b.rowSpan-1===r1?'bottom':'insideHorizontal'};
  const borders={};for(const side of sides)if(actions[edge[side]])borders[side]={...actions[edge[side]]};
  if(Object.keys(borders).length)result.push({cellIndex:b.cellIdx,borders});
 }
 // A neighbour spanning beyond the modified physical edge cannot be partially
 // styled by the underlying format. Refuse before changing any cells.
 for(const item of result){const a=boxes.find(b=>b.cellIdx===item.cellIndex);
  for(const side of Object.keys(item.borders))for(const b of boxes){if(a.cellIdx===b.cellIdx)continue;
   const ro=a.row<b.row+b.rowSpan&&b.row<a.row+a.rowSpan,co=a.col<b.col+b.colSpan&&b.col<a.col+a.colSpan;
   const adjacent=side==='Left'?b.col+b.colSpan===a.col&&ro:side==='Right'?a.col+a.colSpan===b.col&&ro:side==='Top'?b.row+b.rowSpan===a.row&&co:a.row+a.rowSpan===b.row&&co;
   const covered=side==='Left'||side==='Right'?a.row<=b.row&&a.row+a.rowSpan>=b.row+b.rowSpan:a.col<=b.col&&a.col+a.colSpan>=b.col+b.colSpan;
   if(adjacent&&!covered)throw Error('이웃 병합 셀의 선 일부만 변경할 수 없습니다. 병합 셀 전체를 선택해 주세요.');
  }
 }
 return result;
}

export function applyCellBorderPlan(w,ref,plan){
 if(!plan.length)return false;
 const {sec,ppi,ci}=ref;
 w.runInBatch(()=>{for(const item of plan){
  const old=w.getCellOwnProperties(sec,ppi,ci,item.cellIndex),props=retainBorderFill(old);
  // The engine recognizes border changes through borderLeft and synchronizes
  // shared edges. Read each cell at application time to retain earlier edits.
  for(const side of sides)props['border'+side]=item.borders[side]??old['border'+side];
  const result=w.setCellProperties(sec,ppi,ci,item.cellIndex,props);
  if(!result?.ok)throw Error('셀 테두리를 적용하지 못했습니다.');
 }});
 return true;
}
export function applyCellFillPlan(w,ref,indices,changes){
 const {sec,ppi,ci}=ref;
 w.runInBatch(()=>{for(const index of indices){const props={...retainBorderFill(w.getCellOwnProperties(sec,ppi,ci,index)),...changes};const result=w.setCellProperties(sec,ppi,ci,index,props);if(!result?.ok)throw Error('셀 테두리/배경을 적용하지 못했습니다.');}});
}
