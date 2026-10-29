// Hancom's Ctrl+N, T chord, scoped to the active editor input. A host may
// reserve Ctrl+N before the embedded editor receives it; never claim success
// unless the host delivers the prefix.
const pending=new WeakMap();
export function handleTableCreateChord(owner,event,now=Date.now()){
 const isPrefix=event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&(event.code==='KeyN'||event.key?.toLowerCase()==='n');
 if(isPrefix){event.preventDefault();if(!event.repeat)pending.set(owner,now+2500);return true;}
 const until=pending.get(owner);if(!until)return false;
 if(['Control','Shift','Alt','Meta'].includes(event.key))return false;
 pending.delete(owner);
 if(now>until||event.altKey||event.metaKey||event.shiftKey||event.repeat)return false;
 if(event.code!=='KeyT'&&event.key?.toLowerCase()!=='t'&&event.key!=='ㅅ')return false;
 event.preventDefault();
 owner._cellBlockLetterImeGuard?.arm(event);
 owner.dispatcher?.dispatch('table:create',{pwhDetailed:true});
 return true;
}
