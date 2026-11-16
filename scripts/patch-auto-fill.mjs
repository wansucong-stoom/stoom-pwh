import fs from 'node:fs/promises';
import path from 'node:path';
function once(source,anchor,replacement,label){
 if(source.split(anchor).length!==2)throw Error('Unsupported auto-fill build anchor: '+label);
 return source.replace(anchor,()=>replacement);
}
export async function patchAutoFill(studio){
 for(const file of ['auto-fill-lists.mjs','auto-fill-pattern.mjs','auto-fill-table.mjs','pwh-auto-fill.ts','pwh-auto-fill.css'])
  await fs.copyFile(new URL('../src/'+file,import.meta.url),path.join(studio,'src/ui',file));
 const mainFile=path.join(studio,'src/main.ts');let main=await fs.readFile(mainFile,'utf8');
 if(!main.includes('// Pwh table automatic fill')){
  main="// Pwh table automatic fill\nimport {autoFillCommands} from './ui/pwh-auto-fill';\n"+main;
  main=once(main,'registry.registerAll(tableCommands);','registry.registerAll(tableCommands);\nregistry.registerAll(autoFillCommands);','registration');
  await fs.writeFile(mainFile,main);
 }
 const keyFile=path.join(studio,'src/command/contextual-shortcut.ts');let keys=await fs.readFile(keyFile,'utf8');
 if(!keys.includes("commandId: 'table:auto-fill'")){
  keys=once(keys,"commandId: 'table:cell-split' | 'table:cell-merge'","commandId: 'table:auto-fill' | 'table:cell-split' | 'table:cell-merge'",'shortcut type');
  keys=once(keys,'  // pwh cell C and L shortcuts',"  if (key === 'a' || key === 'ㅁ' || code === 'keya') return {kind:'dispatch',commandId: 'table:auto-fill'};\n  // pwh cell C and L shortcuts",'A shortcut');
  keys=once(keys,"['ㅣ', 'ㅊ', 'ㅅ', 'ㅔ', 'ㅈ', 'ㅗ', 'ㅠ', 'ㄹ']","['ㅁ', 'ㅣ', 'ㅊ', 'ㅅ', 'ㅔ', 'ㅈ', 'ㅗ', 'ㅠ', 'ㄹ']",'IME guard');
  await fs.writeFile(keyFile,keys);
 }
 const inputFile=path.join(studio,'src/engine/input-handler.ts');let input=await fs.readFile(inputFile,'utf8');
 if(!input.includes("commandId: 'table:auto-fill'")){
  const anchor="      { type: 'command', commandId: 'table:cell-split' },";
  input=once(input,anchor,anchor+"\n      { type: 'separator' },\n      { type: 'command', commandId: 'table:auto-fill' },\n      { type: 'command', commandId: 'table:auto-fill-list' },\n      { type: 'separator' },",'context menu');
  await fs.writeFile(inputFile,input);
 }
 const htmlFile=path.join(studio,'index.html');let html=await fs.readFile(htmlFile,'utf8');
 if(!html.includes('data-cmd="table:auto-fill"')){
  const anchor=html.split('\n').find(line=>line.includes('data-cmd="table:cell-split"'));
  if(!anchor)throw Error('Missing table menu for auto-fill');
  html=once(html,anchor,anchor+'\n'+[['table:auto-fill','표 자동 채우기','A'],['table:auto-fill-list','자동 채우기 내용…','']].map(([id,label,key])=>
   '<div class="md-item" data-cmd="'+id+'"><span class="md-icon"></span><span class="md-label">'+label+'</span><span class="md-shortcut">'+key+'</span></div>').join('\n'),'table menu');
  await fs.writeFile(htmlFile,html);
 }
}
