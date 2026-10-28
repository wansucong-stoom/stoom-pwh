import { ModalDialog } from '@/ui/dialog';
import { classifyCellDeleteSelection } from './pwh-cell-delete-selection.mjs';

/** Ask before a structural deletion. Unsupported nested selections stay intact. */
export function confirmCellBlockDelete(input: any): void {
  const block = input.getSelectedCellBlock();
  if (!block || !block.cellIndices.length) return;
  const selection = input.cursor.captureCellSelection();
  const before = input.cursor.getPosition();
  let classification: any = {kind:'partial'};
  if (!block.cellPath) {
    const dims = input.wasm.getTableDimensions(block.sec, block.ppi, block.ci);
    const cells = Array.from({length:dims.cellCount}, (_, i) => input.wasm.getCellInfo(block.sec, block.ppi, block.ci, i));
    classification = classifyCellDeleteSelection({...dims,cells,selected:block.cellIndices});
  }
  const kind = classification.kind;
  const label = kind === 'rows' ? '선택한 줄 지우기' : kind === 'columns' ? '선택한 칸 지우기' : '';
  class CellDeleteDialog extends ModalDialog {
    private action: 'clear'|'structure'|'cancel' = 'cancel';
    constructor(){super('선택한 셀 지우기', 420);}
    protected createBody(): HTMLElement {
      const body=document.createElement('div');
      body.textContent=label ? '내용만 지우거나 선택한 줄/칸을 지울 수 있습니다.' : '선택한 셀의 내용을 지우고 셀 모양을 남깁니다.';
      return body;
    }
    protected onConfirm(): void { this.action='clear'; }
    override show(): void {
      super.show();
      this.dialog.setAttribute('role','alertdialog');
      const primary=this.dialog.querySelector('.dialog-btn-primary') as HTMLButtonElement;
      primary.textContent='내용만 지우기';
      if(label){
        const button=document.createElement('button');
        button.className='dialog-btn'; button.textContent=label;
        button.onclick=()=>{this.action='structure';this.hide();};
        primary.after(button);
      }
    }
    override hide(): void {
      const action=this.action; this.action='cancel';
      super.hide();
      if(action==='clear') { input.clearSelectedCellBlock(); input.updateCellSelection(); }
      if(action==='structure') {
        input.executeOperation({kind:'snapshot', operationType:'deleteSelectedTableLines',
          selectionBefore:selection?{mode:'cellBlock',state:selection}:null,
          operation:(wasm:any)=>{
            for(const index of [...classification.indices].reverse()) {
              const result=kind==='rows'?wasm.deleteTableRow(block.sec,block.ppi,block.ci,index):wasm.deleteTableColumn(block.sec,block.ppi,block.ci,index);
              if(!result.ok) throw new Error('선택한 줄/칸을 지우지 못했습니다.');
            }
            const dims=wasm.getTableDimensions(block.sec,block.ppi,block.ci);
            const cellIndex=Math.min(before.cellIndex ?? 0,dims.cellCount-1);
            return {...before,cellIndex,cellParaIndex:0,charOffset:0};
          }});
      }
    }
  }
  new CellDeleteDialog().show();
}
