import fs from 'node:fs/promises';
import path from 'node:path';

export async function patchHancomKeyAliases(studio) {
  async function replace(relative, edits) {
    const file=path.join(studio,'src',relative);
    let source=(await fs.readFile(file,'utf8')).replace(/\r\n/g,'\n');
    const marker='// Pwh Hancom key aliases';
    if(source.split(/\r?\n/).includes(marker))return;
    for(const [oldText,newText] of edits){
      if(source.split(oldText).length!==2)throw Error('Unsupported shortcut source: '+relative+' '+oldText.slice(0,50));
      source=source.replace(oldText,()=>newText);
    }
    await fs.writeFile(file,marker+'\n'+source);
  }
  const aliases=[
    ['h',{ctrl:true},'edit:find-replace'],
    ['o',{alt:true},'file:open'],['s',{alt:true},'file:save'],
    ['b',{alt:true,shift:true},'format:bold'],['i',{alt:true,shift:true},'format:italic'],
    ['u',{alt:true,shift:true},'format:underline'],['p',{alt:true,shift:true},'format:superscript'],
    ['s',{alt:true,shift:true},'format:subscript'],
    ['r',{ctrl:true,shift:true},'format:align-right'],['c',{ctrl:true,shift:true},'format:align-center'],
    ['t',{ctrl:true,shift:true},'format:align-distribute'],
    ['w',{ctrl:true,shift:true},'format:line-spacing-increase'],
    ['q',{ctrl:true,shift:true},'format:line-spacing-decrease'],
    ['j',{ctrl:true},'page:break'],
    ['insert',{alt:true},'table:insert-row-col'],
    ['insert',{ctrl:true,shift:true},'format:toggle-numbering'],
    ['delete',{ctrl:true,shift:true},'format:toggle-bullet'],
    ['pageup',{shift:true},'insert:arrange-front'],['pagedown',{shift:true},'insert:arrange-back'],
  ];
  const entries=aliases.map(([key,modifiers,id])=>{
    const physical=key.length===1?{code:'Key'+key.toUpperCase()}:{};
    return '  ['+JSON.stringify({key,...physical,...modifiers})+', '+JSON.stringify(id)+'],';
  }).join('\n');
  await replace('engine/command.ts',[[
    '    wasm.applyCharFormatInCellByPath(pos.sectionIndex, pos.parentParaIndex!, cellPathJson(pos), from, to, propsJson);',
    '    wasm.applyCharFormatInCellByPath(pos.sectionIndex, pos.parentParaIndex!, JSON.stringify(cellAxisPath(pos)), from, to, propsJson);',
  ]]);
  await replace('command/shortcut-map.ts',[[
    "  [{ key: 'delete', alt: true }, 'table:delete-row-col'],",
    "  [{ key: 'delete', alt: true }, 'table:delete-row-col'],\n"+entries,
  ]]);

  const colors={
    k:['검정','#000000'],r:['빨강','#FF0000'],b:['파랑','#0000FF'],d:['자주','#800080'],
    g:['초록','#008000'],y:['노랑','#FFFF00'],c:['청록','#00FFFF'],w:['흰색','#FFFFFF'],
  };
  const koreanColors={k:'ㅏ',r:'ㄱ',b:'ㅠ',d:'ㅇ',g:'ㅎ',y:'ㅛ',c:'ㅊ',w:'ㅈ'};
  const colorChords=Object.keys(colors).flatMap(key=>[key,koreanColors[key]].map(letter=>
    '  '+JSON.stringify(letter)+': "format:quick-color-'+key+'",')).join('\n');
  const colorCommands=Object.entries(colors).map(([key,[label,textColor]])=>
    '  {id:"format:quick-color-'+key+'", label:'+JSON.stringify(label+' 글자색')+
    ', canExecute:ctx=>ctx.hasDocument && !ctx.isFormMode, execute(services){services.eventBus.emit("format-char", {textColor:'+
    JSON.stringify(textColor)+'});}},').join('\n');
  await replace('command/commands/format.ts',[[
    'export const formatCommands: CommandDef[] = [',
    'export const formatCommands: CommandDef[] = [\n'+colorCommands,
  ]]);
  await replace('command/contextual-shortcut.ts',[[
    "| 'table:cell-height-equal'",
    "| 'table:cell-height-equal' | 'table:border-one' | 'table:background-one'",
  ],[
    '  // pwh cell C and L shortcuts',
    '  if (key === "b" || key === "ㅠ" || code === "keyb") return {kind:"dispatch",commandId:"table:border-one"};\n'+
    '  if (key === "f" || key === "ㄹ" || code === "keyf") return {kind:"dispatch",commandId:"table:background-one"};\n'+
    '  // pwh cell C and L shortcuts',
  ]]);
  await replace('ui/cell-border-bg-dialog.ts',[[
    '  show(): void {\n    super.show();',
    '  show(initialTab: "border" | "background" = "border"): void {\n    super.show();',
  ],[
    '    installPwhBorderDialog(this);',
    '    installPwhBorderDialog(this);\n    if (initialTab === "background") this.switchTab(1);',
  ]]);
  await replace('command/commands/table.ts',[[
    "    id: 'table:border-one',",
    "    id: 'table:background-one',\n"+
    "    opensDialog: true,\n"+
    "    label: '여러 셀 배경',\n"+
    "    canExecute: hasMultiCellSelection,\n"+
    "    execute(services) { openCombinedCellBorder(services, 'background'); },\n"+
    "  },\n  {\n    id: 'table:border-one',",
  ],[
    "      const ih = services.getInputHandler();\n      if (!ih) return;\n      if (!ih.hasMultiCellSelection()) return;\n"+
    "      const pos = ih.getCursorPosition();\n      if (pos.parentParaIndex === undefined || pos.controlIndex === undefined || pos.cellIndex === undefined) return;\n"+
    "      const tableCtx = { sec: pos.sectionIndex, ppi: pos.parentParaIndex, ci: pos.controlIndex };\n"+
    "      const dialog = new CellBorderBgDialog(\n        services.wasm,\n        services.eventBus,\n        tableCtx,\n        pos.cellIndex,\n        'asOne',\n        ih.getSelectedCellRange(),\n        services,\n      );\n      dialog.show();",
    "      openCombinedCellBorder(services, 'border');",
  ],[
    'type CellRange =',
    'function openCombinedCellBorder(services: CommandServices, initialTab: "border" | "background"): void {\n'+
    '  const input = services.getInputHandler();\n'+
    '  if (!input?.hasMultiCellSelection() || input.hasExcludedCellSelection()) return;\n'+
    '  const pos = input.getCursorPosition();\n'+
    '  if (pos.parentParaIndex === undefined || pos.controlIndex === undefined || pos.cellIndex === undefined || (pos.cellPath?.length ?? 0) > 1) return;\n'+
    '  const table = {sec:pos.sectionIndex,ppi:pos.parentParaIndex,ci:pos.controlIndex};\n'+
    '  new CellBorderBgDialog(services.wasm,services.eventBus,table,pos.cellIndex,"asOne",input.getSelectedCellRange(),services).show(initialTab);\n'+
    '}\n\n'+
    'type CellRange =',
  ]]);
  await replace('command/commands/edit.ts',[[
    "    id: 'edit:find-again',",
    "    id: 'edit:find-previous',\n"+
    "    label: '거꾸로 찾기',\n"+
    "    shortcutLabel: 'Ctrl+Q,L',\n"+
    "    canExecute: (ctx) => ctx.hasDocument,\n"+
    "    execute(services) {\n"+
    "      if (findDialogInstance?.isOpen()) { findDialogInstance.findPrev(); return; }\n"+
    "      const ih = services.getInputHandler();\n"+
    "      if (!ih || !FindDialog.lastQuery) return;\n"+
    "      const pos = ih.getCursorPosition();\n"+
    "      const match = services.wasm.searchText(FindDialog.lastQuery, pos.sectionIndex, pos.paragraphIndex,\n"+
    "        pos.charOffset, false, FindDialog.lastCaseSensitive, true);\n"+
    "      navigateToSearchHit(ih, match);\n"+
    "    },\n"+
    "  },\n  {\n    id: 'edit:find-again',",
  ]]);
  await replace('engine/input-handler-keyboard.ts',[[
    '    // [#3682] 개체 선택 상태를 요구하는 커맨드',
    '    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {\n'+
    '      const key = e.code || e.key.toLowerCase();\n'+
    '      const grouping = key === "KeyG" || key === "g" ? "insert:group-shapes"\n'+
    '        : key === "KeyU" || key === "u" ? "insert:ungroup-shapes" : null;\n'+
    '      if (grouping && this.dispatcher?.isEnabled?.(grouping)) {\n'+
    '        e.preventDefault();\n'+
    '        this.dispatcher.dispatch(grouping);\n'+
    '        return;\n'+
    '      }\n'+
    '    }\n'+
    '    // [#3682] 개체 선택 상태를 요구하는 커맨드',
  ],[
    "const chordMapM: Record<string, string> = {",
    "const chordMapM: Record<string, string> = {\n  f: 'table:formula',\n  ㄹ: 'table:formula',\n"+colorChords,
  ],[
    "const chordMapG: Record<string, string> = {",
    "const chordMapG: Record<string, string> = {\n  b: 'view:border-transparent',\n  ㅠ: 'view:border-transparent',",
  ],[
    "      if (this.cursor.isInCellSelectionMode()) {\n        this.cursor.advanceCellSelectionPhase();",
    "      if (this.cursor.isInCellSelectionMode()) {\n"+
    "        if (!e.shiftKey || this.cursor.getCellSelectionPhase() === 1) this.cursor.advanceCellSelectionPhase();",
  ],[
    "        if (this.cursor.enterCellSelectionMode()) {\n          this.caret.hide();",
    "        if (this.cursor.enterCellSelectionMode()) {\n"+
    "          if (e.shiftKey && !this.cursor.isProtectedCellSelectionMode()) this.cursor.advanceCellSelectionPhase();\n"+
    "          this.caret.hide();",
  ],[
    "  if (e.key === 'F3') {\n    e.preventDefault();",
    "  if (e.key === 'F3') {\n    e.preventDefault();\n"+
    "    if (this.cursor.isInCellSelectionMode()) {\n"+
    "      if (this.cursor.getCellSelectionPhase() === 1) this.cursor.advanceCellSelectionPhase();\n"+
    "      this.updateCellSelection();\n"+
    "      return;\n"+
    "    }",
  ],[
    "    if (dispatchCellBlockGlobalShortcut.call(this, e)) return;",
    "    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'F7' || e.key === 'F8')) {\n"+
    "      e.preventDefault();\n"+
    "      const focus = this.cursor.getCellSelectionFocus();\n"+
    "      const table = this.cursor.getCellTableContext();\n"+
    "      if (!focus || !table || this.cursor.isProtectedCellSelectionMode()) return;\n"+
    "      const column = e.key === 'F7';\n"+
    "      this.cursor.setCellSelectionAnchor(column ? 0 : focus.row, column ? focus.col : 0);\n"+
    "      this.cursor.advanceCellSelectionPhase();\n"+
    "      this.cursor.setCellSelectionFocus(column ? table.rowCount - 1 : focus.row, column ? focus.col : table.colCount - 1);\n"+
    "      this.updateCellSelection();\n"+
    "      return;\n"+
    "    }\n"+
    "    if (dispatchCellBlockGlobalShortcut.call(this, e)) return;",
  ],[
    "  if (handleNavigationShortcut.call(this, e)) return;",
    "  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&\n"+
    "      this.cursor.isInCell() && !this.cursor.isInTextBox() && !this.isFormMode?.()) {\n"+
    "    if (e.key === 'Tab') {\n"+
    "      e.preventDefault();\n"+
    "      this.executeOperation({kind: 'command', command: new InsertTabCommand(this.cursor.getPosition())});\n"+
    "      return;\n"+
    "    }\n"+
    "    if (e.key === 'Enter' && this.dispatcher?.isEnabled?.('table:insert-row-below')) {\n"+
    "      e.preventDefault();\n"+
    "      this.dispatcher.dispatch('table:insert-row-below');\n"+
    "      return;\n"+
    "    }\n"+
    "  }\n"+
    "  if (handleNavigationShortcut.call(this, e)) return;",
  ]]);
}
