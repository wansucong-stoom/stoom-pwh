import type { CommandServices, EditorContext } from '@/command/types';
import type { InputHandler } from '@/engine/input-handler';
import type { WasmBridge } from '@/core/wasm-bridge';
import type { DocumentPosition, SectionDef } from '@/core/types';

function sectionEditAvailable(): boolean {
  return (globalThis as typeof globalThis & { __PWH_SECTION_EDIT__?: boolean }).__PWH_SECTION_EDIT__ === true;
}

export function canSplitSection(ctx: EditorContext): boolean {
  return sectionEditAvailable() && ctx.hasDocument && ctx.isEditable && !ctx.isFormMode && !ctx.inField
    && !ctx.inTable && !ctx.inCellSelectionMode && !ctx.inTableObjectSelection
    && !ctx.inPictureObjectSelection && !ctx.hasSelection;
}

export function splitSection(services: CommandServices, definition?: SectionDef): boolean {
  const input = services.getInputHandler();
  if (!input || !input.canEditHyperlink() || !canSplitSection(services.getContext())) return false;
  const pos: DocumentPosition = input.getPosition();
  if (pos.isTextBox || pos.parentParaIndex !== undefined || pos.cellPath?.length) return false;
  return editBoundary(input, services.wasm, pos, 'pwhSection', definition);
}

export function joinSectionAtBoundary(
  input: InputHandler, wasm: WasmBridge, pos: DocumentPosition, key: string,
): boolean {
  if (!sectionEditAvailable()) return false;
  let section = pos.sectionIndex;
  const offset = wasm.bodyPositionToLogical(pos);
  if (key === 'Backspace') {
    if (section === 0 || pos.paragraphIndex !== 0 || offset !== 0) return false;
  } else {
    if (section + 1 >= wasm.getSectionCount()
      || pos.paragraphIndex !== wasm.getParagraphCount(section) - 1
      || offset !== wasm.sectionBoundaryParagraphLength(section, pos.paragraphIndex)) return false;
    section++;
  }
  return editBoundary(input, wasm, {sectionIndex: section, paragraphIndex: 0, charOffset: 0}, 'pwhJoinSection');
}

function editBoundary(
  input: InputHandler, wasm: WasmBridge, pos: DocumentPosition,
  kind: 'pwhSection' | 'pwhJoinSection', definition?: SectionDef,
): boolean {
  const sectionCount = wasm.getSectionCount();
  input.executeOperation({
    kind: 'snapshot',
    operationType: kind === 'pwhSection' ? 'sectionBreak' : 'sectionJoin',
    operation: current => {
      const next = current.editSectionBoundary(pos, kind);
      if (definition) current.setSectionDef(next.sectionIndex, definition);
      return next;
    },
    meta: {actionId: 'page:section-break', domain: 'page', refresh: 'full', dirtyScope: 'document'},
  });
  return wasm.getSectionCount() !== sectionCount;
}
