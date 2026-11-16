// Only modal overlays own focus. Modeless find/history panels remain usable
// alongside the document. Observe body children, never rendered page subtrees.
export function installModalFocus(doc = document) {
 const win=doc.defaultView;
 const records=new Map();
 let active=null,lastOutside=doc.activeElement,redirecting=false;
 const visible=el=>el?.isConnected && !el.closest('[hidden],[inert]') &&
  el.getClientRects().length>0 && win.getComputedStyle(el).visibility!=='hidden';
 const overlayFor=node=>node?.closest?.('.modal-overlay');
 const popover=node=>node?.closest?.('.pwh-color-popover');
 const candidates=dialog=>Array.from(dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex],[contenteditable="true"]'))
  .filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&visible(el))
  .sort((a,b)=>(a.tabIndex>0?a.tabIndex:Infinity)-(b.tabIndex>0?b.tabIndex:Infinity));
 function focusInside(record,preferred) {
  const dialog=record.dialog;
  const first=preferred&&visible(preferred)&&!preferred.matches(':disabled')?preferred:
   candidates(dialog).find(el=>el.matches('input:not([type="checkbox"]):not([type="radio"]),textarea,select')) ??
   candidates(dialog).find(el=>!el.classList.contains('dialog-close')) ?? dialog;
  if(!dialog.hasAttribute('tabindex'))dialog.tabIndex=-1;
  redirecting=true;try{first.focus({preventScroll:true});}finally{redirecting=false;}
 }
 function sync() {
  const overlays=Array.from(doc.body?.children??[]).filter(el=>el.matches('.modal-overlay')&&visible(el)&&el.querySelector('.dialog-wrap'));
  const previous=active;
  for(const overlay of overlays)if(!records.has(overlay)){
   const dialog=overlay.querySelector('.dialog-wrap');
   const record={overlay,dialog,returnFocus:previous?.lastFocus??lastOutside,lastFocus:null};
   records.set(overlay,record);
   if(!dialog.hasAttribute('role'))dialog.setAttribute('role','dialog');
   dialog.setAttribute('aria-modal','true');
   if(!dialog.hasAttribute('aria-label')&&!dialog.hasAttribute('aria-labelledby')){
    const title=dialog.querySelector('.dialog-title')?.childNodes[0]?.textContent?.trim();
    if(title)dialog.setAttribute('aria-label',title);
   }
   record.bubble=e=>{
    if(active!==record)return;
    if(e.key==='Enter'&&!e.defaultPrevented&&!e.isComposing&&
     e.target.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])')){
     const confirm=dialog.querySelector('.dialog-btn-primary');
     if(confirm&&!confirm.disabled){e.preventDefault();confirm.click();}
    }
    if(e.key==='Escape'&&!e.defaultPrevented&&!e.isComposing){
     const close=dialog.querySelector('.dialog-close');
     if(close){e.preventDefault();close.click();}
    }
    // Native controls and widget listeners run before this boundary.
    e.stopPropagation();
   };
   dialog.addEventListener('keydown',record.bubble);
  }
  active=records.get(overlays.at(-1))??null;
  for(const [overlay,record] of records)if(!overlays.includes(overlay)){
   record.dialog.removeEventListener('keydown',record.bubble);records.delete(overlay);
  }
  if(active){
   if(!active.dialog.contains(doc.activeElement)&&!popover(doc.activeElement))focusInside(active,active.lastFocus);
  }else if(previous){
   const target=previous.returnFocus;
   if(target?.isConnected&&visible(target)&&!target.matches(':disabled')){
    redirecting=true;try{target.focus({preventScroll:true});}finally{redirecting=false;}
   }
  }
  return active;
 }
 const keydown=e=>{
  const current=sync();if(!current)return;
  if(popover(e.target))return;
  if(e.key==='Tab'){
   e.preventDefault();e.stopImmediatePropagation();
   const entries=candidates(current.dialog);
   if(!entries.length){focusInside(current);return;}
   const index=entries.indexOf(doc.activeElement);
   const next=index<0?(e.shiftKey?entries.length-1:0):(index+(e.shiftKey?-1:1)+entries.length)%entries.length;
   entries[next].focus({preventScroll:true});return;
  }
  if(!current.dialog.contains(e.target)){
   e.preventDefault();e.stopImmediatePropagation();focusInside(current,current.lastFocus);
  }
 };
 const focusin=e=>{
  if(redirecting)return;
  const current=sync();
  if(current){
   if(current.dialog.contains(e.target))current.lastFocus=e.target;
   else if(!popover(e.target))focusInside(current,current.lastFocus);
  }else if(!overlayFor(e.target))lastOutside=e.target;
 };
 win.addEventListener('keydown',keydown,true);
 doc.addEventListener('focusin',focusin,true);
 const observer=new win.MutationObserver(sync);
 observer.observe(doc.body,{childList:true});
 sync();
 return ()=>{observer.disconnect();win.removeEventListener('keydown',keydown,true);doc.removeEventListener('focusin',focusin,true);
  for(const record of records.values())record.dialog.removeEventListener('keydown',record.bubble);records.clear();};
}

export function isTopModal(dialog) {
 const overlays=Array.from(dialog.ownerDocument.body.children).filter(el=>el.matches('.modal-overlay')&&el.getClientRects().length&&el.querySelector('.dialog-wrap'));
 return overlays.at(-1)?.contains(dialog)===true;
}
