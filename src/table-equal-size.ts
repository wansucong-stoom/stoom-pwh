type Axis = 'width' | 'height';
type GridCell = {cellIdx: number; row: number; col: number; rowSpan: number; colSpan: number};
type Range = {startRow: number; endRow: number; startCol: number; endCol: number};
type Update = {cellIdx: number; widthDelta?: number; heightDelta?: number};

// Use the same shared grid and span semantics as Ctrl+Arrow. Distributing
// the integer remainder keeps the selected bands' combined size exact.
export function planEqualCellSizes(
  fragments: GridCell[],
  range: Range,
  axis: Axis,
  readSize: (cellIndex: number) => number,
): Update[] {
  const cells = [...new Map(fragments.map(cell => [cell.cellIdx, cell])).values()];
  const block = cells.filter(cell =>
    cell.row <= range.endRow && cell.row + cell.rowSpan > range.startRow &&
    cell.col <= range.endCol && cell.col + cell.colSpan > range.startCol);
  if (block.some(cell => cell.row < range.startRow || cell.row + cell.rowSpan > range.endRow + 1 ||
    cell.col < range.startCol || cell.col + cell.colSpan > range.endCol + 1)) return [];

  const width = axis === 'width';
  const first = width ? range.startCol : range.startRow;
  const last = width ? range.endCol : range.endRow;
  const count = last - first + 1;
  if (count < 2) return [];
  const start = (cell: GridCell) => width ? cell.col : cell.row;
  const span = (cell: GridCell) => width ? cell.colSpan : cell.rowSpan;
  const affected = cells.filter(cell => start(cell) <= last && start(cell) + span(cell) > first);
  const sizes = new Map(affected.map(cell => [cell.cellIdx, readSize(cell.cellIdx)]));
  const bands = Array<number>(count).fill(0);
  for (const cell of affected) {
    if (span(cell) !== 1) continue;
    const index = start(cell) - first;
    bands[index] = Math.max(bands[index], sizes.get(cell.cellIdx)!);
  }
  if (bands.some(size => !Number.isSafeInteger(size) || size < 200)) return [];
  const total = bands.reduce((sum, size) => sum + size, 0);
  const average = Math.floor(total / count);
  const remainder = total % count;
  const prefix = [0];
  for (let index = 0; index < count; index++) {
    prefix.push(prefix[index] + average + Number(index < remainder) - bands[index]);
  }
  const updates: Update[] = [];
  for (const cell of affected) {
    const from = Math.max(0, start(cell) - first);
    const to = Math.min(count, start(cell) + span(cell) - first);
    const size = sizes.get(cell.cellIdx)!;
    const delta = span(cell) === 1
      ? average + Number(from < remainder) - size
      : prefix[to] - prefix[from];
    if (!Number.isSafeInteger(size) || size + delta < 200 || size + delta > 0x7fffffff) return [];
    if (delta) updates.push(width ? {cellIdx: cell.cellIdx, widthDelta: delta} : {cellIdx: cell.cellIdx, heightDelta: delta});
  }
  return updates;
}
