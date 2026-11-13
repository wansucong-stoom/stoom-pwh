export const cellAttributeKeys=['paddingLeft','paddingRight','paddingTop','paddingBottom','applyInnerMargin','verticalAlign','textDirection','isHeader','cellProtect','fieldName','editableInForm'];
export const cellBorderKeys=['borderLeft','borderRight','borderTop','borderBottom','diagonalLine','diagonalSlash','diagonalBackSlash','diagonalWidth','diagonalColor','centerLine'];
export const cellFillKeys=['fillType','fillColor','patternColor','patternType'];
const clone=value=>JSON.parse(JSON.stringify(value));
export function chooseCopiedFormat(snapshot,options){
 if(!['character','paragraph','both'].includes(options.text))throw Error('모양 복사 항목을 선택하세요.');
 const cellProps={};
 for(const [flag,keys]of [['cellAttributes',cellAttributeKeys],['cellBorders',cellBorderKeys],['cellBackground',cellFillKeys]]){
  if(options[flag]&&!snapshot.cellProps)throw Error('현재 위치의 셀 모양은 복사할 수 없습니다.');
  if(options[flag])for(const key of keys)if(snapshot.cellProps[key]!==undefined)cellProps[key]=clone(snapshot.cellProps[key]);
 }
 const cellOnly=options.target==='cell';
 if(cellOnly&&!Object.keys(cellProps).length)throw Error('복사할 셀 모양을 선택하세요.');
 return {charProps:!cellOnly&&options.text!=='paragraph'?clone(snapshot.charProps):{},paraProps:!cellOnly&&options.text!=='character'?clone(snapshot.paraProps):{},...(Object.keys(cellProps).length?{cellProps}:{}),textToCells:!cellOnly};
}
