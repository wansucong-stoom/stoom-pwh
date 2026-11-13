// The renderer counts inline controls as slots. Text editing APIs count only
// Unicode scalar text. Keep those contracts separate and retain affinity at
// an inline boundary, where before/after share the same text offset.
export function isBodyPosition(pos) {
  return pos?.parentParaIndex === undefined && !pos?.cellPath?.length && !pos?.isTextBox;
}

export function hasBodyCursorAffinity(pos) {
  const point=pos?.bodyCursor;
  return isBodyPosition(pos) && point?.sectionIndex===pos.sectionIndex
    && point?.paragraphIndex===pos.paragraphIndex && point?.textOffset===pos.charOffset
    && Number.isInteger(point?.logicalOffset) && point.logicalOffset>=0;
}

function noteAt(doc,pos,offset,direction){
  if(typeof doc.getFootnoteAtCursor!=='function')return false;
  return JSON.parse(doc.getFootnoteAtCursor(pos.sectionIndex,pos.paragraphIndex,offset,direction)).hit===true;
}

export function bodyPositionFromLogical(doc,pos) {
  if(!isBodyPosition(pos) || !Number.isInteger(pos?.charOffset))return pos;
  const logicalOffset=pos.charOffset;
  const textOffset=doc.logicalToTextOffset(pos.sectionIndex,pos.paragraphIndex,logicalOffset);
  const {bodyCursor:_old,...plain}=pos;
  const result={...plain,charOffset:textOffset};
  const canonicalOffset=doc.textToLogicalOffset(pos.sectionIndex,pos.paragraphIndex,textOffset);
  const beforeSlot=typeof doc.getLogicalLength==='function'
    &&logicalOffset<doc.getLogicalLength(pos.sectionIndex,pos.paragraphIndex)
    &&doc.logicalToTextOffset(pos.sectionIndex,pos.paragraphIndex,logicalOffset+1)===textOffset;
  if(canonicalOffset!==logicalOffset||beforeSlot||noteAt(doc,pos,logicalOffset,'forward')||noteAt(doc,pos,logicalOffset,'backward'))
    result.bodyCursor={sectionIndex:pos.sectionIndex,paragraphIndex:pos.paragraphIndex,textOffset,logicalOffset,canonicalOffset};
  return result;
}

export function bodyPositionToLogical(doc,pos) {
  if(!isBodyPosition(pos))return pos.charOffset;
  if(hasBodyCursorAffinity(pos) && doc.logicalToTextOffset(pos.sectionIndex,pos.paragraphIndex,pos.bodyCursor.logicalOffset)===pos.charOffset)
    return pos.bodyCursor.logicalOffset;
  let logical=doc.textToLogicalOffset(pos.sectionIndex,pos.paragraphIndex,pos.charOffset);
  // A plain text position denotes the adjacent text side. An explicit affinity
  // is required to place the caret before a zero-text note reference.
  while(noteAt(doc,pos,logical,'forward'))logical++;
  return logical;
}

export function bodyPositionFromText(doc,pos){
  return isBodyPosition(pos)?bodyPositionFromLogical(doc,{...pos,charOffset:bodyPositionToLogical(doc,pos)}):pos;
}

export function compareBodyCursorAffinity(a,b){
  if(!isBodyPosition(a)||!isBodyPosition(b)||a.sectionIndex!==b.sectionIndex||a.paragraphIndex!==b.paragraphIndex||a.charOffset!==b.charOffset)return 0;
  const x=hasBodyCursorAffinity(a)?a.bodyCursor:null,y=hasBodyCursorAffinity(b)?b.bodyCursor:null;
  if(!x&&!y)return 0;
  const base=x?.canonicalOffset??y?.canonicalOffset??a.charOffset;
  return Math.sign((x?.logicalOffset??base)-(y?.logicalOffset??base));
}
