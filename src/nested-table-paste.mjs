import {sameRequestValue} from './request-state.mjs';

const parsed=value=>typeof value==='string'?JSON.parse(value):value;
const ok=value=>{const result=parsed(value);if(!result?.ok)throw Error('중첩 표 처리에 실패했습니다.');return result;};
const counts=controls=>controls.reduce((map,c)=>{map[c.ctrlId]=(map[c.ctrlId]||0)+1;return map;},{});
const difference=(a,b)=>{const out={};for(const key of new Set([...Object.keys(a),...Object.keys(b)])){const n=(a[key]||0)-(b[key]||0);if(n)out[key]=n;}return out;};

export function extractHancomTableModel(html){
 if(typeof html!=='string'||html.length>8*1024*1024)return null;
 const at=html.indexOf('[data-hwpjson]');if(at<0)return null;
 const start=html.indexOf('{',at),end=html.indexOf('-->',start);if(start<0||end<0)return null;
 const model=html.slice(start,end).trim();try{if(!JSON.parse(model))return null;}catch{return null;}return model;
}

// Invoke inside the editor's snapshot operation: any failed check rolls back the
// entire temporary import and paste. The temporary table shares the destination
// document's resource IDs, so copying it keeps fonts, borders and images.
function cellPosition(context){
 const p=context?.cursor,selected=context?.table?.selectedCells;
 if(!p||p.parentParaIndex==null||p.controlIndex==null||p.cellIndex==null||p.cellParaIndex==null||p.isTextBox||p.headerFooter||p.noteRef)throw Error('표 안의 셀에 커서를 놓고 다시 붙여넣으세요.');
 const coordinate=position=>position&&Object.fromEntries(['sectionIndex','paragraphIndex','charOffset','parentParaIndex','controlIndex','cellIndex','cellParaIndex','cellPath'].map(key=>[key,position[key]]));
 if(context.selection&&!sameRequestValue(coordinate(context.selection.start),coordinate(context.selection.end))||context.kind==='cell_block'&&(!selected||selected.length!==1||selected[0].cellIndex!==p.cellIndex))throw Error('표를 넣을 셀 하나만 선택해 주세요.');
 return p;
}
function pasteControl(w,p){
 if(p.cellPath?.length>1)return ok(w.pasteInternalInCellByPath(p.sectionIndex,p.parentParaIndex,JSON.stringify(p.cellPath),p.charOffset));
 return ok(w.pasteInternalInCell(p.sectionIndex,p.parentParaIndex,p.controlIndex,p.cellIndex,p.cellParaIndex,p.charOffset));
}

export function pasteInternalTableInCell(w,context){
 const p=cellPosition(context);if(!w.clipboardHasControl())throw Error('복사한 표를 다시 선택해 복사하세요.');
 const before=counts(parsed(w.getControls()));pasteControl(w,p);
 if((counts(parsed(w.getControls())).tbl||0)<=(before.tbl||0))throw Error('붙여넣은 표 개체를 확인하지 못했습니다.');
 return {ok:true};
}

