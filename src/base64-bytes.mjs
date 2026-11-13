// Keep binary conversion in native typed-array code where available. The
// compatibility path avoids a JavaScript callback allocation for every byte.
export function base64ToBytesFallback(value){
  const binary=atob(value),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
export function base64ToBytes(value){
  return typeof Uint8Array.fromBase64==='function'?Uint8Array.fromBase64(value):base64ToBytesFallback(value);
}
export function bytesToBase64Fallback(bytes){
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
export function bytesToBase64(bytes){
  return typeof bytes.toBase64==='function'?bytes.toBase64():bytesToBase64Fallback(bytes);
}
