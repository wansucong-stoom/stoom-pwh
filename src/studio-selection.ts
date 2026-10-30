/** Read-only semantic context for the local rhwp Studio 0.8.7 build.
 * Uses public InputHandler/WasmBridge methods; never borrows a mutable document.
 */
import {selectionPageHints} from './selection-page-context.mjs';
type BridgeDependencies = {
  getInputHandler: () => any;
  wasm: any;
  getDocumentAgent?: () => any;
  getCanvasView?: () => any;
};

const MAX_TEXT = 6000;
const MAX_PARAGRAPHS = 24;
const MAX_CELLS = 256;
const MAX_SCANNED_CELLS = 256;
const MAX_RECTS = 96;

function plain(value: any, depth = 0): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, MAX_TEXT);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (depth > 7 || typeof value !== 'object' || ArrayBuffer.isView(value)) return null;
  if (Array.isArray(value)) return value.slice(0, MAX_RECTS).map((item) => plain(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 80)
    .filter(([, item]) => typeof item !== 'function')
    .map(([key, item]) => [key, plain(item, depth + 1)]));
}

function cellPath(position: any, paragraph?: number, cell?: number): any[] {
  const path = (position?.cellPath || []).map((entry: any) => ({
    controlIndex: entry.controlIndex ?? entry.controlIdx,
    cellIndex: entry.cellIndex ?? entry.cellIdx,
    cellParaIndex: entry.cellParaIndex ?? entry.cellParaIdx ?? 0,
  }));
  if (path.length) {
    if (paragraph !== undefined) path[path.length - 1].cellParaIndex = paragraph;
    if (cell !== undefined) path[path.length - 1].cellIndex = cell;
  }
  return path;
}

function paragraphIndex(position: any): number {
  return cellPath(position).at(-1)?.cellParaIndex ?? position.cellParaIndex ?? position.paragraphIndex;
}

function sameContainer(left: any, right: any): boolean {
  if (!left || !right || left.sectionIndex !== right.sectionIndex) return false;
  if (left.parentParaIndex === undefined || right.parentParaIndex === undefined)
    return left.parentParaIndex === undefined && right.parentParaIndex === undefined;
  if (left.parentParaIndex !== right.parentParaIndex) return false;
  const a = cellPath(left), b = cellPath(right);
  if (a.length || b.length) return JSON.stringify(a.map(({ controlIndex, cellIndex }) => [controlIndex, cellIndex]))
    === JSON.stringify(b.map(({ controlIndex, cellIndex }) => [controlIndex, cellIndex]));
  return left.controlIndex === right.controlIndex && left.cellIndex === right.cellIndex;
}

