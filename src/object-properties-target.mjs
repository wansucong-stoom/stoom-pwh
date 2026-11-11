// Table object selection owns its address independently of the text caret.
// The full nested path owns the dialog; it must never degrade to a flat address.
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
  if (!path?.length && !selected && pos?.isTextBox) return null;
  if (path && (!Array.isArray(path) || path.some(entry => !entry ||
    ['controlIndex','cellIndex','cellParaIndex'].some(key => !Number.isSafeInteger(entry[key]) || entry[key] < 0)))) return null;
  const cellIdx = selected ? 0 : pos?.cellIndex;
  if (!Number.isInteger(cellIdx) || cellIdx < 0) return null;
  return {
    tableCtx: {sec: ref.sec, ppi: ref.ppi, ci: ref.ci, ...(path?.length > 1 ? {cellPath:path.map(entry=>({...entry}))} : {})},
    cellIdx,
    mode: selected ? 'table' : requestedMode,
  };
}
