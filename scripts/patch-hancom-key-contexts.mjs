import fs from 'node:fs/promises';
import path from 'node:path';

export async function patchHancomKeyContexts(studio) {
  async function edit(relative, replacements) {
    const file = path.join(studio, 'src', relative);
    const marker = '// Pwh Hancom key contexts';
    let source = (await fs.readFile(file, 'utf8')).replaceAll('\r\n', '\n');
    if (source.split('\n').includes(marker)) return;
    for (const [before, after] of replacements) {
      if (source.split(before).length !== 2) {
        throw Error('Unsupported Hancom keyboard context: ' + relative + ' ' + before.slice(0, 60));
      }
      source = source.replace(before, () => after);
    }
    await fs.writeFile(file, marker + '\n' + source);
  }

  await edit('command/shortcut-map.ts', [
    ["  [{ key: 'p', ctrl: true }, 'file:print'],",
     "  [{ key: 'p', ctrl: true }, 'file:print'],\n" +
     "  [{ key: 'p', code: 'KeyP', alt: true, platform: 'other' }, 'file:print'],"],
    ["  [{ key: 'y', ctrl: true }, 'edit:redo'],",
     "  [{ key: 'y', ctrl: true, platform: 'mac' }, 'edit:redo'],"],
    ["  [{ key: 'c', alt: true, shift: true }, 'format:align-center'],  // 가운데 정렬 (재매핑)\n" +
     "  [{ key: 'ㅊ', alt: true, shift: true }, 'format:align-center'],",
     "  [{ key: 'c', code: 'KeyC', alt: true, shift: true, platform: 'other' }, 'format:normal-char-shape'],\n" +
     "  [{ key: 'c', code: 'KeyC', alt: true, shift: true, platform: 'mac' }, 'format:align-center'],"],
    ["  [{ key: '0', ctrl: true }, 'view:zoom-100'],",
     "  [{ key: '0', ctrl: true }, 'view:zoom-100'],\n" +
     "  [{ key: 'numpadadd', code: 'NumpadAdd', shift: true, platform: 'other' }, 'view:zoom-in'],\n" +
     "  [{ key: 'numpadsubtract', code: 'NumpadSubtract', shift: true, platform: 'other' }, 'view:zoom-out'],"],
  ]);

  await edit('command/commands/format.ts', [
    ...[
      ['Center', 'Alt+Shift+C', 'Ctrl+Shift+C'],
      ['Right', 'Alt+Shift+H', 'Ctrl+Shift+R'],
      ['Distribute', 'Alt+Shift+D', 'Ctrl+Shift+T'],
    ].map(([name, before, after]) => [
      "    label: t('command.format.align" + name + ".label'),\n    shortcutLabel: '" + before + "',",
      "    label: t('command.format.align" + name + ".label'),\n    shortcutLabel: '" + after + "',",
    ]),
    ["  {\n    id: 'format:bold',",
     "  {\n    id: 'format:normal-char-shape',\n    label: '보통 모양',\n    shortcutLabel: 'Alt+Shift+C',\n" +
     "    canExecute: (ctx) => ctx.hasDocument && !ctx.isFormMode,\n" +
     "    execute(services) {\n" +
     "      services.eventBus.emit('format-char', {\n" +
     "        bold: false, italic: false, underline: false, underlineType: 'None',\n" +
     "        strikethrough: false, emboss: false, engrave: false, outlineType: 0,\n" +
     "        shadowType: 0, subscript: false, superscript: false,\n" +
     "      });\n" +
     "    },\n  },\n  {\n    id: 'format:bold',"],
  ]);

  await edit('command/commands/table.ts', [
    ["    id: 'table:border-each',",
     "    id: 'table:background-each',\n" +
     "    opensDialog: true,\n    label: '각 셀 배경',\n" +
     "    canExecute: inTableOrCellSelection,\n" +
     "    execute(services) { openEachCellBorder(services, 'background'); },\n" +
     "  },\n  {\n    id: 'table:border-each',"],
    ["      const ih = services.getInputHandler();\n" +
     "      if (!ih) return;\n" +
     "      const pos = ih.getCursorPosition();\n" +
     "      if (pos.parentParaIndex === undefined || pos.controlIndex === undefined || pos.cellIndex === undefined) return;\n" +
     "      const tableCtx = { sec: pos.sectionIndex, ppi: pos.parentParaIndex, ci: pos.controlIndex };\n" +
     "      const selectionRange = ih.isInCellSelectionMode?.() ? ih.getSelectedCellRange?.() ?? null : null;\n" +
     "      const dialog = new CellBorderBgDialog(\n" +
     "        services.wasm,\n        services.eventBus,\n        tableCtx,\n        pos.cellIndex,\n" +
     "        'each',\n        selectionRange,\n        services,\n      );\n      dialog.show();",
     "      openEachCellBorder(services, 'border');"],
    ["function openCombinedCellBorder(",
     "function openEachCellBorder(services: CommandServices, tab: 'border' | 'background'): void {\n" +
     "  const input = services.getInputHandler();\n" +
     "  if (!input || input.hasExcludedCellSelection()) return;\n" +
     "  const position = input.getCursorPosition();\n" +
     "  const { sectionIndex, parentParaIndex, controlIndex, cellIndex, cellPath } = position;\n" +
     "  if (parentParaIndex === undefined || controlIndex === undefined || cellIndex === undefined ||\n" +
     "      (cellPath?.length ?? 0) > 1) return;\n" +
     "  const table = { sec: sectionIndex, ppi: parentParaIndex, ci: controlIndex };\n" +
     "  const range = input.getSelectedCellRange();\n" +
     "  new CellBorderBgDialog(services.wasm, services.eventBus, table, cellIndex, 'each', range, services).show(tab);\n" +
     "}\n\nfunction openCombinedCellBorder("],
    ["      return { ...pos, charOffset: 0, ...corrected };",
     "      const cellPath = pos.cellPath?.map(entry => ({ ...entry, ...corrected }));\n" +
     "      return { ...pos, ...corrected, cellPath, paragraphIndex: 0, charOffset: 0 };"],
    ["    id: 'table:delete-row',\n" +
     "    label: t('command.table.deleteRow.registryLabel'),\n" +
     "    canExecute: inTable,\n" +
     "    execute(services) {\n" +
     "      const ih = services.getInputHandler();\n" +
     "      if (!ih) return;\n" +
     "      const pos = ih.getCursorPosition();\n" +
     "      if (pos.parentParaIndex === undefined || pos.controlIndex === undefined || pos.cellIndex === undefined) return;\n" +
     "      const cellInfo = services.wasm.getCellInfo(pos.sectionIndex, pos.parentParaIndex, pos.controlIndex, pos.cellIndex);\n" +
     "      safeTableOp(() => ih.executeOperation({\n" +
     "        kind: 'snapshot',\n" +
     "        operationType: 'deleteTableRow',\n" +
     "        operation: (wasm) => {\n" +
     "          wasm.deleteTableRow(pos.sectionIndex, pos.parentParaIndex!, pos.controlIndex!, cellInfo.row);\n" +
     "          return pos;\n" +
     "        },\n" +
     "      }), '줄 지우기');\n" +
     "    },",
     "    id: 'table:delete-row',\n" +
     "    label: t('command.table.deleteRow.registryLabel'),\n" +
     "    shortcutLabel: 'Ctrl+Backspace',\n" +
     "    canExecute: (ctx) => ctx.inTable && !ctx.isFormMode,\n" +
     "    execute(services) {\n" +
     "      const position = services.getInputHandler()?.getCursorPosition();\n" +
     "      if (!position || (position.cellPath?.length ?? 0) > 1) return;\n" +
     "      applyTableDeleteRowColumn(services, 'row');\n" +
     "    },"],
  ]);

  await edit('command/contextual-shortcut.ts', [
    ["      || event.key === 'ㅣ' || event.key === 'ㅊ' || event.key === 'ㅅ'",
     "      || ['ㅣ', 'ㅊ', 'ㅅ', 'ㅔ', 'ㅈ', 'ㅗ', 'ㅠ', 'ㄹ'].includes(event.key)"],
    ["| 'table:cell-props' | 'table:border-each' }",
     "| 'table:cell-props' | 'table:border-each' | 'table:background-each' }"],
    ["  if (key === 'c' || event.key === 'ㅊ' || code === 'keyc') return { kind: 'dispatch', commandId: 'table:cell-props' };",
     "  if (key === 'p' || event.key === 'ㅔ' || code === 'keyp') return { kind: 'dispatch', commandId: 'table:cell-props' };\n" +
     "  if (key === 'c' || event.key === 'ㅊ' || code === 'keyc') return { kind: 'dispatch', commandId: 'table:background-each' };"],
  ]);

  await edit('engine/cursor.ts', [
    ["  /** 셀 선택을 화살표 방향으로 이동한다 (anchor/focus 함께 이동, 단일 셀 선택). */",
     "  /** Move between cells while leaving the caret in text editing mode. */\n" +
     "  moveBetweenCells(rowDelta: number, colDelta: number): void {\n" +
     "    if (!this.enterCellSelectionMode()) return;\n" +
     "    try {\n" +
     "      this.clearSelection();\n" +
     "      this.moveCellSelection(rowDelta, colDelta);\n" +
     "    } finally {\n" +
     "      this.exitCellSelectionMode();\n" +
     "    }\n" +
     "  }\n\n" +
     "  /** Leave the innermost table and keep its containing paragraph active. */\n" +
     "  leaveTableEditing(): void {\n" +
     "    const { sectionIndex, parentParaIndex, controlIndex, cellPath } = this.position;\n" +
     "    if (parentParaIndex === undefined || controlIndex === undefined) return;\n" +
     "    const enclosingPath = cellPath?.slice(0, -1);\n" +
     "    const enclosingCell = enclosingPath?.at(-1);\n" +
     "    this.clearSelection();\n" +
     "    this.exitCellSelectionMode();\n" +
     "    if (enclosingCell) {\n" +
     "      const charOffset = this.wasm.getCellParagraphLengthByPath(sectionIndex, parentParaIndex, JSON.stringify(enclosingPath));\n" +
     "      this.moveTo({ sectionIndex, parentParaIndex, paragraphIndex: enclosingCell.cellParaIndex,\n" +
     "        ...enclosingCell, charOffset, cellPath: enclosingPath });\n" +
     "    } else if (parentParaIndex + 1 < this.wasm.getParagraphCount(sectionIndex)) {\n" +
     "      this.moveTo({ sectionIndex, paragraphIndex: parentParaIndex + 1, charOffset: 0 });\n" +
     "    } else {\n" +
     "      const charOffset = this.wasm.getParagraphLength(sectionIndex, parentParaIndex);\n" +
     "      this.moveTo({ sectionIndex, paragraphIndex: parentParaIndex, charOffset });\n" +
     "    }\n" +
     "  }\n\n" +
     "  /** 셀 선택을 화살표 방향으로 이동한다 (anchor/focus 함께 이동, 단일 셀 선택). */"],
  ]);

  await edit('engine/table-resize-updates.ts', [
    ["export function buildColumnResizeUpdates(",
     "export function buildFixedTableResizeUpdates(\n" +
     "  cells: CellGridEntry[], range: CellSelectionRange, key: ResizeArrowKey,\n" +
     "  getSize: (cellIdx: number, axis: 'width' | 'height') => number | undefined,\n" +
     "): LocalResizeUpdate[] {\n" +
     "  const { isHoriz, delta } = resizeAxis(key);\n" +
     "  const boundary = isHoriz ? range.endCol : range.endRow;\n" +
     "  const axis = isHoriz ? 'width' : 'height';\n" +
     "  const affected = collectUniqueCells(cells).flatMap(cell => {\n" +
     "    const direction = overlapCount(cell, isHoriz, boundary, boundary) -\n" +
     "      overlapCount(cell, isHoriz, boundary + 1, boundary + 1);\n" +
     "    return direction ? [{ cellIdx: cell.cellIdx, direction }] : [];\n" +
     "  });\n" +
     "  if (!affected.some(cell => cell.direction === 1) || !affected.some(cell => cell.direction === -1)) return [];\n" +
     "  let step = Math.abs(delta);\n" +
     "  for (const { cellIdx, direction } of affected) {\n" +
     "    if (delta * direction > 0) continue;\n" +
     "    const size = getSize(cellIdx, axis);\n" +
     "    if (size === undefined || !Number.isFinite(size)) return [];\n" +
     "    step = Math.min(step, size - 200); // Match the WASM minimum in HWPUNIT.\n" +
     "  }\n" +
     "  if (step <= 0) return [];\n" +
     "  return affected.map(({ cellIdx, direction }) => ({\n" +
     "    cellIdx, [axis + 'Delta']: Math.sign(delta) * step * direction,\n" +
     "  }));\n" +
     "}\n\n" +
     "export function buildColumnResizeUpdates("],
  ]);
  await edit('engine/input-handler-table.ts', [
    ["  buildColumnResizeUpdates,",
     "  buildColumnResizeUpdates,\n  buildFixedTableResizeUpdates,"],
    ["  build: (bboxes: CellGridEntry[], range: CellSelectionRange, key: ResizeArrowKey) => LocalResizeUpdate[],",
     "  build: (bboxes: CellGridEntry[], range: CellSelectionRange, key: ResizeArrowKey,\n" +
     "    getSize: (cellIdx: number, axis: 'width' | 'height') => number | undefined) => LocalResizeUpdate[],"],
    ["  const updates = build(bboxes, range, key);\n  if (updates.length === 0) return;\n\n  try {",
     "  try {\n" +
     "    const updates = build(bboxes, range, key, (cellIdx, axis) => {\n" +
     "      const cell = nestedPathJson ? this.wasm.getCellPropertiesByPath(ctx.sec, ctx.ppi, nestedPathJson, cellIdx)\n" +
     "        : this.wasm.getCellProperties(ctx.sec, ctx.ppi, ctx.ci, cellIdx);\n" +
     "      return cell[axis];\n" +
     "    });\n" +
     "    if (updates.length === 0) return;"],
    ["export function resizeCellByKeyboard(this: any, key: ResizeArrowKey): void {\n" +
     "  applyKeyboardResize.call(this, key, 'resizeCellByKeyboard', buildColumnResizeUpdates);",
     "export function resizeCellByKeyboard(this: any, key: ResizeArrowKey, fixedTableSize = false): void {\n" +
     "  if (this.cursor.isProtectedCellSelectionMode() || (fixedTableSize && this.cursor.getExcludedCells().size)) return;\n" +
     "  applyKeyboardResize.call(this, key, 'resizeCellByKeyboard',\n" +
     "    fixedTableSize ? buildFixedTableResizeUpdates : buildColumnResizeUpdates);"],
  ]);
  await edit('engine/input-handler.ts', [
    ["resizeCellByKeyboard(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {\n" +
     "    _table.resizeCellByKeyboard.call(this, key);",
     "resizeCellByKeyboard(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', fixedTableSize = false): void {\n" +
     "    _table.resizeCellByKeyboard.call(this, key, fixedTableSize);"],
  ]);

  await edit('core/wasm-bridge.ts', [
    ["  deletePwhScratchParagraph(sec:number,index:number):string {if(!this.doc)throw new Error('문서가 로드되지 않았습니다');return this.doc.deleteParagraph(sec,index);}",
     "  deleteBodyParagraph(sec: number, index: number): string {\n" +
     "    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');\n" +
     "    return this.doc.deleteParagraph(sec, index);\n" +
     "  }\n" +
     "  deletePwhScratchParagraph(sec: number, index: number): string { return this.deleteBodyParagraph(sec, index); }"],
  ]);

  await edit('engine/input-handler-keyboard.ts', [
    ["const CELL_BLOCK_GLOBAL_COMMANDS = new Set([\n  'edit:undo',\n  'edit:redo',",
     "const CELL_BLOCK_GLOBAL_COMMANDS = new Set([\n  'edit:undo',\n  'edit:redo',\n" +
     "  'format:normal-char-shape', 'format:bold', 'format:italic', 'format:underline',\n" +
     "  'format:superscript', 'format:subscript', 'format:char-shape', 'format:para-shape', 'format:style-dialog',"],
    ["  // ─── 셀 선택 모드 중 키 처리 ────────────────────────────",
     "  if (detectPlatformKind() === 'other' && !e.metaKey && !e.altKey && !e.shiftKey &&\n" +
     "      e.ctrlKey && e.key === 'Backspace' && this.cursor.isInCell() && !this.cursor.isInTextBox()) {\n" +
     "    e.preventDefault();\n" +
     "    if (e.repeat || this.cursor.isProtectedCellSelectionMode() || this.isFormMode?.()) return;\n" +
     "    const position = this.cursor.getPosition();\n" +
     "    if ((position.cellPath?.length ?? 0) <= 1) this.dispatcher?.dispatch('table:delete-row');\n" +
     "    return;\n" +
     "  }\n\n" +
     "  if (e.key === 'Escape' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&\n" +
     "      this.cursor.isInCell() && !this.cursor.isInTableObjectSelection() &&\n" +
     "      (!this.cursor.isInTextBox() || this.cursor.nestingDepth() > 1)) {\n" +
     "    e.preventDefault();\n" +
     "    if (this.cursor.isProtectedCellSelectionMode()) return;\n" +
     "    this.cursor.leaveTableEditing();\n" +
     "    this.cellSelectionRenderer?.clear();\n" +
     "    this.updateCaret();\n" +
     "    return;\n" +
     "  }\n\n" +
     "  // ─── 셀 선택 모드 중 키 처리 ────────────────────────────"],
    ["    const cellArrowAction = getCellSelectionArrowAction(e);",
     "    const cellArrowAction = getCellSelectionArrowAction(e);\n" +
     "    if (cellArrowAction && detectPlatformKind() === 'other' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {\n" +
     "      e.preventDefault();\n" +
     "      this.resizeCellByKeyboard(e.key, true);\n" +
     "      return;\n" +
     "    }"],
    ["  if (handleNavigationShortcut.call(this, e)) return;",
     "  if (detectPlatformKind() === 'other' && !e.metaKey && !e.ctrlKey && !e.shiftKey &&\n" +
     "      e.altKey && this.cursor.isInCell() && !this.cursor.isInTextBox() &&\n" +
     "      (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {\n" +
     "    e.preventDefault();\n" +
     "    this.cursor.moveBetweenCells(e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0,\n" +
     "      e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0);\n" +
     "    this.updateCaret();\n" +
     "    return;\n" +
     "  }\n" +
     "  if (handleNavigationShortcut.call(this, e)) return;"],
    ["  // Alt 조합 단축키 처리",
     "  if (detectPlatformKind() === 'other' && e.altKey && !e.shiftKey &&\n" +
     "      (e.code === 'KeyY' || e.key.toLowerCase() === 'y')) {\n" +
     "    e.preventDefault();\n" +
     "    deleteVisualLine.call(this, false);\n" +
     "    return;\n" +
     "  }\n\n" +
     "  // Alt 조합 단축키 처리"],
    ["export function handleCtrlKey(this: any, e: KeyboardEvent): void {",
     "function deleteVisualLine(this: any, entireLine: boolean): void {\n" +
     "  if (this.isFormMode?.() || (this.cursor.getPosition().cellPath?.length ?? 0) > 1) return;\n" +
     "  this.cursor.clearSelection();\n" +
     "  if (entireLine) this.cursor.moveToLineStart();\n" +
     "  const start: DocumentPosition = this.cursor.getPosition();\n" +
     "  this.cursor.setAnchor();\n" +
     "  this.cursor.moveToLineEnd();\n" +
     "  const end: DocumentPosition = this.cursor.getPosition();\n" +
     "  if (entireLine && start.charOffset === 0 && start.parentParaIndex === undefined) {\n" +
     "    const { sectionIndex, paragraphIndex } = start;\n" +
     "    if (end.charOffset === this.wasm.getParagraphLength(sectionIndex, paragraphIndex) &&\n" +
     "        paragraphIndex + 1 < this.wasm.getParagraphCount(sectionIndex)) {\n" +
     "      if (this.wasm.getControlTextPositions(sectionIndex, paragraphIndex).length === 0) {\n" +
     "        this.cursor.clearSelection();\n" +
     "        this.executeOperation({ kind: 'snapshot', operationType: 'deleteVisualLine',\n" +
     "          operation: (wasm: WasmBridge) => {\n" +
     "            wasm.deleteBodyParagraph(sectionIndex, paragraphIndex);\n" +
     "            return { sectionIndex, paragraphIndex, charOffset: 0 };\n" +
     "          } });\n" +
     "      } else {\n" +
     "        this.cursor.moveTo({ sectionIndex, paragraphIndex: paragraphIndex + 1, charOffset: 0 });\n" +
     "        this.deleteSelection();\n" +
     "      }\n" +
     "      return;\n" +
     "    }\n" +
     "  }\n" +
     "  if (end.charOffset > start.charOffset) this.deleteSelection();\n" +
     "  else {\n" +
     "    this.cursor.clearSelection();\n" +
     "    this.updateCaret();\n" +
     "  }\n" +
     "}\n\n" +
     "export function handleCtrlKey(this: any, e: KeyboardEvent): void {\n" +
     "  if (detectPlatformKind() === 'other' && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey &&\n" +
     "      (e.code === 'KeyY' || e.key.toLowerCase() === 'y')) {\n" +
     "    e.preventDefault();\n" +
     "    deleteVisualLine.call(this, true);\n" +
     "    return;\n" +
     "  }"],
    ["  switch (e.key.toLowerCase()) {\n    case 'backspace': {",
     "  const key = e.code === 'KeyT' ? 't' : e.key.toLowerCase();\n" +
     "  switch (key) {\n    case 'backspace': {"],
    ["    case 'delete': {\n      if (!e.ctrlKey) break;",
     "    case 't':\n    case 'delete': {\n" +
     "      if (!e.ctrlKey || (key === 't' &&\n" +
     "          (detectPlatformKind() === 'mac' || e.metaKey || e.shiftKey || e.altKey))) break;"],
    ["    case 'home': {\n      e.preventDefault();",
     "    case 'pageup':\n    case 'home': {\n" +
     "      if (key === 'pageup' && (detectPlatformKind() === 'mac' || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) break;\n" +
     "      e.preventDefault();"],
    ["    case 'end': {\n      e.preventDefault();",
     "    case 'pagedown':\n    case 'end': {\n" +
     "      if (key === 'pagedown' && (detectPlatformKind() === 'mac' || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) break;\n" +
     "      e.preventDefault();"],
    ["    if (e.key === 'Enter' && this.dispatcher?.isEnabled?.('table:insert-row-below')) {\n" +
     "      e.preventDefault();\n      this.dispatcher.dispatch('table:insert-row-below');",
     "    if (e.key === 'Enter' && this.dispatcher?.isEnabled?.('table:insert-row-below')) {\n" +
     "      e.preventDefault();\n" +
     "      if ((this.cursor.getPosition().cellPath?.length ?? 0) <= 1) this.dispatcher.dispatch('table:insert-row-below');"],
  ]);
}
