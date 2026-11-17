import {drawingTools,connectorTools} from '../pwh-drawing-tools.mjs';
export type ShapeType=string;
export interface ShapePickerOptions{onSelect:(type:ShapeType)=>void;}
let current:HTMLDivElement|null=null;
let restoreFocus:HTMLElement|null=null;
function close(restore=true):void{
 current?.remove();current=null;
 document.removeEventListener('mousedown',outside,true);document.removeEventListener('keydown',keyboard,true);
 if(restore&&restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true});restoreFocus=null;
}
function outside(event:MouseEvent):void{if(current&&!current.contains(event.target as Node))close(false);}
function keyboard(event:KeyboardEvent):void{
 if(!current||event.ctrlKey||event.metaKey||event.altKey)return;
 event.stopPropagation();event.preventDefault();
 const buttons=[...current.querySelectorAll<HTMLButtonElement>('button')],at=buttons.indexOf(document.activeElement as HTMLButtonElement);
 if(event.key==='Escape'||event.key==='Tab'){close();return;}
 if(event.key==='Enter'||event.key===' '){buttons[Math.max(0,at)]?.click();return;}
 const index=Math.max(0,at),split=drawingTools.length;
 const delta=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
 const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:
  event.key==='ArrowDown'?(index<split?split+index:index):
  event.key==='ArrowUp'?(index>=split?Math.min(split-1,index-split):index):
  (index+delta+buttons.length)%buttons.length;
 if(delta||['Home','End','ArrowDown','ArrowUp'].includes(event.key))buttons[next]?.focus();
}
function icon(type:string,path:string):SVGSVGElement{
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 28 28');svg.setAttribute('aria-hidden','true');
 const p=document.createElementNS(ns,'path');p.setAttribute('d',path);p.setAttribute('fill','none');p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width','1.2');svg.append(p);
 if(type.includes('-arrow')||type.includes('-both')){
  const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d',type.includes('-stroke')||type.includes('-arc')?'M21 9l4-4 2 5':'M19 5h6v6');arrow.setAttribute('fill','none');arrow.setAttribute('stroke','currentColor');svg.append(arrow);
 }
 if(type.includes('-both')){const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d','M3 17v6h6');arrow.setAttribute('fill','none');arrow.setAttribute('stroke','currentColor');svg.append(arrow);}
 return svg;
}
export function showShapePicker(anchorEl:HTMLElement,opts:ShapePickerOptions):void{
 if(current){close();return;}
 restoreFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
 const panel=document.createElement('div');panel.className='shape-picker pwh-shape-picker';panel.setAttribute('role','menu');panel.setAttribute('aria-label','도형과 연결선');
 panel.addEventListener('mousedown',event=>event.preventDefault());
 for(const [title,tools,connector] of [['그리기 개체',drawingTools,false],['연결선',connectorTools,true]] as const){
  const heading=document.createElement('div');heading.className='shape-picker-title';heading.textContent=title;panel.append(heading);
  const grid=document.createElement('div');grid.className='shape-picker-grid '+(connector?'pwh-connector-grid':'pwh-drawing-grid');
  for(const tool of tools){
   const button=document.createElement('button');button.type='button';button.className='shape-picker-btn';button.dataset.shape=tool.type;button.title=tool.label;button.setAttribute('aria-label',tool.label);button.setAttribute('role','menuitem');button.append(icon(tool.type,tool.path));
   button.addEventListener('click',()=>{close(false);opts.onSelect(tool.type);});grid.append(button);
  }
  panel.append(grid);
 }
 const hint=document.createElement('div');hint.className='pwh-shape-hint';hint.textContent='도형을 고른 뒤 문서에서 그리세요.';panel.append(hint);
 document.body.append(panel);current=panel;
 const rect=anchorEl.getBoundingClientRect();panel.style.position='fixed';
 panel.style.left=Math.max(4,Math.min(rect.left,innerWidth-panel.offsetWidth-4))+'px';
 panel.style.top=Math.max(4,Math.min(rect.bottom+2,innerHeight-panel.offsetHeight-4))+'px';
 document.addEventListener('mousedown',outside,true);document.addEventListener('keydown',keyboard,true);
 panel.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
}
