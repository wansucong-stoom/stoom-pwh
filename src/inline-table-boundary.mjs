// The insertion gutter is outside an inline table. Its cells keep text editing
// and its top/bottom borders and resize handles retain their existing routes.
export function inlineTableBoundaryAtPoint(input,page,x,y,{drag=false}={}){
  const zoom=input.viewportManager.getZoom();if(!Number.isFinite(zoom)||zoom<=0)return null;
  try{
    const controls=input.wasm.getPageControlLayout(page).controls;
    const tables=controls.filter(t=>t.type==='table'&&!t.cellPath?.length&&!t.headerFooter&&!t.noteRef
      &&Number.isInteger(t.secIdx)&&Number.isInteger(t.paraIdx)&&Number.isInteger(t.controlIdx)
      &&[t.x,t.y,t.w,t.h].every(Number.isFinite)&&t.w>0&&t.h>0&&y>=t.y&&y<=t.y+t.h);
    for(const t of tables){
      const right=t.x+t.w,edge=x<t.x?t.x-x:x>right?x-right:Infinity;
      if(!drag&&(edge>6/zoom))continue;
      if(drag&&(x<t.x-6/zoom||x>right+6/zoom))continue;
      if(input.wasm.getTableProperties(t.secIdx,t.paraIdx,t.controlIdx).treatAsChar!==true)continue;
      const slot=input.wasm.getInlineControlPositions(t.secIdx,t.paraIdx).find(p=>p.controlIndex===t.controlIdx);if(!slot)continue;
      const after=drag?x>=t.x+t.w/2:x>right;
      const position=input.wasm.bodyPositionFromLogical({sectionIndex:t.secIdx,paragraphIndex:t.paraIdx,charOffset:slot.offset+(after?1:0)});
      return {...position,cursorRect:input.wasm.getBodyCursorRect(position)};
    }
  }catch{}
  return null;
}

export function inlineTableBoundaryFromClient(input,clientX,clientY,options){
  const scroll=input.container.querySelector('#scroll-content');if(!scroll)return null;
  const zoom=input.viewportManager.getZoom();if(!Number.isFinite(zoom)||zoom<=0)return null;
  const rect=scroll.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top;
  const page=input.virtualScroll.getPageAtPoint(x,y);if(page<0)return null;
  return inlineTableBoundaryAtPoint(input,page,(x-input.virtualScroll.getPageLeftResolved(page,scroll.clientWidth))/zoom,(y-input.virtualScroll.getPageOffset(page))/zoom,options);
}
