// Run inside the editor, with one undoable snapshot and a revision guard.
export async function applyDesktopBodyStyles({document,read,command}){
 const before=read(),expected=command.expected,keys=['documentEpoch','changeSeq','documentSha256'];
 if(!before?.ready||keys.some(k=>before.documentState?.[k]!==expected?.[k]))throw Error('문서가 변경되어 서식을 적용하지 않았습니다.');
 const edits=command.edits;if(!Array.isArray(edits)||edits.length<1||edits.length>100)throw Error('서식을 적용할 문단을 확인하세요.');
 const wasm=document.wasm,seen=new Set();
 for(const e of edits){
  if(!Number.isSafeInteger(e.section)||!Number.isSafeInteger(e.paragraph)||e.section<0||e.paragraph<0||typeof e.text!=='string'||e.text.length>18000)throw Error('문단 위치가 올바르지 않습니다.');
  const key=e.section+':'+e.paragraph;if(seen.has(key))throw Error('같은 문단이 중복되었습니다.');seen.add(key);
  const len=wasm.getParagraphLength(e.section,e.paragraph),actual=wasm.getTextRange(e.section,e.paragraph,0,len);if(actual!==e.text)throw Error('문단 내용이 바뀌어 서식을 적용하지 않았습니다.');
  const raw=wasm.getControlTextPositions(e.section,e.paragraph),controls=typeof raw==='string'?JSON.parse(raw):raw,all=wasm.getControls();const local=Array.isArray(all)?all.filter(c=>c.para===e.paragraph):[];if(!Array.isArray(controls)||!Array.isArray(all)||local.some(c=>!['secd','cold'].includes(c.ctrlId))||controls.length>local.length)throw Error('표·그림 등 객체를 포함한 문단은 본문 서식 변경에서 제외합니다.');
  const style=e.style;if(!style||typeof style!=='object'||Object.keys(style).some(k=>!['bold','fontSize','textColor','alignment'].includes(k))||!Object.keys(style).length)throw Error('문단 서식이 올바르지 않습니다.');
  if(style.bold!==undefined&&typeof style.bold!=='boolean'||style.fontSize!==undefined&&(!Number.isInteger(style.fontSize)||style.fontSize<600||style.fontSize>7200)||style.textColor!==undefined&&!/^#[0-9a-f]{6}$/i.test(style.textColor)||style.alignment!==undefined&&!['left','center','right','justify'].includes(style.alignment))throw Error('문단 서식 값이 올바르지 않습니다.');
 }
 const checked=value=>{const result=typeof value==='string'?JSON.parse(value):value;if(result?.error)throw Error(String(result.error));};
 const input=document.getInputHandler(),cursor=input.getCursorPosition();
 await input.executeDocumentAgentOperation({kind:'snapshot',operationType:'pwh-desktop-body-style',operation:w=>{for(const e of edits){const len=w.getParagraphLength(e.section,e.paragraph),char={};for(const k of ['bold','fontSize','textColor'])if(e.style[k]!==undefined)char[k]=e.style[k];if(len&&Object.keys(char).length)checked(w.applyCharFormat(e.section,e.paragraph,0,len,JSON.stringify(char)));if(e.style.alignment)checked(w.applyParaFormat(e.section,e.paragraph,JSON.stringify({alignment:e.style.alignment})));}return cursor;}},()=>document.getCanvasView().refreshDocumentAgentMutation());
 return {ok:true,undoSteps:1,changes:{paragraphs:edits.length}};
}

export async function applyDesktopColumns({document,read,command}){
 const before=read(),expected=command.expected,keys=['documentEpoch','changeSeq','documentSha256'];
 if(!before?.ready||keys.some(k=>before.documentState?.[k]!==expected?.[k]))throw Error('문서가 변경되어 단 설정을 적용하지 않았습니다.');
 const {section,columns}=command;if(!Number.isSafeInteger(section)||section<0||section>=document.wasm.getSectionCount()||![1,2,3].includes(columns))throw Error('구역 또는 단 수가 올바르지 않습니다.');
 if(document.wasm.getColumnDef(section).columnCount===columns)return {ok:true,undoSteps:0,changes:{section,columns,unchanged:true}};
 const input=document.getInputHandler(),cursor=input.getCursorPosition();
 await input.executeDocumentAgentOperation({kind:'snapshot',operationType:'pwh-desktop-columns',operation:w=>{const value=w.setColumnDef(section,columns,0,1,2268),result=typeof value==='string'?JSON.parse(value):value;if(result?.error||w.getColumnDef(section).columnCount!==columns)throw Error('단 설정 결과를 확인하지 못했습니다.');return cursor;}},()=>document.getCanvasView().refreshDocumentAgentMutation());
 return {ok:true,undoSteps:1,changes:{section,columns}};
}

export async function insertDesktopImage({document,read,command,bytes,sameContext}){
 const before=read();if(!before?.ready||!sameContext(before,command.expected)||before.selection||before.kind!=='body_text'||before.cursor?.parentParaIndex!=null||before.cursor?.cellPath?.length)throw Error('본문 커서나 문서가 바뀌었습니다. 다시 요청하세요.');
 const image=command.image,widthMm=command.widthMm;if(!image||!['png','jpg'].includes(image.extension)||!Number.isFinite(widthMm)||widthMm<20||widthMm>160)throw Error('그림 정보가 올바르지 않습니다.');
 const wasm=document.wasm,input=document.getInputHandler(),cursor=input.getCursorPosition(),page=wasm.getPageDef(cursor.sectionIndex),column=wasm.getColumnDef(cursor.sectionIndex);let available=page.width-page.marginLeft-page.marginRight;if(column?.sameWidth&&column.columnCount>1)available=Math.floor((available-(column.columnCount-1)*column.spacing)/column.columnCount);if(!Number.isFinite(available)||available<=0)throw Error('그림을 넣을 단의 너비를 확인하지 못했습니다.');
 let width=Math.min(Math.round(widthMm*7200/25.4),available),height=Math.round(width*image.height/image.width);if(height>Math.round(120*7200/25.4)){width=Math.round(width*Math.round(120*7200/25.4)/height);height=Math.round(120*7200/25.4);}
 await input.executeDocumentAgentOperation({kind:'snapshot',operationType:'pwh-desktop-insert-image',operation:w=>{const result=w.insertPicture(cursor.sectionIndex,cursor.paragraphIndex,cursor.charOffset,'',bytes,width,height,image.width,image.height,image.extension,'그림',undefined,undefined);if(!result?.ok)throw Error(result?.error||'그림을 삽입하지 못했습니다.');return {...cursor,paragraphIndex:result.paraIdx??cursor.paragraphIndex,charOffset:result.logicalOffset??cursor.charOffset+1};}},()=>document.getCanvasView().refreshDocumentAgentMutation());
 return {ok:true,undoSteps:1,changes:{imageInserted:true,widthMm:Math.round(width*25.4/7200)}};
}
