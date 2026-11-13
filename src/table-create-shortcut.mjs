// One owner for editor chords, including the browser-compatible alternatives.
// Physical codes keep Korean IME Process events on the same command route.
const pending=new WeakMap();
const commands={
 n:{
  t:'table:create',a:'table:split',z:'table:attach',i:'insert:image',b:'insert:textbox',
  n:'insert:footnote',e:'insert:endnote',m:'insert:equation',c:'insert:caption-toggle',
  s:'page:hide',g:'page:section-settings',f:'table:formula',k:'field:edit',
 },
 q:{f:'edit:find',a:'edit:find-replace',l:'edit:find-previous'},
 k:{h:'insert:hyperlink',b:'insert:bookmark',n:'format:para-num-shape'},
 m:{f:'table:formula',a:'table:split',z:'table:attach',n:'insert:footnote',s:'page:hide',m:'insert:equation',
  ...Object.fromEntries(['k','r','b','d','g','y','c','w'].map(key=>[key,'format:quick-color-'+key]))},
 g:{b:'view:border-transparent',c:'view:ctrl-mark',t:'view:para-mark',p:'view:zoom-fit-page',w:'view:zoom-fit-width',q:'view:zoom-100'},
 v:{t:'view:border-transparent'},
};
const koreanKey=Object.fromEntries([... 'ㅁㅠㅊㅇㄷㄹㅎㅗㅑㅓㅏㅣㅡㅜㅐㅔㅂㄱㄴㅅㅕㅍㅈㅌㅛㅋ'].map((key,index)=>[key,String.fromCharCode(97+index)]));
const letter=event=>/^Key[A-Z]$/.test(event.code||'')?event.code.slice(-1).toLowerCase()
 :koreanKey[event.key]??event.key?.toLowerCase();
function clear(owner){const state=pending.get(owner);pending.delete(owner);state?.cleanup?.();}
function start(owner,key,modifier,event,now){
 clear(owner);
 const target=event.target||owner.textarea,window=target?.ownerDocument?.defaultView;
 const cancel=()=>clear(owner);
 target?.addEventListener?.('blur',cancel,{once:true});window?.addEventListener?.('blur',cancel,{once:true});
 pending.set(owner,{key,modifier,until:now+2500,cleanup(){target?.removeEventListener?.('blur',cancel);window?.removeEventListener?.('blur',cancel);}});
}
function prefix(event,key){
 if(event.shiftKey)return null;
 if(event.altKey&&!event.ctrlKey&&!event.metaKey&&key==='v')return 'alt';
 if(event.altKey)return null;
 if(event.ctrlKey&&!event.metaKey&&['n','q','k','m','g'].includes(key))return 'ctrl';
 if(event.metaKey&&!event.ctrlKey&&['k','m','g'].includes(key))return 'meta';
 return null;
}
function continuation(event,state){
 if(event.shiftKey)return false;
 if(state.modifier==='alt')return !event.ctrlKey&&!event.metaKey;
 if(state.modifier==='meta')return !event.ctrlKey&&!event.altKey;
 return !event.metaKey&&!event.altKey;
}
export function handleTableCreateChord(owner,event,now=Date.now()){
 if(owner.connectorDrawingMode||owner.polygonDrawingMode||owner.imagePlacementMode||owner.textboxPlacementMode){clear(owner);return false;}
 const key=letter(event);
 if(['Control','Shift','Alt','Meta'].includes(event.key))return false;
 const chord=pending.get(owner),modifier=prefix(event,key);
 if(chord){
  if(event.repeat&&key===chord.key&&modifier===chord.modifier){event.preventDefault();return true;}
  clear(owner);
  const command=now<=chord.until&&!event.repeat&&continuation(event,chord)&&Object.hasOwn(commands[chord.key],key)?commands[chord.key][key]:null;
  if(command){
   event.preventDefault();owner._cellBlockLetterImeGuard?.arm(event);
   if(command==='table:create')owner.dispatcher?.dispatch(command,{pwhDetailed:true});
   else owner.dispatcher?.dispatch(command);
   return true;
  }
 }
 if(!modifier)return false;
 event.preventDefault();if(!event.repeat)start(owner,key,modifier,event,now);return true;
}
