import fs from 'node:fs/promises';
import path from 'node:path';

export async function patchShapeTools(studio){
 const copies=[['drawing-tools.mjs','pwh-drawing-tools.mjs'],['pwh-shape-tools.ts','engine/pwh-shape-tools.ts'],['pwh-shape-picker.ts','ui/shape-picker.ts'],['pwh-shape-tools.css','styles/pwh-shape-tools.css']];
 for(const [source,target]of copies)await fs.copyFile(new URL('../src/'+source,import.meta.url),path.join(studio,'src',target));
 async function edit(relative,transform){
  const file=path.join(studio,'src',relative),marker='// Pwh shared drawing tools';
  let source=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');if(source.includes(marker))return;
  const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('Unsupported drawing hook: '+relative+' '+before.slice(0,100));source=source.replace(before,()=>after);};
  source=transform(source,replace,()=>source);await fs.writeFile(file,marker+'\n'+source);
 }
 await edit('engine/input-handler.ts',(initial,replace,current)=>{
  replace("    this.shapePlacementType = 'textbox';\n    this.textboxPlacementMode = true;\n    this.textboxPlacementDrag = null;\n    this.container.style.cursor = 'crosshair';","    enterPwhDrawing(this,'textbox');");
  let source=current(),start=source.indexOf('  enterShapePlacementMode(shapeType: string): void {'),end=source.indexOf('  /** 다각형 그리기: 꼭짓점 추가',start);
  if(start<0||end<start)throw Error('Unsupported shape entry');
  source=source.slice(0,start)+"  enterShapePlacementMode(shapeType: string): void {\n    enterPwhDrawing(this,shapeType);\n  }\n\n"+source.slice(end);
  return "import {enterPwhDrawing} from './pwh-shape-tools';\n"+source;
 });
 await edit('engine/input-handler-mouse.ts',(initial,replace,current)=>{
  for(const [method,helper]of [['onClick','pwhDrawingDown'],['onMouseMove','pwhDrawingMove'],['onMouseUp','pwhDrawingUp'],['onDblClick','pwhDrawingDoubleClick']]){
   const anchor=`export function ${method}(this: any, e: MouseEvent): void {`;
   replace(anchor,anchor+`\n  if (${helper}(this,e)) return;`);
  }
  return "import {pwhDrawingDown,pwhDrawingMove,pwhDrawingUp,pwhDrawingDoubleClick} from './pwh-shape-tools';\n"+current();
 });
 await edit('engine/input-handler-keyboard.ts',(initial,replace,current)=>{
  const anchor='export function onKeyDown(this: any, e: KeyboardEvent): void {\n  if (!this.active) return;';
  replace(anchor,anchor+'\n  if (pwhDrawingKey(this,e)) return;');
  return "import {pwhDrawingKey} from './pwh-shape-tools';\n"+current();
 });
 await edit('engine/object-props.ts',(source)=>source.replaceAll("if (ref.type === 'shape') {","if (ref.type === 'shape' || ref.type === 'line') {"));
 await edit('ui/picture-props-dialog.ts',(initial,replace,current)=>{
  replace('      // 선 탭 — 모서리 곡률',`      // Only rectangle models own corner curvature; arc-kind editing has no
      // persisted setter yet. Keep unavailable controls visibly disabled.
      this.cornerBtns.forEach(button=>{button.disabled=isOle||sp.roundRate===undefined;});
      this.cornerCustomRadio.disabled=isOle||sp.roundRate===undefined;
      this.cornerCustomInput.disabled=true;
      this.arcBtns.forEach(button=>{button.disabled=true;});
      // 선 탭 — 모서리 곡률`);
  return current();
 });
 await edit('command/commands/insert.ts',(source)=>{
  const start=source.indexOf("    id: 'insert:shape',"),end=source.indexOf("    id: 'insert:image',",start);
  if(start<0||end<start)throw Error('Unsupported shape command');
  let block=source.slice(start,end);
  if(!block.includes('execute(services)')||!block.includes("const anchor = document.getElementById('tb-shape');"))throw Error('Unsupported shape palette anchor');
  block=block.replace('ctx.hasDocument,','ctx.hasDocument && ctx.isEditable && !ctx.isFormMode,').replace('execute(services)','execute(services,params)');
  block=block.replace("const anchor = document.getElementById('tb-shape');",`const requested=params?.anchorEl;
      const anchor=requested instanceof HTMLElement&&requested.getClientRects().length?requested:
        [...document.querySelectorAll<HTMLElement>('[data-cmd="insert:shape"]')].find(button=>button.getClientRects().length>0)??null;`);
  return source.slice(0,start)+block+source.slice(end);
 });
}
