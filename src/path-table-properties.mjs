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
  };
  return new Proxy(wasm, {get(target, key) {
    if (key === 'pwhTablePropertiesPath') return pathJson;
    if (Object.hasOwn(methods, key)) return methods[key];
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
}
