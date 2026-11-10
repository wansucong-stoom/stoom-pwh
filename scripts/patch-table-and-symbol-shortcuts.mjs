import fs from 'node:fs/promises';
import path from 'node:path';

export async function patchTableAndSymbolShortcuts(studio) {
  async function edit(relative, changes) {
    const file = path.join(studio, 'src', relative);
    let source = (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');
    const marker = '// Pwh table and symbol shortcuts';
    if (source.split(/\r?\n/).includes(marker)) return;
    for (const [from, to] of changes) {
      if (source.split(from).length !== 2) throw Error('Unsupported table or symbols source: ' + relative + ' ' + from.slice(0, 48));
      source = source.replace(from, () => to);
    }
    await fs.writeFile(file, marker + '\n' + source);
  }

  await edit('command/contextual-shortcut.ts', [[
    "commandId: 'table:cell-split' | 'table:cell-merge'",
    "commandId: 'table:cell-split' | 'table:cell-merge' | 'table:cell-width-equal' | 'table:cell-height-equal'",
  ], [
    "  // pwh cell C and L shortcuts",

    "  if (key === 'w' || key === 'ㅈ' || code === 'keyw') return { kind: 'dispatch', commandId: 'table:cell-width-equal' };\n" +
    "  if (key === 'h' || key === 'ㅗ' || code === 'keyh') return { kind: 'dispatch', commandId: 'table:cell-height-equal' };\n" +
    "  // pwh cell C and L shortcuts",
  ]]);
  await edit('command/commands/table.ts', [[
    '// HWP/HWPX cannot persist independent per-row or per-column geometry. Keep\n// commands that require that representation unavailable at command routing.\nconst localTableGeometryCanPersist = () => false;',
    '',
  ], ...[['H', 'height'], ['W', 'width']].map(([key, axis]) => [
    "    shortcutLabel: '" + key + "',\n    canExecute: localTableGeometryCanPersist,\n    execute() {},",
    "    shortcutLabel: '" + key + "',\n    canExecute: hasMultiCellSelection,\n" +
    "    execute(services) { services.getInputHandler()?.equalizeSelectedCellSizes('" + axis + "'); },",
  ])]);
  await edit('engine/input-handler.ts', [[
    "  private resizeTableProportional(key:",
    "  equalizeSelectedCellSizes(axis: 'width' | 'height'): void {\n" +
    "    _table.equalizeSelectedCellSizes.call(this, axis);\n" +
    "  }\n\n  private resizeTableProportional(key:",
  ]]);
  await fs.copyFile(new URL('../src/table-equal-size.ts', import.meta.url), path.join(studio, 'src/engine/pwh-table-equal-size.ts'));
  await edit('engine/input-handler-table.ts', [[
    '/** Build resize updates from the complete table grid and keep the snapshot transaction. */',
    'import {planEqualCellSizes} from "./pwh-table-equal-size";\n\n' +
    'export function equalizeSelectedCellSizes(this: any, axis: "width" | "height"): void {\n' +
    '  const ctx = this.cursor.getCellTableContext();\n' +
    '  const range = this.cursor.getSelectedCellRange();\n' +
    '  if (!ctx || !range || this.cursor.isProtectedCellSelectionMode() || this.cursor.getExcludedCells().size) return;\n' +
    '  const nested = ctx.cellPath?.length > 1 ? JSON.stringify(ctx.cellPath) : undefined;\n' +
    '  try {\n' +
    '    const cells = getKeyboardResizeCells.call(this, ctx, nested);\n' +
    '    const updates = planEqualCellSizes(cells, range, axis, index => {\n' +
    '      const props = nested ? this.wasm.getCellPropertiesByPath(ctx.sec, ctx.ppi, nested, index)\n' +
    '        : this.wasm.getCellProperties(ctx.sec, ctx.ppi, ctx.ci, index);\n' +
    '      return props[axis] ?? NaN;\n' +
    '    });\n' +
    '    if (!updates.length) return;\n' +
    '    this.executeOperation({\n' +
    '      kind: "snapshot", operationType: "equalizeSelectedCellSizes", operation: (wasm: any) => {\n' +
    '        if (nested) wasm.resizeTableCellsByPath(ctx.sec, ctx.ppi, nested, updates);\n' +
    '        else wasm.resizeTableCells(ctx.sec, ctx.ppi, ctx.ci, updates);\n' +
    '        return this.cursor.getPosition();\n' +
    '      },\n' +
    '    });\n' +
    '    this.updateCellSelection();\n' +
    '  } catch (error) {\n' +
    '    console.warn("[InputHandler] equalizeSelectedCellSizes", error);\n' +
    '  }\n' +
    '}\n\n/** Build resize updates from the complete table grid and keep the snapshot transaction. */',
  ]]);

  await edit('command/shortcut-map.ts', [[
    "  [{ key: 'f10', alt: true }, 'insert:symbols'],",
    "  [{ key: 'f10', ctrl: true }, 'insert:symbols'],\n  [{ key: 'f10', alt: true }, 'insert:symbols'],",
  ]]);
  await edit('command/commands/insert.ts', [["shortcutLabel: 'Alt+F10'", "shortcutLabel: 'Ctrl+F10'"]]);
  for (const language of ['ko', 'en']) {
    await edit('i18n/locales/' + language + '.ts', [[
      ' (Alt+F10)",', ' (Ctrl+F10)",',
    ], [
      '  "dialog.symbols.label.xc57c60":',
      '  "dialog.symbols.enclosedAlphanumerics": "' + (language === 'ko' ? '원문자와 괄호 문자' : 'Enclosed alphanumerics') + '",\n' +
      '  "dialog.symbols.enclosedCjk": "' + (language === 'ko' ? '원문자와 괄호 한글·한자' : 'Enclosed CJK letters') + '",\n' +
      '  "dialog.symbols.label.xc57c60":',
    ]]);
  }
  await edit('ui/symbols-dialog.ts', [[
    "import { isCodePointInBlock, type UnicodeBlock } from './unicode-block.ts';",
    "import type { UnicodeBlock } from './unicode-block.ts';",
  ], [
    "  { name: t('dialog.symbols.label.xc57c60'),",
    "  { name: t('dialog.symbols.enclosedAlphanumerics'), start: 0x2460, end: 0x24FF },\n" +
    "  { name: t('dialog.symbols.label.xc57c60'),",
  ], [
    "  { name: t('dialog.symbols.label.x4e4d67'),",
    "  { name: t('dialog.symbols.enclosedCjk'), start: 0x3200, end: 0x32FF },\n" +
    "  { name: t('dialog.symbols.label.x4e4d67'),",
  ], [
    'const COLS = 16;',
    'const COLS = 16;\n' +
    'const nonInsertable = /[\\p{Cc}\\p{Cs}\\p{Cn}]/u;\n' +
    'function symbolDisplay(character: string): string {\n' +
    '  if (/\\p{Z}/u.test(character)) return "␣";\n' +
    '  if (/\\p{Cf}/u.test(character)) return "◇";\n' +
    '  return /\\p{M}/u.test(character) ? "◌" + character : character;\n' +
    '}',
  ], [
    "    this.codeLabel.textContent = block.start.toString(16).toUpperCase().padStart(4, '0');",
    "    this.codeLabel.textContent = this.charGrid.firstElementChild?.getAttribute('data-code') ?? '';",
  ], [
    '    const count = block.end - block.start + 1;',
    '    const characters = Array.from({length: block.end - block.start + 1}, (_, index) =>\n' +
    '      String.fromCodePoint(block.start + index)).filter(character => !nonInsertable.test(character));\n' +
    '    const count = characters.length;',
  ], [
    '        const cp = block.start + r * COLS + c;',
    '        const ch = characters[r * COLS + c];',
  ], [
    '        if (cp <= block.end) {\n          const ch = String.fromCodePoint(cp);\n          cell.textContent = ch;',
    "        if (ch !== undefined) {\n          const cp = ch.codePointAt(0)!;\n          cell.dataset.code = cp.toString(16).toUpperCase().padStart(4, '0');\n          cell.textContent = symbolDisplay(ch);",
  ], [
    '    this.previewCell.textContent = ch;',
    '    this.previewCell.textContent = symbolDisplay(ch);',
  ], [
    "    if (isCodePointInBlock(codePoint, this.currentBlock)) {\n      const idx = codePoint - this.currentBlock.start;\n      const cells = this.charGrid.querySelectorAll('.sym-cell');\n      cells[idx]?.classList.add('selected');\n    }",
    "    this.charGrid.querySelector('[data-code=\"' + this.codeLabel.textContent + '\"]')?.classList.add('selected');",
  ], [
    '      return raw ? JSON.parse(raw) : [];',
    '      const recent: unknown = raw ? JSON.parse(raw) : [];\n' +
    '      return Array.isArray(recent) ? recent.filter((value): value is string =>\n' +
    '        typeof value === "string" && Array.from(value).length === 1 && !nonInsertable.test(value)) : [];',
  ], [
    '      cell.textContent = ch;',
    '      cell.textContent = symbolDisplay(ch);',
  ]]);
  // The marker must remain a CSS comment.
  const cssFile = path.join(studio, 'src/styles/symbols-dialog.css');
  const css = await fs.readFile(cssFile, 'utf8');
  const font = 'font-family: "Segoe UI Symbol", "Malgun Gothic", "Cambria Math", "Segoe UI Emoji", sans-serif;';
  if (!css.includes(font)) {
    await fs.writeFile(cssFile, css.replace('repeat(16, 1fr)', 'repeat(16, minmax(0, 1fr))') +
      '\n.sym-char-grid { overflow-x: hidden; align-content: start; }\n' +
      '.sym-cell, .sym-preview { ' + font + ' }\n');
  }
}
