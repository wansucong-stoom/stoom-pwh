import {ModalDialog} from '@/ui/dialog';
import './pwh-format-copy-dialog.css';
export type CopyFormatOptions={text:'character'|'paragraph'|'both';cellAttributes:boolean;cellBorders:boolean;cellBackground:boolean;target:'both'|'cell'};
export class PwhFormatCopyDialog extends ModalDialog {
 private choices=new Map<string,HTMLInputElement>();
 private keys:((event:KeyboardEvent)=>void)|null=null;
 constructor(private cells:boolean,private accept:(options:CopyFormatOptions)=>void,private restoreFocus:()=>void){super('모양 복사',370);}
 protected createBody():HTMLElement {
  const body=document.createElement('div');body.className='pwh-format-copy-body';
  const section=(legend:string)=>{const field=document.createElement('fieldset');const title=document.createElement('legend');title.textContent=legend;field.append(title);body.append(field);return field;};
  const input=(parent:HTMLElement,key:string,label:string,type:'radio'|'checkbox',name:string,checked=false,disabled=false)=>{
   const row=document.createElement('label');const control=document.createElement('input');control.type=type;control.name=name;control.value=key;control.checked=checked;control.disabled=disabled;row.append(control,document.createTextNode(label));parent.append(row);this.choices.set(key,control);return control;
  };
  const text=section('본문 모양 복사');input(text,'character','글자 모양','radio','pwh-copy-text',true);input(text,'paragraph','문단 모양','radio','pwh-copy-text');input(text,'both','글자 모양과 문단 모양 둘 다 복사','radio','pwh-copy-text');
  const cell=section('셀 모양 복사');for(const [key,label]of [['cellAttributes','셀 속성'],['cellBorders','셀 테두리'],['cellBackground','셀 배경']])input(cell,key,label,'checkbox','',false,!this.cells);
  const target=section('표에서 적용 대상');input(target,'target-both','본문 모양과 셀 모양 둘 다','radio','pwh-copy-target',true,!this.cells);input(target,'target-cell','셀 모양만','radio','pwh-copy-target',false,!this.cells);
  const note=document.createElement('p');note.className='pwh-format-copy-note';note.textContent=this.cells?'복사한 뒤 대상을 선택하고 Alt+C 또는 모양 붙이기로 적용합니다.':'셀 모양은 일반 표의 셀 안에서 복사할 수 있습니다. 스타일 복사는 아직 지원하지 않습니다.';body.append(note);
  return body;
 }
 protected onConfirm():boolean {
  const checked=(key:string)=>this.choices.get(key)?.checked===true;
  const options:CopyFormatOptions={text:checked('paragraph')?'paragraph':checked('both')?'both':'character',cellAttributes:checked('cellAttributes'),cellBorders:checked('cellBorders'),cellBackground:checked('cellBackground'),target:checked('target-cell')?'cell':'both'};
  if(options.target==='cell'&&!options.cellAttributes&&!options.cellBorders&&!options.cellBackground){this.choices.get('cellAttributes')?.focus();return false;}
  this.accept(options);return true;
 }
 override hide():void {if(this.keys)document.removeEventListener('keydown',this.keys,true);this.keys=null;super.hide();this.restoreFocus();}
 override show():void {
  super.show();this.dialog.classList.add('pwh-format-copy-dialog');const button=this.dialog.querySelector<HTMLButtonElement>('.dialog-btn-primary');if(button)button.textContent='복사';
  // The inherited modal captures non-input keys. Keep the new choices and
  // footer reachable from its initially focused confirmation button.
  this.keys=event=>{
   if(event.key==='Tab'){
    event.preventDefault();const controls=[...this.dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
    const at=controls.indexOf(document.activeElement as HTMLElement);controls[(at+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus();
   }else if(event.key===' '&&document.activeElement instanceof HTMLButtonElement){event.preventDefault();document.activeElement.click();}
  };document.addEventListener('keydown',this.keys,true);
 }
}
