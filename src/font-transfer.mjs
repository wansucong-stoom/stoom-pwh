// A TTC has several faces but one encoded file. Verify and transfer that file
// once while retaining each face's identity and independent buffer ownership.
const FONT_CHUNK_BYTES=512*1024, FONT_CACHE_BYTES=64*1024*1024;
function checkFontTransfer(signal){if(signal.aborted)throw Error('글꼴 요청 취소');}
function fontTransferPin(first){
 const pin=first?.structuredContent;
 if(!pin||pin.offset!==0||!Number.isSafeInteger(pin.totalBytes)||pin.totalBytes<1||pin.totalBytes>FONT_CACHE_BYTES||!/^[a-f0-9]{64}$/.test(pin.sha256||'')||!Number.isSafeInteger(pin.faceIndex)||pin.faceIndex<0)throw Error('글꼴 전송 정보 오류');
 return {...pin};
}
function cacheFontBytes(cache,pin,bytes){
 if(!cache)return;
 const old=cache.get(pin.sha256);if(old===bytes)return;
 cache.delete(pin.sha256);let size=[...cache.values()].reduce((n,b)=>n+b.byteLength,0);
 for(const [key,value]of cache){if(size+bytes.byteLength<=FONT_CACHE_BYTES)break;cache.delete(key);size-=value.byteLength;}
 cache.set(pin.sha256,bytes);
}
async function transferFontBytes(request,first,pin,signal,digest,onProgress){
 const bytes=new Uint8Array(pin.totalBytes);let received=0,next=FONT_CHUNK_BYTES,failed=false;
 function accept(result,offset){
  checkFontTransfer(signal);
  const m=result.structuredContent;
  if(!m||m.offset!==offset||m.totalBytes!==pin.totalBytes||m.sha256!==pin.sha256||m.faceIndex!==pin.faceIndex)throw Error('글꼴 변경 감지');
  const part=atob(result._meta?.['pwh/font-bytes']||'');
  if(part.length!==Math.min(FONT_CHUNK_BYTES,bytes.length-offset))throw Error('글꼴 청크 오류');
  for(let i=0;i<part.length;i++)bytes[offset+i]=part.charCodeAt(i);
  received+=part.length;onProgress(received,bytes.length);
 }
 accept(first,0);
 await Promise.all(Array.from({length:Math.min(4,Math.ceil(bytes.length/FONT_CHUNK_BYTES)-1)},async()=>{
  try{while(!failed&&next<bytes.length){checkFontTransfer(signal);const offset=next;next+=FONT_CHUNK_BYTES;accept(await request(offset),offset);}}catch(error){failed=true;throw error;}
 }));
 checkFontTransfer(signal);
 if(await digest(bytes)!==pin.sha256)throw Error('글꼴 SHA 오류');
 checkFontTransfer(signal);
 return bytes;
}
// Four bounded chunk requests; only complete SHA-verified bytes are published.
export async function readVerifiedFont(request,signal,digest,onProgress=()=>{},cache=null) {
 checkFontTransfer(signal);
 const first=await request(0),pin=fontTransferPin(first);checkFontTransfer(signal);
 const cached=cache?.get(pin.sha256);
 if(cached?.byteLength===pin.totalBytes){onProgress(pin.totalBytes,pin.totalBytes);return {bytes:cached.slice().buffer,faceIndex:pin.faceIndex};}
 const bytes=await transferFontBytes(request,first,pin,signal,digest,onProgress);
 cacheFontBytes(cache,pin,bytes.slice());
 return {bytes:bytes.buffer,faceIndex:pin.faceIndex};
}

// Per editor, bounded memory only. Every face still checks its fresh identity.
// A cancelled consumer cannot cancel another face that needs the same file.
export function createVerifiedFontReader(){
 const cache=new Map(),pending=new Map();
 return async(request,signal,digest,progress=()=>{})=>{
  checkFontTransfer(signal);
  const first=await request(0),pin=fontTransferPin(first);checkFontTransfer(signal);
  const cached=cache.get(pin.sha256);
  if(cached?.byteLength===pin.totalBytes){cache.delete(pin.sha256);cache.set(pin.sha256,cached);progress(pin.totalBytes,pin.totalBytes);return {bytes:cached.slice().buffer,faceIndex:pin.faceIndex};}
  const key=pin.sha256+':'+pin.totalBytes;let job=pending.get(key);
  if(!job){
   job={controller:new AbortController(),consumers:new Set(),loaded:0,total:pin.totalBytes};pending.set(key,job);
   const active=job;
   active.promise=Promise.resolve().then(()=>transferFontBytes(request,first,pin,active.controller.signal,digest,(loaded,total)=>{
    active.loaded=loaded;for(const consumer of active.consumers)consumer.notify(loaded,total);
   })).then(bytes=>{cacheFontBytes(cache,pin,bytes);return bytes;}).finally(()=>{if(pending.get(key)===active)pending.delete(key);});
  }
  const shared=job;
  return new Promise((resolve,reject)=>{
   let settled=false;
   const consumer={notify:(loaded,total)=>{if(!settled){try{progress(loaded,total);}catch(error){finish(error);}}}};
   const finish=(error,bytes)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);shared.consumers.delete(consumer);if(!shared.consumers.size){shared.controller.abort();if(pending.get(key)===shared)pending.delete(key);}if(error)reject(error);else resolve({bytes:bytes.slice().buffer,faceIndex:pin.faceIndex});};
   const abort=()=>finish(Error('글꼴 요청 취소'));
   shared.consumers.add(consumer);signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted)abort();else if(shared.loaded)consumer.notify(shared.loaded,shared.total);
   shared.promise.then(bytes=>finish(null,bytes),error=>finish(error));
  });
 };
}
