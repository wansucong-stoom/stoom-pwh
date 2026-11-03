import fs from 'node:fs/promises';
import path from 'node:path';

const marker='pwh pointer hit geometry owns its logical position';
export function transformPointerHitGeometry(original) {
  if(original.includes(marker))return original;
  let code=original.replace(/\r\n/g,'\n');
  const replace=(before,after)=>{
    if(code.split(before).length!==2)throw Error('Unsupported pointer hit geometry anchor: '+before.slice(0,100));
    code=code.replace(before,after);
  };
  replace('  private rect: CursorRect | null = null;', `  private rect: CursorRect | null = null;
  /** A pointer rectangle belongs only to the exact logical position that was hit. */
  private pointerHitPosition: DocumentPosition | null = null;

  private discardPointerHitGeometry(): void {
    this.pointerHitPosition = null;
    if (this.position.cursorRect) this.position = { ...this.position, cursorRect: undefined };
  }

  private currentPointerHitRect(): CursorRect | null {
    const hit = this.pointerHitPosition;
    const current = this.position;
    if (!hit || !current.cursorRect
        || !CursorState.sameFocusedCellPosition(hit, current)
        || hit.bodyCursor?.sectionIndex !== current.bodyCursor?.sectionIndex
        || hit.bodyCursor?.paragraphIndex !== current.bodyCursor?.paragraphIndex
        || hit.bodyCursor?.textOffset !== current.bodyCursor?.textOffset
        || hit.bodyCursor?.logicalOffset !== current.bodyCursor?.logicalOffset) {
      this.discardPointerHitGeometry();
      return null;
    }
    return current.cursorRect;
  }`);
  replace('  invalidateFocusedCellCursorGeometry(): void {\n    this.preparedFocusedGeometry = null;', '  invalidateFocusedCellCursorGeometry(): void {\n    this.discardPointerHitGeometry();\n    this.preparedFocusedGeometry = null;');
  replace('    this.position = this.isInHeaderFooter()||this.isInFootnote()?{...pos}:this.wasm.bodyPositionFromText(pos);\n    this.atLineEnd = false;', '    this.position = this.isInHeaderFooter()||this.isInFootnote()?{...pos}:this.wasm.bodyPositionFromText(pos);\n    this.discardPointerHitGeometry();\n    this.atLineEnd = false;');
  replace('  moveToHit(pos: DocumentPosition): void {\n    this.position = { ...pos };', `  moveToHit(pos: DocumentPosition): void {
    this.position = { ...pos, cursorRect: pos.cursorRect ? { ...pos.cursorRect } : undefined };
    this.pointerHitPosition = pos.cursorRect ? {
      ...pos,
      cellPath: pos.cellPath?.map(entry => ({ ...entry })),
      bodyCursor: pos.bodyCursor ? { ...pos.bodyCursor } : undefined,
    } : null;`);
  for(const method of ['moveToLineStart','moveToLineEnd'])replace('  '+method+'(): void {\n    this.preferredX = null;', '  '+method+'(): void {\n    this.discardPointerHitGeometry();\n    this.preferredX = null;');
  replace('  private getCursorRectOnVisualLine(lineIndex: number, atEnd: boolean): CursorRect | null {\n    const pos = this.position;', `  private getCursorRectOnVisualLine(lineIndex: number, atEnd: boolean): CursorRect | null {
    const pos = this.position;
    // The flat line API cannot identify an inner cell. Preserve the logical
    // endpoint, then let updateRect query its full path instead of a root cell.
    if ((pos.cellPath?.length ?? 0) > 1) return null;`);
  replace('  updateRect(): void {\n    try {', '  updateRect(): void {\n    const pointerHitRect = this.currentPointerHitRect();\n    try {');
  replace(`      // WASM 결과가 hitTest의 cursorRect와 페이지가 다르면 잘못된 좌표 → 폴백
      if (this.rect && this.position.cursorRect &&
          this.rect.pageIndex !== this.position.cursorRect.pageIndex) {
        console.warn('[CursorState] 캐럿 페이지 불일치 (WASM=%d, hitTest=%d) → hitTest 폴백',
          this.rect.pageIndex, this.position.cursorRect.pageIndex);
        this.rect = { ...this.position.cursorRect };
      }`, `      // Only a fresh pointer hit may retain its frame affinity when the same
      // logical address appears in several saved frames. A moved address must
      // accept the native query's page; a historical hit is not contrary proof.
      if (this.rect && pointerHitRect &&
          this.rect.pageIndex !== pointerHitRect.pageIndex) {
        console.warn('[CursorState] 캐럿 페이지 불일치 (WASM=%d, hitTest=%d) → 현재 hitTest 폴백',
          this.rect.pageIndex, pointerHitRect.pageIndex);
        this.rect = { ...pointerHitRect };
      }`);
  replace('      if (pos.cursorRect) {\n        console.warn', '      if (pointerHitRect) {\n        console.warn');
  replace('        this.rect = { ...pos.cursorRect };\n      } else {\n        // 인라인 컨트롤', '        // The captured hit may serve this failed query once. Invalidation\n        // above has already removed persistent hit authority for later calls.\n        this.rect = { ...pointerHitRect };\n      } else {\n        // 인라인 컨트롤');
  return '// '+marker+'\n'+code;
}

export async function patchPointerHitGeometry(studio) {
  const file=path.join(studio,'src/engine/cursor.ts');
  const original=await fs.readFile(file,'utf8'),candidate=transformPointerHitGeometry(original);
  if(candidate!==original)await fs.writeFile(file,candidate);
}
