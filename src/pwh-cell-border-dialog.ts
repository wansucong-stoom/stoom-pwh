import {planCellBorders,applyCellBorderPlan,applyCellFillPlan} from './pwh-cell-border-grid.mjs';
import {showToast} from './toast';
import './pwh-cell-border-dialog.css';

type Edge = 'left'|'right'|'top'|'bottom'|'insideVertical'|'insideHorizontal';
const allEdges:Edge[]=['left','right','top','bottom','insideVertical','insideHorizontal'];
const sideFor:Record<Edge,string>={left:'Left',right:'Right',top:'Top',bottom:'Bottom',insideVertical:'Right',insideHorizontal:'Bottom'};

function geometry(d:any){
 const {sec,ppi,ci}=d.tableCtx,dims=d.wasm.getTableDimensions(sec,ppi,ci);
 const boxes=Array.from({length:dims.cellCount},(_,cellIdx)=>({cellIdx,...d.wasm.getCellInfo(sec,ppi,ci,cellIdx)}));
 return {dims,boxes};
}
function scope(d:any,kind:'border'|'bg'|'diag'){
 const radios=kind==='border'?d.borderScopeRadios:kind==='bg'?d.bgScopeRadios:d.diagScopeRadios;
 const {dims,boxes}=geometry(d);
 if(radios?.find((r:HTMLInputElement)=>r.checked)?.value==='all')return {range:{startRow:0,startCol:0,endRow:dims.rowCount-1,endCol:dims.colCount-1},boxes};
 if(d.selectionRange)return {range:{...d.selectionRange},boxes};
 const cell=boxes.find((b:any)=>b.cellIdx===d.cellIdx);if(!cell)throw Error('선택된 셀을 찾을 수 없습니다.');
 return {range:{startRow:cell.row,startCol:cell.col,endRow:cell.row+cell.rowSpan-1,endCol:cell.col+cell.colSpan-1},boxes};
}
function selected(boxes:any[],r:any){return boxes.filter(b=>b.row<=r.endRow&&b.row+b.rowSpan-1>=r.startRow&&b.col<=r.endCol&&b.col+b.colSpan-1>=r.startCol);}
function currentEdge(d:any,boxes:any[],r:any,edge:Edge){
 const cs=selected(boxes,r).filter(b=>edge==='left'?b.col===r.startCol:edge==='right'?b.col+b.colSpan-1===r.endCol:edge==='top'?b.row===r.startRow:edge==='bottom'?b.row+b.rowSpan-1===r.endRow:edge==='insideVertical'?b.col+b.colSpan-1<r.endCol:b.row+b.rowSpan-1<r.endRow);
 const {sec,ppi,ci}=d.tableCtx,values=cs.map(b=>d.wasm.getCellOwnProperties(sec,ppi,ci,b.cellIdx)['border'+sideFor[edge]]).filter(Boolean);
 if(!values.length)return null;const first=JSON.stringify(values[0]);return values.every(v=>JSON.stringify(v)===first)?values[0]:null;
}
function elem<K extends keyof HTMLElementTagNameMap>(tag:K,cls?:string){const e=document.createElement(tag);if(cls)e.className=cls;return e;}
function labeled(text:string,input:HTMLElement){const row=elem('label','pwh-border-field');const name=elem('span');name.textContent=text;row.append(name,input);return row;}
function button(label:string,callback:()=>void,cls=''){const b=elem('button',cls);b.type='button';b.textContent=label;b.addEventListener('click',callback);return b;}

