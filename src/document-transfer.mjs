export const DEFAULT_DOCUMENT_CHUNK=512*1024;
export const MAX_DOCUMENT_CHUNK=2*1024*1024;
export const DOCUMENT_RPC_BYTES=Math.ceil(MAX_DOCUMENT_CHUNK*4/3)+65536;

// File size chooses the initial batch; the receiver's advertised ceiling wins.
export function documentChunkBytes(totalBytes,maxChunkBytes=DEFAULT_DOCUMENT_CHUNK){
  if(!Number.isSafeInteger(totalBytes)||totalBytes<1)throw Error('Invalid document byte length');
  if(!Number.isSafeInteger(maxChunkBytes)||maxChunkBytes<65536||maxChunkBytes>MAX_DOCUMENT_CHUNK)throw Error('Invalid document chunk ceiling');
  const preferred=totalBytes<=256*1024?Math.max(65536,2**Math.ceil(Math.log2(totalBytes)))
    :totalBytes<=8*1024*1024?512*1024:totalBytes<=64*1024*1024?1024*1024:MAX_DOCUMENT_CHUNK;
  return Math.min(preferred,maxChunkBytes);
}
