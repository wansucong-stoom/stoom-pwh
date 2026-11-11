// Single and double clicks share visible-page source-owned table addresses.
// Resize drag keeps its earlier mousedown priority.
import {isPointNearBoxBorder} from './table-border-selection.mjs';

function tableControlTarget(control) {
  if (control.type !== 'table' || control.headerFooter || control.noteRef || control.isTextBox) return null;
  const path=control.cellPath;
  // A paint ordering key can identify an unsupported nested record, but must
  // never be decoded into an editing address.
  if (!path && control.stableIndex?.length > 3) return null;
  if (path && (!Array.isArray(path) || path.length < 2 || path.some(entry => !entry ||
    ['controlIndex','cellIndex','cellParaIndex'].some(key => !Number.isSafeInteger(entry[key]) || entry[key] < 0)))) return null;
  const ref={sec:control.secIdx,ppi:path ? control.parentParaIdx : control.paraIdx,
    ci:path ? control.outerTableControlIdx : control.controlIdx,
    ...(path ? {cellPath:path.map(entry=>({...entry}))} : {})};
  if (![ref.sec,ref.ppi,ref.ci].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  return ref;
}

export function tableBorderAtPagePoint(input,page,pageX,pageY) {
  const zoom=input.viewportManager.getZoom();
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  let controls;try{controls=input.wasm.getPageControlLayout(page).controls;}catch{return null;}
  let best=null;
  for (const control of controls || []) {
    const ref=tableControlTarget(control);if(!ref)continue;
    let box={x:control.x,y:control.y,width:control.w,height:control.h};
    if (ref.cellPath && control.cells?.length) {
      const cells=control.cells.filter(c=>[c.x,c.y,c.w,c.h].every(Number.isFinite) && c.w >= 0 && c.h > 0);
      if (!cells.length)continue;
      const x=Math.min(...cells.map(c=>c.x)),y=Math.min(...cells.map(c=>c.y));
      box={x,y,width:Math.max(...cells.map(c=>c.x+c.w))-x,height:Math.max(...cells.map(c=>c.y+c.h))-y};
    }
    if(!isPointNearBoxBorder(pageX,pageY,box,zoom))continue;
    const distances=[];
    if(pageY>=box.y-10/zoom && pageY<=box.y+box.height+10/zoom)distances.push(Math.abs(pageX-box.x),Math.abs(pageX-box.x-box.width));
    if(pageX>=box.x-10/zoom && pageX<=box.x+box.width+10/zoom)distances.push(Math.abs(pageY-box.y),Math.abs(pageY-box.y-box.height));
    const distance=Math.min(...distances)*zoom,depth=ref.cellPath?.length || 1;
    if(!best || distance<best.distance-0.01 || Math.abs(distance-best.distance)<=0.01 && depth>best.depth)best={ref,distance,depth};
  }
  return best?.ref || null;
}

export function tablePropertiesAtPoint(input, clientX, clientY) {
  const scroll=input.container.querySelector('#scroll-content');
  if(!scroll)return null;
  const rect=scroll.getBoundingClientRect(),zoom=input.viewportManager.getZoom();
  if(!Number.isFinite(zoom)||zoom<=0)return null;
  const x=clientX-rect.left,y=clientY-rect.top;
  const page=input.virtualScroll.getPageAtPoint(x,y);if(page<0)return null;
  const px=(x-input.virtualScroll.getPageLeftResolved(page,scroll.clientWidth))/zoom;
  const py=(y-input.virtualScroll.getPageOffset(page))/zoom;
  if(typeof input.wasm.getPageControlLayout==='function')return tableBorderAtPagePoint(input,page,px,py);
  const near=ref=>ref.cellPath?.length>1
    ?input.isNestedTableBorderClick(page,px,py,ref.sec,ref.ppi,ref.cellPath)
    :input.isTableBorderClick(page,px,py,ref.sec,ref.ppi,ref.ci);
  const selected=input.cursor.isInTableObjectSelection()?input.cursor.getSelectedTableRef():null;
  let hit;try{hit=input.wasm.hitTest(page,px,py);}catch{return selected&&near(selected)?selected:null;}
  if(!hit||hit.paragraphIndex>=0xFFFFFF00)return null;
  if(hit.parentParaIndex!==undefined&&hit.controlIndex!==undefined&&!hit.isTextBox){
    const ref={sec:hit.sectionIndex,ppi:hit.parentParaIndex,ci:hit.controlIndex};
    if(hit.cellPath?.length>1){const nested={...ref,cellPath:hit.cellPath};if(near(nested))return nested;}
    if(selected&&near(selected))return selected;
    return near(ref)?ref:null;
  }
  if(selected&&near(selected))return selected;
  return input.findTableByOuterClick(page,px,py,hit.sectionIndex,hit.paragraphIndex);
}
