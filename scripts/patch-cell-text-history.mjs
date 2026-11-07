import fs from 'node:fs/promises';
import path from 'node:path';

// Preserve the original cell layout, not merely its text, across text Undo.
// The core checkpoint owns one paragraph and the cell's following line vpos.
export async function patchCellTextHistory(studio) {
  const change = async (relative, marker, edit) => {
    const file = path.join(studio, 'src', relative);
    let source = await fs.readFile(file, 'utf8');
    if (source.includes(marker)) return;
    const replace = (before, after) => {
      if (source.split(before).length !== 2) throw Error('Unsupported cell text history: ' + relative + ' ' + before.slice(0,80));
      source = source.replace(before, after);
    };
    edit(replace);
    await fs.writeFile(file, '// ' + marker + '\n' + source);
  };
  await change('core/wasm-bridge.ts', 'pwh scoped cell text fragment bridge', replace => {
    replace('  captureDeleteRange(sectionIdx: number, startPara: number, endPara: number): number {', `  captureCellTextFragment(sectionIdx: number, parentParaIdx: number, pathJson: string): number | null {
    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');
    // Studio represents text boxes and other embedded text as cell positions.
    // Use the core's table-only lookup, without a layout query, before capture.
    try { this.doc.getCellInfoByPath(sectionIdx, parentParaIdx, pathJson); }
    catch { return null; }
    return this.doc.captureCellTextFragment(sectionIdx, parentParaIdx, pathJson);
  }

  captureDeleteRange(sectionIdx: number, startPara: number, endPara: number): number {`);
  });
  await change('engine/command.ts', 'pwh exact cell text history', replace => {
    replace('  mergeWith(other: EditCommand): EditCommand | null;', '  mergeWith(other: EditCommand, wasm?: WasmBridge): EditCommand | null;');
    replace('export function captureTextFragment(wasm: WasmBridge, pos: DocumentPosition): number | null {', `export function captureCellTextFragment(wasm: WasmBridge, pos: DocumentPosition): number | null {
  if (!isCell(pos)) return null;
  const target = hyperlinkTarget(pos);
  if (!target.cellPath.length || target.cellPath.some(entry => entry[1] >= 65534)) return null;
  const path = target.cellPath.map(([controlIndex, cellIndex, cellParaIndex]) => ({controlIndex, cellIndex, cellParaIndex}));
  return wasm.captureCellTextFragment(target.section, target.para, JSON.stringify(path));
}

export function captureTextFragment(wasm: WasmBridge, pos: DocumentPosition): number | null {`);
    // Caption sentinels must be checked before hyperlinkTarget rejects them.
    replace('  if (!isCell(pos)) return null;\n  const target = hyperlinkTarget(pos);', '  if (!isCell(pos) || pos.cellIndex === 65534 || pos.cellPath?.some(entry => entry.cellIndex === 65534)) return null;\n  const target = hyperlinkTarget(pos);');
    replace('  return wasm.captureDeleteRange(target.section, target.para, target.para);', '  return captureCellTextFragment(wasm, pos) ?? wasm.captureDeleteRange(target.section, target.para, target.para);');
    replace("  readonly type = 'insertText';", "  readonly type = 'insertText';\n  private scopedCellText = false;");
    replace('      this.lastMutationEffects = insertTextWithMutationEffects(wasm, this.position, this.text);', `      const fragmentId = this.text ? captureCellTextFragment(wasm, this.position) : null;
      this.scopedCellText = fragmentId !== null;
      if (fragmentId !== null) this.fragmentIds = [fragmentId];
      try {
        this.lastMutationEffects = insertTextWithMutationEffects(wasm, this.position, this.text);
      } catch (error) {
        this.discard(wasm);
        throw error;
      }`);
    replace('      && this.fragmentIds.length === 0;', '      && (this.fragmentIds.length === 0 || this.scopedCellText);');
    replace('    merged.steps = [...this.steps, ...other.steps];', '    merged.steps = [...this.steps, ...other.steps];\n    merged.scopedCellText = this.scopedCellText && other.scopedCellText;');
    replace('    merged.scopedCellText = this.scopedCellText && other.scopedCellText;', `    merged.scopedCellText = this.scopedCellText && other.scopedCellText;
    // Only the first checkpoint owns the merged Undo. Release intermediate
    // paragraph/tail journals immediately instead of retaining one per key.
    if (wasm && merged.fragmentIds.length > 1) {
      const [first, ...redundant] = merged.fragmentIds;
      for (const id of redundant) wasm.discardDeleteFragment(id);
      merged.fragmentIds = [first];
    }`);
    replace('  mergeWith(other: EditCommand): EditCommand | null {\n    if (!(other instanceof InsertTextCommand))', '  mergeWith(other: EditCommand, wasm?: WasmBridge): EditCommand | null {\n    if (!(other instanceof InsertTextCommand))');
    // Flat terminal fields alone do not identify a deeply nested owner.
    for (const marker of ['    // 연속 위치 확인', "    if (this.direction === 'backward') {"]) {
      replace(marker, `    if ((isNestedCell(this.position) || isNestedCell(other.position)) && !sameCellPath(this.position.cellPath, other.position.cellPath)) return null;
${marker}`);
    }
    replace("  readonly type = 'deleteText';", "  readonly type = 'deleteText';\n  private scopedCellText = false;");
    replace('    if (!isCaption && this.count > 0) {', `    if (!isCaption && this.count > 0) this.fragmentId = captureCellTextFragment(wasm, this.position);
    this.scopedCellText = this.fragmentId !== null;
    if (this.fragmentId === null && !isCaption && this.count > 0) {`);
    replace('    const restoredLen = this.deletedText.length;', '    const restoredLen = charCount(this.deletedText);');
    replace('  mergeWith(other: EditCommand): EditCommand | null {\n    if (!(other instanceof DeleteTextCommand))', '  mergeWith(other: EditCommand, wasm?: WasmBridge): EditCommand | null {\n    if (!(other instanceof DeleteTextCommand))');
    replace(`    // 각 조각은 삭제 직전 문단 전체를 복원한다. 서로 다른 시점과 합치지 않는다.
    if (this.fragmentId !== null || other.fragmentId !== null) return null;`, `    const first = this.fragmentId, later = other.fragmentId;
    const scoped = this.scopedCellText && other.scopedCellText && first !== null && later !== null;
    if ((first !== null || later !== null) && (!scoped || !wasm)) return null;
    const keepFirstCheckpoint = (merged: DeleteTextCommand): DeleteTextCommand => {
      if (scoped && wasm) {
        merged.fragmentId = first;
        merged.scopedCellText = true;
        wasm.discardDeleteFragment(later);
      }
      return merged;
    };`);
    replace(`        return new DeleteTextCommand(
          other.position, this.count + other.count, 'backward',
          other.deletedText + this.deletedText, this.timestamp,
        );`, `        return keepFirstCheckpoint(new DeleteTextCommand(
          other.position, this.count + other.count, 'backward',
          other.deletedText + this.deletedText, this.timestamp,
        ));`);
    replace(`        return new DeleteTextCommand(
          this.position, this.count + other.count, 'forward',
          this.deletedText + other.deletedText, this.timestamp,
        );`, `        return keepFirstCheckpoint(new DeleteTextCommand(
          this.position, this.count + other.count, 'forward',
          this.deletedText + other.deletedText, this.timestamp,
        ));`);
  });
  await change('engine/input-handler-text.ts', 'pwh cell IME layout checkpoint', replace => {
    replace('  captureTextFragment,', '  captureTextFragment,\n  captureCellTextFragment,');
    replace(`      if (this._compositionCovered) {
        this._compositionFragment = captureTextFragment(this.wasm, anchor);`, `      if (!this.cursor.isInHeaderFooter() && !this.cursor.isInFootnote()) {
        this._compositionFragment = this._compositionCovered
          ? captureTextFragment(this.wasm, anchor) : captureCellTextFragment(this.wasm, anchor);
      }
      if (this._compositionCovered) {`);
    replace('  if (anchor && finalLength === 0 && covered) {', '  if (anchor && finalLength === 0 && (covered || fragmentId !== null)) {');
  });
  await change('engine/history.ts', 'pwh release merged cell checkpoints', replace => {
    replace('      const merged = last.mergeWith(command);\n      if (merged) {\n        this.undoStack[this.undoStack.length - 1] = merged;\n        // redo', '      const merged = last.mergeWith(command, wasm);\n      if (merged) {\n        this.undoStack[this.undoStack.length - 1] = merged;\n        // redo');
    replace('      const merged = last.mergeWith(command);', '      const merged = last.mergeWith(command, wasm);');
  });
}