export function createPwhBorderTab(d:any){
 const root=elem('div','pwh-border-tab'),layout=elem('div','pwh-border-layout'),controls=elem('div','pwh-border-controls');
 const type=elem('select','dialog-select');type.setAttribute('aria-label','선 종류');
 for(const [value,label] of [[0,'없음'],[1,'실선'],[2,'파선'],[3,'점선'],[4,'일점쇄선'],[5,'이점쇄선'],[6,'긴 파선'],[7,'원형 파선'],[8,'이중선']] as const){const o=elem('option');o.value=String(value);o.textContent=label;type.append(o);}type.value='1';
 const width=elem('select','dialog-select');width.setAttribute('aria-label','선 굵기');
 ['0.1','0.12','0.15','0.2','0.25','0.3','0.4','0.5','0.6','0.7','1.0','1.5','2.0','3.0','4.0','5.0'].forEach((v,i)=>{const o=elem('option');o.value=String(i);o.textContent=v+' mm';width.append(o);});width.value='1';
 const color=elem('input');color.type='color';color.value='#000000';color.setAttribute('aria-label','선 색');
 const immediate=elem('input');immediate.type='checkbox';immediate.checked=true;const check=elem('label','pwh-border-immediate');check.append(immediate,document.createTextNode('선 모양 바로 적용'));
 controls.append(labeled('종류',type),labeled('굵기',width),labeled('색',color),check);
 const previewArea=elem('div','pwh-border-preview-area'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 180 180');svg.classList.add('pwh-border-preview');svg.setAttribute('aria-label','셀 테두리 미리보기');
 const lines:Record<string,SVGLineElement>={};const coords:Record<Edge,number[]>={left:[5,5,5,175],right:[175,5,175,175],top:[5,5,175,5],bottom:[5,175,175,175],insideVertical:[90,5,90,175],insideHorizontal:[5,90,175,90]};
 for(const edge of allEdges){const line=document.createElementNS('http://www.w3.org/2000/svg','line'),v=coords[edge];['x1','y1','x2','y2'].forEach((k,i)=>line.setAttribute(k,String(v[i])));line.dataset.edge=edge;svg.append(line);lines[edge]=line;}
 const state:any={actions:{},marked:new Set<Edge>(),lines,type,width,color,immediate,scope:null};d.pwhBorderState=state;
 const pen=()=>({type:Number(type.value),width:Number(width.value),color:color.value});
 const choose=(edges:Edge[])=>{const available=new Set(availableEdges(d));state.marked=new Set(edges.filter(e=>available.has(e)));for(const e of state.marked)state.actions[e]=pen();refreshPwhBorderPreview(d);};
 const controlsFor:[Edge,string,string][]=[['left','왼쪽','left'],['right','오른쪽','right'],['top','위쪽','top'],['bottom','아래쪽','bottom'],['insideVertical','안쪽 세로','inside-v'],['insideHorizontal','안쪽 가로','inside-h']];
 const board=elem('div','pwh-border-board');board.append(svg);
 for(const [edge,label,cls] of controlsFor){const b=button(label,()=>choose([edge]),'pwh-edge pwh-edge-'+cls);b.setAttribute('aria-label',label+' 선');b.dataset.edge=edge;board.append(b);}
 previewArea.append(board);const presets=elem('div','pwh-border-presets');
 presets.append(button('모두',()=>choose(allEdges)),button('바깥쪽',()=>choose(['left','right','top','bottom'])),button('안쪽',()=>choose(['insideVertical','insideHorizontal'])));previewArea.append(presets);
 layout.append(controls,previewArea);root.append(layout);
 const applyPen=()=>{if(immediate.checked){for(const edge of state.marked)state.actions[edge]=pen();refreshPwhBorderPreview(d);}};
 for(const el of [type,width,color])el.addEventListener('change',applyPen);color.addEventListener('input',applyPen);
 root.append(d.buildScopeSection('border'));
 for(const radio of d.borderScopeRadios)radio.addEventListener('change',()=>refreshPwhBorderPreview(d));
 return root;
}
function availableEdges(d:any):Edge[]{const {range:r}=scope(d,'border');return allEdges.filter(e=>e!=='insideVertical'||d.applyMode!=='asOne'&&r.endCol>r.startCol).filter(e=>e!=='insideHorizontal'||d.applyMode!=='asOne'&&r.endRow>r.startRow);}
export function refreshPwhBorderPreview(d:any){
 const state=d.pwhBorderState;if(!state||!d.cellProps)return;const {range,boxes}=scope(d,'border'),available=new Set(availableEdges(d));
 for(const edge of allEdges){const b=state.actions[edge]??currentEdge(d,boxes,range,edge),line=state.lines[edge];line.setAttribute('stroke',b&&b.type!==0?b.color:'#cbd3d8');line.setAttribute('stroke-width',b&&b.type!==0?String(b.type===8?1:Math.max(1,Math.min(5,(b.width+2)*.6))):'1');const dashes:Record<number,string>={2:'7 4',3:'2 3',4:'8 3 2 3',5:'8 3 2 3 2 3',6:'12 4',7:'1 4'};line.setAttribute('stroke-dasharray',b&&b.type!==0?(dashes[b.type]??''):'3 3');line.setAttribute('stroke-linecap',b?.type===7?'round':'butt');line.classList.toggle('pwh-border-mixed',!b);line.classList.toggle('pwh-border-chosen',state.marked.has(edge));
  let second=line.parentElement?.querySelector(`line[data-double-edge="${edge}"]`) as SVGLineElement|null;if(b?.type===8){if(!second){second=line.cloneNode() as SVGLineElement;second.removeAttribute('data-edge');second.dataset.doubleEdge=edge;line.parentElement?.append(second);}second.setAttribute('stroke',b.color);second.setAttribute('stroke-width','1');second.setAttribute('stroke-dasharray','');second.setAttribute('transform',edge==='left'||edge==='right'||edge==='insideVertical'?'translate(3 0)':'translate(0 3)');}else second?.remove();
  const control=d.dialog.querySelector(`.pwh-edge[data-edge="${edge}"]`) as HTMLButtonElement|null;if(control)control.disabled=!available.has(edge);
 }
}

export function installPwhBorderDialog(d:any){
 const footer=d.dialog.querySelector('.dialog-footer') as HTMLElement|null;if(!footer)return;
 const confirm=footer.querySelector('.dialog-btn-primary') as HTMLButtonElement|null;if(confirm)confirm.textContent='설정';
 if(!footer.querySelector('[data-pwh-apply]')){const apply=button('적용',()=>{if(applyPwhBorderDialog(d))refreshPwhBorderPreview(d);},'dialog-btn');apply.dataset.pwhApply='1';footer.append(apply);}
 const bg=d.dialog.querySelector('[data-tab="background"].dialog-tab-panel'),diag=d.dialog.querySelector('[data-tab="diagonal"].dialog-tab-panel');
 const changed=(kind:string)=>(event:Event)=>{const target=event.target as HTMLElement;if(target instanceof HTMLInputElement&&target.name.endsWith('Scope'))return;d.pwhBorderState[kind]=true;};
 bg?.addEventListener('change',changed('bgDirty'));bg?.addEventListener('input',changed('bgDirty'));
 diag?.addEventListener('change',changed('diagDirty'));diag?.addEventListener('click',(e:Event)=>{if((e.target as Element).closest('.tcp-diag-btn'))d.pwhBorderState.diagDirty=true;});
 refreshPwhBorderPreview(d);
}
export function applyPwhBorderDialog(d:any):boolean{
 const state=d.pwhBorderState,actions=state.actions,hasBorders=Object.keys(actions).length>0;
 if(!hasBorders&&!state.bgDirty&&!state.diagDirty)return true;
 try{
  const ref=d.tableCtx, ih=d.services?.getInputHandler();if(!ih)throw Error('편집기를 다시 열고 시도해 주세요.');
  if((ih.getCellTableContext?.()?.cellPath?.length??0)>1)throw Error('중첩 표의 셀 테두리는 아직 변경할 수 없습니다.');
  if(ih.hasExcludedCellSelection?.())throw Error('선택에서 제외된 셀이 있습니다. 이어진 셀 영역을 선택해 주세요.');
  const borderScope=scope(d,'border'),borderPlan=hasBorders&&d.applyMode!=='asOne'?planCellBorders(borderScope.boxes,borderScope.range,actions):[];
  const bgScope=state.bgDirty?scope(d,'bg'):null,diagScope=state.diagDirty?scope(d,'diag'):null;
  const bgProps=d.bgColorRadio.checked?{fillType:'solid',fillColor:d.bgColorPicker.value,patternColor:d.bgPatternColorPicker.value,patternType:Number(d.bgPatternTypeSelect.value)}:{fillType:'none'};
  d.normalizeDiagonalExclusive();const diagProps={diagonalLine:Number(d.diagLineTypeSelect.value),diagonalSlash:d.diagSlashBits,diagonalBackSlash:d.diagBackSlashBits,diagonalWidth:Number(d.diagWidthSelect.value),diagonalColor:d.diagColorInput.value,centerLine:d.diagCenterLine};
  const cursor=ih.getCursorPosition();
  ih.executeOperation({kind:'snapshot',operationType:'cellBorderBackground',operation:(w:any)=>{
   if(d.applyMode==='asOne'){
    const groups=[hasBorders?{...borderScope,props:Object.fromEntries(Object.entries(actions).filter(([k])=>['left','right','top','bottom'].includes(k)).map(([k,v])=>['border'+k[0].toUpperCase()+k.slice(1),v]))}:null,bgScope?{...bgScope,props:bgProps}:null,diagScope?{...diagScope,props:diagProps}:null].filter(Boolean);
    // Zone properties use a complete source style; the operation is explicit
    // because "as one cell" changes the whole selected zone.
    const zoneStyles=new Map<string,any>();for(const group of groups){const key=JSON.stringify((group as any).range),props={...(zoneStyles.get(key)??d.cellProps),...(group as any).props};const result=w.setCellZoneProperties(ref.sec,ref.ppi,ref.ci,(group as any).range,props);if(!result?.ok)throw Error('선택 영역에 적용하지 못했습니다.');zoneStyles.set(key,props);}
   }else{
    if(hasBorders)applyCellBorderPlan(w,ref,borderPlan);
    const applyProps=(group:any,props:any)=>{if(!group)return;applyCellFillPlan(w,ref,selected(group.boxes,group.range).map((b:any)=>b.cellIdx),props);};
    applyProps(bgScope,bgProps);applyProps(diagScope,diagProps);
   }
   return cursor;
  }});
  state.actions={};state.marked.clear();state.bgDirty=false;state.diagDirty=false;d.cellProps=d.wasm.getCellOwnProperties(ref.sec,ref.ppi,ref.ci,d.cellIdx);return true;
 }catch(error){showToast({message:error instanceof Error?error.message:'셀 테두리/배경을 적용하지 못했습니다.',durationMs:8000});return false;}
}
