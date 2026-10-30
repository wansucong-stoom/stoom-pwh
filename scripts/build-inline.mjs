import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]);
const studio=path.join(root,'rhwp-studio');
// Apply the same text selection behavior in both Pwh hosts.
await fs.copyFile(new URL('../src/multiclick-selection.mjs',import.meta.url),path.join(studio,'src/engine/pwh-multiclick-selection.mjs'));
await fs.copyFile(new URL('../src/selection-page-context.mjs',import.meta.url),path.join(studio,'src/selection-page-context.mjs'));
await fs.copyFile(new URL('../src/document-font-requests.mjs',import.meta.url),path.join(studio,'src/core/pwh-document-font-requests.mjs'));
const mousePath=path.join(studio,'src/engine/input-handler-mouse.ts');let mouse=await fs.readFile(mousePath,'utf8');
if(!mouse.includes('pwh word and paragraph multiclick')){
 const anchor='    this.cursor.moveToHit(hit);\n    this.cursor.resetPreferredX();\n    this.prepareClickHerePointerEntry?.(pageX);';
 if(!mouse.includes(anchor))throw Error('Unsupported mouse text selection');
 const generatedImport="import {selectMulticlick} from "+JSON.stringify('./pwh-multiclick-selection.mjs')+";\n";
 mouse="// pwh word and paragraph multiclick\n"+generatedImport+mouse.replace(anchor,"    this.cursor.moveToHit(hit);\n    this.cursor.resetPreferredX();\n    if (e.button === 0 && !e.ctrlKey && !e.altKey && !e.metaKey && selectMulticlick(this.cursor,this.wasm,e.detail)) {\n      this.active = true; this.cellSelectionDragCandidate = null; this.updateCaret(true); this.textarea.focus(); e.preventDefault(); return;\n    }\n    this.prepareClickHerePointerEntry?.(pageX);");
 await fs.writeFile(mousePath,mouse);
}
// Reuse the editor's object-properties command, including the complete nested
// cell or header/footer reference, rather than constructing a second dialog.
if(!mouse.includes('pwh image double-click properties')){
 const anchor="  // 머리말/꼬리말 영역 더블클릭 → 편집 모드 진입";
 if(!mouse.includes(anchor))throw Error('Unsupported picture double-click handler');
 mouse=mouse.replace(anchor,"  // pwh image double-click properties\n  const selectedPicture = this.cursor.isInPictureObjectSelection() ? this.cursor.getSelectedPictureRef() : null;\n  if (selectedPicture?.type === 'image' && !selectedPicture.missing) {\n    e.preventDefault();\n    this.eventBus.emit('pwh-picture-properties-request');\n    return;\n  }\n\n"+anchor);
 await fs.writeFile(mousePath,mouse);
}
// Double-clicking the selected table object opens table properties; a double
// click inside editable cell text still belongs to word selection.
if(!mouse.includes('pwh table double-click properties')){
 const anchor='  // 머리말/꼬리말 영역 더블클릭 → 편집 모드 진입';
 if(!mouse.includes(anchor))throw Error('Unsupported table double-click handler');
 mouse=mouse.replace(anchor,`  // pwh table double-click properties
  const selectedTable = this.cursor.isInTableObjectSelection() ? this.cursor.getSelectedTableRef() : null;
  if (selectedTable && !selectedTable.cellPath?.length) {
    e.preventDefault();
    this.eventBus.emit('pwh-table-properties-request');
    return;
  }

`+anchor);
 await fs.writeFile(mousePath,mouse);
}
// Keep Hancom-style commands in the shared editor rather than in either host.
await fs.copyFile(new URL('../src/table-create-shortcut.mjs',import.meta.url),path.join(studio,'src/engine/pwh-table-create-shortcut.mjs'));
await fs.copyFile(new URL('../src/cell-border-grid.mjs',import.meta.url),path.join(studio,'src/ui/pwh-cell-border-grid.mjs'));
await fs.copyFile(new URL('../src/pwh-cell-border-dialog.ts',import.meta.url),path.join(studio,'src/ui/pwh-cell-border-dialog.ts'));
await fs.copyFile(new URL('../src/pwh-cell-border-dialog.css',import.meta.url),path.join(studio,'src/ui/pwh-cell-border-dialog.css'));
await fs.copyFile(new URL('../src/pwh-color-palette.ts',import.meta.url),path.join(studio,'src/ui/pwh-color-palette.ts'));
await fs.copyFile(new URL('../src/pwh-color-palette.css',import.meta.url),path.join(studio,'src/ui/pwh-color-palette.css'));
const paletteMainPath=path.join(studio,'src/main.ts');let paletteMain=await fs.readFile(paletteMainPath,'utf8');
if(!paletteMain.includes('pwh common color palette')){paletteMain="// pwh common color palette\nimport {installPwhColorPalette} from './ui/pwh-color-palette';\ninstallPwhColorPalette();\n"+paletteMain;await fs.writeFile(paletteMainPath,paletteMain);}
const modalPath=path.join(studio,'src/ui/dialog.ts');let modal=await fs.readFile(modalPath,'utf8');
if(!modal.includes('pwh palette keyboard')){const anchor='      const target = e.target as HTMLElement | null;';if(!modal.includes(anchor))throw Error('Unsupported modal keyboard handling');modal=modal.replace(anchor,anchor+"\n      if (target?.closest('.pwh-color-popover')) return; // pwh palette keyboard");await fs.writeFile(modalPath,modal);}
const toolbarPath=path.join(studio,'src/ui/toolbar.ts');let toolbar=await fs.readFile(toolbarPath,'utf8');
if(!toolbar.includes('pwh common highlight palette')){const anchor="      this.highlightDropdown.classList.toggle('open');";if(!toolbar.includes(anchor))throw Error('Unsupported highlight palette');toolbar="// pwh common highlight palette\nimport {openPwhColorPalette} from './pwh-color-palette';\n"+toolbar.replace(anchor,"      this.highlightDropdown.classList.remove('open');\n      openPwhColorPalette(hiddenPicker,this.btnHighlight,{allowNone:true});");await fs.writeFile(toolbarPath,toolbar);}
const endnotePath=path.join(studio,'src/ui/endnote-shape-dialog.ts');let endnote=await fs.readFile(endnotePath,'utf8');
if(!endnote.includes('pwh common endnote colors')){const anchor='      this.toggleMenu(this.lineColorMenu);';if(!endnote.includes(anchor))throw Error('Unsupported endnote color menu');endnote=endnote.replace(anchor,"      this.closePopupMenus();\n      this.lineColorInput.click(); // pwh common endnote colors");await fs.writeFile(endnotePath,endnote);}
const borderDialogPath=path.join(studio,'src/ui/cell-border-bg-dialog.ts');
let borderDialog=await fs.readFile(borderDialogPath,'utf8');
if(!borderDialog.includes('pwh Hancom-style border dialog')){
 borderDialog="// pwh Hancom-style border dialog\nimport {createPwhBorderTab,installPwhBorderDialog,applyPwhBorderDialog} from './pwh-cell-border-dialog';\n"+borderDialog;
 borderDialog=borderDialog.replace("    super(i18nText('dialog.cellBorderBg.diagonalPreviewWidthPx.title'), 460);", "    super(i18nText('dialog.cellBorderBg.diagonalPreviewWidthPx.title'), 640);");
 borderDialog=borderDialog.replace('    this.populateFields();\n  }','    this.populateFields();\n    installPwhBorderDialog(this);\n  }');
 const start=borderDialog.indexOf('  private buildBorderTab(): HTMLElement {'),end=borderDialog.indexOf('  private applyBorderDir(',start);
 if(start<0||end<0)throw Error('Unsupported cell border dialog');
 borderDialog=borderDialog.slice(0,start)+"  private buildBorderTab(): HTMLElement { return createPwhBorderTab(this); }\n\n"+borderDialog.slice(end);
 const begin=borderDialog.indexOf('  protected onConfirm(): void {'),finish=borderDialog.indexOf('  // ─── DOM 헬퍼',begin);
 if(begin<0||finish<0)throw Error('Unsupported cell border apply');
 borderDialog=borderDialog.slice(0,begin)+"  protected onConfirm(): boolean { return applyPwhBorderDialog(this); }\n\n"+borderDialog.slice(finish);
 await fs.writeFile(borderDialogPath,borderDialog);
}
if(!borderDialog.includes('pwh supported diagonals')){
 const prior="      ['CENTER', 0b010, '단순 역대각선'],\n      ['CENTER_BELOW', 0b011, '아래쪽 분기 역대각선'],\n      ['ALL', 0b111, '전체 분기 역대각선'],";
 const prior2="      ['CENTER', 0b010, '단순 대각선'],\n      ['CENTER_BELOW', 0b011, '아래쪽 분기 대각선'],\n      ['ALL', 0b111, '전체 분기 대각선'],";
 if(!borderDialog.includes(prior)||!borderDialog.includes(prior2))throw Error('Unsupported diagonal controls');
 borderDialog=borderDialog.replace(prior,"      ['CENTER', 0b010, '단순 역대각선'], // pwh supported diagonals").replace(prior2,"      ['CENTER', 0b010, '단순 대각선'],");
 borderDialog=borderDialog.replace("    previewSection.appendChild(this.diagPreviewSvg);","    previewSection.appendChild(this.diagPreviewSvg);\n    const unsupported=document.createElement('p');unsupported.className='pwh-diag-unsupported';unsupported.hidden=true;unsupported.textContent='기존 문서의 분기 대각선은 보존되지만 한 줄로 표시됩니다.';previewSection.appendChild(unsupported);");
 borderDialog=borderDialog.replace('    const diagonalSelected = this.hasDiagonalSelection();',"    const diagonalSelected = this.hasDiagonalSelection();\n    const unsupported=this.dialog.querySelector('.pwh-diag-unsupported') as HTMLElement|null;if(unsupported)unsupported.hidden=![0,2].includes(this.diagSlashBits)||![0,2].includes(this.diagBackSlashBits);");
 // Correct the inverse above: the warning is visible only for multi-branch data.
 borderDialog=borderDialog.replace("unsupported.hidden=![0,2].includes(this.diagSlashBits)||![0,2].includes(this.diagBackSlashBits)","unsupported.hidden=[0,2].includes(this.diagSlashBits)&&[0,2].includes(this.diagBackSlashBits)");
 borderDialog=borderDialog.replace("        if (this.hasDiagonalSelection()) this.diagCenterLine = 'NONE';","        if (this.hasDiagonalSelection()) { this.diagCenterLine = 'NONE'; if (this.diagLineTypeSelect.value === '0') this.diagLineTypeSelect.value = '1'; }");
 borderDialog=borderDialog.replace("        if (this.hasCenterLineSelection()) {\n          this.diagSlashBits = 0;", "        if (this.hasCenterLineSelection()) {\n          if (this.diagLineTypeSelect.value === '0') this.diagLineTypeSelect.value = '1';\n          this.diagSlashBits = 0;");
 await fs.writeFile(borderDialogPath,borderDialog);
}
const contextShortcutPath=path.join(studio,'src/command/contextual-shortcut.ts');
let contextShortcut=await fs.readFile(contextShortcutPath,'utf8');
if(!contextShortcut.includes('pwh cell C and L shortcuts')){
 const signature="  | { kind: 'dispatch'; commandId: 'table:cell-split' | 'table:cell-merge' }";
 const ime="      || event.key === 'ㅡ'\n";
 const before="  return null;\n}\n";
 if(!contextShortcut.includes(signature)||!contextShortcut.includes(ime))throw Error('Unsupported cell shortcut resolver');
 contextShortcut=contextShortcut.replace(signature,"  | { kind: 'dispatch'; commandId: 'table:cell-split' | 'table:cell-merge' | 'table:cell-props' | 'table:border-each' }");
 contextShortcut=contextShortcut.replace(ime,ime+"      || event.key === 'ㅣ' || event.key === 'ㅊ' || event.key === 'ㅅ'\n");
 const at=contextShortcut.lastIndexOf(before);if(at<0)throw Error('Unsupported cell shortcut resolver tail');
 contextShortcut=contextShortcut.slice(0,at)+"  // pwh cell C and L shortcuts\n  if (key === 'c' || event.key === 'ㅊ' || code === 'keyc') return { kind: 'dispatch', commandId: 'table:cell-props' };\n  if (key === 'l' || event.key === 'ㅣ' || code === 'keyl') return { kind: 'dispatch', commandId: 'table:border-each' };\n"+contextShortcut.slice(at);
 await fs.writeFile(contextShortcutPath,contextShortcut);
}
const tableCommandPath=path.join(studio,'src/command/commands/table.ts');
let tableCommand=await fs.readFile(tableCommandPath,'utf8');
if(!tableCommand.includes('pwh detailed table creation')){
 const anchor='      dialog.show(params?.anchorEl as HTMLElement | undefined);';
 if(!tableCommand.includes(anchor))throw Error('Unsupported table creation command');
 tableCommand=tableCommand.replace(anchor,"      // pwh detailed table creation\n      dialog.onClose = () => restoreEditorFocus(ih);\n      if (params?.pwhDetailed) dialog.showInputDialog();\n      else dialog.show(params?.anchorEl as HTMLElement | undefined);");
 tableCommand=tableCommand.replace("    id: 'table:border-each',\n    opensDialog: true,\n    label: t('command.table.borderEach.registryLabel'),\n    canExecute: inTable,", "    id: 'table:border-each',\n    opensDialog: true,\n    label: '셀 테두리/배경',\n    canExecute: inTableOrCellSelection,");
 await fs.writeFile(tableCommandPath,tableCommand);
}
const tableDialogPath=path.join(studio,'src/ui/table-create-dialog.ts');
let tableDialog=await fs.readFile(tableDialogPath,'utf8');
if(!tableDialog.includes('pwh direct detail dialog')){
 if(!tableDialog.includes('  private showInputDialog(): void {'))throw Error('Unsupported table creation dialog');
 tableDialog=tableDialog.replace('  private showInputDialog(): void {','  // pwh direct detail dialog\n  onClose: (() => void) | null = null;\n  showInputDialog(): void {');
 tableDialog=tableDialog.replace("    dlg.className = 'dialog-wrap';\n    dlg.style.width = '420px';", "    dlg.className = 'dialog-wrap';\n    dlg.setAttribute('role', 'dialog');\n    dlg.setAttribute('aria-label', '표 만들기');\n    dlg.style.width = '420px';");
 tableDialog=tableDialog.replace('function close() { overlay.remove(); }','function close() { overlay.remove(); self.onClose?.(); }');
 tableDialog=tableDialog.replace("const rowInput = createSpinnerRow(sec1, i18nText('dialog.tableCreate.createSpinnerRow.label'), 4, 1, 256);", "const rowInput = createSpinnerRow(sec1, i18nText('dialog.tableCreate.createSpinnerRow.label'), 5, 1, 256);");
 tableDialog=tableDialog.replace("  row.appendChild(makeLabel(labelText));\n  const input = document.createElement('input');", "  const label = makeLabel(labelText);\n  row.appendChild(label);\n  const input = document.createElement('input');\n  input.id = `pwh-table-count-${Math.random().toString(36).slice(2)}`;\n  label.htmlFor = input.id;");
 await fs.writeFile(tableDialogPath,tableDialog);
}
const tableInputPath=path.join(studio,'src/engine/input-handler.ts');
let tableInput=await fs.readFile(tableInputPath,'utf8');
if(!tableInput.includes('pwh caret char shape dialog')){
 const anchor='  /** 지정된 선택 범위에 글자 서식을 적용한다 (커맨드 시스템용) */';
 if(!tableInput.includes(anchor))throw Error('Unsupported character shape command API');
 tableInput=tableInput.replace(anchor,`  // pwh caret char shape dialog: use the same pending/cell-block/submode path as the toolbar.
  applyCharPropsAtCursor(props: Partial<CharProperties>): void { this.applyCharFormat(props); }

`+anchor);
 await fs.writeFile(tableInputPath,tableInput);
}
if(!tableInput.includes('pwh pending char shape in dialog')){
 const anchor='    return this.getCharPropertiesAtCursor();\n  }\n\n  /** 문단 모양 대화상자용';
 if(!tableInput.includes(anchor))throw Error('Unsupported character shape read');
 tableInput=tableInput.replace(anchor,'    return {...this.getCharPropertiesAtCursor(),...this.getPendingCharShape()}; // pwh pending char shape in dialog\n  }\n\n  /** 문단 모양 대화상자용');await fs.writeFile(tableInputPath,tableInput);
}
const formatPath=path.join(studio,'src/command/commands/format.ts');let format=await fs.readFile(formatPath,'utf8');
if(!format.includes('pwh caret char shape dialog')){
 const start=format.indexOf("    id: 'format:char-shape',"),end=format.indexOf("    id: 'format:para-shape',",start);
 if(start<0||end<0||!format.slice(start,end).includes('      if (!savedSel) return;'))throw Error('Unsupported character shape dialog command');
 const block=format.slice(start,end).replace('      if (!savedSel) return;','      // pwh caret char shape dialog: a caret is a valid formatting target.').replace('        ih.applyCharPropsToRange(savedSel.start, savedSel.end, mods);',`        const nonempty = savedSel && (savedSel.start.charOffset !== savedSel.end.charOffset || savedSel.start.paragraphIndex !== savedSel.end.paragraphIndex || savedSel.start.cellParaIndex !== savedSel.end.cellParaIndex);
        if (nonempty && !ih.isInCellSelectionMode()) ih.applyCharPropsToRange(savedSel.start, savedSel.end, mods);
        else ih.applyCharPropsAtCursor(mods);`);
 format=format.slice(0,start)+block+format.slice(end);
 await fs.writeFile(formatPath,format);
}
if(format.includes('const nonempty = savedSel && (savedSel.start.charOffset')){
 format=format.replace('const nonempty = savedSel && (savedSel.start.charOffset','const nonempty = savedSel && (savedSel.start.sectionIndex !== savedSel.end.sectionIndex || savedSel.start.charOffset');await fs.writeFile(formatPath,format);
}
if(!tableInput.includes('pwh release deferred deletion resources')){
 const before=`      const newPos = cmd.execute(this.wasm);
      this.cursor.moveTo(newPos);`;
 const after=`      // pwh release deferred deletion resources: the outer snapshot owns undo.
      let newPos: DocumentPosition;
      try { newPos = cmd.execute(this.wasm); } finally { cmd.discard(this.wasm); }
      this.cursor.moveTo(newPos);`;
 const section=tableInput.indexOf('  private deleteSelection('),end=tableInput.indexOf('  /** Undo 처리 */',section);
 if(section<0||end<0||!tableInput.slice(section,end).includes(before))throw Error('Unsupported deferred deletion path');
 tableInput=tableInput.slice(0,section)+tableInput.slice(section,end).replace(before,after)+tableInput.slice(end);
 await fs.writeFile(tableInputPath,tableInput);
}
if(!tableInput.includes("label: '셀 테두리/배경(L)...'")){
 const anchor="      { type: 'command', commandId: 'table:cell-props', label: '셀 속성...' },";
 if(!tableInput.includes(anchor))throw Error('Unsupported cell context menu');
 tableInput=tableInput.replace(anchor,anchor+"\n      { type: 'command', commandId: 'table:border-each', label: '셀 테두리/배경(L)...' },");
 tableInput=tableInput.replace("      { type: 'command', commandId: 'table:border-each', label: '셀 테두리/배경 - 각 셀마다 적용(E)...' },\n",'');
 await fs.writeFile(tableInputPath,tableInput);
}
// Cell properties opened from a block must apply to the selected cells, while
// leaving values that the user did not edit alone.
const cellPropsPath=path.join(studio,'src/ui/table-cell-props-dialog.ts');
let cellProps=await fs.readFile(cellPropsPath,'utf8');
if(!cellProps.includes('pwh selected cell properties')){
 const start=cellProps.indexOf('    // 셀 속성 수정\n    const newCellProps: Record<string, unknown> = {};');
 const end=cellProps.indexOf('    // 셀 테두리/배경 (cell 모드',start);
 if(start<0||end<0)throw Error('Unsupported cell properties dialog');
 const fields=cellProps.slice(start,end);
 cellProps=cellProps.slice(0,start)+'    const newCellProps = this.pwhCurrentCellProps();\n\n'+cellProps.slice(end);
 const method='  private pwhCurrentCellProps(): Record<string, unknown> {\n'+fields+'    return newCellProps;\n  }\n\n';
 cellProps=cellProps.replace('  protected onConfirm(): void {',method+'  protected onConfirm(): boolean | void {');
 cellProps=cellProps.replace('  private mode: \'table\' | \'cell\';',"  private mode: 'table' | 'cell';\n  private pwhInitialCellProps: Record<string, unknown> = {};");
 cellProps=cellProps.replace('    this.populateFields();\n  }','    this.populateFields();\n    this.pwhInitialCellProps = this.pwhCurrentCellProps();\n  }');
 const anchor='    // 표 속성 수정\n';
 if(!cellProps.includes(anchor))throw Error('Unsupported cell properties apply');
 cellProps=cellProps.replace(anchor,`    // pwh selected cell properties
    const blockHandler = this.services?.getInputHandler() as any;
    if (this.mode === 'cell' && blockHandler?.isInCellSelectionMode?.()) {
      const block = blockHandler.getSelectedCellBlock?.();
      if (!block || !block.cellIndices?.length || block.cellPath) {
        showToast({message:'이 셀 선택의 속성은 아직 변경할 수 없습니다.',durationMs:7000});
        return false;
      }
      const changed = Object.fromEntries(Object.entries(newCellProps).filter(([key,value]) => JSON.stringify(value) !== JSON.stringify(this.pwhInitialCellProps[key])));
      if (!Object.keys(changed).length) return true;
      const cursor = blockHandler.getCursorPosition();
      blockHandler.executeOperation({kind:'snapshot',operationType:'objectProps',operation:(wasm: WasmBridge)=>{
        wasm.runInBatch(()=>{for(const index of block.cellIndices){const result=wasm.setCellProperties(block.sec,block.ppi,block.ci,index,changed as Partial<CellProperties>);if(!result?.ok)throw Error('셀 속성을 적용하지 못했습니다.');}});
        return cursor;
      }});
      return true;
    }

`+anchor);
 cellProps="// pwh selected cell properties\nimport {showToast} from './toast';\n"+cellProps;
 await fs.writeFile(cellPropsPath,cellProps);
}
await fs.copyFile(new URL('../src/document-state-cache.mjs',import.meta.url),path.join(studio,'src/document-agent/pwh-document-state-cache.mjs'));
const agentPath=path.join(studio,'src/document-agent/controller.ts');
let agentSource=await fs.readFile(agentPath,'utf8');
if(!agentSource.includes('pwh presentation digest cache')){
 const method='  getDocumentState(): RhwpDocumentStateV1 {';
 if(!agentSource.includes(method)||!agentSource.includes('export class DocumentAgentController {'))throw Error('Unsupported document agent state bridge');
 agentSource='// pwh presentation digest cache; authoritative getDocumentState stays fresh.\nimport {createDocumentStateDigestCache} from '+JSON.stringify('./pwh-document-state-cache.mjs')+';\n'+agentSource;
 agentSource=agentSource.replace('export class DocumentAgentController {',`export class DocumentAgentController {
  private readonly pwhStateCache=createDocumentStateDigestCache();
  private pwhStateCacheOff: (()=>void)|null=null;
  getPresentationDocumentState(): RhwpDocumentStateV1 {
    this.syncGeneration();
    if(!this.pwhStateCacheOff){const offs=['document-mutated','document-changed'].map(event=>this.deps.eventBus.on(event,()=>this.pwhStateCache.invalidate()));this.pwhStateCacheOff=()=>offs.forEach(off=>off());}
    const revision={documentEpoch:this.documentEpoch,changeSeq:this.changeSeq,format:this.currentFormat(),pageCount:this.deps.wasm.pageCount,dirty:this.deps.isDirty()};
    return {schemaVersion:1,...revision,documentSha256:this.pwhStateCache.read(revision,()=>exportDocumentSha256(this.deps.wasm,revision.format))};
  }`);
 agentSource=agentSource.replace('    this.offMutation();','    this.offMutation();\n    this.pwhStateCacheOff?.();');
 await fs.writeFile(agentPath,agentSource);
}
await fs.copyFile(new URL('../src/local-font-face.mjs',import.meta.url),path.join(studio,'src/core/pwh-local-font-face.mjs'));
const hostCanvasPath=path.join(studio,'src/core/host-canvas-fonts.ts');
let hostCanvas=await fs.readFile(hostCanvasPath,'utf8');
if(!hostCanvas.includes('pwh exact local face first')){
 const begin='            const data = await loadRendererLocalFont(record);';
 const finish='            await font.load();';
 const from=hostCanvas.indexOf(begin),to=hostCanvas.indexOf(finish,from);
 if(from<0||to<0)throw Error('Unsupported host canvas font preparation');
 hostCanvas='// pwh exact local face first; verified bytes remain the fallback.\nimport {tryLoadExactLocalFont} from '+JSON.stringify('./pwh-local-font-face.mjs')+';\nimport {getLocalFontRecords} from "./local-fonts.ts";\n'+hostCanvas.slice(0,from)+`            const alias = \`__rhwp_host_face_\${this.id}_\${++this.serial}\`;
            const face = record.hostReference!.face;
            const localFace:any={...face};
            const catalog=getLocalFontRecords({includeRegistered:true});
            for(const field of ['fullName','postscriptName']){
              const wanted=String((face as any)[field]||'').normalize('NFC').toLowerCase();
              const matches=new Set(catalog.filter(candidate=>[candidate.hostReference?.face.fullName,candidate.hostReference?.face.postscriptName].some(name=>name&&name.normalize('NFC').toLowerCase()===wanted)).map(candidate=>candidate.hostReference?.face.id));
              if(!wanted||matches.size!==1||!matches.has(face.id))delete localFace[field];
            }
            let font=await tryLoadExactLocalFont(alias,localFace);
            const pwhLocalFace=!!font;
            if(stale())return;
            if(!font){
              const data=await loadRendererLocalFont(record);
              if(stale())return;
              const bytes=data?normalizeFontFaceData(data.bytes,data.faceIndex??0):null;
              if(!bytes)throw new Error('Host font has no usable face');
              font=new FontFace(alias,bytes,{weight:String(face.weight??400),style:face.slant??'normal'});
              await font.load();
            }
            if(!stale()){const field=pwhLocalFace?'pwhLocalFontLoads':'pwhTransferredFontLoads';document.documentElement.dataset[field]=String(Number(document.documentElement.dataset[field]||0)+1);}`+hostCanvas.slice(to+finish.length);
 await fs.writeFile(hostCanvasPath,hostCanvas);
}
// Repair builds made before the lightweight diagnostic count was added.
if(hostCanvas.includes('pwh exact local face first')&&!hostCanvas.includes('const pwhLocalFace=')){
 hostCanvas=hostCanvas.replace('let font=await tryLoadExactLocalFont(alias,localFace);','let font=await tryLoadExactLocalFont(alias,localFace);\n            const pwhLocalFace=!!font;');
 hostCanvas=hostCanvas.replace('            this.fontSet!.add(font);',"            const pwhField=pwhLocalFace?'pwhLocalFontLoads':'pwhTransferredFontLoads';document.documentElement.dataset[pwhField]=String(Number(document.documentElement.dataset[pwhField]||0)+1);\n            this.fontSet!.add(font);");
 await fs.writeFile(hostCanvasPath,hostCanvas);
}
await fs.copyFile(new URL('../src/clipboard-structure.mjs',import.meta.url),path.join(studio,'src/engine/pwh-clipboard-structure.mjs'));
const keyboardPath=path.join(studio,'src/engine/input-handler-keyboard.ts');
const noteTextPath=path.join(studio,'src/engine/input-handler-text.ts');let noteText=await fs.readFile(noteTextPath,'utf8');
if(!noteText.includes('pwh note deletion target guard')){
 const begin=noteText.indexOf('function tryDeleteBodyFootnoteAtCursor('),end=noteText.indexOf('export function handleBackspace(',begin);
 if(begin<0||end<0)throw Error('Unsupported note deletion command');
 let block=noteText.slice(begin,end);
 block=block.replace('    void showConfirm(FOOTNOTE_DELETE_TITLE, FOOTNOTE_DELETE_MESSAGE)',`    // pwh note deletion target guard: a modal must not delete a different note.
    const generation=this.wasm.documentGeneration;
    const undoTop=this.history.peekUndoTop();
    const state=()=>JSON.stringify([this.cursor.getPosition(),this.cursor.getSelectionOrdered()],(key,value)=>key==='cursorRect'?undefined:value);
    const targetState=state();
    const current=()=>this.wasm.documentGeneration===generation && this.history.peekUndoTop()===undoTop && state()===targetState;
    void showConfirm(FOOTNOTE_DELETE_TITLE, FOOTNOTE_DELETE_MESSAGE)`);
 block=block.replace('        if (!ok) {',`        if (!current()) return;
        if (!ok) {`);
 block=block.replace('        this.executeOperation({',`        const fresh=this.wasm.getFootnoteAtCursor(pos.sectionIndex,pos.paragraphIndex,pos.charOffset,direction);
        if (!fresh.hit || fresh.controlIndex!==controlIndex) return;
        this.executeOperation({`);
 noteText=noteText.slice(0,begin)+block+noteText.slice(end);
 noteText=noteText.replace("const FOOTNOTE_DELETE_TITLE = '각주 삭제';","const FOOTNOTE_DELETE_TITLE = '각주·미주 삭제';").replace("const FOOTNOTE_DELETE_MESSAGE = '각주를 삭제하시겠습니까?';","const FOOTNOTE_DELETE_MESSAGE = '이 각주·미주와 연결된 주석 내용을 삭제할까요?';");
 await fs.writeFile(noteTextPath,noteText);
}
if(noteText.includes('const targetState=JSON.stringify([this.cursor.getPosition(),this.cursor.getSelectionOrdered()]);')){
 noteText=noteText.replace('const targetState=JSON.stringify([this.cursor.getPosition(),this.cursor.getSelectionOrdered()]);',"const state=()=>JSON.stringify([this.cursor.getPosition(),this.cursor.getSelectionOrdered()],(key,value)=>key==='cursorRect'?undefined:value);\n    const targetState=state();").replace('JSON.stringify([this.cursor.getPosition(),this.cursor.getSelectionOrdered()])===targetState','state()===targetState');await fs.writeFile(noteTextPath,noteText);
}
let keyboard=await fs.readFile(keyboardPath,'utf8');
// A failed or empty clipboard read must never delete the selected source text.
if(!keyboard.includes('pwh reject empty plain paste before deletion')){
 const before=`function pastePlainText(this: any, text: string, hasSelection: boolean): void {
  if (hasSelection) {
    this.deleteSelection({ deferRecord: true });
  }
  if (!text) return;`;
 const after=`function pastePlainText(this: any, text: string, hasSelection: boolean): void {
  // pwh reject empty plain paste before deletion
  if (!text) return;
  if (hasSelection) {
    this.deleteSelection({ deferRecord: true });
  }`;
 if(!keyboard.includes(before))throw Error('Unsupported Studio plain-text paste guard');
 keyboard=keyboard.replace(before,after);
 await fs.writeFile(keyboardPath,keyboard);
}
// A selected range and its replacement form one undoable edit. Preserve the
// selected first character's format even if the whole paragraph is replaced.
if(!keyboard.includes('pwh atomic all plain paste')){
 const start=keyboard.indexOf('function pastePlainText(this: any, text: string, hasSelection: boolean): void {');
 const end=keyboard.indexOf('\n\nexport function prepareRhwpInternalClipboardHtml',start);
 if(start<0||end<0)throw Error('Unsupported Studio plain paste function');
 const replacement=String.raw`function pastePlainText(this: any, text: string, hasSelection: boolean): void {
  // pwh reject empty plain paste before deletion
  if (!text) return;
  const lines = text.split(/\r?\n/);
  // pwh atomic all plain paste
  const selected = hasSelection ? this.cursor.getSelectionOrdered() : null;
  if (hasSelection && !selected) return;
  let inherited: any;
  try { inherited = {...this.getCharPropertiesAtCursor(), ...(!hasSelection ? this.getPendingCharShape?.() : undefined)}; }
  catch { return; }
  const originalSelection = this.cursor.getSelection();
  const originalPosition = this.cursor.getPosition();
  const blockPhase = this.cursor.blockSelectionPhase();
  const selectionBefore = selected && selected.start.parentParaIndex === undefined
    ? {start: selected.start, end: selected.end, blockPhase} : null;
  try {
    this.executeOperation({kind: 'snapshot', operationType: 'pastePlainText', selectionBefore, operation: (wasm: WasmBridge) => {
      if (hasSelection) this.deleteSelection({deferRecord: true});
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) {
          const before = this.cursor.getPosition();
          const command = new InsertTextCommand(before, lines[i], undefined, inherited);
          const after = command.execute(wasm);
          this.cursor.moveTo(after);
          if (!hasSelection) this.advancePendingCharShapeAnchor?.(before, after);
        }
        if (i < lines.length - 1) {
          const position = this.cursor.getPosition();
          const command = this.cursor.isInCell() ? new SplitParagraphInCellCommand(position) : new SplitParagraphCommand(position);
          this.cursor.moveTo(command.execute(wasm));
        }
      }
      return this.cursor.getPosition();
    }});
  } catch (error) {
    if (originalSelection) pwhRestorePasteSelection(this, originalSelection, blockPhase);
    else this.cursor.moveTo(originalPosition);
    console.warn('[paste] 선택 영역 교체 실패:', error);
  }
}`;
 keyboard=keyboard.slice(0,start)+replacement+keyboard.slice(end);
 await fs.writeFile(keyboardPath,keyboard);
}
// A rejected rich paste must roll back its snapshot before falling back to
// plain text; a rejected HTML payload with no text must retain the source.
if(!keyboard.includes('pwh restore selection after rolled-back paste')){
 const anchor='function pastePlainText(this: any, text: string, hasSelection: boolean): void {';
 if(!keyboard.includes(anchor))throw Error('Unsupported selection restore insertion point');
 keyboard=keyboard.replace(anchor,`// pwh restore selection after rolled-back paste
function pwhRestorePasteSelection(input: any, selection: any, blockPhase: number | null): void {
  if (!selection) return;
  input.cursor.clearSelection();
  if (selection.anchor.parentParaIndex === undefined) input.cursor.selectRange(selection.anchor, selection.focus, blockPhase);
  else { input.cursor.moveTo(selection.anchor); input.cursor.setAnchor(); input.cursor.moveTo(selection.focus); }
  input.updateSelection();
}
`+anchor);
 // Older in-progress overlay revisions restored only body selections.
 keyboard=keyboard.replace('if (originalSelection && selected.start.parentParaIndex === undefined) this.cursor.selectRange(originalSelection.anchor, originalSelection.focus, blockPhase);','pwhRestorePasteSelection(this, originalSelection, blockPhase);');
 await fs.writeFile(keyboardPath,keyboard);
}
if(!keyboard.includes('pwh rollback rejected rich paste')){
 const from=keyboard.indexOf('function pasteHwpJsonModel('),to=keyboard.indexOf('/** 클립보드의 이미지 파일',from);
 if(from<0||to<0)throw Error('Unsupported Studio rich-paste handlers');
 let part=keyboard.slice(from,to);
 const modelStart='function pasteHwpJsonModel(this: any, model: string, hasSelection: boolean): boolean {\n  let ok = false;';
 const modelCell='if (p.parentParaIndex !== undefined) return undefined;';
 const modelReject='if (!parsed.ok) return undefined;';
 const modelCatch="    console.warn('[paste] 문서모델 붙여넣기 실패 — HTML 경로로 되돌아감:', error);";
 const htmlStart='function pasteExternalHtml(this: any, html: string, text: string, hasSelection: boolean): void {';
 const htmlReject="      console.warn('[paste] HTML 가져오기 거절(ok=false) — 텍스트로 폴백:', parsed.error ?? parsed);\n      return p;";
 const htmlCatch="    console.warn('[paste] HTML 붙여넣기 실패 — 텍스트로 폴백:', error);";
 if(![modelStart,modelCell,modelReject,modelCatch,htmlStart,htmlReject,htmlCatch].every(s=>part.includes(s)))throw Error('Unsupported Studio rich-paste failure paths');
 part=part.replace(modelStart,modelStart+`\n  // pwh rollback rejected rich paste\n  const originalSelection = this.cursor.getSelection();\n  const blockPhase = this.cursor.blockSelectionPhase();`)
  .replace(modelCell,'if (p.parentParaIndex !== undefined) return null;')
  .replace(modelReject,"if (!parsed.ok) throw new Error('Document model was rejected');")
  .replace(modelCatch,`    pwhRestorePasteSelection(this, originalSelection, blockPhase);\n`+modelCatch)
  .replace(htmlStart,htmlStart+`\n  const originalSelection = this.cursor.getSelection();\n  const blockPhase = this.cursor.blockSelectionPhase();`)
  .replace(htmlReject,"      throw new Error('HTML paste was rejected');")
  .replace(htmlCatch,`    if (selectionConsumed) { pwhRestorePasteSelection(this, originalSelection, blockPhase); selectionConsumed = false; }\n`+htmlCatch);
 keyboard=keyboard.slice(0,from)+part+keyboard.slice(to);
 await fs.writeFile(keyboardPath,keyboard);
}
if(!keyboard.includes('pwh table create chord')){
 const anchor='  if (!this.active) return;';
 if(!keyboard.includes(anchor))throw Error('Unsupported editor keyboard handler');
 keyboard='// pwh table create chord\nimport {handleTableCreateChord} from '+JSON.stringify('./pwh-table-create-shortcut.mjs')+';\n'+keyboard.replace(anchor,anchor+"\n  if (handleTableCreateChord(this, e)) return;");
 await fs.writeFile(keyboardPath,keyboard);
}
await fs.copyFile(new URL('../src/cell-delete-selection.mjs',import.meta.url),path.join(studio,'src/pwh-cell-delete-selection.mjs'));
await fs.copyFile(new URL('../src/cell-delete-dialog.ts',import.meta.url),path.join(studio,'src/pwh-cell-delete-dialog.ts'));
if(!keyboard.includes('pwh cell delete confirmation')){
 const prior=`      if (!this.cursor.isProtectedCellSelectionMode()) {
        this.clearSelectedCellBlock();
        this.updateCellSelection();
      }`;
 if(!keyboard.includes(prior))throw new Error('Unsupported Studio cell deletion handler');
 keyboard="// pwh cell delete confirmation\nimport {confirmCellBlockDelete} from '@/pwh-cell-delete-dialog';\n"+keyboard.replace(prior,`      if (!this.cursor.isProtectedCellSelectionMode()) confirmCellBlockDelete(this);`);
 await fs.writeFile(keyboardPath,keyboard);
}
if(!keyboard.includes('pwh structured cell clipboard guard')){
 const internalAnchor='  // 내부 복사 marker가 있으면 내부 클립보드를 사용한다.';
 const externalAnchor='function pasteExternalHtml(this: any, html: string, text: string, hasSelection: boolean): void {';
 if(!keyboard.includes(internalAnchor)||!keyboard.includes(externalAnchor))throw new Error('Unsupported Studio clipboard bridge: review upstream paste handlers');
 keyboard='// pwh structured cell clipboard guard\nimport {clipboardCellWarning} from '+JSON.stringify('./pwh-clipboard-structure.mjs')+';\nimport {showToast as pwhClipboardToast} from "@/ui/toast";\n'+keyboard;
 keyboard=keyboard.replace(internalAnchor,`  if(useInternalClipboard){
    const warning=clipboardCellWarning(pos,html,this.wasm.clipboardHasControl());
    if(warning){pwhClipboardToast({message:warning,durationMs:12000});return;}
  }
`+internalAnchor);
 keyboard=keyboard.replace(externalAnchor,externalAnchor+`
  const warning=clipboardCellWarning(this.cursor.getPosition(),html);
  if(warning){pwhClipboardToast({message:warning,durationMs:12000});return;}
`);
 await fs.writeFile(keyboardPath,keyboard);
}
await fs.copyFile(new URL('../src/selection-layout.mjs',import.meta.url),path.join(studio,'src/core/pwh-selection-layout.mjs'));
if(!keyboard.includes('pwh prefer editable table over bitmap preview')){
 const imageGate='  if (items) {';
 const bitmapStart='    const img = new Image();';
 const bitmapEnd='    // px → HWPUNIT (1px = 75 HWPUNIT at 96 DPI)';
 const from=keyboard.indexOf(bitmapStart,keyboard.indexOf('async function pasteImageFile'));
 const to=keyboard.indexOf(bitmapEnd,from);
 if(!keyboard.includes(imageGate)||from<0||to<0)throw Error('Unsupported clipboard image priority/decode path');
 keyboard=keyboard.replace('import {clipboardCellWarning}', 'import {clipboardCellWarning,preferStructuredClipboardHtml}');
 keyboard=keyboard.replace(imageGate,'  // pwh prefer editable table over bitmap preview\n  if (items && !preferStructuredClipboardHtml(html)) {');
 const start=keyboard.indexOf(bitmapStart,keyboard.indexOf('async function pasteImageFile'));
 const end=keyboard.indexOf(bitmapEnd,start);
 keyboard=keyboard.slice(0,start)+`    // Decode local clipboard bytes without a blob URL blocked by host image CSP.
    const img = await createImageBitmap(file);
    const imageWidth=img.width,imageHeight=img.height;img.close();

`+keyboard.slice(end);
 const pasteStart=keyboard.indexOf('async function pasteImageFile'),pasteEnd=keyboard.indexOf('/** 기존 컨트롤 선택 상태',pasteStart);
 if(pasteEnd<0)throw Error('Unsupported clipboard image function boundary');
 keyboard=keyboard.slice(0,pasteStart)+keyboard.slice(pasteStart,pasteEnd).replaceAll('img.naturalWidth','imageWidth').replaceAll('img.naturalHeight','imageHeight')+keyboard.slice(pasteEnd);
 await fs.writeFile(keyboardPath,keyboard);
}
// A Hancom model includes the original image and object properties, whereas
// the clipboard bitmap is only a preview. Prefer the model when available.
const oldImageGate='if (items && !preferStructuredClipboardHtml(html)) {';
if(keyboard.includes(oldImageGate)){
 keyboard=keyboard.replace(oldImageGate,'if (items && !preferStructuredClipboardHtml(html) && !extractHwpJsonModel(html)) {');
 await fs.writeFile(keyboardPath,keyboard);
}
// Image decoding and RTF image inlining yield to the event loop. Capture the
// document revision, selection and DOM focus before yielding; never apply a
// delayed paste to a different document or selection.
if(!keyboard.includes('pwh guard asynchronous clipboard operations')){
 const anchor='export function onPaste(this: any, e: ClipboardEvent): void {';
 const helper=`// pwh guard asynchronous clipboard operations
function pwhCapturePasteContext(input: any): any {
  const state = (window as any).pwhEditor?.context?.();
  return {state: state ? JSON.stringify([state.documentState, state.cursor, state.selection]) : null,
    target: input.textarea, wasm: input.wasm};
}
function pwhPasteContextUnchanged(input: any, expected: any): boolean {
  const state = (window as any).pwhEditor?.context?.();
  return !!expected.state && !!state && input.wasm === expected.wasm && input.active &&
    JSON.stringify([state.documentState, state.cursor, state.selection]) === expected.state &&
    expected.target?.isConnected && expected.target.ownerDocument.activeElement === expected.target &&
    expected.target.ownerDocument.hasFocus();
}
`;
 const rtfStart=`    if (needsRtfImageInlining(html, rtf)) {
      void (async () => {`;
 const rtfEnd=`        pasteExternalHtml.call(this, merged, text, hasSelection);`;
 const imageStart=`async function pasteImageFile(this: any, file: File, hasSelection: boolean): Promise<void> {
  try {`;
 const imageReady=`    const imageWidth=img.width,imageHeight=img.height;img.close();`;
 if(!keyboard.includes(anchor)||!keyboard.includes(rtfStart)||!keyboard.includes(rtfEnd)||!keyboard.includes(imageStart)||!keyboard.includes(imageReady))throw Error('Unsupported Studio async clipboard path');
 keyboard=keyboard.replace(anchor,helper+anchor)
  .replace(rtfStart,`    if (needsRtfImageInlining(html, rtf)) {
      const pasteContext = pwhCapturePasteContext(this);
      void (async () => {`)
  .replace(rtfEnd,`        if (!pwhPasteContextUnchanged(this, pasteContext)) return;
        pasteExternalHtml.call(this, merged, text, hasSelection);`)
  .replace(imageStart,`async function pasteImageFile(this: any, file: File, hasSelection: boolean): Promise<void> {
  const pasteContext = pwhCapturePasteContext(this);
  try {`)
  .replace(imageReady,`${imageReady}
    if (!pwhPasteContextUnchanged(this, pasteContext)) return;`);
 await fs.writeFile(keyboardPath,keyboard);
}
await fs.copyFile(new URL('../src/table-style.mjs',import.meta.url),path.join(studio,'src/pwh-table-style.mjs'));
await fs.copyFile(new URL('../src/table-content.mjs',import.meta.url),path.join(studio,'src/pwh-table-content.mjs'));
await fs.copyFile(new URL('../src/text-edit.mjs',import.meta.url),path.join(studio,'src/pwh-text-edit.mjs'));
await fs.copyFile(new URL('../src/request-state.mjs',import.meta.url),path.join(studio,'src/pwh-request-state.mjs'));
await fs.copyFile(new URL('../src/table-clipboard.mjs',import.meta.url),path.join(studio,'src/pwh-table-clipboard.mjs'));
await fs.copyFile(new URL('../src/nested-table-paste.mjs',import.meta.url),path.join(studio,'src/pwh-nested-table-paste.mjs'));
await fs.copyFile(new URL('../src/table-paste-dialog.ts',import.meta.url),path.join(studio,'src/pwh-table-paste-dialog.ts'));
// The source module uses package-relative imports; the Studio overlay uses prefixed names.
for(const name of ['pwh-table-content.mjs','pwh-table-clipboard.mjs','pwh-nested-table-paste.mjs']){
 const file=path.join(studio,'src',name);
 await fs.writeFile(file,(await fs.readFile(file,'utf8')).replaceAll("'./table-style.mjs'","'./pwh-table-style.mjs'").replaceAll("'./request-state.mjs'","'./pwh-request-state.mjs'").replaceAll("'./table-content.mjs'","'./pwh-table-content.mjs'").replaceAll("'./nested-table-paste.mjs'","'./pwh-nested-table-paste.mjs'"));
}
const editCommandsPath=path.join(studio,'src/command/commands/edit.ts');
let editCommands=await fs.readFile(editCommandsPath,'utf8');
if(!editCommands.includes('pwh cell clipboard command')){
 const predicate='ctx.hasSelection || ctx.inPictureObjectSelection || ctx.inTableObjectSelection';
 if(!editCommands.includes(predicate))throw Error('Unsupported copy command eligibility');
 editCommands=editCommands.replace(predicate,'ctx.hasSelection || ctx.inCellSelectionMode /* pwh cell clipboard command */ || ctx.inPictureObjectSelection || ctx.inTableObjectSelection');
 await fs.writeFile(editCommandsPath,editCommands);
}
await fs.copyFile(new URL('../src/collaboration-target.ts',import.meta.url),path.join(studio,'src/pwh-collaboration-target.ts'));
await fs.copyFile(new URL('../src/picture-replace.ts',import.meta.url),path.join(studio,'src/pwh-picture-replace.ts'));
await fs.copyFile(new URL('../src/page-layout.ts',import.meta.url),path.join(studio,'src/pwh-page-layout.ts'));
await fs.copyFile(new URL('../src/blank-compose.ts',import.meta.url),path.join(studio,'src/pwh-blank-compose.ts'));
await fs.copyFile(new URL('../src/studio-selection.ts',import.meta.url),path.join(studio,'src/collaboration-selection.ts'));
await fs.copyFile(new URL('../src/studio-inline-adapter.ts',import.meta.url),path.join(studio,'src/pwh-inline-adapter.ts'));
let main=await fs.readFile(path.join(studio,'src/main.ts'),'utf8');
if(!main.includes("import './style.css'"))main="import './style.css';\n"+main;
if(!main.includes('pwh image double-click dispatch')){
 const anchor="// 수식 더블클릭 → 수식 편집 대화상자";
 if(!main.includes(anchor))throw Error('Unsupported picture command dispatch');
 main=main.replace(anchor,"// pwh image double-click dispatch\neventBus.on('pwh-picture-properties-request', () => dispatcher.dispatch('insert:picture-props'));\n\n"+anchor);
}
if(!main.includes('pwh table double-click dispatch')){
 const anchor="// 수식 더블클릭 → 수식 편집 대화상자";
 if(!main.includes(anchor))throw Error('Unsupported table command dispatch');
 main=main.replace(anchor,"// pwh table double-click dispatch\neventBus.on('pwh-table-properties-request', () => dispatcher.dispatch('table:cell-props'));\n\n"+anchor);
}
if(!main.includes('pwh desktop print command')){
 const filter="? fileCommands.filter((cmd) => !EMBED_HIDDEN_FILE_COMMAND_IDS.includes(cmd.id))";
 const prune='  for (const id of [...EMBED_HIDDEN_FILE_COMMAND_IDS, ...EMBED_HIDDEN_EDIT_COMMAND_IDS]) {';
 if(!main.includes(filter)||!main.includes(prune))throw Error('Unsupported embedded print commands');
 main=main.replace(filter,"? fileCommands.filter((cmd) => !EMBED_HIDDEN_FILE_COMMAND_IDS.includes(cmd.id) || ((window as any).__PWH_DESKTOP__ === true && cmd.id === 'file:print')) /* pwh desktop print command */");
 main=main.replace(prune,prune+"\n    if ((window as any).__PWH_DESKTOP__ === true && id === 'file:print') continue;");
 main+="\n// pwh desktop print dispatch\n(window as any).pwhDesktopPrint = (pages?: number[]) => dispatcher.dispatch('file:print', { pwhPages: pages });\n";
}
main=main.replace("(window as any).pwhDesktopPrint = () => dispatcher.dispatch('file:print');","(window as any).pwhDesktopPrint = (pages?: number[]) => dispatcher.dispatch('file:print', { pwhPages: pages });");
const printDispatch="(window as any).pwhDesktopPrint = (pages?: number[]) => dispatcher.dispatch('file:print', { pwhPages: pages });";
const directPrintDispatch="(window as any).pwhDesktopPrint = (pages?: number[], direct = false) => dispatcher.dispatch('file:print', { pwhPages: pages, pwhDirectPrint: direct });";
if(main.includes(printDispatch))main=main.replace(printDispatch,directPrintDispatch);
const nativePrintDispatch="(window as any).pwhDesktopPrint = (pages?: number[], direct = false, options?: any) => dispatcher.dispatch('file:print', { pwhPages: pages, pwhDirectPrint: direct, pwhPrintOptions: options });";
main=main.replace("options?: {printer: string, copies: number}","options?: any");
main=main.replace(directPrintDispatch,nativePrintDispatch);
if(!main.includes(nativePrintDispatch))throw Error('Unsupported desktop print dispatch');
const printCommandPath=path.join(studio,'src/command/commands/file.ts');
let printCommand=await fs.readFile(printCommandPath,'utf8');
if(!printCommand.includes('pwh selected print pages')){
 const signature="  onProgress: (currentPage: number, pageCount: number) => void,\n): Promise<PrintPage[]> {";
 const pages="  const pages = wasm.withPortableMetrics(() => Array.from({ length: wasm.pageCount }, (_, i) => ({";
 const preview='async function runPrintPreview(services: CommandServices): Promise<void> {';
 const invoke="    const printPages = await preparePrintPages(services, 'print', (current, total) => {";
 const tail="      if (surface) setPrintPreviewLoading(surface, progressText);\n    });";
 const command="    async execute(services) {\n      await runPrintPreview(services);\n    },";
 if(![signature,pages,preview,invoke,tail,command].every(x=>printCommand.includes(x)))throw Error('Unsupported print rendering');
 printCommand=printCommand.replace(signature,"  onProgress: (currentPage: number, pageCount: number) => void,\n  selectedPages?: number[], // pwh selected print pages\n): Promise<PrintPage[]> {");
 printCommand=printCommand.replace(pages,"  const indexes = selectedPages ?? Array.from({ length: wasm.pageCount }, (_, i) => i);\n  if (!indexes.length || indexes.some(i => !Number.isInteger(i) || i < 0 || i >= wasm.pageCount)) throw new Error('인쇄할 쪽 범위를 확인해 주세요.');\n  const pages = wasm.withPortableMetrics(() => indexes.map((i) => ({");
 printCommand=printCommand.replace(preview,"async function runPrintPreview(services: CommandServices, selectedPages?: number[]): Promise<void> {");
 printCommand=printCommand.replace(tail,"      if (surface) setPrintPreviewLoading(surface, progressText);\n    }, selectedPages);");
 printCommand=printCommand.replace(command,"    async execute(services, params) {\n      await runPrintPreview(services, params?.pwhPages as number[] | undefined);\n    },");
 await fs.writeFile(printCommandPath,printCommand);
}
if(!printCommand.includes('pwh direct print')&&!printCommand.includes('pwh native print')){
 const signature='async function runPrintPreview(services: CommandServices, selectedPages?: number[]): Promise<void> {';
 const command='await runPrintPreview(services, params?.pwhPages as number[] | undefined);';
 const ready='    keepPreviewOpen = true;\n\n    console.info(';
 if(![signature,command,ready].every(x=>printCommand.includes(x)))throw Error('Unsupported direct print rendering');
 printCommand=printCommand.replace(signature,'async function runPrintPreview(services: CommandServices, selectedPages?: number[], direct = false): Promise<void> {');
 printCommand=printCommand.replace(command,'await runPrintPreview(services, params?.pwhPages as number[] | undefined, params?.pwhDirectPrint === true);');
 printCommand=printCommand.replace(ready,`    keepPreviewOpen = true;
    if (direct) { // pwh direct print
      const readySurface = surface;
      readySurface.window.addEventListener('afterprint', () => readySurface.close(), { once: true });
      readySurface.window.focus();
      readySurface.window.print();
    }

    console.info(`);
 await fs.writeFile(printCommandPath,printCommand);
}
if(!printCommand.includes('pwh native print')){
 const signature='async function runPrintPreview(services: CommandServices, selectedPages?: number[], direct = false): Promise<void> {';
 const command='await runPrintPreview(services, params?.pwhPages as number[] | undefined, params?.pwhDirectPrint === true);';
 const surface='const surfacePromise = createPrintPreviewSurface();';
 const directBlock=`    if (direct) { // pwh direct print
      const readySurface = surface;
      readySurface.window.addEventListener('afterprint', () => readySurface.close(), { once: true });
      readySurface.window.focus();
      readySurface.window.print();
    }`;
 const errorLine="    const msg = err instanceof Error ? err.message : String(err);\n    console.error('[file:print]', msg);";
 if(![signature,command,surface,directBlock,errorLine].every(x=>printCommand.includes(x)))throw Error('Unsupported native print rendering');
 printCommand=printCommand.replace(signature,'async function runPrintPreview(services: CommandServices, selectedPages?: number[], direct = false, options?: {printer: string, copies: number}): Promise<void> {');
 printCommand=printCommand.replace(command,'await runPrintPreview(services, params?.pwhPages as number[] | undefined, params?.pwhDirectPrint === true, params?.pwhPrintOptions as {printer: string, copies: number} | undefined);');
 printCommand=printCommand.replace(surface,"const surfacePromise = createPrintPreviewSurface(direct ? { surfacePath: 'print.html?pwhDirect=1' } : undefined);");
 printCommand=printCommand.replace(directBlock,`    if (direct) { // pwh native print
      const readySurface = surface;
      const native = (readySurface.window as any).pwhNative;
      if (native) {
        if (!options) throw new Error('프린터와 인쇄 매수를 확인하세요.');
        try {
          const result = await native.printDocument(options);
          if (!result?.ok) throw new Error(result?.error || '인쇄를 시작하지 못했습니다.');
          window.dispatchEvent(new CustomEvent('pwh-print-result', { detail: { ok: true } }));
          readySurface.close();
        } catch (error) { keepPreviewOpen = false; throw error; }
      } else {
        readySurface.window.addEventListener('afterprint', () => readySurface.close(), { once: true });
        readySurface.window.focus();
        readySurface.window.print();
      }
    } else {
      const button = surface.document.getElementById('print-btn');
      if (button) button.hidden = true;
    }`);
 printCommand=printCommand.replace(errorLine,"    const msg = err instanceof Error ? err.message : String(err);\n    if (direct) window.dispatchEvent(new CustomEvent('pwh-print-result', { detail: { ok: false, message: msg } }));\n    console.error('[file:print]', msg);");
 await fs.writeFile(printCommandPath,printCommand);
}
// The native dialog owns printer, copies, range and per-job driver settings.
// Do not put a second Pwh print-configuration dialog in front of it.
printCommand=printCommand.replace("        if (!options) throw new Error('프린터와 인쇄 매수를 확인하세요.');\n",'');
printCommand=printCommand.replace('const result = await native.printDocument(options);','const result = await native.printDocument();');
if(!printCommand.includes('pwh native print cancellation')&&!printCommand.includes('pwh native print with integrated preview')){
 const result="          if (!result?.ok) throw new Error(result?.error || '인쇄를 시작하지 못했습니다.');";
 if(!printCommand.includes(result))throw Error('Unsupported native print result');
 printCommand=printCommand.replace(result,`          if (result?.cancelled) { // pwh native print cancellation
            window.dispatchEvent(new CustomEvent('pwh-print-result', { detail: { ok: false, cancelled: true } }));
            readySurface.close();
            return;
          }
${result}`);
}
printCommand=printCommand.replace('if (button) button.hidden = true;',"if (button) button.style.display = 'none';");
// Pwh owns one combined preview/settings window. Its Print button submits the
// already-previewed SVG sheets directly, without a second settings dialog.
await fs.copyFile(new URL('../src/print-plan.mjs',import.meta.url),path.join(studio,'src/print-plan.mjs'));
await fs.copyFile(new URL('../src/desktop-print-preview.mjs',import.meta.url),path.join(studio,'src/pwh-desktop-print-preview.mjs'));
if(!printCommand.includes("import {showPwhPrintPreview}"))printCommand="import {showPwhPrintPreview} from '@/pwh-desktop-print-preview.mjs';\n"+printCommand;
printCommand=printCommand.replaceAll('options?: {printer: string, copies: number}','options?: any').replaceAll('params?.pwhPrintOptions as {printer: string, copies: number} | undefined','params?.pwhPrintOptions as any');
const previewFunction=printCommand.indexOf('async function runPrintPreview('),previewBody=printCommand.indexOf('    if (direct) { // pwh ',previewFunction),previewTail=printCommand.indexOf('\n    console.info(',previewBody);
if(previewFunction<0||previewBody<0||previewTail<0)throw Error('Unsupported Pwh print preview boundary');
printCommand=printCommand.slice(0,previewBody)+`    if (direct) { // pwh native print with integrated preview
      const readySurface = surface;
      const native = (readySurface.window as any).pwhNative;
      if (native?.getPrinters) {
        const result = await showPwhPrintPreview(readySurface.window, { ...options, printPages: printPages.map(page => ({ widthMm: page.widthMm, heightMm: page.heightMm })) });
        window.dispatchEvent(new CustomEvent('pwh-print-result', { detail: result }));
        readySurface.close();
      } else {
        readySurface.window.addEventListener('afterprint', () => readySurface.close(), { once: true });
        readySurface.window.focus();
        readySurface.window.print();
      }
    } else {
      const button = surface.document.getElementById('print-btn');
      if (button) button.style.display = 'none';
    }
`+printCommand.slice(previewTail);
await fs.writeFile(printCommandPath,printCommand);
if(!main.includes('pwh selection layout invalidation'))main+=`\n// pwh selection layout invalidation\nfor(const event of ['document-mutated','document-changed','document-page-invalidated','document-view-changed','local-fonts-changed'])eventBus.on(event,()=>wasm.invalidatePwhSelectionLayout());\n`;
main=main.replace("'document-changed','page-invalidated','document-view-changed'","'document-changed','document-page-invalidated','document-view-changed'");
if(!main.includes('pwh propagate host document initialization failure'))main=main.replace("console.error('[initDoc] 오류:', error);","console.error('[initDoc] 오류:', error);\n    // pwh propagate host document initialization failure\n    if(options.suppressDialogs)throw error;");
main=main.replace("const { CanvasKitLayerRenderer } = await import('@/view/canvaskit-renderer');","const CanvasKitLayerRenderer={create(){throw new Error('This client uses the Canvas2D editor backend')}};");
main=main.replace('resolveChromeModeRequest(window.location.search)',"resolveChromeModeRequest('?chrome=embed')");
main=main.replace('maybeShowSkinOnboarding();','/* host owns startup */');
if(!main.includes('installInlineEditor'))main+=`\nimport {installInlineEditor} from './pwh-inline-adapter';\ninstallInlineEditor({registry,ready:initPromise, getInputHandler:()=>inputHandler,wasm,getDocumentAgent:()=>documentAgent,getCanvasView:()=>canvasView,load:(bytes,name)=>loadBytes(bytes,name,null,undefined,{suppressDialogs:true}),saved:completeHostSave,recovered:()=>documentState.markDirty('pwh-recovered'),legacyDrafts:listAutosaveDrafts});\n`;
main=main.replace('saved:completeHostSave});',"saved:completeHostSave,recovered:()=>documentState.markDirty('pwh-recovered'),legacyDrafts:listAutosaveDrafts});");
main=main.replace('installInlineEditor({ready:initPromise','installInlineEditor({registry,ready:initPromise');
await fs.writeFile(path.join(studio,'src/main.ts'),main);
main=main.replace("recovered:()=>documentState.markDirty('pwh-recovered')});","recovered:()=>documentState.markDirty('pwh-recovered'),legacyDrafts:listAutosaveDrafts});");
await fs.writeFile(path.join(studio,'src/main.ts'),main);
const menuPath=path.join(studio,'src/ui/context-menu.ts');
let menu=await fs.readFile(menuPath,'utf8');
if(!menu.includes("commandId:'pwh:ai-rewrite-request'"))menu=menu.replace('    this.hide();',"    items=[{type:'command',commandId:'pwh:ai-rewrite-request',label:'AI 수정 요청'},{type:'separator'},...items];\n    this.hide();");
await fs.writeFile(menuPath,menu);
const localFontsPath=path.join(studio,'src/core/local-fonts.ts');
let localFonts=await fs.readFile(localFontsPath,'utf8');
if(!localFonts.includes('pwh host fonts in menu'))localFonts=localFonts.replace('export function getLocalFontRecords(options: GetLocalFontsOptions = {}): LocalFontRecord[] {',`export function getLocalFontRecords(options: GetLocalFontsOptions = {}): LocalFontRecord[] {
  // pwh host fonts in menu: system inventory and renderer share the same source.
  if (hostFontSource.active) return currentHostRecords().filter(record => options.includeRegistered || !record.aliases.some(name => REGISTERED_FONTS.has(name)));`);