export function installSelectionBridge(deps: BridgeDependencies) {
  const studioWindow = window as any;

  function getSelectionContext(options: { fresh?: boolean } = {}) {
    const input = deps.getInputHandler();
    const unknown: string[] = [];
    let remainingText = MAX_TEXT;
    const read = (label: string, target: any, method: string, ...args: any[]) => {
      if (typeof target?.[method] !== 'function') { unknown.push(`${label}: unavailable`); return null; }
      try { return target[method](...args); }
      catch { unknown.push(`${label}: read failed`); return null; }
    };
    const clip = (value: any) => {
      if (typeof value !== 'string') return { text: null, truncated: false };
      const characters = Array.from(value);
      const text = characters.slice(0, remainingText).join('');
      remainingText -= Array.from(text).length;
      return { text, truncated: characters.length > Array.from(text).length };
    };
    if (!input) return { schemaVersion: 1, ready: false, unknown: ['InputHandler is not ready'] };
    const cursor = read('cursor', input, 'getCursorPosition');
    if (!cursor) return { schemaVersion: 1, ready: false, unknown };
    const selection = read('text selection', input, 'getSelection');
    const inCellBlock = read('cell selection mode', input, 'isInCellSelectionMode') === true;
    const tableObject = read('table object selection', input, 'isInTableObjectSelection') === true;
    const pictureObject = read('picture object selection', input, 'isInPictureObjectSelection') === true;
    const inCell = cursor.parentParaIndex !== undefined;
    const normalTextContext = !inCellBlock && !tableObject && !pictureObject
      && read('text submode coverage', input, 'canEditHyperlink') === true;
    const kind = pictureObject ? 'object' : tableObject ? 'table_object' : inCellBlock ? 'cell_block'
      : normalTextContext ? (inCell ? (cursor.isTextBox ? 'textbox_text' : 'cell_text') : 'body_text')
        : 'unsupported_submode';
    if (kind === 'unsupported_submode') unknown.push('Header/footer/footnote coordinates are not exposed by this bridge.');

    function readRange(position: any, paragraph: number, start: number, requested: number) {
      const inContainer = position.parentParaIndex !== undefined;
      const path = cellPath(position, paragraph);
      const length = inContainer
        ? path.length
          ? read('cell paragraph length', deps.wasm, 'getCellParagraphLengthByPath', position.sectionIndex, position.parentParaIndex, JSON.stringify(path))
          : read('cell paragraph length', deps.wasm, 'getCellParagraphLength', position.sectionIndex, position.parentParaIndex, position.controlIndex, position.cellIndex, paragraph)
        : read('paragraph length', deps.wasm, 'getParagraphLength', position.sectionIndex, paragraph);
      if (!Number.isInteger(length) || length < 0) return { text: null, length: null, truncated: false };
      const wanted = Math.max(0, Math.min(requested, length - start));
      const count = Math.min(wanted, remainingText);
      const raw = inContainer
        ? path.length
          ? read('cell text', deps.wasm, 'getTextInCellByPath', position.sectionIndex, position.parentParaIndex, JSON.stringify(path), start, count)
          : read('cell text', deps.wasm, 'getTextInCell', position.sectionIndex, position.parentParaIndex, position.controlIndex, position.cellIndex, paragraph, start, count)
        : read('body text', deps.wasm, 'getTextRange', position.sectionIndex, paragraph, start, count);
      const clipped = clip(raw);
      return { ...clipped, length, truncated: clipped.truncated || wanted > count };
    }

    let selectedText: any = { text: null, truncated: false, known: false };
    let selectionRects: any[] = [];
    if (normalTextContext && selection?.start && selection?.end && sameContainer(selection.start, selection.end)) {
      const { start, end } = selection;
      const first = inCell ? paragraphIndex(start) : start.paragraphIndex;
      const last = inCell ? paragraphIndex(end) : end.paragraphIndex;
      const pieces: string[] = [];
      let truncated = false, known = true;
      for (let paragraph = first; paragraph <= Math.min(last, first + MAX_PARAGRAPHS - 1); paragraph++) {
        const from = paragraph === first ? start.charOffset : 0;
        const count = paragraph === last ? Math.max(0, end.charOffset - from) : Number.MAX_SAFE_INTEGER;
        const part = readRange(start, paragraph, from, count);
        if (part.text === null) known = false; else pieces.push(part.text);
        truncated ||= part.truncated;
        if (!remainingText && paragraph < last) { truncated = true; break; }
      }
      selectedText = { text: known ? pieces.join('\n') : null, known, truncated: truncated || last - first + 1 > MAX_PARAGRAPHS };
      const path = cellPath(start);
      const pageHints = selectionPageHints(start,end);
      const rects = !inCell
        ? read('selection rectangles', deps.wasm, 'getSelectionRects', start.sectionIndex, start.paragraphIndex, start.charOffset, end.paragraphIndex, end.charOffset)
        : path.length > 1
          ? read('selection rectangles', deps.wasm, 'getSelectionRectsInCellByPath', start.sectionIndex, start.parentParaIndex, JSON.stringify(path), first, start.charOffset, last, end.charOffset, pageHints)
          : read('selection rectangles', deps.wasm, 'getSelectionRectsInCell', start.sectionIndex, start.parentParaIndex, start.controlIndex, start.cellIndex, first, start.charOffset, last, end.charOffset, pageHints);
      selectionRects = Array.isArray(rects) ? rects.slice(0, MAX_RECTS) : [];
      if (Array.isArray(rects) && rects.length > MAX_RECTS) unknown.push('Selection rectangle list truncated.');
    } else if (normalTextContext && !selection) selectedText = { text: '', known: true, truncated: false };
    else if (selection && !sameContainer(selection.start, selection.end)) unknown.push('Selected text spans unsupported source containers.');

    const paragraph = normalTextContext ? {
      position: { ...cursor, charOffset: 0 },
      ...readRange(cursor, inCell ? paragraphIndex(cursor) : cursor.paragraphIndex, 0, Number.MAX_SAFE_INTEGER),
    } : null;
    const formatting = {
      character: read('current character properties', input, 'getCharProperties'),
      paragraph: read('current paragraph properties', input, 'getParaProperties'),
    };
    const tableRef = tableObject ? read('selected table', input, 'getSelectedTableRef')
      : inCellBlock ? read('selected cell table', input, 'getCellTableContext')
        : inCell && !cursor.isTextBox ? { sec: cursor.sectionIndex, ppi: cursor.parentParaIndex, ci: cursor.controlIndex, cellPath: cursor.cellPath } : null;
    let table: any = null;
    if (tableRef) {
      const path = cellPath(tableRef), nested = path.length > 1;
      const range = inCellBlock ? read('selected cell range', input, 'getSelectedCellRange') : null;
      const excluded = inCellBlock && read('excluded cells', input, 'hasExcludedCellSelection') === true;
      const dimensions = nested
        ? read('table dimensions', deps.wasm, 'getTableDimensionsByPath', tableRef.sec, tableRef.ppi, JSON.stringify(path))
        : read('table dimensions', deps.wasm, 'getTableDimensions', tableRef.sec, tableRef.ppi, tableRef.ci);
      const boxes = nested
        ? read('cell rectangles', deps.wasm, 'getTableCellBboxesByPath', tableRef.sec, tableRef.ppi, JSON.stringify(path))
        : read('cell rectangles', deps.wasm, 'getTableCellBboxes', tableRef.sec, tableRef.ppi, tableRef.ci);
      const selectedCells: any[] = [];
      let scanned = 0;
      if (excluded) unknown.push('Nonrectangular cell exclusions are not public; selectedCells is unknown.');
      else if (range && Number.isInteger(dimensions?.cellCount)) {
        for (let cell = 0; cell < Math.min(dimensions.cellCount, MAX_SCANNED_CELLS); cell++) {
          scanned++;
          const cellSource = { ...tableRef, cellPath: path };
          const cellInfo = nested
            ? read('cell information', deps.wasm, 'getCellInfoByPath', tableRef.sec, tableRef.ppi, JSON.stringify(cellPath(cellSource, 0, cell)))
            : read('cell information', deps.wasm, 'getCellInfo', tableRef.sec, tableRef.ppi, tableRef.ci, cell);
          if (!cellInfo) continue;
          if (cellInfo.row > range.endRow || cellInfo.col > range.endCol
            || cellInfo.row + cellInfo.rowSpan <= range.startRow || cellInfo.col + cellInfo.colSpan <= range.startCol) continue;
          if (selectedCells.length >= MAX_CELLS) break;
          selectedCells.push({ cellIndex: cell, ...cellInfo, source: { sec: tableRef.sec, ppi: tableRef.ppi, ci: tableRef.ci, ...(path.length ? { cellPath: cellPath(cellSource, 0, cell) } : {}) } });
        }
      }
      table = {
        source: tableRef, dimensions, selectedRange: range, selectedCells: excluded ? null : selectedCells,
        selectedCellsComplete: !excluded && (!range || scanned >= (dimensions?.cellCount ?? Infinity)),
        scannedCellCount: scanned,
        properties: nested ? null : read('table properties', deps.wasm, 'getTableProperties', tableRef.sec, tableRef.ppi, tableRef.ci),
        rectangles: Array.isArray(boxes) ? boxes.slice(0, MAX_RECTS) : [],
        rectanglesTruncated: Array.isArray(boxes) && boxes.length > MAX_RECTS,
      };
    }

    const refs = pictureObject ? read('selected objects', input, 'getSelectedPictureRefs') : [];
    const primary = pictureObject ? read('selected object', input, 'getSelectedPictureRef') : null;
    const objectRefs = Array.isArray(refs) && refs.length ? refs : primary ? [primary] : [];
    const objects = objectRefs.slice(0, 16).map((ref: any) => {
      let properties: any = null;
      const objectPath = ref.cellPath?.length ? ref.cellPath
        : ref.cellIdx !== undefined && ref.outerTableControlIdx !== undefined
          ? [{ controlIndex: ref.outerTableControlIdx, cellIndex: ref.cellIdx, cellParaIndex: ref.cellParaIdx ?? 0 }]
          : null;
      if (ref.headerFooter || ref.noteRef) unknown.push('Submode object properties omitted; source reference retained.');
      else if (ref.cellIdx !== undefined && !objectPath) unknown.push('Cell object parent path is incomplete; properties omitted.');
      else if (ref.type === 'shape' || ref.type === 'image') {
        const method = ref.type === 'shape' ? 'getShapeProperties' : 'getPictureProperties';
        properties = objectPath
          ? read('object properties', deps.wasm, ref.type === 'shape' ? 'getCellShapePropertiesByPath' : 'getCellPicturePropertiesByPath', ref.sec, ref.ppi, objectPath, ref.ci)
          : read('object properties', deps.wasm, method, ref.sec, ref.ppi, ref.ci);
      } else if (ref.type === 'equation') properties = read('equation properties', deps.wasm, 'getEquationProperties', ref.sec, ref.ppi, ref.ci, ref.cellIdx, ref.cellParaIdx);
      const bbox = ref.type === 'shape' && !objectPath && ref.cellIdx === undefined && !ref.headerFooter && !ref.noteRef
        ? read('shape rectangle', deps.wasm, 'getShapeBBox', ref.sec, ref.ppi, ref.ci) : null;
      return { source: ref, properties, bbox, geometry: properties?{unit:'HWPUNIT (7200 per inch)',widthMm:properties.width*25.4/7200,heightMm:properties.height*25.4/7200,frameAspectRatio:properties.height?properties.width/properties.height:null,preserveSize:true,preserveAspectRatio:true,preservePosition:true,rotationAngle:properties.rotationAngle,crop:{left:properties.cropLeft,top:properties.cropTop,right:properties.cropRight,bottom:properties.cropBottom},replacementFit:'contain; keep existing frame/crop/rotation, pad if incoming pixel aspect differs'}:null };
    });
    const agent = deps.getDocumentAgent?.();
    const stateMethod = options.fresh === false && typeof agent?.getPresentationDocumentState === 'function' ? 'getPresentationDocumentState' : 'getDocumentState';
    const documentState = agent ? read('document state', agent, stateMethod) : null;
    return plain({ schemaVersion: 1, ready: true, kind, documentState, cursor, selection,
      selectedText, paragraph, formatting, table, objects, selectionRects,
      coordinateSystem: 'Source indices are zero-based; rectangles use unzoomed page CSS pixels.',
      limits: { maxTextCodePoints: MAX_TEXT, maxParagraphs: MAX_PARAGRAPHS, maxCells: MAX_CELLS, maxScannedCells: MAX_SCANNED_CELLS, maxRectangles: MAX_RECTS },
      unknown: [...new Set(unknown)].slice(0, 24) });
  }

  function hitTest(point: { pageIndex?: number; x?: number; y?: number; clientX?: number; clientY?: number }) {
    let { pageIndex, x, y } = point || {};
    if (Number.isFinite(point?.clientX) && Number.isFinite(point?.clientY)) {
      const canvas = deps.getCanvasView?.(), virtual = canvas?.getVirtualScroll?.(), viewport = canvas?.getViewportManager?.();
      const content = document.getElementById('scroll-content');
      if (!virtual || !viewport || !content) return { ready: false, unknown: ['Viewport is not ready.'] };
      const bounds = content.getBoundingClientRect(), zoom = viewport.getZoom();
      const cx = point.clientX! - bounds.left, cy = point.clientY! - bounds.top;
      pageIndex = virtual.getPageAtPoint(cx, cy);
      x = (cx - virtual.getPageLeftResolved(pageIndex, content.clientWidth)) / zoom;
      y = (cy - virtual.getPageOffset(pageIndex)) / zoom;
    }
    if (!Number.isInteger(pageIndex) || pageIndex! < 0 || !Number.isFinite(x) || !Number.isFinite(y))
      throw new TypeError('Use pageIndex/x/y in page CSS pixels or clientX/clientY in the Studio iframe.');
    const position = deps.wasm.hitTest(pageIndex, x, y);
    let candidates: any[] = [];
    try {
      const controls = deps.wasm.getPageControlLayout(pageIndex)?.controls || [];
      candidates = controls.filter((item: any) => x! >= item.x && y! >= item.y && x! <= item.x + item.w && y! <= item.y + item.h).slice(0, 16);
    } catch { /* Text hit remains valid when the control layout is unavailable. */ }
    return plain({ schemaVersion: 1, ready: true, pageIndex, x, y, position, objectCandidates: candidates,
      coordinateSystem: 'unzoomed page CSS pixels; objectCandidates are intersecting bounds, not a final z-order selection' });
  }

  const bridge = Object.freeze({ schemaVersion: 1, getSelectionContext, hitTest });
  studioWindow.rhwpStudio ||= {};
  studioWindow.rhwpStudio.collaboration = bridge;
  return bridge;
}
