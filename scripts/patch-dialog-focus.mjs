import fs from 'node:fs/promises';
import path from 'node:path';
export async function patchDialogFocus(studio) {
 const moduleName='pwh-modal-focus.mjs';
 await fs.copyFile(new URL('../src/modal-focus.mjs',import.meta.url),path.join(studio,'src/ui',moduleName));
 const mainPath=path.join(studio,'src/main.ts');
 let main=await fs.readFile(mainPath,'utf8');
 if(!main.includes('// Pwh modal keyboard ownership')){
  main=`// Pwh modal keyboard ownership\nimport {installModalFocus} from './ui/${moduleName}';\nif(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>installModalFocus(),{once:true});else installModalFocus();\n`+main;
  await fs.writeFile(mainPath,main);
 }
 const file=path.join(studio,'src/ui/dialog.ts');
 let source=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');
 if(!source.includes('// Pwh native dialog controls')){
  const begin=source.indexOf('    this.captureHandler = (e: KeyboardEvent) => {');
  const end=source.indexOf("\n    document.addEventListener('keydown', this.captureHandler, true);",begin);
  if(begin<0||end<begin)throw Error('Unsupported modal keyboard handler');
  source=`import {isTopModal} from './${moduleName}';\n`+source.slice(0,begin)+`    // Pwh native dialog controls: target listeners and native Tab/Space remain usable.
    this.captureHandler = (e: KeyboardEvent) => {
      if(!isTopModal(this.dialog)||e.isComposing)return;
      const target=e.target as HTMLElement|null;
      if(target?.closest('.pwh-color-popover'))return;
      if(e.key==='Escape'){
        e.preventDefault();e.stopPropagation();this.hide();return;
      }
      if(target&&this.dialog.contains(target))return;
      e.preventDefault();e.stopPropagation();
    };`+source.slice(end);
  await fs.writeFile(file,source);
 }
}
