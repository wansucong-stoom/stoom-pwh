/** Compare semantic snapshot values, never JSON member insertion order.
 * Array order and every value remain significant. Presentation metadata is not
 * an integrity check: callers must obtain a fresh document state at submit.
 */
export function sameRequestValue(left,right,depth=0){
 if(left===right)return true;
 if(depth>32||left===null||right===null||typeof left!=='object'||typeof right!=='object')return false;
 if(Array.isArray(left)!==Array.isArray(right))return false;
 if(Array.isArray(left))return left.length===right.length&&left.every((value,index)=>sameRequestValue(value,right[index],depth+1));
 const a=Object.keys(left).sort(),b=Object.keys(right).sort();
 return a.length===b.length&&a.every((key,index)=>key===b[index]&&sameRequestValue(left[key],right[key],depth+1));
}

export function normalizeRequestContext(context){
 if(!context||typeof context!=='object'||context.target!=null)return context;
 const {target,...value}=context;return value;
}

export function sameRequestContext(left,right){
 return sameRequestValue(normalizeRequestContext(left),normalizeRequestContext(right));
}

/** Older immutable Studio bundles compare complete contexts using JSON text.
 * Keep their native fresh-state member order without dropping unknown fields.
 */
export function queuedRequestContext(context){
 const value=structuredClone(normalizeRequestContext(context));
 if(value?.documentState){const state=value.documentState,order=['schemaVersion','format','documentEpoch','changeSeq','dirty','pageCount','documentSha256'];value.documentState=Object.fromEntries([...order.filter(key=>Object.hasOwn(state,key)).map(key=>[key,state[key]]),...Object.entries(state).filter(([key])=>!order.includes(key))]);}
 return value;
}

export function assertRequestStateCurrent(frozen,current){
 if(!frozen?.ready||!current?.ready||!Number.isSafeInteger(frozen.documentState?.documentEpoch)
  ||current.documentState?.documentEpoch!==frozen.documentState.documentEpoch)throw Error('문서가 다시 열렸습니다. 다시 요청하세요.');
 // Tracked targets keep their original context. The actual mutation path
 // resolves their content/format fingerprints again before applying a change.
 if(!frozen.target&&['objects','kind','selection','documentState'].some(key=>!sameRequestValue(current[key],frozen[key])))throw Error('문서나 선택 영역이 바뀌었습니다. 다시 선택해 주세요.');
}
