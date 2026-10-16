import { replaceTextWithMutationEffects } from './engine/command';
import { installSelectionBridge } from './collaboration-selection';

export function installInlineEditor(d:any) {
 const bridge=installSelectionBridge(d);
 const read=()=>bridge.getSelectionContext();
 const canRequest=(c:any)=>!!c?.ready&&((!!c.selection&&!!c.selectedText?.text&&c.selectedText.known&&!c.selectedText.truncated)||(c.kind==='object'&&Array.isArray(c.objects)&&c.objects.length>0));
 const requestAI=()=>{const context:any=structuredClone(read());if(!canRequest(context))return;window.dispatchEvent(new CustomEvent('pwh-ai-request',{detail:context}));};
 d.registry.register({id:'pwh:ai-rewrite-request',label:'AI 수정 요청',opensDialog:true,
  canExecute:()=>{const c:any=read();return canRequest(c);},
  execute:requestAI
 });
 let applying=false;
 const area=document.getElementById('editor-area');
 if(area){
  area.style.position='relative';
  const style=document.createElement('style');style.textContent=`#pwh-ai-floating{position:absolute;left:26px;top:44px;z-index:35;display:flex;align-items:center;gap:7px;padding:10px 12px;border:1px solid #c4d4eb;border-radius:24px;background:var(--ui-surface,#fff);color:var(--ui-text,#222);box-shadow:0 3px 12px #0002;font:600 12px system-ui;cursor:pointer;white-space:nowrap}#pwh-ai-floating:disabled{opacity:.55;cursor:default}#pwh-ai-floating:focus-visible{outline:3px solid #4c8ee8;outline-offset:3px}#pwh-ai-floating:not(:disabled):hover{background:var(--ui-surface-muted,#edf3fc)}@media(max-width:980px){#pwh-ai-floating{left:24px;padding:10px;border-radius:50%}#pwh-ai-floating .pwh-ai-label{display:none}}`;document.head.appendChild(style);
  const button=document.createElement('button');button.id='pwh-ai-floating';button.type='button';button.disabled=true;button.setAttribute('aria-label','AI 수정 요청');button.title='수정할 글을 드래그한 뒤 AI 수정을 요청하세요';
  button.innerHTML='<span aria-hidden="true">✦</span><span class="pwh-ai-label">AI 수정 요청</span>';
  button.addEventListener('pointerdown',event=>event.preventDefault());button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',requestAI);area.appendChild(button);
  const update=()=>{const c:any=read();button.disabled=applying||!canRequest(c);button.title=button.disabled?'글을 드래그하거나 그림·도형을 선택하세요':'선택한 글 또는 객체에 AI 수정을 요청합니다';};
  document.addEventListener('pointerup',()=>setTimeout(update,0));document.addEventListener('keyup',update);const timer=setInterval(()=>{if(!button.isConnected){clearInterval(timer);return;}update();},750);
 }
 for(const type of ['keydown','beforeinput','pointerdown','mousedown'])window.addEventListener(type,(event)=>{if(applying){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
 (window as any).pwhEditor={
  ready:()=>d.ready,
  async load(bytes:Uint8Array,name:string){await d.ready;await d.load(bytes,name);},
  context:read,
  export:()=>d.wasm.exportHwpxWithReport(),
  saved:(name:string)=>d.saved(name),
  async rewrite(command:any){
   const before:any=read(),input=d.getInputHandler();
   if(!before.ready||!before.selection||!before.selectedText?.known||before.selectedText.truncated||!['body_text','cell_text','textbox_text'].includes(before.kind))throw Error('본문 또는 같은 셀 안의 텍스트를 선택하세요.');
   const expected=command.expected;
   for(const key of ['documentEpoch','changeSeq','documentSha256'])if(before.documentState[key]!==expected.documentState[key])throw Error('문서가 변경되어 적용하지 않았습니다. 다시 선택해 주세요.');
   if(JSON.stringify(before.selection)!==JSON.stringify(expected.selection)||before.selectedText.text!==expected.selectedText.text)throw Error('선택 영역이 변경되어 적용하지 않았습니다.');
   const replacement=command.replacement;
   if(typeof replacement!=='string'||replacement.length>12000||replacement.includes('\r'))throw Error('다시 쓸 내용이 올바르지 않습니다.');
   const lines=replacement.split('\n'),oldLines=before.selectedText.text.split('\n');
   if(lines.length!==oldLines.length)throw Error('기존 문단 서식을 유지하려면 선택한 문단 수와 같은 수의 문단으로 작성해야 합니다.');
   const {start,end}=before.selection;
   const isCell=start.parentParaIndex!==undefined,first=isCell?(start.cellPath?.at(-1)?.cellParaIndex??start.cellParaIndex):start.paragraphIndex;
   const parts=oldLines.map((text:string,i:number)=>{
    const p={...start,paragraphIndex:first+i,cellParaIndex:first+i,charOffset:i===0?start.charOffset:0,
     ...(start.cellPath?.length?{cellPath:start.cellPath.map((x:any,j:number)=>j===start.cellPath.length-1?{...x,cellParaIndex:first+i}:x)}:{})};
    const props=(offset:number)=>isCell?d.wasm.getCellCharPropertiesAtByPath(p.sectionIndex,p.parentParaIndex,JSON.stringify(p.cellPath?.length?p.cellPath:[{controlIndex:p.controlIndex,cellIndex:p.cellIndex,cellParaIndex:p.cellParaIndex}]),offset):d.wasm.getCharPropertiesAt(p.sectionIndex,p.paragraphIndex,offset);
    const format=props(p.charOffset),length=Array.from(text).length;
    const total=isCell?d.wasm.getCellParagraphLengthByPath(p.sectionIndex,p.parentParaIndex,JSON.stringify(p.cellPath?.length?p.cellPath:[{controlIndex:p.controlIndex,cellIndex:p.cellIndex,cellParaIndex:p.cellParaIndex}])):d.wasm.getParagraphLength(p.sectionIndex,p.paragraphIndex);
    const expectedLength=(i===oldLines.length-1?end.charOffset:total)-p.charOffset;
    if(length!==expectedLength)throw Error('선택에 비텍스트 개체나 해석할 수 없는 오프셋이 포함되어 있습니다.');
    for(let j=0;j<length;j++)if(JSON.stringify(props(p.charOffset+j))!==JSON.stringify(format))throw Error('선택에 서로 다른 글자 서식이 섞여 있습니다. 같은 서식의 범위를 선택해 주세요.');
    if(/[\u0000-\u0008\ufffc]/.test(text))throw Error('선택에 문서 개체가 포함되어 있습니다. 텍스트만 선택해 주세요.');
    return {p,length,format,text:lines[i]};
   });
   if(applying)throw Error('이전 수정 적용이 끝날 때까지 기다려 주세요.');
   applying=true;
   try{await input.executeDocumentAgentOperation({kind:'snapshot',operationType:'pwh-selection-rewrite',operation:(wasm:any)=>{
    for(const part of [...parts].reverse()){
     replaceTextWithMutationEffects(wasm,part.p,part.length,part.text);
     if(part.text){
      const end=part.p.charOffset+Array.from(part.text).length;
      if(isCell)wasm.setCharShapeIdInCellByPath(part.p.sectionIndex,part.p.parentParaIndex,JSON.stringify(part.p.cellPath?.length?part.p.cellPath:[{controlIndex:part.p.controlIndex,cellIndex:part.p.cellIndex,cellParaIndex:part.p.cellParaIndex}]),part.p.charOffset,end,part.format.charShapeId);
      else wasm.setCharShapeId(part.p.sectionIndex,part.p.paragraphIndex,part.p.charOffset,end,part.format.charShapeId);
     }
    }
    wasm.flushDeferredPagination();
    for(const part of parts){
     const count=Array.from(part.text).length;
     const actual=isCell?wasm.getTextInCellByPath(part.p.sectionIndex,part.p.parentParaIndex,JSON.stringify(part.p.cellPath?.length?part.p.cellPath:[{controlIndex:part.p.controlIndex,cellIndex:part.p.cellIndex,cellParaIndex:part.p.cellParaIndex}]),part.p.charOffset,count):wasm.getTextRange(part.p.sectionIndex,part.p.paragraphIndex,part.p.charOffset,count);
     if(actual!==part.text)throw Error('선택 범위 수정 결과가 요청 내용과 다릅니다.');
    }
    const last=parts.at(-1)!;return {...end,charOffset:last.p.charOffset+Array.from(last.text).length};
   }},()=>d.getCanvasView().refreshDocumentAgentMutation());}finally{applying=false;}
   return {ok:true,context:read(),undoSteps:1};
  }
 };
 window.dispatchEvent(new Event('pwh-editor-installed'));
}