await fs.writeFile(localFontsPath,localFonts);
const wasmPath=path.join(studio,'src/core/wasm-bridge.ts');
let wasm=await fs.readFile(wasmPath,'utf8');
if(!wasm.includes('pwh source font preparation')){
 const start='      const records = this.withPortableMetrics(() => {',end='      await this.hostCanvasFonts.prepare(records);';
 const first=wasm.indexOf(start),last=wasm.indexOf(end,first);
 if(first<0||last<0)throw Error('Unsupported host font preparation');
 const original=wasm.slice(first,last).replace('      const records = ','');
 wasm=wasm.slice(0,first)+`      // pwh source font preparation: no page render scan on ordinary edits.
      const records = documentFontRequests(this.getDocumentInfo(), resolveRendererLocalFont, localFontFaceKey) ?? ${original.trimEnd().replace(/;$/,'')};
`+wasm.slice(last);
 wasm='import {documentFontRequests} from '+JSON.stringify('./pwh-document-font-requests.mjs')+';\n'+wasm;
 // resolveRendererLocalFont is the same family/weight/slant resolver used by
 // collectHostFontRequests; use the normal import rather than another font map.
 if(!/import\s*\{[^}]*\bresolveRendererLocalFont\b[^}]*\}\s*from\s*['\"]\.\/local-fonts/.test(wasm)){
  const imported=wasm.match(/import\s*\{[^}]*\blocalFontFaceKey\b[^}]*\}\s*from\s*['\"]\.\/local-fonts[^\r\n]*/);
  if(!imported)throw Error('Unsupported host font resolver import');
  wasm=wasm.replace(imported[0],imported[0].replace('{','{ resolveRendererLocalFont,'));
 }
}
if(!/import\s*\{[^}]*\brenderedBodySelectionRects\b/.test(wasm))wasm='import {renderedBodySelectionRects} from '+JSON.stringify('./pwh-selection-layout.mjs')+';\n'+wasm;
if(wasm.includes('import {renderedBodySelectionRects,createBodySelectionLayoutCache}'))wasm=wasm.replace(/^import\s+\{renderedBodySelectionRects\}\s+from[^\r\n]+\r?\n/gm,'');
wasm=wasm.replace('return JSON.parse(this.doc.getSelectionRects(sec, startPara, startOffset, endPara, endOffset));','return renderedBodySelectionRects(this.doc,sec,startPara,startOffset,endPara,endOffset,JSON.parse(this.doc.getSelectionRects(sec,startPara,startOffset,endPara,endOffset)));');
if(!wasm.includes('return renderedBodySelectionRects(this.doc,'))throw new Error('Unsupported Studio selection bridge: review upstream getSelectionRects');
if(!wasm.includes('pwh gesture scoped selection layout cache')){
 wasm=wasm.replace('import {renderedBodySelectionRects}', 'import {renderedBodySelectionRects,createBodySelectionLayoutCache}');
 wasm=`// pwh gesture scoped selection layout cache\n`+wasm;
 const moduleAnchor='export class WasmBridge {';
 if(!wasm.includes(moduleAnchor))throw Error('Unsupported WasmBridge selection cache owner');
 wasm=wasm.replace(moduleAnchor,`const pwhBodySelectionCache=createBodySelectionLayoutCache();
if(typeof window!=='undefined'){
 window.addEventListener('pointerdown',()=>pwhBodySelectionCache.begin(),{capture:true});
 for(const event of ['pointerup','pointercancel','blur'])window.addEventListener(event,()=>pwhBodySelectionCache.end(),{capture:true});
 for(const event of ['keydown','beforeinput'])window.addEventListener(event,()=>pwhBodySelectionCache.invalidate(),{capture:true});
}
export class WasmBridge {
  invalidatePwhSelectionLayout():void {pwhBodySelectionCache.invalidate();}`);
 wasm=wasm.replace('  invalidateCanvasMetrics(): void {','  invalidateCanvasMetrics(): void {\n    pwhBodySelectionCache.invalidate();');
 wasm=wasm.replace('JSON.parse(this.doc.getSelectionRects(sec,startPara,startOffset,endPara,endOffset)));','JSON.parse(this.doc.getSelectionRects(sec,startPara,startOffset,endPara,endOffset)),pwhBodySelectionCache);');
}
if(!wasm.includes('pwh scratch paragraph operations')){
 const anchor='export class WasmBridge {';if(!wasm.includes(anchor))throw Error('Unsupported Studio paragraph bridge');
 wasm=wasm.replace(anchor,`${anchor}
  // pwh scratch paragraph operations: append and remove without splitting existing anchors.
  insertPwhScratchParagraph(sec:number,index:number):string {if(!this.doc)throw new Error('문서가 로드되지 않았습니다');return this.doc.insertParagraph(sec,index);}
  deletePwhScratchParagraph(sec:number,index:number):string {if(!this.doc)throw new Error('문서가 로드되지 않았습니다');return this.doc.deleteParagraph(sec,index);}`);
}

