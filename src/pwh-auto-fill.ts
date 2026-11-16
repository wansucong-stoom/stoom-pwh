import type {CommandDef,CommandServices} from '@/command/types';
import {ModalDialog} from './dialog';
import {showToast} from './toast';
import {autoFillLists,validateCustomList} from './auto-fill-lists.mjs';
import {autoFillDirection} from './auto-fill-pattern.mjs';
import {autoFillTableAccess} from './auto-fill-table.mjs';
import './pwh-auto-fill.css';

type FillList={id:string;label:string;values:string[]};
const preference=async(args:Record<string,unknown>={})=>{
 const host=(window as any).pwhAutoFillLists;
 if(typeof host!=='function')throw Error('사용자 정의 목록 저장 기능에 연결되지 않았습니다.');
 return await host(args) as FillList[];
};
function target(services:CommandServices){
 const input=services.getInputHandler();
 if(!input||input.hasExcludedCellSelection())throw Error('연속된 셀 블록을 선택하세요.');
 const position=structuredClone(input.getCursorPosition());
 const access=autoFillTableAccess(services.wasm,position);
 const cell=access.cells.find((cell:any)=>cell.index===position.cellIndex);
 if(!cell)throw Error('채울 셀을 선택하세요.');
 const selectionRange=input.getSelectedCellRange();
 const range=selectionRange??{startRow:cell.row,endRow:cell.row,startCol:cell.col,endCol:cell.col};
 const selection=(input as any).cursor?.captureCellSelection?.()??null;
 return {input,position,range:{...range},selection,hadCellSelection:!!selectionRange,generation:services.wasm.documentGeneration};
}
function apply(services:CommandServices,captured:ReturnType<typeof target>,options:any){
 if(services.wasm.documentGeneration!==captured.generation)throw Error('문서가 바뀌었습니다. 셀을 다시 선택하세요.');
 const currentPosition=captured.input.getCursorPosition();
 const tableKey=(p:any)=>JSON.stringify([p.sectionIndex,p.parentParaIndex,p.controlIndex,(p.cellPath??[]).map((entry:any,index:number,array:any[])=>index===array.length-1?{...entry,cellIndex:0,cellParaIndex:0}:entry)]);
 const currentRange=captured.input.getSelectedCellRange();
 const sameRange=captured.hadCellSelection?
  currentRange&&['startRow','startCol','endRow','endCol'].every(key=>(currentRange as any)[key]===(captured.range as any)[key]):
  !currentRange&&currentPosition.cellIndex===captured.position.cellIndex;
 const currentSelection=(captured.input as any).cursor?.captureCellSelection?.()??null;
 const endpoints=(selection:any)=>JSON.stringify([selection?.anchor,selection?.focus]);
 if(tableKey(currentPosition)!==tableKey(captured.position)||!sameRange||endpoints(currentSelection)!==endpoints(captured.selection))
  throw Error('선택한 셀이 바뀌었습니다. 다시 실행하세요.');
 const access=autoFillTableAccess(services.wasm,captured.position);
 const plan=access.plan(captured.range,{...options,selection:captured.selection}),prepared=access.prepare(plan);
 if(!prepared.some((edit:any)=>edit.old.text!==edit.text)){
  showToast({message:'선택한 범위에 채울 빈 셀이 없습니다.'});return;
 }
 const selection=(captured.input as any).cursor?.captureCellSelection?.();
 captured.input.executeOperation({kind:'snapshot',operationType:'pwh-auto-fill',
  ...(selection?{selectionBefore:{mode:'cellBlock',state:selection}}:{}),
  operation:wasm=>{
   const current=autoFillTableAccess(wasm,captured.position);
   for(const edit of prepared)if(current.read(edit.cellIndex).text!==edit.old.text)throw Error('셀 내용이 바뀌었습니다. 다시 선택하세요.');
   current.apply(prepared);
   return {...captured.position,charOffset:0};
  },
 });
 showToast({message:plan.edits.length+'개 셀을 채웠습니다.'});
}

