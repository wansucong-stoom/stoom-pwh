/** Cache expensive export digests for presentation/polling only. A revision key
 * cannot detect unsignaled native mutations: authoritative conflict validation
 * must pass fresh:true, and every mutation signal must invalidate the cache. */
export function createDocumentStateDigestCache(){
 let entry=null,artifactEntry=null,generation=0;
 function revisionKey(revision){
  if(!revision||!['hwp','hwpx'].includes(revision.format)||typeof revision.dirty!=='boolean'
   ||!['documentEpoch','changeSeq','pageCount'].every(key=>Number.isSafeInteger(revision[key])&&revision[key]>=0))throw Error('Invalid document digest revision');
  return JSON.stringify([revision.documentEpoch,revision.changeSeq,revision.format,revision.pageCount,revision.dirty]);
 }
 return Object.freeze({
  invalidate(){generation++;entry=null;artifactEntry=null;},
  readArtifact(revision,compute,digestBytes,{fresh=false}={}){
   const key=revisionKey(revision);
   if(!fresh&&artifactEntry?.key===key)return artifactEntry.value;
   const ticket=++generation;entry=null;artifactEntry=null;
   const artifact=compute();
   if(!(artifact?.bytes instanceof Uint8Array))throw Error('Invalid document export artifact');
   const digest=digestBytes(artifact.bytes);
   if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid document export digest');
   const value={artifact,digest};
   if(generation===ticket){entry={key,digest};if(artifact.bytes.byteLength<=8*1024*1024)artifactEntry={key,value};}
   return value;
  },
  read(revision,compute,{fresh=false}={}){
   const key=revisionKey(revision);
   if(!fresh&&entry?.key===key)return entry.digest;
   // A failed fresh verification must never leave an older digest available.
   const ticket=++generation;entry=null;artifactEntry=null;
   const digest=compute();
   if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid document export digest');
   // Reentrant callbacks may invalidate or populate a newer revision.
   if(generation===ticket)entry={key,digest};
   return digest;
  },
 });
}