wasm=wasm.replace('await init() as',"await init({module_or_path:await (window as any).pwhWasmBytes}) as");
await fs.writeFile(wasmPath,wasm);
const glue=path.join(root,'pkg/rhwp.js');
await fs.writeFile(glue,(await fs.readFile(glue,'utf8')).replace("new URL('rhwp_bg.wasm', import.meta.url)","(()=>{throw new Error('Host WASM bytes required')})()"));
const {build}=await import(pathToFileURL(path.join(studio,'node_modules/vite/dist/node/index.js')));
await build({configFile:false,root:studio,publicDir:false,define:{__APP_VERSION__:JSON.stringify('0.8.7'),__RHWP_DISABLE_EXTERNAL_WEBFONTS__:'true',__RHWP_HWPCTRL__:'false'},resolve:{alias:{'@':path.join(studio,'src'),'@wasm':path.join(root,'pkg')}},build:{outDir:path.join(root,'inline-dist'),target:'es2022',modulePreload:false,cssCodeSplit:false,lib:{entry:path.join(studio,'src/main.ts'),formats:['es'],fileName:()=> 'editor.js'},rollupOptions:{output:{inlineDynamicImports:true}}}});
const cssPath=path.join(root,'inline-dist/rhwp-studio.css');
let css=await fs.readFile(cssPath,'utf8');
for(const name of ['icon_small_ko.svg','icon_small_ko_dark.svg']){
 const bytes=await fs.readFile(path.join(studio,'public/images',name));
 css=css.replaceAll(`/images/${name}`,`data:image/svg+xml;base64,${bytes.toString('base64')}`);
}
if(css.includes('/images/icon_small_ko'))throw new Error('Editor icon sprites must be embedded');
await fs.writeFile(cssPath,css);
const html=await fs.readFile(path.join(studio,'index.html'),'utf8');
await fs.writeFile(path.join(root,'inline-dist/editor-body.html'),html.slice(html.indexOf('<body>')+6,html.lastIndexOf('</body>')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
console.log('Inline Studio build ready');
