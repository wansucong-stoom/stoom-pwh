import fs from 'node:fs/promises';
import path from 'node:path';

export async function patchViewportTableSelection(studio) {
  const glueFile = path.join(studio, '..', 'pkg', 'rhwp.js');
  const glue = await fs.readFile(glueFile, 'utf8');
  if (!glue.includes('    getTableCellLayout(')) {
    const anchor = '    getTableCellBboxesByPath(section_idx, parent_para_idx, path_json) {';
    const method = [
      '    getTableCellLayout(section, paragraph, path, page) {',
      '        if (!wasm.hwpdocument_getTableCellLayout) return null;',
      '        const pathPtr = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);',
      '        const pathLen = WASM_VECTOR_LEN;',
      '        const [ptr, len, error, failed] = wasm.hwpdocument_getTableCellLayout(this.__wbg_ptr, section, paragraph, pathPtr, pathLen, isLikeNone(page) ? Number.MAX_SAFE_INTEGER : page >>> 0);',
      '        if (failed) throw takeFromExternrefTable0(error);',
      '        try { return getStringFromWasm0(ptr, len); }',
      '        finally { wasm.__wbindgen_free(ptr, len, 1); }',
      '    }',
      '',
    ].join('\n');
    const start = glue.lastIndexOf('    /**', glue.indexOf(anchor));
    if (glue.split(anchor).length !== 2 || start < 0) throw Error('Unsupported table selection WASM binding');
    await fs.writeFile(glueFile, glue.slice(0, start) + method + glue.slice(start));
  }
  const change = async (relative, edits) => {
    const file = path.join(studio, 'src', relative);
    let source = await fs.readFile(file, 'utf8');
    const marker = '// Pwh viewport table selection';
    if (source.split(/\r?\n/).includes(marker)) return;
    for (const [before, after] of edits) {
      if (source.split(before).length !== 2) throw Error('Unsupported table selection source: ' + relative);
      source = source.replace(before, after);
    }
    await fs.writeFile(file, marker + '\n' + source);
  };
  await change('core/wasm-bridge.ts', [[
    '  getTableDimensionsByPath(sec: number, parentPara: number, pathJson: string): TableDimensions {',
    '  getTableCellLayout(sec: number, parentPara: number, pathJson: string): Pick<CellBbox, "cellIdx" | "row" | "col" | "rowSpan" | "colSpan">[] | null;\n' +
    '  getTableCellLayout(sec: number, parentPara: number, pathJson: string, page: number): CellBbox[] | null;\n' +
    '  getTableCellLayout(sec: number, parentPara: number, pathJson: string, page?: number): CellBbox[] | null {\n' +
    '    const doc = this.doc as (HwpDocument & {getTableCellLayout?: (sec: number, para: number, path: string, page?: number) => string | null}) | null;\n' +
    '    const data = doc?.getTableCellLayout?.(sec, parentPara, pathJson, page);\n' +
    '    return data == null ? null : JSON.parse(data);\n' +
    '  }\n\n' +
    '  getTableDimensionsByPath(sec: number, parentPara: number, pathJson: string): TableDimensions {',
  ]]);
  await change('engine/table-resize-updates.ts', [[
    'export type ResizeArrowKey',
    'export type CellGridEntry = Pick<CellBbox, "cellIdx" | "row" | "col" | "rowSpan" | "colSpan">;\n\nexport type ResizeArrowKey',
  ], ...[
    'function collectUniqueCells(bboxes: CellBbox[]): CellBbox[] {',
    '  const out: CellBbox[] = [];',
    'function axisStart(b: CellBbox,',
    'function axisEnd(b: CellBbox,',
    'function overlapCount(b: CellBbox,',
    'export function buildColumnResizeUpdates(\n  bboxes: CellBbox[],',
  ].map(anchor => [anchor, anchor.replaceAll('CellBbox', 'CellGridEntry')])]);
  await change('engine/input-handler-table.ts', [[
    '  buildColumnResizeUpdates,',
    '  buildColumnResizeUpdates,\n  type CellGridEntry,',
  ], [
    '  let bboxes: CellBbox[];\n  try {\n    bboxes = nestedPathJson\n      ? this.wasm.getTableCellBboxesByPath(ctx.sec, ctx.ppi, nestedPathJson)\n      : this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci);\n  } catch { return; }',
    '  let bboxes: CellGridEntry[];\n  try {\n    bboxes = getKeyboardResizeCells.call(this, ctx, nestedPathJson);\n  } catch { return; }',
  ], [
    '    const bboxes = nestedPathJson\n      ? this.wasm.getTableCellBboxesByPath(ctx.sec, ctx.ppi, nestedPathJson)\n      : this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci);\n    const updates: Array',
    '    const bboxes = getKeyboardResizeCells.call(this, ctx, nestedPathJson);\n    const updates: Array',
  ], [
    '  build: (bboxes: CellBbox[], range: CellSelectionRange, key: ResizeArrowKey) => LocalResizeUpdate[],',
    '  build: (bboxes: CellGridEntry[], range: CellSelectionRange, key: ResizeArrowKey) => LocalResizeUpdate[],',
  ], [
    '/** 세 모드 공통: 셀 bbox 조회 → 빌더 → snapshot 라우팅. */',
    'function getKeyboardResizeCells(this: any, ctx: {sec: number; ppi: number; ci: number}, nestedPath?: string): CellGridEntry[] {\n' +
    '  const path = nestedPath ?? JSON.stringify([{controlIndex: ctx.ci, cellIndex: 0, cellParaIndex: 0}]);\n' +
    '  return this.wasm.getTableCellLayout(ctx.sec, ctx.ppi, path) ?? (nestedPath\n' +
    '    ? this.wasm.getTableCellBboxesByPath(ctx.sec, ctx.ppi, nestedPath)\n' +
    '    : this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci));\n' +
    '}\n\n/** Build resize updates from the complete table grid and keep the snapshot transaction. */',
  ]]);
  await change('engine/cursor.ts', [[
    '    let bboxes: CellBbox[];\n    try {\n      bboxes = cellPath\n        ? this.wasm.getTableCellBboxesByPath(sec, ppi, JSON.stringify(cellPath))\n        : this.wasm.getTableCellBboxes(sec, ppi, ci!);\n    } catch { bboxes = []; }',
    '    let bboxes: Pick<CellBbox, "cellIdx" | "row" | "col" | "rowSpan" | "colSpan">[];\n    try {\n      const path = JSON.stringify(cellPath ?? [{controlIndex: ci, cellIndex: 0, cellParaIndex: 0}]);\n' +
    '      bboxes = this.wasm.getTableCellLayout(sec, ppi, path) ?? (cellPath\n' +
    '        ? this.wasm.getTableCellBboxesByPath(sec, ppi, path)\n' +
    '        : this.wasm.getTableCellBboxes(sec, ppi, ci!));\n' +
    '    } catch { bboxes = []; }',
  ]]);
  await change('engine/input-handler.ts', [[
    "      if (this.cursor.getHeaderFooterSelectionOrdered()) this.updateSelection();\n    });",
    "      if (this.cursor.getHeaderFooterSelectionOrdered()) this.updateSelection();\n" +
    "      if (this.cursor.isInCellSelectionMode()) this.updateCellSelection(true);\n    });",
  ], [
    '  private updateCellSelection(): void {',
    '  private updateCellSelection(viewportOnly = false): void {',
  ], [
    '      let bboxes;\n      if (ctx.cellPath && ctx.cellPath.length > 1) {\n        // 중첩 표: 경로 기반 API 사용\n        const pathJson = JSON.stringify(ctx.cellPath);\n        bboxes = this.wasm.getTableCellBboxesByPath(ctx.sec, ctx.ppi, pathJson);\n      } else {\n        bboxes = this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci);\n      }',
    '      const nested = ctx.cellPath && ctx.cellPath.length > 1;\n' +
    '      const path = JSON.stringify(nested ? ctx.cellPath : [{controlIndex: ctx.ci, cellIndex: 0, cellParaIndex: 0}]);\n' +
    '      const {width, height} = this.viewportManager.getViewportSize();\n' +
    '      const pages = this.virtualScroll.getVisiblePages(this.viewportManager.getScrollY(), height, this.viewportManager.getScrollX(), width);\n' +
    '      const visible = pages.map(page => this.wasm.getTableCellLayout(ctx.sec, ctx.ppi, path, page));\n' +
    '      const requiresLegacyQuery = visible.some(cells => cells === null);\n' +
    '      if (viewportOnly && requiresLegacyQuery) return;\n' +
    '      const bboxes = requiresLegacyQuery\n' +
    '        ? (nested ? this.wasm.getTableCellBboxesByPath(ctx.sec, ctx.ppi, path) : this.wasm.getTableCellBboxes(ctx.sec, ctx.ppi, ctx.ci))\n' +
    '        : visible.flatMap(cells => cells ?? []);',
  ]]);
}
