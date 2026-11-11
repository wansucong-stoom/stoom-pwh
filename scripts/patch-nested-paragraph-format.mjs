import fs from 'node:fs/promises';
import path from 'node:path';

// Selective upstream b96229c; apply after Pwh's command and format patches.
const changes = [
  {
    "file": "src/core/mutation-method-registry.ts",
    "edits": [
      [
        "  'setCharShapeIdInCell', 'setCharShapeIdInCellByPath',\n  'setCharShapeRuns', 'setCharShapeRunsInCellByPath',\n  'applyParaFormat', 'setParaShapeId', 'applyParaFormatInCell', 'setCellParaShapeId',\n  // 스타일/번호 정의 (DocInfo 변이 포함)\n  'updateStyle', 'updateStyleShapes', 'createStyle', 'deleteStyle', 'applyStyle',\n  'applyCellStyle', 'createNumbering', 'ensureDefaultNumbering', 'ensureDefaultBullet',\n",
        "  'setCharShapeIdInCell', 'setCharShapeIdInCellByPath',\n  'setCharShapeRuns', 'setCharShapeRunsInCellByPath',\n  'applyParaFormat', 'setParaShapeId', 'applyParaFormatInCell', 'setCellParaShapeId',\n  'applyParaFormatInCellByPath', 'setCellParaShapeIdByPath',\n  // 스타일/번호 정의 (DocInfo 변이 포함)\n  'updateStyle', 'updateStyleShapes', 'createStyle', 'deleteStyle', 'applyStyle',\n  'applyCellStyle', 'createNumbering', 'ensureDefaultNumbering', 'ensureDefaultBullet',\n"
      ]
    ]
  },
  {
    "file": "src/core/wasm-bridge.ts",
    "edits": [
      [
        "    return (this.doc as any).setNumberingRestart(sec, para, mode, startNum);\n  }\n\n  applyParaFormat(sec: number, para: number, propsJson: string): string {\n    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');\n    return this.doc.applyParaFormat(sec, para, propsJson);\n",
        "    return (this.doc as any).setNumberingRestart(sec, para, mode, startNum);\n  }\n\n  getCellParaPropertiesAtByPath(sec: number, parentPara: number, pathJson: string): ParaProperties {\n    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');\n    return JSON.parse(this.doc.getCellParaPropertiesAtByPath(sec, parentPara, pathJson));\n  }\n\n  applyParaFormatInCellByPath(sec: number, parentPara: number, pathJson: string, propsJson: string): string {\n    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');\n    return this.doc.applyParaFormatInCellByPath(sec, parentPara, pathJson, propsJson);\n  }\n\n  setCellParaShapeIdByPath(sec: number, parentPara: number, pathJson: string, paraShapeId: number): string {\n    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');\n    return this.doc.setCellParaShapeIdByPath(sec, parentPara, pathJson, paraShapeId);\n  }\n\n  applyParaFormat(sec: number, para: number, propsJson: string): string {\n    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');\n    return this.doc.applyParaFormat(sec, para, propsJson);\n"
      ]
    ]
  },
  {
    "file": "src/engine/cell-block-format.ts",
    "edits": [
      [
        "  for (const cellIdx of block.cellIndices) {\n    const paraCount = paraCountAt(cellIdx);\n    for (let cellParaIdx = 0; cellParaIdx < paraCount; cellParaIdx++) {\n      targets.push({\n        kind: 'cell',\n        sec: block.sec,\n",
        "  for (const cellIdx of block.cellIndices) {\n    const paraCount = paraCountAt(cellIdx);\n    for (let cellParaIdx = 0; cellParaIdx < paraCount; cellParaIdx++) {\n      if (block.cellPath) {\n        targets.push({\n          kind: 'cellPath',\n          sec: block.sec,\n          parentPara: block.ppi,\n          path: withCellPathTarget(block.cellPath, cellIdx, cellParaIdx),\n        });\n        continue;\n      }\n      targets.push({\n        kind: 'cell',\n        sec: block.sec,\n"
      ]
    ]
  },
  {
    "file": "src/engine/command.ts",
    "edits": [
      [
        "\nexport type ParaFormatTarget =\n  | { kind: 'body'; sec: number; para: number }\n  | { kind: 'cell'; sec: number; parentPara: number; controlIdx: number; cellIdx: number; cellParaIdx: number };\n\ninterface ParaShapeHistoryEntry {\n",
        "\nexport type ParaFormatTarget =\n  | { kind: 'body'; sec: number; para: number }\n  | { kind: 'cellPath'; sec: number; parentPara: number; path: CellPathEntry[] }\n  | { kind: 'cell'; sec: number; parentPara: number; controlIdx: number; cellIdx: number; cellParaIdx: number };\n\ninterface ParaShapeHistoryEntry {\n"
      ],
      [
        "function getParaShapeId(wasm: WasmBridge, target: ParaFormatTarget): number {\n  const props = target.kind === 'body'\n    ? wasm.getParaPropertiesAt(target.sec, target.para)\n    : wasm.getCellParaPropertiesAt(\n        target.sec,\n        target.parentPara,\n        target.controlIdx,\n",
        "function getParaShapeId(wasm: WasmBridge, target: ParaFormatTarget): number {\n  const props = target.kind === 'body'\n    ? wasm.getParaPropertiesAt(target.sec, target.para)\n    : target.kind === 'cellPath'\n      ? wasm.getCellParaPropertiesAtByPath(target.sec, target.parentPara, JSON.stringify(target.path))\n      : wasm.getCellParaPropertiesAt(\n        target.sec,\n        target.parentPara,\n        target.controlIdx,\n"
      ],
      [
        "    wasm.applyParaFormat(target.sec, target.para, propsJson);\n    return;\n  }\n  wasm.applyParaFormatInCell(\n    target.sec,\n    target.parentPara,\n",
        "    wasm.applyParaFormat(target.sec, target.para, propsJson);\n    return;\n  }\n  if (target.kind === 'cellPath') {\n    wasm.applyParaFormatInCellByPath(target.sec, target.parentPara, JSON.stringify(target.path), propsJson);\n    return;\n  }\n  wasm.applyParaFormatInCell(\n    target.sec,\n    target.parentPara,\n"
      ],
      [
        "    wasm.setParaShapeId(target.sec, target.para, paraShapeId);\n    return;\n  }\n  wasm.setCellParaShapeId(\n    target.sec,\n    target.parentPara,\n",
        "    wasm.setParaShapeId(target.sec, target.para, paraShapeId);\n    return;\n  }\n  if (target.kind === 'cellPath') {\n    wasm.setCellParaShapeIdByPath(target.sec, target.parentPara, JSON.stringify(target.path), paraShapeId);\n    return;\n  }\n  wasm.setCellParaShapeId(\n    target.sec,\n    target.parentPara,\n"
      ],
      [
        "\n  execute(wasm: WasmBridge): DocumentPosition {\n    if (this.entries.length > 0 && this.entries.every(entry => entry.afterParaShapeId !== undefined)) {\n      for (const entry of this.entries) {\n        restoreParaShapeId(wasm, entry.target, entry.afterParaShapeId!);\n      }\n      return { ...this.cursorBefore };\n    }\n",
        "\n  execute(wasm: WasmBridge): DocumentPosition {\n    if (this.entries.length > 0 && this.entries.every(entry => entry.afterParaShapeId !== undefined)) {\n      wasm.runInBatch(() => {\n        for (const entry of this.entries) {\n          restoreParaShapeId(wasm, entry.target, entry.afterParaShapeId!);\n        }\n      });\n      return { ...this.cursorBefore };\n    }\n"
      ],
      [
        "  }\n\n  undo(wasm: WasmBridge): DocumentPosition {\n    for (const entry of this.entries) {\n      restoreParaShapeId(wasm, entry.target, entry.beforeParaShapeId);\n    }\n    return { ...this.cursorBefore };\n  }\n",
        "  }\n\n  undo(wasm: WasmBridge): DocumentPosition {\n    wasm.runInBatch(() => {\n      for (const entry of this.entries) {\n        restoreParaShapeId(wasm, entry.target, entry.beforeParaShapeId);\n      }\n    });\n    return { ...this.cursorBefore };\n  }\n"
      ]
    ]
  },
  {
    "file": "src/engine/input-handler.ts",
    "edits": [
      [
        "\n  /** 셀 블록 안 모든 셀의 모든 문단을 문단 서식 대상으로 만든다 */\n  private getParaFormatTargetsForCellBlock(block: SelectedCellBlock): ParaFormatTarget[] {\n    // 중첩 표 문단 서식은 목표 밖(getParaFormatTargetsForRange 도 동일 하계)이다.\n    if (block.cellPath) return [];\n    return paraFormatTargetsForCellBlock(\n      block,\n      (cellIdx) => this.wasm.getCellParagraphCount(block.sec, block.ppi, block.ci, cellIdx),\n    );\n  }\n\n  private getParaFormatTargetsForRange(start: DocumentPosition, end: DocumentPosition): ParaFormatTarget[] {\n    if (this.cursor.isInHeaderFooter() || this.cursor.isInFootnote()) return [];\n    if (start.isTextBox || end.isTextBox) return [];\n    if ((start.cellPath?.length ?? 0) > 1 || (end.cellPath?.length ?? 0) > 1) return [];\n\n    const startInCell = start.parentParaIndex !== undefined;\n    const endInCell = end.parentParaIndex !== undefined;\n",
        "\n  /** 셀 블록 안 모든 셀의 모든 문단을 문단 서식 대상으로 만든다 */\n  private getParaFormatTargetsForCellBlock(block: SelectedCellBlock): ParaFormatTarget[] {\n    return paraFormatTargetsForCellBlock(\n      block,\n      (cellIdx) => block.cellPath\n        ? this.wasm.getCellParagraphCountByPath(\n            block.sec, block.ppi, JSON.stringify(withCellPathTarget(block.cellPath, cellIdx)),\n          )\n        : this.wasm.getCellParagraphCount(block.sec, block.ppi, block.ci, cellIdx),\n    );\n  }\n\n  private getParaFormatTargetsForRange(start: DocumentPosition, end: DocumentPosition): ParaFormatTarget[] {\n    if (this.cursor.isInHeaderFooter() || this.cursor.isInFootnote()) return [];\n    if (start.isTextBox || end.isTextBox) return [];\n    if ((start.cellPath?.length ?? 0) > 1 || (end.cellPath?.length ?? 0) > 1) {\n      if (start.parentParaIndex === undefined || !isSameSelectionCellContainer(start, end)) return [];\n      const path = start.cellPath!;\n      const first = path[path.length - 1];\n      const last = end.cellPath![end.cellPath!.length - 1];\n      const targets: ParaFormatTarget[] = [];\n      for (let para = Math.min(first.cellParaIndex, last.cellParaIndex);\n        para <= Math.max(first.cellParaIndex, last.cellParaIndex); para++) {\n        targets.push({\n          kind: 'cellPath', sec: start.sectionIndex, parentPara: start.parentParaIndex,\n          path: withCellPathTarget(path, first.cellIndex, para),\n        });\n      }\n      return targets;\n    }\n\n    const startInCell = start.parentParaIndex !== undefined;\n    const endInCell = end.parentParaIndex !== undefined;\n"
      ],
      [
        "  applyStyle(styleId: number): void {\n    try {\n      const targets = this.getParaFormatTargetsAtCursor();\n      if (targets.length === 0) return;\n      const cursorBefore = this.cursor.getPosition();\n      const operation = (wasm: WasmBridge): DocumentPosition => {\n        for (const target of targets) {\n          if (target.kind === 'body') {\n            wasm.applyStyle(target.sec, target.para, styleId);\n            continue;\n          }\n          wasm.applyCellStyle(\n            target.sec,\n            target.parentPara,\n",
        "  applyStyle(styleId: number): void {\n    try {\n      const targets = this.getParaFormatTargetsAtCursor();\n      // 스타일에는 글자 모양도 포함된다. 중첩 셀 스타일은 별도 경로가 필요하다.\n      if (targets.length === 0 || targets.some(target => target.kind === 'cellPath')) return;\n      const cursorBefore = this.cursor.getPosition();\n      const operation = (wasm: WasmBridge): DocumentPosition => {\n        for (const target of targets) {\n          if (target.kind === 'body') {\n            wasm.applyStyle(target.sec, target.para, styleId);\n            continue;\n          }\n          if (target.kind !== 'cell') continue;\n          wasm.applyCellStyle(\n            target.sec,\n            target.parentPara,\n"
      ],
      [
        "    }\n    const pos = this.cursor.getPosition();\n    if (pos.parentParaIndex !== undefined) {\n      return this.wasm.getCellParaPropertiesAt(\n        pos.sectionIndex, pos.parentParaIndex, pos.controlIndex!,\n        pos.cellIndex!, pos.cellParaIndex!,\n",
        "    }\n    const pos = this.cursor.getPosition();\n    if (pos.parentParaIndex !== undefined) {\n      if ((pos.cellPath?.length ?? 0) > 1) {\n        return this.wasm.getCellParaPropertiesAtByPath(\n          pos.sectionIndex, pos.parentParaIndex, JSON.stringify(pos.cellPath),\n        );\n      }\n      return this.wasm.getCellParaPropertiesAt(\n        pos.sectionIndex, pos.parentParaIndex, pos.controlIndex!,\n        pos.cellIndex!, pos.cellParaIndex!,\n"
      ]
    ]
  }
];

