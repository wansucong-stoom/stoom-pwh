export function installPasteBridge(editor,requestNative,notice){
 let pending=false;
 editor.addEventListener('pwh-native-paste-request',event=>{
  event.preventDefault();if(pending)return;
  const context=editor.pwhEditor?.context();if(!context?.ready)return;
  const expected={documentEpoch:context.documentState.documentEpoch,changeSeq:context.documentState.changeSeq,cursor:context.cursor,selection:context.selection};
  pending=true;
  Promise.resolve().then(()=>requestNative({url:editor.location.href,expected})).catch(error=>notice(error.message||'붙여넣지 못했습니다. Ctrl+V로 다시 시도해 주세요.')).finally(()=>{pending=false;});
 });
}
