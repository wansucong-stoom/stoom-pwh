// Table object selection owns its address independently of the text caret.
// Nested table properties need by-path setters; the flat dialog cannot own them.
export function resolveTablePropertiesTarget(ih, requestedMode = 'table') {
  if (!ih) return null;
  const selected = ih.isInTableObjectSelection?.() ? ih.getSelectedTableRef?.() : null;
  const pos = ih.getCursorPosition?.();
  const cell = !selected && ih.getCellTableContext?.();
  const ref = selected || cell;
  if (!ref) return null;
  const values = [ref.sec, ref.ppi, ref.ci];
  if (!values.every(value => Number.isInteger(value) && value >= 0)) return null;
  const path = ref.cellPath || (!selected && pos?.cellPath);
  if (path?.length > 1 || (!selected && pos?.isTextBox)) return {unsupported: 'nested-table'};
  const cellIdx = selected ? 0 : pos?.cellIndex;
  if (!Number.isInteger(cellIdx) || cellIdx < 0) return null;
  return {
    tableCtx: {sec: ref.sec, ppi: ref.ppi, ci: ref.ci},
    cellIdx,
    mode: selected ? 'table' : requestedMode,
  };
}
