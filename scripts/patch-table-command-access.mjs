import fs from 'node:fs/promises';
import path from 'node:path';

// Run after existing command, clipboard and property patches. Each edit checks
// the pinned input; an upstream change must not silently reintroduce flat calls.
export async function patchTableCommandAccess(studio) {
  const commands=path.join(studio,'src/command/commands');
  await fs.copyFile(new URL('../src/pwh-table-command-access.ts',import.meta.url),path.join(commands,'pwh-table-command-access.ts'));
  const services=await fs.readFile(new URL('../src/table-command-services.mjs',import.meta.url),'utf8');
  await fs.writeFile(path.join(commands,'pwh-table-command-services.mjs'),services.replace("'./path-table-properties.mjs'","'../../ui/pwh-path-table-properties.mjs'"));
  async function edit(relative,transform) {
    const file=path.join(studio,'src',relative),marker='// Pwh table command access';
    const source=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');
    if(source.startsWith(marker+'\n'))return;
    const replace=(text,before,after)=>{
      if(text.split(before).length!==2)throw Error('Unsupported table command access: '+relative+' '+before.slice(0,100));
      return text.replace(before,()=>after);
    };
    await fs.writeFile(file,marker+'\n'+transform(source,replace));
  }
  await edit('command/commands/table.ts',(source,replace)=>{
    source="import {wrapTableCommands} from './pwh-table-command-access';\nimport {showToast} from '@/ui/toast';\n"+source;
    source=replace(source,'export const tableCommands: CommandDef[] = [','export const tableCommands: CommandDef[] = wrapTableCommands([');
    if(!source.endsWith('];\n'))throw Error('Unsupported table command array');
    source=source.slice(0,-3)+']);\n';
    source=replace(source,"(cellPath?.length ?? 0) > 1) return;","((cellPath?.length ?? 0) > 1 && !(services.wasm as any).pwhTablePropertiesPath)) return;");
    source=replace(source,"pos.cellIndex === undefined || (pos.cellPath?.length ?? 0) > 1) return;","pos.cellIndex === undefined || ((pos.cellPath?.length ?? 0) > 1 && !(services.wasm as any).pwhTablePropertiesPath)) return;");
    source=replace(source,"if (!position || (position.cellPath?.length ?? 0) > 1) return;","if (!position) return;");
    source=replace(source,'const cellPath = pos.cellPath?.map(entry => ({ ...entry, ...corrected }));',
      'const cellPath = pos.cellPath?.map((entry, index, entries) => index === entries.length - 1 ? { ...entry, ...corrected } : { ...entry });');
    source=replace(source,'      for (let i = 0; i < count; i += 1) {',`      const pathJson=(wasm as any).pwhTablePropertiesPath;
      if(pathJson) {
        wasm.editTableStructureByPath(pos.sectionIndex,pos.parentParaIndex!,pathJson,
          {operation:'insert-'+mode,row:cellInfo.row,col:cellInfo.col,count});
        return pos;
      }
      for (let i = 0; i < count; i += 1) {`);
    source=replace(source,'try { fn(); } catch (e) { console.error(`[table] ${label} 실패:`, e); }',
      'try { fn(); } catch (e) { console.error(`[table] ${label} 실패:`, e); showToast({message: `${label}: ${e instanceof Error ? e.message : "표를 변경하지 못했습니다."}`, durationMs:7000}); }');
    return source;
  });
  await edit('core/wasm-bridge.ts',(source,replace)=>{
    source=replace(source,'    treatAsChar?: boolean;\n    colWidths?: number[];',
      '    parentParaIdx?: number;\n    cellPath?: {controlIndex:number;cellIndex:number;cellParaIndex:number}[];\n    treatAsChar?: boolean;\n    colWidths?: number[];');
    return replace(source,'  getTablePropertiesByPath(sec: number, ppi: number, cellPath: string): TableProperties {',`  editTableStructureByPath(sec:number,ppi:number,pathJson:string,edit:Record<string,unknown>): {ok:boolean;rowCount:number;colCount:number;cellCount:number} {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');
    return JSON.parse((this.doc as any).editTableStructureByPath(sec,ppi,pathJson,JSON.stringify(edit)));
  }
  getCellOwnPropertiesByPath(sec:number,ppi:number,pathJson:string,cell:number): CellProperties {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');
    return JSON.parse((this.doc as any).getCellOwnPropertiesByPath(sec,ppi,pathJson,cell));
  }
  setCellZonePropertiesByPath(sec:number,ppi:number,pathJson:string,range:{startRow:number;startCol:number;endRow:number;endCol:number},props:Partial<CellProperties>): {ok:boolean} {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');
    return JSON.parse((this.doc as any).setCellZonePropertiesByPath(sec,ppi,pathJson,range.startRow,range.startCol,range.endRow,range.endCol,JSON.stringify(props)));
  }
  getTablePropertiesByPath(sec: number, ppi: number, cellPath: string): TableProperties {`);
  });
  await edit('command/types.ts',(source,replace)=>replace(source,'  inTable: boolean;','  inTable: boolean;\n  /** The selected table or text caret belongs to a table inside another cell. */\n  inNestedTable?: boolean;'));
  await edit('main.ts',(source,replace)=>replace(source,'    inTable: inputHandler?.isInTable() ?? false,',
    '    inTable: inputHandler?.isInTable() ?? false,\n    inNestedTable: ((inputHandler?.getSelectedTableRef()?.cellPath ?? inputHandler?.getCellTableContext()?.cellPath ?? inputHandler?.getCursorPosition().cellPath)?.length ?? 0) > 1,'));
  await edit('command/commands/edit.ts',(source,replace)=>{
    for(const id of ['edit:copy','edit:delete']) {
      const start=source.indexOf("    id: '"+id+"',"),end=source.indexOf('\n  },',start);
      const block=source.slice(start,end);
      const patched=replace(block,'(ctx.hasSelection || ctx.inPictureObjectSelection || ctx.inTableObjectSelection)',
        '(ctx.hasSelection || ctx.inCellSelectionMode || ctx.inPictureObjectSelection || ctx.inTableObjectSelection)');
      source=source.slice(0,start)+patched+source.slice(end);
    }
    return source;
  });
  await edit('engine/input-handler.ts',(source,replace)=>{
    source="import {confirmCellBlockDelete} from '@/pwh-cell-delete-dialog';\n"+source;
    return replace(source,"  performDelete(): void {\n    if (this.editMode === 'form') return;",
      "  performDelete(): void {\n    if (this.editMode === 'form') return;\n    if (this.cursor.isInCellSelectionMode()) {\n      if (!this.cursor.isProtectedCellSelectionMode()) confirmCellBlockDelete(this);\n      return;\n    }");
  });
  await edit('engine/input-handler-keyboard.ts',(source,replace)=>{
    source=replace(source,"const CELL_BLOCK_GLOBAL_COMMANDS = new Set([\n  'edit:undo',",
      "const CELL_BLOCK_GLOBAL_COMMANDS = new Set([\n  'edit:delete',\n  'edit:undo',");
    source=replace(source,
      "      if ((this.cursor.getPosition().cellPath?.length ?? 0) <= 1) this.dispatcher.dispatch('table:insert-row-below');",
      "      this.dispatcher.dispatch('table:insert-row-below');");
    return replace(source,
      "    if ((position.cellPath?.length ?? 0) <= 1) this.dispatcher?.dispatch('table:delete-row');",
      "    this.dispatcher?.dispatch('table:delete-row');");
  });
  await edit('command/commands/insert.ts',(source,replace)=>{
    source=replace(source,'  const pos = ih.getPosition();\n  let result: { ok: boolean; paraIdx: number; controlIdx: number } | undefined;',
      '  const pos = ih.getCursorPosition();\n  if(pos.parentParaIndex!==undefined) { showToast({message:"셀 안의 각주·미주 삽입은 아직 지원하지 않습니다."}); return; }\n  let result: { ok: boolean; paraIdx: number; controlIdx: number } | undefined;');
    for(const id of ['insert:footnote','insert:endnote']) {
      const start=source.indexOf("    id: '"+id+"',"),end=source.indexOf('\n  },',start);
      const block=source.slice(start,end);
      source=source.slice(0,start)+replace(block,'canExecute: (ctx) => ctx.hasDocument,','canExecute: (ctx) => ctx.hasDocument && !ctx.inTable,')+source.slice(end);
    }
    return source;
  });
}
