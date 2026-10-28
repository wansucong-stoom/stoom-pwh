// Local recovery is keyed by the exact source path and source digest.
export function openRecoveryDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('pwh-inline-recovery',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function recoveryStore(action,key,value){const db=await openRecoveryDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('drafts',action==='get'?'readonly':'readwrite'),store=tx.objectStore('drafts');const r=action==='get'?store.get(key):action==='delete'?store.delete(key):store.put({...value,key});let result;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}}

// Closing is a separate choice: the already-loaded document stays open and
// the stored draft is not implicitly accepted or deleted.
export function promptRecovery(legacy=false){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='pwh-recovery';
  dialog.style.cssText='box-sizing:border-box;width:min(520px,calc(100vw - 32px));padding:18px 20px;border:1px solid #aeb9c7;border-radius:6px;box-shadow:0 12px 32px #0003';
  dialog.setAttribute('aria-labelledby','pwh-recovery-title');
  dialog.innerHTML='<div class="pwh-recovery-heading" style="display:flex;align-items:center;gap:12px"><h2 id="pwh-recovery-title" style="flex:1;margin:0;font-size:18px">미저장 편집 내용 복구</h2><button type="button" class="recovery-close" aria-label="닫기" title="닫기" style="width:30px;height:30px;border:0;border-radius:4px;background:transparent;font-size:24px;line-height:1;cursor:pointer">×</button></div><p>이 문서의 임시 저장본이 있습니다. 복구할까요?</p><p class="recovery-note" style="font-size:12px">닫기를 누르면 기존 임시본을 보존합니다. 이후 변경 내용은 새 수정본으로 저장해 주세요.</p><div class="pwh-recovery-actions" style="display:flex;gap:8px"><button type="button" class="restore">복구하기</button><button type="button" class="source">저장본 열기</button></div>';
  if(legacy)dialog.querySelector('p').textContent='이전 편집기의 같은 파일명 임시본이 있습니다. 원본 경로는 확인할 수 없으므로 내용을 확인해 복구해 주세요.';
  document.body.appendChild(dialog);let completed=false;
  const done=value=>{if(completed)return;completed=true;dialog.close();dialog.remove();resolve(value);};
  dialog.querySelector('.restore').onclick=()=>done('recover');
  dialog.querySelector('.source').onclick=()=>done('source');
  dialog.querySelector('.recovery-close').onclick=()=>done('dismiss');
  dialog.oncancel=event=>{event.preventDefault();done('dismiss');};
  dialog.showModal();dialog.querySelector('.recovery-close').focus();
 });
}