function pasteExternalTableInCell(w,context,payload,mode,expectedSpec){
 const p=cellPosition(context);
 if(typeof payload!=='string'||!payload||payload.length>8*1024*1024)throw Error('표 원본 정보를 확인하지 못했습니다.');
 if(w.getSectionCount()!==1||p.sectionIndex!==0)throw Error('여러 구역 문서에는 아직 표를 넣을 수 없습니다.');
 const sec=p.sectionIndex,originalCount=w.getParagraphCount(sec),last=originalCount-1;
 if(last<0)throw Error('문서의 본문을 확인하지 못했습니다.');
 const beforeControls=parsed(w.getControls());
 const originalLength=w.getParagraphLength(sec,last),originalText=w.getTextRange(sec,last,0,originalLength),originalPara=parsed(w.getParaPropertiesAt(sec,last));
 const originalChars=Array.from({length:Math.max(1,originalLength)},(_,i)=>parsed(w.getCharPropertiesAt(sec,last,i)));
 ok(w.insertPwhScratchParagraph(sec,originalCount));
 if(w.getParagraphCount(sec)!==originalCount+1)throw Error('임시 문단을 확인하지 못했습니다.');
 const scratch=originalCount;ok(mode==='hancom'?w.pasteHwpJson(sec,scratch,0,payload):w.pasteHtml(sec,scratch,0,payload));
 const imported=parsed(w.getControls()),tail=imported.filter(c=>c.list===0&&c.para>=scratch),tables=tail.filter(c=>c.ctrlId==='tbl');
 if(tables.length!==1||tail.length!==1)throw Error('표 하나만 복사해 다시 붙여넣어 주세요.');
 const source=tables[0],dims=parsed(w.getTableDimensions(sec,source.para,source.controlIndex));
 if(!dims?.cellCount||dims.cellCount>256)throw Error('복사한 표의 크기를 확인하지 못했습니다.');
 if(expectedSpec){
  if(dims.rowCount!==expectedSpec.rows||dims.colCount!==expectedSpec.columns||dims.cellCount!==expectedSpec.cells.length)throw Error('원본 표의 행·열·병합을 보존하지 못했습니다.');
  for(const [sourceIndex,cell] of expectedSpec.cells.entries()){
   let index=-1;for(let i=0;i<dims.cellCount;i++){const g=parsed(w.getCellInfo(sec,source.para,source.controlIndex,i));if(g.row===cell.row&&g.col===cell.column){if(g.rowSpan!==(cell.rowSpan??1)||g.colSpan!==(cell.columnSpan??1))throw Error('원본 표의 병합을 보존하지 못했습니다.');index=i;break;}}
   if(index<0)throw Error('원본 표의 셀을 확인하지 못했습니다.');
   const count=w.getCellParagraphCount(sec,source.para,source.controlIndex,index),actual=[];
   for(let i=0;i<count;i++){const n=w.getCellParagraphLength(sec,source.para,source.controlIndex,index,i);actual.push(w.getTextInCell(sec,source.para,source.controlIndex,index,i,0,n));}
   const norm=parts=>parts.join('\n').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
   if(norm(actual)!==norm(cell.paragraphs))throw Error('원본 표의 셀 내용을 보존하지 못했습니다.');
   const style=expectedSpec.clipboardStyles?.[sourceIndex];
   if(style){
    const props=parsed(w.getCellProperties(sec,source.para,source.controlIndex,index));
    if(style.fillColor&&String(props.fillColor).toLowerCase()!==style.fillColor.toLowerCase())throw Error('셀 배경을 보존하지 못했습니다.');
    for(let para=0;para<count;para++){
     const n=w.getCellParagraphLength(sec,source.para,source.controlIndex,index,para);if(!n)continue;
     const chars=parsed(w.getCellCharPropertiesAt(sec,source.para,source.controlIndex,index,para,0));
     for(const field of ['bold','fontSize','fontFamily','textColor'])if(style[field]!==undefined&&String(chars[field]).toLowerCase()!==String(style[field]).toLowerCase())throw Error('셀 글자 서식을 보존하지 못했습니다.');
     if(style.alignment&&parsed(w.getCellParaPropertiesAt(sec,source.para,source.controlIndex,index,para)).alignment!==style.alignment)throw Error('셀 문단 정렬을 보존하지 못했습니다.');
    }
   }
  }
 }
 const sourceControls=difference(counts(imported),counts(beforeControls));
 const paragraphs=w.getParagraphCount(sec);
 for(let i=scratch;i<paragraphs;i++)if(w.getParagraphLength(sec,i)!==0)throw Error('표 밖의 글이 함께 복사되어 중첩 표로 넣지 않았습니다.');
 ok(w.copyControl(sec,source.para,source.controlIndex,'[]'));ok(w.deleteTableControl(sec,source.para,source.controlIndex));
 for(let i=w.getParagraphCount(sec)-1;i>=scratch;i--){
  if(w.getParagraphLength(sec,i)!==0||parsed(w.getControls()).some(c=>c.list===0&&c.para===i))throw Error('임시 표를 안전하게 정리하지 못했습니다.');
  ok(w.deletePwhScratchParagraph(sec,i));
 }
 if(w.getParagraphCount(sec)!==originalCount||w.getParagraphLength(sec,last)!==originalLength||w.getTextRange(sec,last,0,originalLength)!==originalText||!sameRequestValue(parsed(w.getParaPropertiesAt(sec,last)),originalPara)||!sameRequestValue(Array.from({length:Math.max(1,originalLength)},(_,i)=>parsed(w.getCharPropertiesAt(sec,last,i))),originalChars)||!sameRequestValue(parsed(w.getControls()),beforeControls))throw Error('원래 본문을 보존하지 못해 붙여넣기를 취소했습니다.');
 pasteControl(w,p);
 if(!sameRequestValue(difference(counts(parsed(w.getControls())),counts(beforeControls)),sourceControls))throw Error('붙여넣은 표의 개체를 확인하지 못했습니다.');
 return {rows:dims.rowCount,columns:dims.colCount,cells:dims.cellCount};
}

export function pasteHancomTableInCell(w,context,model){return pasteExternalTableInCell(w,context,model,'hancom');}
export function pasteHtmlTableInCell(w,context,html,spec){return pasteExternalTableInCell(w,context,html,'html',spec);}
