import fs from 'node:fs/promises';import path from 'node:path';
export async function patchFormatCopyOptions(studio){
 for(const name of ['pwh-format-copy-dialog.ts','pwh-format-copy-dialog.css','format-copy-options.mjs'])await fs.copyFile(new URL('../src/'+name,import.meta.url),path.join(studio,'src',name));
 const file=path.join(studio,'src/engine/input-handler.ts');let source=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');
 if(source.includes('// Pwh format copy choices'))return;
 const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('Unsupported format copy source: '+before.slice(0,80));source=source.replace(before,()=>after);};
 replace('  cellProps?: Partial<CellProperties>;','  cellProps?: Partial<CellProperties>;\n  textToCells?: boolean;');
 replace('    this.copyFormatAtCursor();',`    const captured=this.captureFormatAtCursor();
    new PwhFormatCopyDialog(!!captured.cellProps,options=>{
      this.formatCopyState=chooseCopiedFormat(captured,options);
      this.eventBus.emit('command-state-changed');
    },()=>this.focusTextarea()).show();`);
 const start=source.indexOf('  private applyCopiedFormatToCurrentTarget(): boolean {'),end=source.indexOf('  private copyFormatAtCursor(): void {',start);
 if(start<0||end<start)throw Error('Unsupported format copy target');
 source=source.slice(0,start)+`  private applyCopiedFormatToCurrentTarget(): boolean {
    const state=this.formatCopyState;if(!state||this.editMode==='form')return false;
    const block=this.getSelectedCellBlock(),selection=this.getSelection(),cursorBefore=this.cursor.getPosition();
    if(!block&&!selection)return false;
    if(!block&&state.textToCells===false)return false;
    if(state.cellProps&&block?.cellPath&&block.cellPath.length>1)return false;
    const useText=!block||state.textToCells!==false;
    const targets=useText&&Object.keys(state.paraProps).length?(block?this.getParaFormatTargetsForCellBlock(block):this.getParaFormatTargetsForRange(selection!.start,selection!.end)):[];
    if(!block&&Object.keys(state.paraProps).length&&!targets.length)return false;
    if(block&&!state.cellProps&&!useText)return false;
    let applied=false;
    this.executeOperation({kind:'snapshot',operationType:'formatCopy',operation:wasm=>{
      wasm.runInBatch(()=>{
        if(block){
          for(const cell of block.cellIndices){
            if(state.cellProps)wasm.setCellProperties(block.sec,block.ppi,block.ci,cell,state.cellProps);
            if(useText&&Object.keys(state.charProps).length){
              const count=block.cellPath?wasm.getCellParagraphCountByPath(block.sec,block.ppi,JSON.stringify(withCellPathTarget(block.cellPath,cell))):wasm.getCellParagraphCount(block.sec,block.ppi,block.ci,cell);
              for(let para=0;para<count;para++){
                const path=block.cellPath?JSON.stringify(withCellPathTarget(block.cellPath,cell,para)):null;
                const length=path?wasm.getCellParagraphLengthByPath(block.sec,block.ppi,path):wasm.getCellParagraphLength(block.sec,block.ppi,block.ci,cell,para);
                if(length>0){if(path)wasm.applyCharFormatInCellByPath(block.sec,block.ppi,path,0,length,JSON.stringify(state.charProps));else wasm.applyCharFormatInCell(block.sec,block.ppi,block.ci,cell,para,0,length,JSON.stringify(state.charProps));}
              }
            }
          }
        }else if(Object.keys(state.charProps).length)new ApplyCharFormatCommand(selection!.start,selection!.end,state.charProps).execute(wasm);
        if(targets.length)new ApplyParaFormatCommand(targets,state.paraProps,cursorBefore).execute(wasm);
      });applied=true;return cursorBefore;
    }});
    if(applied){this.formatCopyState=null;this.focusTextarea();this.eventBus.emit('command-state-changed');}
    return applied;
  }

`+source.slice(end);
 replace('  private copyFormatAtCursor(): void {','  private captureFormatAtCursor(): FormatCopyState {');
 const captureStart=source.indexOf('  private captureFormatAtCursor()'),captureEnd=source.indexOf('  private applyCopiedCellPropsToSelection',captureStart);
 let capture=source.slice(captureStart,captureEnd);
 if(capture.split('this.formatCopyState = {').length!==2)throw Error('Unsupported format capture state');
 capture=capture.replace('pos.parentParaIndex !== undefined','pos.parentParaIndex !== undefined && (pos.cellPath?.length??0)<=1').replace('this.formatCopyState = {','return {').replace('    this.focusTextarea();\n','');
 source=source.slice(0,captureStart)+capture+source.slice(captureEnd);
 const cellStart=source.indexOf('const FORMAT_COPY_CELL_KEYS:'),cellEnd=source.indexOf('\n];',cellStart);
 if(cellStart<0||cellEnd<0)throw Error('Unsupported format copy cell fields');
 source=source.slice(0,cellStart)+`const FORMAT_COPY_CELL_KEYS: Array<keyof CellProperties> = [...cellAttributeKeys,...cellBorderKeys,...cellFillKeys] as Array<keyof CellProperties>;`+source.slice(cellEnd+3);
 const unused=source.indexOf('  private applyCopiedCellPropsToSelection('),afterUnused=source.indexOf('  /** 서식 토글',unused);
 if(unused<0||afterUnused<unused)throw Error('Unsupported legacy cell format copy boundary');source=source.slice(0,unused)+source.slice(afterUnused);
 source="// Pwh format copy choices\nimport {PwhFormatCopyDialog} from '../pwh-format-copy-dialog';\nimport {chooseCopiedFormat,cellAttributeKeys,cellBorderKeys,cellFillKeys} from "+JSON.stringify('../format-copy-options.mjs')+";\n"+source;
 await fs.writeFile(file,source);
}
