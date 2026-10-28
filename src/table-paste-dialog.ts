import {ModalDialog} from '@/ui/dialog';

export function chooseTablePaste(options: {htmlOnly?:boolean} = {}): Promise<'nested'|'overwrite'|null> {
 return new Promise(resolve=>{
  class TablePasteDialog extends ModalDialog {
   private choice: 'nested'|'overwrite'|null = null;
   constructor(){super('셀 붙이기',420);}
   protected createBody():HTMLElement {
    const body=document.createElement('div');
    body.textContent=options.htmlOnly?'셀 안에 표를 넣거나 기존 셀에 덮어쓸 수 있습니다. 덮어쓰기는 복사한 표가 들어갈 만큼의 셀이 필요하며, HTML이 전달한 서식만 유지할 수 있습니다.':'셀 안에 표를 넣거나 기존 셀에 덮어쓸 수 있습니다. 덮어쓰기는 복사한 표가 들어갈 만큼의 셀이 필요합니다.';
    return body;
   }
   protected onConfirm():void {this.choice='nested';}
   override show():void {
    super.show();this.dialog.setAttribute('role','dialog');this.dialog.setAttribute('aria-label','셀 붙이기');
    const primary=this.dialog.querySelector('.dialog-btn-primary') as HTMLButtonElement;
    primary.textContent='셀 안에 표로 넣기';
    const overwrite=document.createElement('button');overwrite.className='dialog-btn';overwrite.textContent='기존 셀에 붙이기';
    overwrite.onclick=()=>{this.choice='overwrite';this.hide();};primary.after(overwrite);
   }
   override hide():void {const choice=this.choice;this.choice=null;super.hide();resolve(choice);}
  }
  new TablePasteDialog().show();
 });
}
