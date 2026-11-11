import {createPathTablePropertiesBridge} from './path-table-properties.mjs';

// Scope reads and snapshot mutations together. A dialog must never read an
// inner table then apply its cell indices through the outer table's flat API.
export function scopeTableCommandServices(services) {
  const input=services.getInputHandler();
  const context=input?.getCellTableContext?.();
  const position=input?.getCursorPosition?.();
  const sourcePath=context?.cellPath??position?.cellPath;
  if(!sourcePath||sourcePath.length<2)return services;
  const path=sourcePath.map(entry=>({...entry}));
  const scoped=createPathTablePropertiesBridge(services.wasm,path);
  const inputProxy=new Proxy(input,{get(target,key) {
    if(key==='executeOperation')return spec=>{
      if(spec.kind!=='snapshot'||typeof spec.operation!=='function') {
        throw Error('이 중첩 표 명령의 실행 취소 경로가 연결되지 않았습니다.');
      }
      const structural=/^(insertTable|deleteTableRow|deleteTableColumn|mergeTableCells|splitTableCell)/.test(spec.operationType);
      const before=target.getCursorPosition();
      const anchor=structural?scoped.getCellInfo(before.sectionIndex,before.parentParaIndex,0,before.cellIndex):null;
      const selection=structural?target.cursor?.captureCellSelection?.():null;
      let applied=false;
      const result=target.executeOperation({...spec,
        ...(selection&&!spec.selectionBefore?{selectionBefore:{mode:'cellBlock',state:selection}}:{}),operation:wasm=>{
        const owned=createPathTablePropertiesBridge(wasm,path);
        const position=spec.operation(owned);
        if(!position)return position;
        applied=true;
        if(!structural) {
          if(spec.operationType==='cellNumberFormat') {
            const cursorPath=position.cellPath??path;
            const length=wasm.getCellParagraphLengthByPath(position.sectionIndex,position.parentParaIndex,JSON.stringify(cursorPath));
            return {...position,charOffset:Math.min(position.charOffset,length)};
          }
          return position;
        }
        // Structural edits can replace cell indices. Clamp by row/column using
        // topology only; preserve every enclosing table's cell and paragraph.
        const pathJson=owned.pwhTablePropertiesPath;
        const dims=owned.getTableDimensions(before.sectionIndex,before.parentParaIndex,0);
        const row=Math.min(anchor.row,dims.rowCount-1),col=Math.min(anchor.col,dims.colCount-1);
        const cells=wasm.getTableCellLayout(before.sectionIndex,before.parentParaIndex,pathJson);
        if(!cells)throw Error('변경한 표의 셀 위치를 확인하지 못했습니다.');
        const hit=cells.find(c=>row>=c.row&&row<c.row+c.rowSpan&&col>=c.col&&col<c.col+c.colSpan);
        if(!hit)throw Error('변경한 표의 커서 위치를 찾지 못했습니다.');
        const cellPath=path.map(entry=>({...entry}));
        cellPath.at(-1).cellIndex=hit.cellIdx;cellPath.at(-1).cellParaIndex=0;
        return {...position,cellPath,cellIndex:hit.cellIdx,cellParaIndex:0,paragraphIndex:0,charOffset:0};
      }});
      if(applied&&structural)target.exitCellSelectionMode?.();
      return result;
    };
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
  return {...services,wasm:scoped,getInputHandler:()=>inputProxy};
}
