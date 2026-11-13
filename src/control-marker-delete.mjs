// Structural section/column controls are deliberately outside this route.
// Only the displayed page-hiding control at the exact body text boundary owns
// Delete. A failed control operation must not fall through and delete text.
export function tryDeletePageHiding(input,position,inCell){
 const w=input.wasm,cursor=input.cursor;
 if(inCell||cursor.isInHeaderFooter()||cursor.isInFootnote()||cursor.isInTextBox()||cursor.hasSelection()||input.isFormMode?.()||!w.getShowControlCodes())return false;
 let owned=false;
 try{
  const hiding=JSON.parse(w.getPageHide(position.sectionIndex,position.paragraphIndex));if(!hiding.exists)return false;
  let paragraph=position.paragraphIndex;for(let s=0;s<position.sectionIndex;s++)paragraph+=w.getParagraphCount(s);
  const offsets=w.getControlTextPositions(position.sectionIndex,position.paragraphIndex);
  const candidates=w.getControls().filter(c=>c.list===0&&c.para===paragraph&&c.ctrlId==='pghd'&&offsets[c.controlIndex]===position.charOffset);
  if(candidates.length!==1)return false;const target=candidates[0];owned=true;
  input.executeOperation({kind:'snapshot',operationType:'deletePageHiding',operation:wasm=>{wasm.deleteControlAt(target.list,target.para,target.controlIndex);return {...position,cursorRect:undefined};}});
  return true;
 }catch(error){console.warn('[Pwh] 감추기 부호 삭제 실패:',error);return owned;}
}
