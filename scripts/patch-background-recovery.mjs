import fs from 'node:fs/promises';import path from 'node:path';
export async function patchBackgroundRecovery(studio){
 async function change(file,marker,edit){const target=path.join(studio,'src',file);let source=(await fs.readFile(target,'utf8')).replaceAll('\r\n','\n');if(source.includes(marker))return;edit(source,(before,after)=>{if(source.split(before).length!==2)throw Error('Unsupported recovery source '+file+' '+before.slice(0,70));source=source.replace(before,()=>after);});await fs.writeFile(target,'// '+marker+'\n'+source);}
 await change('document-agent/controller.ts','Pwh shared presentation recovery export',(text,replace)=>{
  replace('  getPresentationDocumentState(): RhwpDocumentStateV1 {',`  getPresentationRecoveryExport(): any {
    const revision=this.getPresentationDocumentRevision();
    if(revision.format!=='hwpx'){const artifact=(this.deps.wasm as any).exportHwpxWithReport();return {artifact,digest:digestBytes(artifact.bytes)};}
    return this.pwhStateCache.readArtifact(revision,()=> (this.deps.wasm as any).exportHwpxWithReport(),digestBytes);
  }
  getPresentationDocumentState(): RhwpDocumentStateV1 {`);
  replace('this.pwhStateCache.read(revision,()=>exportDocumentSha256(this.deps.wasm,revision.format))',"this.pwhStateCache.read(revision,()=>revision.format==='hwpx'?this.getPresentationRecoveryExport().digest:exportDocumentSha256(this.deps.wasm,revision.format))");
  return undefined;
 });
 await change('recovery/autosave-manager.ts','Pwh background recovery coordination',(text,replace)=>{
  replace('    if (this.saving) {',`    // A live gesture must not run a synchronous archive export. The Pwh host
    // also persists recovery; skip this second format only after that exact
    // revision has actually reached its recovery store. Keep the fallback
    // for larger files and failed/unavailable host checkpoints.
    if ((globalThis as any).pwhEditor?.interacting?.()) { this.schedule(reason); return; }
    if ((globalThis as any).pwhRecoveryCheckpointCurrent?.()) { this.cancelTimers(); return; }
    if (this.saving) {`);
  return undefined;
 });
}
