export async function waitForInlineEditor(frame) {
  await frame.locator('textarea[aria-label="문서 편집 입력"]').waitFor({state:'attached',timeout:60000});
  await frame.locator('body').evaluate(async()=>{
    const deadline=Date.now()+60000;
    while(Date.now()<deadline){
      if(window.pwhRecoveryReady?.()===true&&window.pwhEditor?.context().ready)return;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('Inline editor not ready: '+document.getElementById('pwh-status')?.innerText);
  });
}
