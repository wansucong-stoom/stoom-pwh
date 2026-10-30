import fs from 'node:fs/promises';
import path from 'node:path';

export async function patchBodyCursorContract(studio){
 await fs.copyFile(new URL('../src/body-cursor-position.mjs',import.meta.url),path.join(studio,'src/core/pwh-body-cursor-position.mjs'));
 const change=async(relative,marker,edit)=>{
  const file=path.join(studio,'src',relative);let source=await fs.readFile(file,'utf8');
  if(source.includes(marker))return;
  const replace=(before,after)=>{if(!source.includes(before))throw Error('Unsupported body cursor contract: '+relative+' '+before.slice(0,90));source=source.replace(before,after);};
  edit(replace,()=>source);await fs.writeFile(file,'// '+marker+'\n'+source);
 };
 await change('core/types.ts','pwh body cursor text ownership',replace=>{
  for(const name of ['DocumentPosition','HitTestResult'])replace('export interface '+name+' {','export interface '+name+' {\n  bodyCursor?: {sectionIndex:number;paragraphIndex:number;textOffset:number;logicalOffset:number};');
 });
 await change('core/wasm-bridge.ts','pwh logical geometry text editing boundary',(replace,read)=>{
  replace('export class WasmBridge {',`export class WasmBridge {
  bodyPositionToLogical(pos: DocumentPosition): number {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');
    return bodyPositionToLogical(this.doc,pos);
  }
  bodyPositionFromText(pos: DocumentPosition): DocumentPosition {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');
    return bodyPositionFromText(this.doc,pos);
  }
  getBodyCursorRect(pos: DocumentPosition): CursorRect {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');
    return JSON.parse(this.doc.getCursorRect(pos.sectionIndex,pos.paragraphIndex,bodyPositionToLogical(this.doc,pos)));
  }
  insertTextAtBodyCursor(pos: DocumentPosition,text:string): void {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');
    this.doc.insertTextLogical(pos.sectionIndex,pos.paragraphIndex,bodyPositionToLogical(this.doc,pos),text);
  }
  getBodyFootnoteAtCursor(pos: DocumentPosition,direction:'backward'|'forward'): FootnoteAtCursorResult {
    return this.getFootnoteAtCursor(pos.sectionIndex,pos.paragraphIndex,this.bodyPositionToLogical(pos),direction);
  }`);
  replace('return JSON.parse(this.doc.getCursorRect(sec, para, charOffset));','return this.getBodyCursorRect({sectionIndex:sec,paragraphIndex:para,charOffset});');
  replace('return JSON.parse(this.doc.hitTest(pageNum, x, y));','return bodyPositionFromLogical(this.doc,JSON.parse(this.doc.hitTest(pageNum, x, y)));');
  replace('return JSON.parse(this.doc.navigateNextEditable(sec, para, charOffset, delta, contextJson));',`const result=JSON.parse(this.doc.navigateNextEditable(sec,para,charOffset,delta,contextJson));
    if(result.type==='text' && !result.context?.length){const pos=bodyPositionFromLogical(this.doc,{sectionIndex:result.sec,paragraphIndex:result.para,charOffset:result.charOffset});return {...result,charOffset:pos.charOffset,bodyCursor:pos.bodyCursor};}
    return result;`);
  replace('return JSON.parse((this.doc as any).deleteFootnote(sec, para, controlIdx));',`const result=JSON.parse((this.doc as any).deleteFootnote(sec,para,controlIdx));
    return result.ok?bodyPositionFromLogical(this.doc,{...result,sectionIndex:result.sectionIndex??sec,paragraphIndex:result.paragraphIndex??para}):result;`);
  replace(read().slice(0,read().indexOf('\n')+1),'import {bodyPositionFromLogical,bodyPositionToLogical,bodyPositionFromText} from '+JSON.stringify('./pwh-body-cursor-position.mjs')+';\n'+read().slice(0,read().indexOf('\n')+1));
 });
 await change('engine/cursor.ts','pwh preserve body cursor affinity',replace=>{
  replace('  moveTo(pos: DocumentPosition): void {\n    this.position = { ...pos };','  moveTo(pos: DocumentPosition): void {\n    this.position = this.isInHeaderFooter()||this.isInFootnote()?{...pos}:this.wasm.bodyPositionFromText(pos);');
  replace('sec, effectivePara, pos.charOffset, delta,','sec, effectivePara, context.length===0?this.wasm.bodyPositionToLogical(pos):pos.charOffset, delta,');
  replace('        charOffset: result.charOffset,\n      };','        charOffset: result.charOffset,\n        bodyCursor: (result as any).bodyCursor,\n      };');
  replace(`this.rect = this.wasm.getCursorRect(
          this.position.sectionIndex,
          this.position.paragraphIndex,
          this.position.charOffset,
        );`,'this.rect = this.wasm.getBodyCursorRect(this.position);');
 });
 await change('engine/command.ts','pwh insert at exact body control side',(replace,read)=>{
  replace('  if (isCell(pos)) return false;\n  if (!Number.isInteger(deleteCount)', '  if (isCell(pos) || hasBodyCursorAffinity(pos)) return false;\n  if (!Number.isInteger(deleteCount)');
  replace('  } else if (canUseLocalBodyTextReplace(pos, 0, text)) {','  } else if (hasBodyCursorAffinity(pos)) {\n    wasm.insertTextAtBodyCursor(pos,text);\n  } else if (canUseLocalBodyTextReplace(pos, 0, text)) {');
  replace(`function doInsertTextImmediate(wasm: WasmBridge, pos: DocumentPosition, text: string): void {
  if (isNestedCell(pos)) {`,`function doInsertTextImmediate(wasm: WasmBridge, pos: DocumentPosition, text: string): void {
  if (hasBodyCursorAffinity(pos)) {wasm.insertTextAtBodyCursor(pos,text);return;}
  if (isNestedCell(pos)) {`);
  replace('    // 삭제 전 텍스트 보존','    this.position=wasm.bodyPositionFromText(this.position);\n    // 삭제 전 텍스트 보존');
  replace('    try {\n      this.lastMutationEffects = deleteTextWithMutationEffects(wasm, this.position, this.count);','    if(this.fragmentId===null && hasBodyCursorAffinity(this.position))this.fragmentId=captureTextFragment(wasm,this.position);\n    try {\n      this.lastMutationEffects = deleteTextWithMutationEffects(wasm, this.position, this.count);');
  replace(read().slice(0,read().indexOf('\n')+1),'import {hasBodyCursorAffinity} from '+JSON.stringify('../core/pwh-body-cursor-position.mjs')+';\n'+read().slice(0,read().indexOf('\n')+1));
 });
 await change('engine/input-handler-text.ts','pwh note deletion uses exact logical cursor',replace=>{
  replace(`this.wasm.getFootnoteAtCursor(
      pos.sectionIndex,
      pos.paragraphIndex,
      pos.charOffset,
      direction,
    )`,'this.wasm.getBodyFootnoteAtCursor(pos,direction)');
  replace('this.wasm.getFootnoteAtCursor(pos.sectionIndex,pos.paragraphIndex,pos.charOffset,direction)','this.wasm.getBodyFootnoteAtCursor(pos,direction)');
 });
}
