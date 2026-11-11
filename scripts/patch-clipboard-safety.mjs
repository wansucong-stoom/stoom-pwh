import fs from 'node:fs/promises';
import path from 'node:path';

// Backport only the reviewed clipboard commits, not the 0.9 editor wholesale.
// Upstream: 17a8d2e and d50535c6 (MIT); Pwh adds strict rich-cut and focus checks.
export async function patchClipboardSafety(studio) {
  const files = new Map();
  const read = async name => {
    if (!files.has(name)) files.set(name, (await fs.readFile(path.join(studio, name), 'utf8')).replaceAll('\r\n', '\n'));
    return files.get(name);
  };
  const replace = async (name, before, after) => {
    const source = await read(name);
    if (source.split(before).length !== 2) throw Error('Unsupported clipboard source anchor: ' + name + ': ' + before.slice(0, 70));
    files.set(name, source.replace(before, after));
  };
  const handler = 'src/engine/input-handler.ts', keyboard = 'src/engine/input-handler-keyboard.ts';
  if ((await read(handler)).includes('// pwh clipboard cut safety')) return;
  const patch = await fs.readFile(new URL('../docs/engine-patches/studio/clipboard-safety.patch', import.meta.url), 'utf8');
  let file = null, before = [], after = [];
  const flush = async () => {
    if (before.length) await replace(file, before.join('\n') + '\n', after.join('\n') + '\n');
    before = []; after = [];
  };
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) { await flush(); file = line.split(' b/rhwp-studio/')[1]; }
    else if (line.startsWith('@@')) await flush();
    else if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    else if (line.startsWith(' ')) { before.push(line.slice(1)); after.push(line.slice(1)); }
    else if (line.startsWith('-')) before.push(line.slice(1));
    else if (line.startsWith('+')) after.push(line.slice(1));
  }
  await flush();
  await replace(keyboard, 'export function onKeyDown(this: any, e: KeyboardEvent): void {\n  if (!this.active) return;', "export function onKeyDown(this: any, e: KeyboardEvent): void {\n  if (!this.active) return;\n  if (['Delete', 'Backspace', 'Enter', 'Tab'].includes(e.key)\n    && !(e.key === 'Tab' && this.isFormMode?.())\n    && this.cursor.hasSelection() && this.canDeleteSelectionInFormMode?.() === false) {\n    e.preventDefault();\n    return;\n  }");
  // A text-only fallback is acceptable for Copy, but cannot prove an object is
  // recoverable after Cut. Keep the original if rich/image export or write fails.
  await replace(handler, 'private async copySelectedObject(isCurrent: () => boolean = () => true)', 'private async copySelectedObject(isCurrent: () => boolean = () => true, requireRich = false)');
  let source = await read(handler);
  const copyStart = source.indexOf('  private async copySelectedObject('), copyEnd = source.indexOf('\n  /**', copyStart);
  let copy = source.slice(copyStart, copyEnd);
  copy = copy.replaceAll('if (!isCurrent()) return false;', "if (!isCurrent() || (requireRich && (!html || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write))) return false;");
  copy = copy.replaceAll('.catch(() => { if (isCurrent()) return navigator.clipboard.writeText(text); });', '.catch((error) => { if (requireRich) throw error; if (isCurrent()) return navigator.clipboard.writeText(text); });');
  files.set(handler, source.slice(0, copyStart) + copy + source.slice(copyEnd));
  await replace(handler, 'await this.copySelectedObject(isCurrent)', 'await this.copySelectedObject(isCurrent, true)');
  await replace(handler, '    const undoTop = this.history.peekUndoTop();\n    const section = ref.sec;', '    const undoTop = this.history.peekUndoTop();\n    const focusTarget = document.activeElement;\n    const ownerWindow = document.defaultView;\n    const section = ref.sec;');
  await replace(handler, '      stopChange();\n    };\n    this.cancelPendingObjectCut', '      stopChange();\n      ownerWindow?.removeEventListener(\'blur\', cancel);\n    };\n    ownerWindow?.addEventListener(\'blur\', cancel, {once: true});\n    this.cancelPendingObjectCut');
  await replace(handler, "const stopMutation = this.eventBus.on('document-mutated', () => { invalidated = true; });", "const stopMutation = this.eventBus.on('document-mutated', () => cancel());");
  await replace(handler, "const stopChange = this.eventBus.on('document-changed', () => { invalidated = true; });", "const stopChange = this.eventBus.on('document-changed', () => cancel());");
  await replace(handler, '    const cancel = () => {\n      invalidated = true;', '    const lostFocus = (event: FocusEvent) => { if (event.target === focusTarget) cancel(); };\n    const cancel = () => {\n      invalidated = true;\n      if (this.cancelPendingObjectCut === cancel) this.cancelPendingObjectCut = null;\n      document.removeEventListener(\'focusout\', lostFocus, true);');
  await replace(handler, "    ownerWindow?.addEventListener('blur', cancel, {once: true});", "    ownerWindow?.addEventListener('blur', cancel, {once: true});\n    document.addEventListener('focusout', lostFocus, true);");
  await replace(handler, 'if (invalidated || this.cancelPendingObjectCut !== cancel', 'if (invalidated || !document.hasFocus() || document.activeElement !== focusTarget || this.cancelPendingObjectCut !== cancel');
  // Native Cut events use the same asynchronous object path as menu/keyboard Cut.
  const kb = await read(keyboard), start = kb.indexOf('  // 개체 선택 모드 → 개체 잘라내기', kb.indexOf('export function onCut(')), end = kb.indexOf('\n  if (!this.cursor.hasSelection())', start);
  if (start < 0 || end < 0) throw Error('Unsupported object Cut event');
  files.set(keyboard, kb.slice(0, start) + '  if (this.cursor.isInPictureObjectSelection() || this.cursor.isInTableObjectSelection()) {\n    e.preventDefault();\n    this.performCut();\n    return;\n  }\n' + kb.slice(end));
  // Keep a formatted text selection if HTML export fails; Copy can still use
  // its text fallback. Header/footer currently has an explicit plain-text API.
  await replace(handler, 'private onCopy(e: ClipboardEvent): boolean {\n    return _keyboard.onCopy.call(this, e);', 'private onCopy(e: ClipboardEvent, requireRich = false): boolean {\n    return _keyboard.onCopy.call(this, e, requireRich);');
  await replace(keyboard, 'export function onCopy(this: any, e: ClipboardEvent): boolean {', 'export function onCopy(this: any, e: ClipboardEvent, requireRich = false): boolean {');
  await replace(keyboard, '      const markedHtml = prepareRhwpInternalClipboardHtml(this, html, text);\n      e.clipboardData.setData', '      if (requireRich && !html) return false;\n      const markedHtml = prepareRhwpInternalClipboardHtml(this, html, text);\n      e.clipboardData.setData');
  await replace(keyboard, 'if (this.onCopy(e)) this.deleteSelection();', 'if (this.onCopy(e, true)) this.deleteSelection();');
  files.set(handler, '// pwh clipboard cut safety\n' + await read(handler));
  // All anchors are checked before any source is changed.
  for (const [name, content] of files) await fs.writeFile(path.join(studio, name), content);
}
