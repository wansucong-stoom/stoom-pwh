export function blankBody(wasm:any):boolean {
 try {
  if(wasm.getSectionCount()!==1)return false;
  const controls=wasm.getControls();
  const items=typeof controls==='string'?JSON.parse(controls):controls;
  if(!Array.isArray(items)||items.some((c:any)=>!['secd','cold'].includes(c.ctrlId)))return false;
  const count=wasm.getParagraphCount(0);
  return count>=1&&count<=128&&Array.from({length:count},(_,i)=>wasm.getParagraphLength(0,i)).every(n=>n===0);
 }catch{return false;}
}
export function validateDraft(paragraphs:any) {
 if(!Array.isArray(paragraphs)||!paragraphs.length||paragraphs.length>128)throw Error('초안은 1~128개 문단이어야 합니다.');
 let total=0;
 for(const p of paragraphs){if(!p||typeof p.text!=='string'||/[\r\n\u0000-\u0008\ufffc]/.test(p.text)||!['title','heading','body'].includes(p.role)||((total+=p.text.length)>24000))throw Error('초안 문단·역할·길이를 확인하세요.');}
 if(!paragraphs.some(p=>p.text.trim()))throw Error('작성할 내용을 입력하세요.');
}
export function composeBlankBody(wasm:any,paragraphs:any) {
 validateDraft(paragraphs);
 if(!blankBody(wasm))throw Error('빈 문서가 아닙니다. 기존 내용을 덮어쓰지 않았습니다.');
 const check=(r:any)=>{const value=typeof r==='string'?JSON.parse(r):r;if(value?.ok===false)throw Error('초안 적용 실패');};
 for(let i=0;i<paragraphs.length;i++){
  if(i)check(wasm.splitParagraph(0,i-1,Array.from(paragraphs[i-1].text).length));
  const p=paragraphs[i];if(p.text){check(wasm.insertText(0,i,0,p.text));check(wasm.applyCharFormat(0,i,0,Array.from(p.text).length,JSON.stringify({fontSize:p.role==='title'?1800:p.role==='heading'?1400:1000,bold:p.role!=='body'})));}
 }
 wasm.flushDeferredPagination();
 for(let i=0;i<paragraphs.length;i++)if(wasm.getTextRange(0,i,0,wasm.getParagraphLength(0,i))!==paragraphs[i].text)throw Error('초안 결과 검증 실패');
 const last=paragraphs.length-1;return {sectionIndex:0,paragraphIndex:last,charOffset:Array.from(paragraphs[last].text).length};
}