export async function patchNestedParagraphFormat(studio) {
  const marker='// Pwh nested paragraph formatting';
  for(const {file,edits} of changes) {
    const target=path.join(studio,file);
    let source=(await fs.readFile(target,'utf8')).replaceAll('\r\n','\n');
    if(source.split('\n').includes(marker))continue;
    for(const [before,after] of edits) {
      if(source.split(before).length!==2)throw Error('Unsupported nested paragraph format: '+file+' '+before.slice(0,100));
      source=source.replace(before,()=>after);
    }
    // A target owns every ancestor entry; undo must not alias a live cursor path.
    if(file.endsWith('cell-block-format.ts'))source=source.replace('...path.slice(0, -1),','...path.slice(0, -1).map(entry => ({ ...entry })),');
    if(file.endsWith('mutation-method-registry.ts'))source=source.replace("  'evaluateTableFormula',","  'evaluateTableFormula',\n  'editTableStructureByPath', 'setCellZonePropertiesByPath',\n  'setTablePropertiesByPath', 'setCellPropertiesByPath',");
    await fs.writeFile(target,marker+'\n'+source);
  }
  // Cell-block paragraph commands must reach the new path before selection exit.
  const keyboard=path.join(studio,'src/engine/input-handler-keyboard.ts');
  let source=(await fs.readFile(keyboard,'utf8')).replaceAll('\r\n','\n');
  if(!source.split('\n').includes(marker)) {
    const anchor="  'format:normal-char-shape', 'format:bold', 'format:italic', 'format:underline',";
    if(source.split(anchor).length!==2)throw Error('Unsupported cell-block paragraph shortcut routing');
    source=source.replace(anchor,"  'format:align-left', 'format:align-center', 'format:align-right',\n  'format:align-justify', 'format:align-distribute',\n"+anchor);
    await fs.writeFile(keyboard,marker+'\n'+source);
  }
}
