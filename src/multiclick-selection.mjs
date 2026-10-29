// Offsets in rhwp are Unicode scalar values, whereas Intl.Segmenter uses UTF-16.
export function wordRange(text,offset){
 const chars=Array.from(text);if(!chars.length)return null;
 const point=Math.max(0,Math.min(chars.length-1,Math.trunc(offset)));
 if(typeof Intl.Segmenter==='function'){
  const utf16=chars.slice(0,point).join('').length;
  for(const part of new Intl.Segmenter('ko',{granularity:'word'}).segment(text)){
   if(utf16>=part.index&&utf16<part.index+part.segment.length){
    const start=Array.from(text.slice(0,part.index)).length;
    return {start,end:start+Array.from(part.segment).length};
   }
  }
 }
 const group=character=>/^[\p{L}\p{N}\p{M}_]$/u.test(character)?'word':/^\s$/u.test(character)?'space':'punctuation';
 const kind=group(chars[point]);let start=point,end=point+1;
 while(start>0&&group(chars[start-1])===kind)start--;
 while(end<chars.length&&group(chars[end])===kind)end++;
 return {start,end};
}

// The two endpoints inherit the exact clicked container, including every nested
// cell-path component and its paragraph index. No adjacent cell can be selected.
export function selectMulticlick(cursor,wasm,count){
 if(count!==2&&count!==3)return false;
 if(cursor.isInHeaderFooter()||cursor.isInFootnote()||cursor.isInTextBox()||cursor.isInCellSelectionMode())return false;
 const pos=cursor.getPosition(),sec=pos.sectionIndex;let len,text;
 try{
  if(pos.parentParaIndex!==undefined){
   if(pos.cellPath?.length){const path=JSON.stringify(pos.cellPath);len=wasm.getCellParagraphLengthByPath(sec,pos.parentParaIndex,path);text=wasm.getTextInCellByPath(sec,pos.parentParaIndex,path,0,len);}
   else{const {parentParaIndex:ppi,controlIndex:ci,cellIndex:cell,cellParaIndex:para}=pos;if(ci===undefined||cell===undefined||para===undefined)return false;len=wasm.getCellParagraphLength(sec,ppi,ci,cell,para);text=wasm.getTextInCell(sec,ppi,ci,cell,para,0,len);}
  }else{len=wasm.getParagraphLength(sec,pos.paragraphIndex);text=wasm.getTextRange(sec,pos.paragraphIndex,0,len);}
  if(!Number.isInteger(len)||len<1||Array.from(text).length!==len)return false;
  const range=count===3?{start:0,end:len}:wordRange(text,pos.charOffset);if(!range||range.end<=range.start)return false;
  // A hit-test rectangle belongs to the clicked offset, not to either endpoint.
  const {cursorRect,...base}=pos;cursor.clearSelection();cursor.moveTo({...base,charOffset:range.start});cursor.setAnchor();cursor.moveTo({...base,charOffset:range.end});return true;
 }catch(error){console.warn('[Pwh] 클릭 선택 실패:',error);return false;}
}
