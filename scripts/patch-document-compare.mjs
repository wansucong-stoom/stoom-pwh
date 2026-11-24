import fs from 'node:fs/promises';
import path from 'node:path';

// The inline editor's host owns document replacement. Comparison has its own
// result session and renderers, so it never needs to load either side there.
export async function patchDocumentCompare(studio) {
  async function edit(relative, update) {
    const file = path.join(studio, 'src', relative);
    const source = (await fs.readFile(file, 'utf8')).replaceAll('\r\n', '\n');
    const marker = '// Pwh document comparison keeps the working document';
    if (source.includes(marker)) return;
    function replace(text, before, after) {
      if (text.split(before).length !== 2) throw Error('Unsupported comparison source: ' + relative);
      return text.replace(before, () => after);
    }
    await fs.writeFile(file, marker + '\n' + update(source, replace));
  }
  await edit('ui/chrome-mode.ts', (text, replace) => replace(text,
    `/**
 * embed 프로파일에서 등록하지 않는 편집 커맨드.
 *
 * 문서 비교는 비교 실행 시 오른쪽 문서를 현재 에디터에 로드하므로, 파일 열기와
 * 같은 급의 문서 교체 진입점이다 — 호스트는 문서 A를 열었다고 알고 있는데 Studio
 * 내부 문서가 B로 바뀔 수 있다.
 */
export const EMBED_HIDDEN_EDIT_COMMAND_IDS: readonly string[] = [
  'edit:compare-documents',
];`,
    'export const EMBED_HIDDEN_EDIT_COMMAND_IDS: readonly string[] = [];'));
  await edit('main.ts', (text, replace) => replace(text,
    '// registerAll이 메뉴 클릭·단축키·전역 단축키·커맨드 팔레트가 모두 지나는 choke point라\n// 이 필터 하나로 충분하다. 파일 수명주기 커맨드에 더해 edit:compare-documents도 거른다:\n// 비교 실행이 오른쪽 문서를 현재 에디터에 로드하는, 호스트가 감지할 수 없는 문서 교체\n// 진입점이다. shortcut-map의 파일 매핑은 그대로 둔다:',
    '// Pwh keeps file lifecycle commands with the host. The comparison dialog\n// renders its results without replacing the document. shortcut-map의 파일 매핑은 그대로 둔다:'));
  await edit('command/commands/edit.ts', (text, replace) => replace(text,
    "      if (!compareSessionStore) {\n        compareSessionStore = new CompareSessionStore(services.eventBus);\n      }\n      if (historyDialogInstance?.isOpen()) historyDialogInstance.hide();\n      if (compareDialogInstance && compareDialogInstance.isOpen()) return;\n      compareDialogInstance = new CompareDialog(services, compareSessionStore);",
    "      if (historyDialogInstance?.isOpen()) historyDialogInstance.hide();\n      if (compareDialogInstance?.isOpen()) return;\n      compareDialogInstance = new CompareDialog(services);"));
  await edit('ui/compare-dialog.ts', (text, replace) => {
    text = replace(text, "import type { CompareSessionStore } from '@/compare/session';",
      "import { CompareSessionStore } from '@/compare/session';\nimport { EventBus } from '@/core/event-bus';");
    text = replace(text, '  private readonly compareSessionStore: CompareSessionStore;',
      '  private readonly compareSessionStore = new CompareSessionStore(new EventBus());\n  private picking = false;');
    text = replace(text, '  constructor(services: CommandServices, compareSessionStore: CompareSessionStore) {\n    this.services = services;\n    this.compareSessionStore = compareSessionStore;\n  }',
      '  constructor(services: CommandServices) {\n    this.services = services;\n  }');
    text = replace(text, '    document.body.appendChild(this.wrap);\n  }',
      "    document.body.appendChild(this.wrap);\n    this.wrap.querySelector<HTMLElement>('.compare-row button')?.focus();\n  }");
    text = replace(text, '    this._open = false;\n    this.wrap?.remove();',
      '    this._open = false;\n    this.resultWindow?.hide();\n    this.resultWindow = null;\n    this.compareSessionStore.clear();\n    this.leftFile = null;\n    this.rightFile = null;\n    this.wrap?.remove();\n    this.services.getInputHandler()?.focus();');
    text = replace(text, "    this.wrap.className = 'compare-dialog doc-compare-dialog';",
      `    this.wrap.className = 'compare-dialog doc-compare-dialog';
    this.wrap.setAttribute('role', 'dialog');
    this.wrap.setAttribute('aria-label', '문서 비교');
    this.wrap.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hide();
      }
      event.stopPropagation();
    });`);
    text = replace(text, '      i18nText(\'dialog.compare.hint.text\');',
      "      'HWP 또는 HWPX 문서 두 개를 비교합니다. 현재 문서는 비교 대상으로 복사되며 편집 탭은 유지됩니다.';");
    text = replace(text, "      const fmt = wasm.getSourceFormat();\n      const raw = fmt === 'hwpx' ? wasm.exportHwpx() : wasm.exportHwp();\n      const bytes = new Uint8Array(raw);",
      '      const bytes = new Uint8Array(wasm.exportHwpx());');

    const start = text.indexOf("  private async pickFile(side: 'left' | 'right'): Promise<void> {");
    const end = text.indexOf('  private async onRunCompare(): Promise<void> {', start);
    if (start < 0 || end < start) throw Error('Unsupported comparison file picker');
    text = text.slice(0, start) + `  private async pickFile(side: 'left' | 'right'): Promise<void> {
    if (this.running || this.picking) return;
    this.picking = true;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.hwp,.hwpx';
    input.hidden = true;
    document.body.append(input);
    try {
      const selected = await new Promise<File | null>(resolve => {
        input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
        input.addEventListener('cancel', () => resolve(null), { once: true });
        input.click();
      });
      if (!selected || !this._open) return;
      if (!/\\.hwpx?$/i.test(selected.name)) {
        this.resultMetaEl.textContent = 'HWP 또는 HWPX 문서를 선택해 주세요.';
        return;
      }
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (!this._open) return;
      const picked: CompareFile = { bytes, fileName: selected.name };
      this.resultWindow?.hide();
      this.compareSessionStore.clear();
      this.openTwoPaneBtn.disabled = true;
      this.resultListEl.replaceChildren();
      this.resultMetaEl.textContent = i18nText('dialog.compare.resultMetaEl.text');
      if (side === 'left') {
        this.leftFile = picked;
        this.leftFileNameEl.textContent = selected.name;
      } else {
        this.rightFile = picked;
        this.rightFileNameEl.textContent = selected.name;
      }
    } catch {
      this.resultMetaEl.textContent = '선택한 비교 문서를 읽지 못했습니다.';
    } finally {
      input.remove();
      this.picking = false;
    }
  }

` + text.slice(end);
    text = replace(text, '    if (this.running) return;', '    if (this.running || this.picking) return;');
    const confirmation = text.indexOf('    const ctx = this.services.getContext();', text.indexOf('  private async onRunCompare'));
    const compareStart = text.indexOf('    this.running = true;', confirmation);
    if (confirmation < 0 || compareStart < confirmation) throw Error('Unsupported comparison confirmation');
    text = text.slice(0, confirmation) + text.slice(compareStart);
    text = replace(text,
      "      await this.loadRightDocumentToEditor(this.rightFile);\n      this.compareSessionStore.set(session);\n      this.services.eventBus.emit('compare:mode-changed', true);",
      '      if (!this._open) return;\n      this.compareSessionStore.set(session);');
    const unsafe = text.indexOf('  private async loadRightDocumentToEditor(');
    const following = text.indexOf('  private renderDiffList(', unsafe);
    if (unsafe < 0 || following < unsafe) throw Error('Unsupported comparison document replacement');
    return text.slice(0, unsafe) + text.slice(following);
  });
}
