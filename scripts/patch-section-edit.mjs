import fs from 'node:fs/promises';
import path from 'node:path';

export async function patchSectionEdit(studio) {
  const from = new URL('../src/pwh-section-edit.ts', import.meta.url);
  await fs.copyFile(from, path.join(studio, 'src/pwh-section-edit.ts'));
  async function patch(relative, replacements) {
    const file = path.join(studio, relative);
    let text = await fs.readFile(file, 'utf8');
    for (const [before, after] of replacements) {
      if (!text.includes(before)) throw Error('Section edit source anchor missing: '+relative);
      text = text.replace(before, after);
    }
    await fs.writeFile(file, text);
  }
  await patch('src/core/wasm-bridge.ts', [[
    '  getSectionCount(): number {',
    `  /** Edit the body section list in the shared core. */
  editSectionBoundary(pos: DocumentPosition, kind: 'pwhSection' | 'pwhJoinSection'): DocumentPosition {
    if (!this.doc) throw Error('문서를 열어 주세요.');
    let rootParagraph = pos.paragraphIndex;
    for (let section = 0; section < pos.sectionIndex; section++) rootParagraph += this.getParagraphCount(section);
    const result = JSON.parse(this.doc.breakAtCursor(0, rootParagraph, this.bodyPositionToLogical(pos), kind));
    if (!result.ok) throw Error('구역 경계를 변경하지 못했습니다.');
    this.invalidatePwhSelectionLayout();
    return {sectionIndex: result.sectionIndex, paragraphIndex: result.paragraphIndex, charOffset: result.charOffset};
  }
  sectionBoundaryParagraphLength(section: number, paragraph: number): number {
    return this.doc?.getLogicalLength(section, paragraph) ?? 0;
  }
  getSectionCount(): number {`,
  ]]);
  await patch('src/command/commands/page.ts', [[
    '  // 다단 프리셋 — ColumnDef 컨트롤 수정 (SectionDef와 독립)',
    `  {
    id: 'page:section-break', label: '구역 나누기', shortcutLabel: 'Alt+Shift+Enter',
    canExecute: canSplitSection,
    execute: services => { splitSection(services); },
  },
  // 다단 프리셋 — ColumnDef 컨트롤 수정 (SectionDef와 독립)`,
  ], ['import { SectionSettingsDialog }', "import { canSplitSection, splitSection } from '@/pwh-section-edit';\nimport { SectionSettingsDialog }"]]);
  await patch('src/ui/section-settings-dialog.ts', [
    ['import { ModalDialog }', "import { canSplitSection, splitSection } from '@/pwh-section-edit';\nimport { ModalDialog }"],
    ["      [i18nText('dialog.sectionSettings.createBody.label'), 'selection'],", "      ['새 구역으로', 'new'],"],
    ["      opt.value = value;", "      opt.value = value;\n      if (value === 'new') opt.disabled = !this.services || !canSplitSection(this.services.getContext()) || !this.services.getInputHandler()?.canEditHyperlink();"],
    ["    // 'current'/'selection' 은 현재 구역과 동일 처리. all=전 구역(전문서 효과).", "    if (scope === 'new') return !!this.services && splitSection(this.services, newDef);\n    // current changes the active section; all changes existing sections."],
  ]);
  await patch('src/command/shortcut-map.ts', [[
    '  // 편집\n',
    "  [{key: 'enter', alt: true, shift: true}, 'page:section-break'],\n  // 편집\n",
  ]]);
  await patch('src/engine/input-handler-keyboard.ts', [
    ["      } else if (e.key === 'Backspace') {\n        this.handleBackspace(pos, inCell);",
      "      } else if (!inCell && !e.ctrlKey && !e.metaKey && !e.shiftKey && !this.isFormMode?.()\n        && this.canEditHyperlink() && joinSectionAtBoundary(this, this.wasm, pos, e.key)) {\n        return;\n      } else if (e.key === 'Backspace') {\n        this.handleBackspace(pos, inCell);"],
  ]);
  const keyboard = path.join(studio, 'src/engine/input-handler-keyboard.ts');
  await fs.writeFile(keyboard, "import {joinSectionAtBoundary} from '@/pwh-section-edit';\n"+await fs.readFile(keyboard, 'utf8'));
  await patch('src/main.ts', [[
    'p1: pageInfo.sectionIndex + 1, p2: totalSections',
    'p1: pageInfo.sectionIndex + 1, p2: wasm.getSectionCount()',
  ]]);
  await patch('index.html', [[
    '          <div class="md-item disabled" data-cmd="page:section-settings">',
    '          <div class="md-item" data-cmd="page:section-break"><span class="md-icon"></span><span class="md-label">구역 나누기</span><span class="md-shortcut">Alt+Shift+Enter</span></div>\n          <div class="md-item disabled" data-cmd="page:section-settings">',
  ]]);
}
