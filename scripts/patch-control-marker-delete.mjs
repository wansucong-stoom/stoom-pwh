import fs from 'node:fs/promises';import path from 'node:path';
export async function patchControlMarkerDelete(studio){
 await fs.copyFile(new URL('../src/control-marker-delete.mjs',import.meta.url),path.join(studio,'src/control-marker-delete.mjs'));
 const textPath=path.join(studio,'src/engine/input-handler-text.ts');let text=await fs.readFile(textPath,'utf8');
 if(!text.includes('// Pwh visible page-hiding deletion')){
  const anchor='export function handleDelete(this: any, pos: DocumentPosition, inCell: boolean): void {';
  if(text.split(anchor).length!==2)throw Error('Unsupported visible control delete handler');
  text=text.replace(anchor,anchor+'\n  if(tryDeletePageHiding(this,pos,inCell))return;');
  await fs.writeFile(textPath,"// Pwh visible page-hiding deletion\nimport {tryDeletePageHiding} from "+JSON.stringify('../control-marker-delete.mjs')+";\n"+text);
 }
 const bridgePath=path.join(studio,'src/core/wasm-bridge.ts');let bridge=await fs.readFile(bridgePath,'utf8');
 if(!bridge.includes('  deleteControlAt(')){
  const anchor='  getControls(): Array<{ ctrlId: string; list: number; para: number; controlIndex: number }> {';
  if(bridge.split(anchor).length!==2)throw Error('Unsupported control deletion bridge');
  bridge=bridge.replace(anchor,`  getPageHide(sec:number,para:number):string {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');return this.doc.getPageHide(sec,para);
  }
  deleteControlAt(list:number,para:number,control:number):void {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');
    const result=JSON.parse(this.doc.deleteControlAt(list,para,control));if(!result.ok)throw Error('감추기 부호를 삭제하지 못했습니다.');
  }
`+anchor);await fs.writeFile(bridgePath,bridge);
 }
 const registryPath=path.join(studio,'src/core/mutation-method-registry.ts');let registry=await fs.readFile(registryPath,'utf8');
 if(!registry.includes("'deleteControlAt'")){const anchor="'deleteText', 'deleteRange', 'deleteBodySelection',";if(registry.split(anchor).length!==2)throw Error('Unsupported control deletion mutation registry');registry=registry.replace(anchor,anchor+" 'deleteControlAt',");await fs.writeFile(registryPath,registry);}
}
