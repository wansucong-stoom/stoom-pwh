/* eslint-disable @typescript-eslint/no-explicit-any */
import {allDrawingTools,isConnector,isPointDrawing,isLinear,drawingGeometry,constrainDrawingEnd,appendDrawingSample,connectorPath} from '../pwh-drawing-tools.mjs';
import {findNearestConnectionPoint,showConnectionPointOverlay,removeConnectionPointOverlay} from './input-handler-connector';
import {getObjectProps} from './object-props';
import {showToast} from '@/ui/toast';
import '../styles/pwh-shape-tools.css';

function stop(owner:any):void{
 const mode=owner._pwhDrawing;if(mode?.frame)cancelAnimationFrame(mode.frame);
 mode?.preview?.remove();owner._pwhDrawing=null;
 owner.connectorDrawingMode=false;owner.polygonDrawingMode=false;owner.textboxPlacementMode=false;
 owner.connectorStartRef=null;owner.textboxPlacementDrag=null;owner.polygonPoints=[];
 owner.hideTextboxPlacementOverlay?.();owner.cancelPolygonDrawing?.();
 removeConnectionPointOverlay.call(owner);owner.container.style.cursor='';
 document.removeEventListener('mouseup',owner.onMouseUpBound);
}
export function enterPwhDrawing(owner:any,type:string):void{
 stop(owner);owner.cancelImagePlacement?.();
 if(!allDrawingTools.some(tool=>tool.type===type))return;
 if(owner.isFormMode?.()){showToast({message:'도형을 그리려면 문서 편집 모드로 전환하세요.'});return;}
 owner._pwhDrawing={type,points:[]};owner.shapePlacementType=type;
 owner.connectorDrawingMode=isConnector(type);owner.polygonDrawingMode=isPointDrawing(type);
 owner.textboxPlacementMode=!owner.connectorDrawingMode&&!owner.polygonDrawingMode;
 owner.active=true;owner.container.style.cursor='crosshair';owner.focusTextarea();
 const message=isPointDrawing(type)?'꼭짓점을 클릭하고 더블클릭 또는 Enter로 마칩니다. Esc는 취소합니다.':
  isConnector(type)?'드래그하거나 시작점·끝점을 클릭하세요. 개체의 연결점에 가까우면 연결됩니다.':
  type==='textbox'?'문서에서 영역을 그린 뒤 글상자를 더블클릭해 내용을 입력하세요.':'문서에서 드래그하세요. Shift로 비율·방향을 맞추고 Esc로 취소합니다.';
 showToast({message,durationMs:3500});
}
function point(owner:any,event:MouseEvent):any{
 const p=owner.pagePointFromClientPoint(event.clientX,event.clientY);
 if(!p||p.pageIdx<0||p.pageX<0||p.pageY<0)return null;
 return{x:p.pageX,y:p.pageY,pageIdx:p.pageIdx};
}
function nearest(owner:any,mode:any,p:any):any{
 if(!isConnector(mode.type)||mode.anchor?.parentParaIndex!==undefined)return null;
 return findNearestConnectionPoint.call(owner,p.pageIdx,p.x,p.y,12,mode.startConnection?{sec:mode.startConnection.sec,ppi:mode.startConnection.ppi,ci:mode.startConnection.ci}:undefined);
}
function resolveAnchor(owner:any,p:any):any{
 const hit=owner.wasm.hitTest(p.pageIdx,p.x,p.y);
 const anchor=hit?.sectionIndex!==undefined?hit:owner.cursor.getPosition();
 return {...anchor,cellPath:anchor.cellPath?.map((entry:any)=>({...entry}))};
}
function screen(owner:any,pageIdx:number,p:any):{x:number;y:number}{
 const sc=owner.container.querySelector('#scroll-content'),r=sc.getBoundingClientRect(),zoom=owner.viewportManager.getZoom();
 return{x:r.left+owner.virtualScroll.getPageLeftResolved(pageIdx,sc.clientWidth)+p.x*zoom,y:r.top+owner.virtualScroll.getPageOffset(pageIdx)+p.y*zoom};
}
function preview(owner:any):void{
 const mode=owner._pwhDrawing;if(!mode?.start||!mode.end)return;
 mode.preview??=document.createElementNS('http://www.w3.org/2000/svg','svg');
 const svg=mode.preview as SVGSVGElement;svg.classList.add('pwh-drawing-preview');
 if(!svg.isConnected)document.body.append(svg);
 const start=screen(owner,mode.pageIdx,mode.start),end=screen(owner,mode.pageIdx,constrainDrawingEnd(mode.type,mode.start,mode.end,mode.shift));
 const left=Math.min(start.x,end.x),top=Math.min(start.y,end.y),width=Math.abs(end.x-start.x),height=Math.abs(end.y-start.y);
 let path='';
 if(isConnector(mode.type))path=connectorPath(mode.type,start.x,start.y,end.x,end.y);
 else if(mode.type==='line')path=`M${start.x} ${start.y}L${end.x} ${end.y}`;
 else if(isPointDrawing(mode.type)||mode.type==='freehand'){
  const points=[...mode.points,...(isPointDrawing(mode.type)?[mode.end]:[])].map(p=>screen(owner,mode.pageIdx,p));
  path=points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join('');
 }else if(mode.type==='ellipse')path=`M${left} ${top+height/2}a${width/2} ${height/2} 0 1 0 ${width} 0a${width/2} ${height/2} 0 1 0 -${width} 0`;
 else if(mode.type==='arc')path=`M${left+width/2} ${top}A${width/2} ${height/2} 0 0 1 ${left+width} ${top+height/2}`;
 else path=`M${left} ${top}h${width}v${height}H${left}Z`;
 const line=document.createElementNS(svg.namespaceURI,'path');line.setAttribute('d',path);line.setAttribute('fill','none');line.setAttribute('stroke','#3979bc');line.setAttribute('stroke-width','1.5');line.setAttribute('stroke-dasharray','5 3');
 svg.replaceChildren(line);
 if(mode.type.endsWith('-arrow')||mode.type.endsWith('-both')){
  const arrow=(from:any,to:any)=>{const angle=Math.atan2(to.y-from.y,to.x-from.x),p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',`M${to.x-9*Math.cos(angle-.45)} ${to.y-9*Math.sin(angle-.45)}L${to.x} ${to.y}L${to.x-9*Math.cos(angle+.45)} ${to.y-9*Math.sin(angle+.45)}`);p.setAttribute('fill','none');p.setAttribute('stroke','#3979bc');svg.append(p);};
  arrow(start,end);if(mode.type.endsWith('-both'))arrow(end,start);
 }
}
function schedulePreview(owner:any):void{
 const mode=owner._pwhDrawing;if(!mode||mode.frame)return;
 mode.frame=requestAnimationFrame(()=>{mode.frame=0;if(owner._pwhDrawing===mode)preview(owner);});
}
function cellPath(anchor:any):any[]{
 if(anchor.parentParaIndex===undefined)return [];
 return anchor.cellPath?.length?anchor.cellPath:[{controlIndex:anchor.controlIndex,cellIndex:anchor.cellIndex,cellParaIndex:anchor.cellParaIndex??0}];
}
function commit(owner:any,click=false):void{
 const mode=owner._pwhDrawing;if(!mode?.anchor||!mode.start||!mode.end){stop(owner);return;}
 if(isPointDrawing(mode.type)&&mode.points.length<(mode.type==='polygon'?3:2)){stop(owner);return;}
 const anchor=mode.anchor,path=cellPath(anchor),parent=anchor.parentParaIndex??anchor.paragraphIndex;
 const params:any={sectionIdx:anchor.sectionIndex,paraIdx:parent,charOffset:anchor.charOffset,
  shapeType:mode.type,treatAsChar:false,textWrap:'InFrontOfText',
  ...drawingGeometry(mode.type,mode.start,mode.end,{shift:mode.shift,click,points:isPointDrawing(mode.type)||mode.type==='freehand'?mode.points:[]})};
 if(path.length){
  params.parentParaIdx=parent;params.cellPath=path;
  const boxes=owner.wasm.getTableCellBboxesByPath(anchor.sectionIndex,parent,JSON.stringify(path));
  const box=boxes.find((b:any)=>b.cellIdx===path.at(-1).cellIndex&&b.pageIndex===mode.pageIdx);
  if(box){params.horzOffset=Math.max(0,params.horzOffset-Math.round(box.x*75));params.vertOffset=Math.max(0,params.vertOffset-Math.round(box.y*75));}
 }
 if(mode.startConnection){params.startSubjectID=mode.startConnection.instanceId||owner.wasm.getShapeProperties(mode.startConnection.sec,mode.startConnection.ppi,mode.startConnection.ci).scInstId||0;params.startSubjectIndex=mode.startConnection.index;}
 if(mode.endConnection){params.endSubjectID=mode.endConnection.instanceId||owner.wasm.getShapeProperties(mode.endConnection.sec,mode.endConnection.ppi,mode.endConnection.ci).scInstId||0;params.endSubjectIndex=mode.endConnection.index;}
 let result:any;stop(owner);
 try{
  owner.cursor.exitPictureObjectSelection();owner.cursor.exitTableObjectSelection();owner.cursor.exitCellSelectionMode();owner.cursor.clearSelection();owner.cursor.moveTo(anchor);
  owner.executeOperation({kind:'snapshot',operationType:'insertShape',operation:(wasm:any)=>{
   result=wasm.createShapeControl(params);if(!result?.ok)throw Error(result?.error||'도형을 삽입하지 못했습니다.');
   return {...anchor,charOffset:anchor.charOffset+8};
  }});
  if(!result?.ok)return;
  const last=path.at(-1);
  owner.cursor.enterPictureObjectSelectionDirect(anchor.sectionIndex,result.paraIdx,result.controlIdx,isLinear(mode.type)?'line':'shape',last?.cellIndex,last?.cellParaIndex,undefined,path[0]?.controlIndex,path.length?path:undefined,undefined,undefined,mode.pageIdx);
  owner.caret.hide();owner.selectionRenderer.clear();owner.renderPictureObjectSelection();owner.eventBus.emit('picture-object-selection-changed',true);owner.active=true;owner.focusTextarea();
 }catch(error){showToast({message:error instanceof Error?error.message:'도형을 삽입하지 못했습니다.',durationMs:6000});console.error('[Pwh drawing]',error);}
}
export function pwhDrawingDown(owner:any,event:MouseEvent):boolean{
 const mode=owner._pwhDrawing;if(!mode||event.button!==0)return false;
 if((event.target as Element).closest('#menu-bar,#icon-toolbar,#style-bar,.shape-picker,.dialog-overlay'))return false;
 const p=point(owner,event);if(!p)return true;event.preventDefault();owner.focusTextarea();
 if(!mode.start){mode.anchor=resolveAnchor(owner,p);mode.pageIdx=p.pageIdx;mode.startConnection=nearest(owner,mode,p);mode.start=mode.startConnection?{x:mode.startConnection.x,y:mode.startConnection.y}:p;mode.end={...mode.start};}
 if(p.pageIdx!==mode.pageIdx)return true;
 if(isPointDrawing(mode.type)){
  if(event.detail>1)return true;
  if(mode.type==='polygon'&&mode.points.length>=3&&Math.hypot(p.x-mode.points[0].x,p.y-mode.points[0].y)<8/owner.viewportManager.getZoom()){
   mode.points.push({...mode.points[0]});mode.end=p;commit(owner);return true;
  }
  mode.points.push(p);mode.end=p;schedulePreview(owner);return true;
 }
 if(mode.waiting){mode.endConnection=nearest(owner,mode,p);mode.end=mode.endConnection?{x:mode.endConnection.x,y:mode.endConnection.y}:p;commit(owner);return true;}
 mode.down=true;mode.end={...mode.start};mode.shift=event.shiftKey;
 if(mode.type==='freehand')mode.points=[{...mode.start}];
 document.addEventListener('mouseup',owner.onMouseUpBound,{once:true});schedulePreview(owner);return true;
}
export function pwhDrawingMove(owner:any,event:MouseEvent):boolean{
 const mode=owner._pwhDrawing;if(!mode)return false;
 const p=point(owner,event);if(!p||mode.pageIdx!==undefined&&p.pageIdx!==mode.pageIdx)return true;
 if(isConnector(mode.type))showConnectionPointOverlay.call(owner,p.pageIdx,p.x,p.y);
 if(!mode.start)return true;
 mode.shift=event.shiftKey;mode.endConnection=nearest(owner,mode,p);mode.end=mode.endConnection?{x:mode.endConnection.x,y:mode.endConnection.y}:p;
 if(mode.type==='freehand'&&mode.down)appendDrawingSample(mode.points,p,1.5/owner.viewportManager.getZoom());
 schedulePreview(owner);return true;
}
export function pwhDrawingUp(owner:any,event:MouseEvent):boolean{
 const mode=owner._pwhDrawing;if(!mode)return false;
 if(isPointDrawing(mode.type)||!mode.down)return true;
 pwhDrawingMove(owner,event);mode.down=false;
 const click=Math.hypot(mode.end.x-mode.start.x,mode.end.y-mode.start.y)*owner.viewportManager.getZoom()<3;
 if(isConnector(mode.type)&&click){mode.waiting=true;return true;}
 if(mode.type==='freehand'){appendDrawingSample(mode.points,mode.end,0);if(mode.points.length<2){stop(owner);return true;}}
 commit(owner,click);return true;
}
export function pwhDrawingKey(owner:any,event:KeyboardEvent):boolean{
 const mode=owner._pwhDrawing;if(!mode)return false;event.preventDefault();event.stopPropagation();
 if(event.key==='Escape'){stop(owner);return true;}
 if(event.key==='Enter'&&isPointDrawing(mode.type)){commit(owner);return true;}
 if(event.key==='Backspace'&&isPointDrawing(mode.type)){mode.points.pop();if(!mode.points.length)stop(owner);else schedulePreview(owner);}
 return true;
}
export function pwhDrawingDoubleClick(owner:any,event:MouseEvent):boolean{
 if(!owner.active||(event.target as Element).closest('#menu-bar,#icon-toolbar,#style-bar,.shape-picker,.dialog-overlay'))return false;
 if(owner._pwhDrawing&&isPointDrawing(owner._pwhDrawing.type)){event.preventDefault();commit(owner);return true;}
 const p=point(owner,event);
 const ref=owner.cursor.isInPictureObjectSelection()?owner.cursor.getSelectedPictureRef():p?owner.findPictureAtClick(p.pageIdx,p.x,p.y):null;
 if(!ref||!['line','shape'].includes(ref.type))return false;
 const props=getObjectProps(owner.wasm,ref);
 if(props?.tbMarginLeft!==undefined){
  if(!ref.cellPath?.length)return false;
  owner.cursor.exitPictureObjectSelection();owner.pictureObjectRenderer?.clear();owner.eventBus.emit('picture-object-selection-changed',false);
  const path=[...ref.cellPath.map((entry:any)=>({...entry})),{controlIndex:ref.ci,cellIndex:0,cellParaIndex:0}];
  owner.cursor.moveTo({sectionIndex:ref.sec,parentParaIndex:ref.ppi,paragraphIndex:0,charOffset:0,cellPath:path,controlIndex:ref.ci,cellIndex:0,cellParaIndex:0,isTextBox:true});owner.updateCaret();owner.focusTextarea();return true;
 }
 event.preventDefault();owner.eventBus.emit('pwh-picture-properties-request');return true;
}
