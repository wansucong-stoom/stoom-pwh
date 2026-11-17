import fs from 'node:fs/promises';import path from 'node:path';
export async function patchAutoPageArrangement(studio){
 await fs.copyFile(new URL('../src/auto-page-arrangement.mjs',import.meta.url),path.join(studio,'src/pwh-auto-page-arrangement.mjs'));
 const file=path.join(studio,'src/core/user-settings.ts'),marker='// Pwh automatic page rows';
 let source=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');if(source.includes(marker))return;
 const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('Unsupported automatic page arrangement: '+before);source=source.replace(before,()=>after);};
 replace('  pageArrangement: PageArrangement;','  pageArrangement: PageArrangement;\n  pageArrangementChosen?: boolean;');
 replace("      pageArrangement: { kind: 'single' },","      pageArrangement: { kind: 'auto' },\n      pageArrangementChosen: false,");
 replace('        view.pageArrangement ?? defaults.view.pageArrangement,','        initialPageArrangement(view,defaults.view.pageArrangement),');
 replace('    this.data.view.pageArrangement = pageView.arrangement;','    this.data.view.pageArrangementChosen = true;\n    this.data.view.pageArrangement = pageView.arrangement;');
 source='import {initialPageArrangement} from '+JSON.stringify('../pwh-auto-page-arrangement.mjs')+';\n'+source;
 await fs.writeFile(file,marker+'\n'+source);
}
