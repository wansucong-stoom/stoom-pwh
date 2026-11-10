// Hancom chords scoped to the active editor input. Keep alternative chords
// in the editor for browsers that reserve Ctrl+N or Ctrl+Q.
const pending=new WeakMap();
const commands={
 n:{
  t:'table:create',a:'table:split',z:'table:attach',i:'insert:image',b:'insert:textbox',
  n:'insert:footnote',e:'insert:endnote',m:'insert:equation',c:'insert:caption-toggle',
  s:'page:hide',g:'page:section-settings',f:'table:formula',k:'field:edit',
 },
 q:{f:'edit:find',a:'edit:find-replace',l:'edit:find-previous'},
};
const koreanKey={'ㅅ':'t','ㅁ':'a','ㅋ':'z','ㅑ':'i','ㅠ':'b','ㅜ':'n','ㄷ':'e','ㅡ':'m','ㅊ':'c','ㄴ':'s','ㅎ':'g','ㄹ':'f','ㅏ':'k','ㅣ':'l'};
const letter=event=>/^Key[A-Z]$/.test(event.code||'')?event.code.slice(-1).toLowerCase()
 :koreanKey[event.key]??event.key?.toLowerCase();
export function handleTableCreateChord(owner,event,now=Date.now()){
 const key=letter(event);
 const isPrefix=event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&(key==='n'||key==='q');
 if(isPrefix){event.preventDefault();if(!event.repeat)pending.set(owner,{key,until:now+2500});return true;}
 const chord=pending.get(owner);if(!chord)return false;
 if(['Control','Shift','Alt','Meta'].includes(event.key))return false;
 pending.delete(owner);
 if(now>chord.until||event.altKey||event.metaKey||event.shiftKey||event.repeat)return false;
 const command=Object.hasOwn(commands[chord.key],key)?commands[chord.key][key]:null;
 if(!command)return false;
 event.preventDefault();
 owner._cellBlockLetterImeGuard?.arm(event);
 if(command==='table:create')owner.dispatcher?.dispatch(command,{pwhDetailed:true});
 else owner.dispatcher?.dispatch(command);
 return true;
}
