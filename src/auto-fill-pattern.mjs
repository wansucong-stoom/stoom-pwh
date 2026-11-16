import {autoFillLists} from './auto-fill-lists.mjs';
const mod=(n,m)=>((n%m)+m)%m;
function numberPattern(values){
 const parsed=values.map(text=>/^([^0-9]*?)([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([^0-9]*)$/.exec(text));
 if(parsed.some(v=>!v))return null;
 const first=parsed[0];
 if(parsed.some(v=>v[1]!==first[1]||v[3]!==first[3]))return null;
 const decimals=Math.max(...parsed.map(v=>(v[2].split('.')[1]||'').length));
 if(decimals>12)return null;
 const scale=10n**BigInt(decimals);
 const numbers=parsed.map(v=>{const raw=v[2].replaceAll(',',''),negative=raw.startsWith('-'),[integer,fraction='']=raw.replace(/^[+-]/,'').split('.');
  return (BigInt(integer)*scale+BigInt(fraction.padEnd(decimals,'0')))*(negative?-1n:1n);});
 const step=numbers.length>1?numbers[1]-numbers[0]:0n;
 if(numbers.some((v,i)=>v!==numbers[0]+BigInt(i)*step))return null;
 const numeric=first[2].replace(/^[+-]/,'').split('.')[0];
 const padding=/^0\d/.test(numeric)&&!numeric.includes(',')?numeric.length:0;
 const grouping=first[2].includes(','),plus=first[2].startsWith('+');
 return {kind:'number',label:step===0n?'같은 값 반복':'숫자 규칙',at(index){
  const value=numbers[0]+BigInt(index)*step,negative=value<0n,absolute=negative?-value:value;
  let integer=(absolute/scale).toString().padStart(padding,'0');
  if(grouping)integer=integer.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const fraction=decimals?'.'+(absolute%scale).toString().padStart(decimals,'0'):'';
  return first[1]+(negative?'-':plus?'+':'')+integer+fraction+first[3];
 }};
}
export function inferAutoFillPattern(values,lists=autoFillLists){
 if(!Array.isArray(values)||!values.length||values.some(v=>typeof v!=='string'||!v.length))throw Error('규칙의 기준이 되는 셀에 먼저 내용을 입력하세요.');
 // Plain numeric series stay unbounded even when 1..20 is in the list UI.
 // Named cycles such as 11월,12월 take priority over a numeric suffix rule.
 const numeric=numberPattern(values);
 if(numeric&&values.every(value=>/^[+-]?[\d,]+(?:\.\d+)?$/.test(value)))return numeric;
 for(const list of lists){
  const start=list.values.indexOf(values[0]);if(start<0)continue;
  const length=list.values.length;
  const step=values.length>1?mod(list.values.indexOf(values[1])-start,length):1;
  if(values.length>1&&list.values.indexOf(values[1])<0)continue;
  if(values.every((v,i)=>v===list.values[mod(start+i*step,length)]))
   return {kind:'list',label:list.label,at:index=>list.values[mod(start+index*step,length)]};
 }
 if(numeric)return numeric;
 // Hancom's no-pattern case repeats the entered text sequence.
 return {kind:'repeat',label:'입력한 내용 반복',at:index=>values[mod(index,values.length)]};
}

export function autoFillDirection(range,selection){
 const rows=range.endRow-range.startRow,cols=range.endCol-range.startCol;
 const dr=selection?.focus?.row-selection?.anchor?.row,dc=selection?.focus?.col-selection?.anchor?.col;
 const vertical=cols===0||(rows>0&&(Number.isFinite(dr)&&Number.isFinite(dc)?Math.abs(dr)>Math.abs(dc):rows>cols));
 return vertical?(dr<0?'up':'down'):(dc<0?'left':'right');
}

// Use the selection's axis and endpoints. Never extend the selected rectangle
// or overwrite a populated cell, including when only seed cells are selected.
export function planAutoFill({rowCount,colCount,cells,range,getText,selection,list=null,lists=autoFillLists}){
 const direction=autoFillDirection(range,selection);
 const {startRow,startCol,endRow,endCol}=range;
 if(![startRow,startCol,endRow,endCol,rowCount,colCount].every(Number.isSafeInteger)||startRow<0||startCol<0||endRow<startRow||endCol<startCol||endRow>=rowCount||endCol>=colCount)
  throw Error('연속된 직사각형 셀 블록을 선택하세요.');
 const map=new Map();for(const cell of cells){
  for(let r=cell.row;r<cell.row+cell.rowSpan;r++)for(let c=cell.col;c<cell.col+cell.colSpan;c++)map.set(r+':'+c,cell);
 }
 const vertical=direction==='up'||direction==='down',reverse=direction==='up'||direction==='left';
 const sequence=(r0,c0,r1,c1)=>{
  const result=[],outerStart=vertical?c0:r0,outerEnd=vertical?c1:r1,innerStart=vertical?r0:c0,innerEnd=vertical?r1:c1;
  for(let outer=outerStart;outer<=outerEnd;outer++)for(let i=0;i<=innerEnd-innerStart;i++){
   const inner=reverse?innerEnd-i:innerStart+i,r=vertical?inner:outer,c=vertical?outer:inner,cell=map.get(r+':'+c);
   if(!cell||cell.rowSpan!==1||cell.colSpan!==1)throw Error('자동 채우기 범위에 병합 셀이 있습니다. 같은 크기의 연속된 셀을 선택하세요.');
   result.push(cell);
  }
  return result;
 };
 const ordered=sequence(startRow,startCol,endRow,endCol);
 const selected=ordered.map(cell=>getText(cell.index));
 if(selected.every(Boolean))return {direction,pattern:'빈 셀 없음',seedCount:selected.length,edits:[]};
 const seedStart=selected.findIndex(Boolean);
 if(!list&&seedStart<0)throw Error('선택한 범위에 먼저 기준 값을 입력하세요.');
 let seedEnd=Math.max(0,seedStart);
 while(seedEnd<selected.length&&selected[seedEnd])seedEnd++;
 const values=list?[]:selected.slice(seedStart,seedEnd),seedCount=values.length;
 const pattern=list?{kind:'list',label:list.label,at:index=>list.values[mod(index,list.values.length)]}:inferAutoFillPattern(values,lists);
 let listIndex=0;
 const edits=ordered.flatMap((cell,index)=>selected[index]?[]:[{cellIndex:cell.index,text:pattern.at(list?listIndex++:index-seedStart)}]);
 return {direction,pattern:pattern.label,seedCount,edits};
}
