// Four bounded requests at a time; publish only a complete, verified face.
export async function readVerifiedFont(request,signal,digest,onProgress=()=>{},cache=null) {
 if(signal.aborted)throw Error('글꼴 요청 취소');
 const chunk=512*1024;
 const first=await request(0),pin=first.structuredContent;
 if(!pin||!Number.isSafeInteger(pin.totalBytes)||pin.totalBytes<1||pin.totalBytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(pin.sha256||'')||!Number.isSafeInteger(pin.faceIndex)||pin.faceIndex<0)throw Error('글꼴 전송 정보 오류');
 if(signal.aborted)throw Error('글꼴 요청 취소');
 const cached=cache?.get(pin.sha256);
 if(cached?.byteLength===pin.totalBytes){if(pin.offset!==0)throw Error('글꼴 청크 오류');onProgress(pin.totalBytes,pin.totalBytes);return {bytes:cached.slice().buffer,faceIndex:pin.faceIndex};}
 const bytes=new Uint8Array(pin.totalBytes);let received=0,next=chunk,failed=false;
 function accept(result,offset){
  if(signal.aborted)throw Error('글꼴 요청 취소');
  const m=result.structuredContent;
  if(!m||m.offset!==offset||m.totalBytes!==pin.totalBytes||m.sha256!==pin.sha256||m.faceIndex!==pin.faceIndex)throw Error('글꼴 변경 감지');
  const part=Uint8Array.from(atob(result._meta?.['pwh/font-bytes']||''),x=>x.charCodeAt(0));
  if(part.length!==Math.min(chunk,bytes.length-offset))throw Error('글꼴 청크 오류');
  bytes.set(part,offset);received+=part.length;onProgress(received,bytes.length);
 }
 accept(first,0);
 await Promise.all(Array.from({length:Math.min(4,Math.ceil(bytes.length/chunk)-1)},async()=>{
  try{while(!failed&&next<bytes.length){if(signal.aborted)throw Error('글꼴 요청 취소');const offset=next;next+=chunk;accept(await request(offset),offset);}}catch(error){failed=true;throw error;}
 }));
 if(signal.aborted)throw Error('글꼴 요청 취소');
 if(await digest(bytes)!==pin.sha256)throw Error('글꼴 SHA 오류');
 if(signal.aborted)throw Error('글꼴 요청 취소');
 if(cache){let size=[...cache.values()].reduce((n,b)=>n+b.length,0);for(const [key,value] of cache){if(size+bytes.length<=64*1024*1024)break;cache.delete(key);size-=value.length;}cache.set(pin.sha256,bytes.slice());}
 return {bytes:bytes.buffer,faceIndex:pin.faceIndex};
}

// Per editor, memory only. Copies preserve ownership when a consumer detaches.
export function createVerifiedFontReader(){const cache=new Map();return (request,signal,digest,progress)=>readVerifiedFont(request,signal,digest,progress,cache);}
