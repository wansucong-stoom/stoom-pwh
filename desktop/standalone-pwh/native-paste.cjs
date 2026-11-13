'use strict';
function installNativePaste(ipcMain,getWindow,ownedLocal){
 let pending=false;
 ipcMain.handle('pwh:paste',async(event,request)=>{
  const win=getWindow(),contents=win?.webContents;
  if(pending||!win||win.isDestroyed()||!win.isFocused()||event.sender!==contents||event.senderFrame!==contents.mainFrame||!ownedLocal(contents.getURL()))throw Error('현재 Pwh 편집 창에서 다시 붙여넣어 주세요.');
  const frame=contents.focusedFrame;
  let url;try{url=new URL(request?.url);}catch{throw Error('붙일 문서 위치를 확인하지 못했습니다.');}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^\/[a-f0-9]{48}\/editor$/.test(url.pathname)||!frame||frame.name!=='editor'||frame.url!==url.href||!contents.mainFrame.framesInSubtree.includes(frame))throw Error('문서 입력 위치가 바뀌어 붙여넣기를 취소했습니다.');
  const expected=request?.expected;
  if(!expected||!Number.isSafeInteger(expected.documentEpoch)||!Number.isSafeInteger(expected.changeSeq)||JSON.stringify(expected).length>32000)throw Error('붙일 문서 상태를 확인하지 못했습니다.');
  pending=true;
  try{
   const same=await frame.executeJavaScript(`(()=>{const c=window.pwhEditor?.context(),t=document.querySelector('textarea[aria-label="문서 편집 입력"]'),e=${JSON.stringify(expected)};return !!c?.ready&&document.hasFocus()&&document.activeElement===t&&c.documentState.documentEpoch===e.documentEpoch&&c.documentState.changeSeq===e.changeSeq&&JSON.stringify(c.cursor)===JSON.stringify(e.cursor)&&JSON.stringify(c.selection)===JSON.stringify(e.selection);})()`);
   if(!same||!win.isFocused()||contents.focusedFrame!==frame)throw Error('문서·선택 또는 포커스가 바뀌어 붙여넣기를 취소했습니다.');
   // Let Chromium create the original trusted paste event and DataTransfer.
   contents.paste();return {ok:true};
  }finally{pending=false;}
 });
}
module.exports={installNativePaste};
