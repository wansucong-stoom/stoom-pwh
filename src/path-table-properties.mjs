// Bind the existing dialog to one immutable table path. All ordinary bridge
// methods keep their original receiver; no nested operation falls back outward.
export function changedPropertyFields(current, initial) {
  return Object.fromEntries(Object.entries(current).filter(([key,value]) => JSON.stringify(value)!==JSON.stringify(initial[key])));
}
export function tablePropertiesPathKey(cellPath) {
  if (!Array.isArray(cellPath) || cellPath.length < 2 || cellPath.some(entry =>
    !entry || ['controlIndex','cellIndex','cellParaIndex'].some(key => !Number.isSafeInteger(entry[key]) || entry[key] < 0))) {
    throw Error('Invalid nested table property path');
  }
  const ownedPath=cellPath.map(entry=>({controlIndex:entry.controlIndex,cellIndex:entry.cellIndex,cellParaIndex:entry.cellParaIndex}));
  ownedPath[ownedPath.length-1]={...ownedPath[ownedPath.length-1],cellIndex:0,cellParaIndex:0};
  return JSON.stringify(ownedPath);
}
export function createPathTablePropertiesBridge(wasm, cellPath) {
  const pathJson=tablePropertiesPathKey(cellPath);
  for (const method of ['getTablePropertiesByPath','setTablePropertiesByPath','getCellPropertiesByPath','setCellPropertiesByPath']) {
    if (typeof wasm[method] !== 'function') throw Error('이 코어는 중첩 표 속성을 지원하지 않습니다. 편집기와 코어를 함께 업데이트해 주세요.');
  }
  const methods = {
    getTableProperties: (sec, ppi) => wasm.getTablePropertiesByPath(sec, ppi, pathJson),
    setTableProperties: (sec, ppi, _ci, props) => wasm.setTablePropertiesByPath(sec, ppi, pathJson, props),
    getCellProperties: (sec, ppi, _ci, cell) => wasm.getCellPropertiesByPath(sec, ppi, pathJson, cell),
    setCellProperties: (sec, ppi, _ci, cell, props) => wasm.setCellPropertiesByPath(sec, ppi, pathJson, cell, props),
    getCellOwnProperties: (sec, ppi, _ci, cell) => required('getCellOwnPropertiesByPath', sec, ppi, pathJson, cell),
    getTableDimensions: (sec, ppi) => required('getTableDimensionsByPath', sec, ppi, pathJson),
    getTableCellBboxes: (sec, ppi) => required('getTableCellBboxesByPath', sec, ppi, pathJson),
    getCellInfo: (sec, ppi, _ci, cell) => {
      const owned=JSON.parse(pathJson);owned.at(-1).cellIndex=cell;
      return required('getCellInfoByPath',sec,ppi,JSON.stringify(owned));
    },
    getCellParagraphLength: (sec, ppi, _ci, cell, para) =>
      required('getCellParagraphLengthByPath',sec,ppi,cellParagraph(cell,para)),
    getTextInCell: (sec, ppi, _ci, cell, para, offset, count) =>
      required('getTextInCellByPath',sec,ppi,cellParagraph(cell,para),offset,count),
    deleteTextInCell: (sec, ppi, _ci, cell, para, offset, count) =>
      required('deleteTextInCellByPath',sec,ppi,cellParagraph(cell,para),offset,count),
    insertTextInCell: (sec, ppi, _ci, cell, para, offset, text) =>
      required('insertTextInCellByPath',sec,ppi,cellParagraph(cell,para),offset,text),
    setCellZoneProperties: (sec, ppi, _ci, range, props) =>
      required('setCellZonePropertiesByPath',sec,ppi,pathJson,range,props),
    insertTableRow: (sec, ppi, _ci, row, below) => structure(sec,ppi,{operation:below?'insert-row-below':'insert-row-above',row}),
    insertTableColumn: (sec, ppi, _ci, col, right) => structure(sec,ppi,{operation:right?'insert-col-right':'insert-col-left',col}),
    deleteTableRow: (sec, ppi, _ci, row) => structure(sec,ppi,{operation:'delete-row',row}),
    deleteTableColumn: (sec, ppi, _ci, col) => structure(sec,ppi,{operation:'delete-col',col}),
    mergeTableCells: (sec, ppi, _ci, row, col, endRow, endCol) => structure(sec,ppi,{operation:'merge-cells',row,col,endRow,endCol}),
    splitTableCell: (sec, ppi, _ci, row, col) => structure(sec,ppi,{operation:'split-cell',row,col}),
    splitTableCellInto: (sec, ppi, _ci, row, col, rows, cols, equalRowHeight, mergeFirst) =>
      structure(sec,ppi,{operation:'split-cell-into',row,col,rows,cols,equalRowHeight,mergeFirst}),
    splitTableCellsInRange: (sec, ppi, _ci, row, col, endRow, endCol, rows, cols, equalRowHeight) =>
      structure(sec,ppi,{operation:'split-cells-in-range',row,col,endRow,endCol,rows,cols,equalRowHeight}),
  };
  function cellParagraph(cell,para) {
    const owned=JSON.parse(pathJson);
    owned.at(-1).cellIndex=cell;owned.at(-1).cellParaIndex=para;
    return JSON.stringify(owned);
  }
  function required(name,...args) {
    if(typeof wasm[name]!=='function')throw Error('중첩 표 편집에는 편집기와 공통 코어를 함께 업데이트해야 합니다.');
    return wasm[name](...args);
  }
  function structure(sec,ppi,edit) {
    const result=required('editTableStructureByPath',sec,ppi,pathJson,edit);
    if(!result?.ok)throw Error('선택한 중첩 표를 변경하지 못했습니다.');
    return result;
  }
  return new Proxy(wasm, {get(target, key) {
    if (key === 'pwhTablePropertiesPath') return pathJson;
    if (Object.hasOwn(methods, key)) return methods[key];
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
}