class AutoFillDialog extends ModalDialog {
 private captured:ReturnType<typeof target>;
 private custom:FillList[]=[];
 private selected:FillList|null=null;
 private listBox!:HTMLSelectElement;
 private preview!:HTMLParagraphElement;
 private error!:HTMLParagraphElement;
 private customPanel!:HTMLDivElement;
 private listTab='basic';
 private busy=false;
 constructor(private services:CommandServices){
  super('자동 채우기 내용',600);
  this.captured=target(services);
 }
 show(){
  super.show();this.dialog.classList.add('pwh-autofill-dialog');
  this.dialog.querySelector('.dialog-btn-primary')!.textContent='채우기';
  void preference().then(lists=>{this.custom=lists;if(this.listTab==='custom')this.populate();this.updatePreview();})
   .catch(error=>{this.error.textContent=error.message;});
 }
 protected createBody():HTMLElement {
  const body=document.createElement('div');
  const description=document.createElement('p');
  description.textContent='목록을 선택하면 드래그한 방향으로 선택 범위의 빈 셀만 채웁니다.';
  body.append(description);
  {
   const tabs=document.createElement('div');tabs.className='pwh-autofill-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','자동 채우기 목록');
   for(const [id,label]of [['basic','기본'],['custom','사용자 정의']]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(id===this.listTab));
    button.onclick=()=>{this.listTab=id;for(const tab of tabs.children)tab.setAttribute('aria-selected',String(tab===button));this.populate();};
    tabs.append(button);
   }
   this.listBox=document.createElement('select');this.listBox.size=9;this.listBox.setAttribute('aria-label','자동 채우기 목록');this.listBox.className='pwh-autofill-lists';
   this.listBox.onchange=()=>{this.selected=this.displayLists().find(list=>list.id===this.listBox.value)??null;this.updatePreview();};
   this.customPanel=document.createElement('div');this.customPanel.className='pwh-autofill-custom';this.customPanel.hidden=true;
   const name=document.createElement('input');name.placeholder='목록 이름';name.setAttribute('aria-label','사용자 정의 목록 이름');name.maxLength=80;
   const values=document.createElement('textarea');values.rows=3;values.placeholder='항목을 쉼표나 줄바꿈으로 구분하세요.';values.setAttribute('aria-label','사용자 정의 목록 항목');
   const actions=document.createElement('div');actions.className='pwh-autofill-actions';
   const add=document.createElement('button');add.type='button';add.textContent='추가';
   add.onclick=()=>void this.saveCustom({upsert:{id:crypto.randomUUID(),label:name.value,values:values.value.split(/[,\n]/).map(v=>v.trim()).filter(Boolean)}},()=>{name.value='';values.value='';});
   const remove=document.createElement('button');remove.type='button';remove.textContent='삭제';
   remove.onclick=()=>{if(this.selected)void this.saveCustom({remove:this.selected.id});};
   actions.append(add,remove);this.customPanel.append(name,values,actions);body.append(tabs,this.listBox,this.customPanel);
   this.populate();
  }
  this.preview=document.createElement('p');this.preview.className='pwh-autofill-preview';this.preview.setAttribute('aria-live','polite');
  this.error=document.createElement('p');this.error.className='pwh-autofill-error';this.error.setAttribute('role','alert');
  body.append(this.preview,this.error);
  queueMicrotask(()=>this.updatePreview());return body;
 }
 private displayLists():FillList[]{return this.listTab==='custom'?this.custom:autoFillLists as unknown as FillList[];}
 private populate(){
  this.listBox.replaceChildren();
  for(const list of this.displayLists()){
   const option=document.createElement('option');option.value=list.id;option.textContent=list.values.join(', ');option.title=list.label+' — '+option.textContent;this.listBox.append(option);
  }
  this.listBox.selectedIndex=this.listBox.options.length?0:-1;
  this.selected=this.displayLists()[0]??null;this.customPanel.hidden=this.listTab!=='custom';
  if(this.preview)this.updatePreview();
 }
 private options(){return {selection:this.captured.selection,list:this.selected};}
 private updatePreview(){
  if(!this.preview)return;
  try{
   if(!this.selected)throw Error('채울 목록을 선택하거나 사용자 정의 목록을 추가하세요.');
   const plan=autoFillTableAccess(this.services.wasm,this.captured.position).plan(this.captured.range,this.options());
   const direction={up:'위로',down:'아래로',left:'왼쪽으로',right:'오른쪽으로'}[autoFillDirection(this.captured.range,this.captured.selection)];
   this.preview.textContent=direction+' · '+plan.pattern+' · 빈 셀 '+plan.edits.length+'개'+(plan.edits.length?' · '+plan.edits.slice(0,5).map((e:any)=>e.text).join(' → '):'');
   this.error.textContent='';
  }catch(error){this.preview.textContent='';this.error.textContent=error instanceof Error?error.message:String(error);}
 }
 private async saveCustom(args:any,done?:()=>void){
  if(this.busy)return;this.busy=true;
  try{if(args.upsert)validateCustomList(args.upsert);this.custom=await preference(args);this.populate();done?.();}
  catch(error){this.error.textContent=error instanceof Error?error.message:String(error);}
  finally{this.busy=false;}
 }
 protected onConfirm():boolean {
  if(this.busy)return false;
  try{
   if(!this.selected)throw Error('목록을 선택하세요.');
   apply(this.services,this.captured,this.options());return true;
  }catch(error){this.error.textContent=error instanceof Error?error.message:String(error);return false;}
 }
}
const enabled=(ctx:any)=>ctx.hasDocument&&ctx.isEditable&&!ctx.isFormMode&&(ctx.inTable||ctx.inCellSelectionMode);
export const autoFillCommands:CommandDef[]=[
 {id:'table:auto-fill',label:'표 자동 채우기',shortcutLabel:'A',canExecute:ctx=>enabled(ctx)&&ctx.inCellSelectionMode,
  execute(services){
   let captured:ReturnType<typeof target>;try{captured=target(services);}catch(error){showToast({message:String(error)});return;}
   void preference().then(custom=>apply(services,captured,{lists:[...custom,...autoFillLists]}))
    .catch(error=>showToast({message:error.message,durationMs:6000}));
  }},
 {id:'table:auto-fill-list',label:'자동 채우기 내용…',opensDialog:true,canExecute:enabled,execute(services:CommandServices){
   try{new AutoFillDialog(services).show();}catch(error){showToast({message:error instanceof Error?error.message:String(error),durationMs:6000});}
  },
 },
];
