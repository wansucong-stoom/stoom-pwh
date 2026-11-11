import type {CommandDef, CommandServices} from '../types';
import {TableCreateDialog} from '@/ui/table-create-dialog';
import {showToast} from '@/ui/toast';
import {scopeTableCommandServices} from './pwh-table-command-services.mjs';

const scopedCommands=new Set([
  'table:insert-row-col','table:delete-row-col',
  'table:insert-row-above','table:insert-row-below','table:insert-col-left','table:insert-col-right',
  'table:delete-row','table:delete-col','table:cell-merge','table:cell-split',
  'table:background-each','table:border-each','table:background-one','table:border-one',
  'table:thousand-sep','table:decimal-add','table:decimal-remove',
]);
// These operations still have body-only native mutation/editing APIs. Disabling
// the command is safer than sending an inner cell index to the containing table.
const needsPathBackend=new Set([
  'table:delete','table:caption-toggle','table:split','table:attach',
  'table:transpose-copy','table:transpose-paste','table:formula','table:block-formula',
  'table:block-sum','table:block-avg','table:block-product',
]);

function nestedTarget(services: CommandServices): boolean {
  const input=services.getInputHandler();
  const path=input?.getSelectedTableRef()?.cellPath ?? input?.getCellTableContext()?.cellPath ?? input?.getCursorPosition().cellPath;
  return (path?.length??0)>1;
}

function createInsideCell(services: CommandServices, params?: Record<string,unknown>): void {
  const input=services.getInputHandler();
  if(!input)return;
  if(input.hasMultiCellSelection()) {
    showToast({message:'표를 넣을 셀 한 곳에 커서를 놓아 주세요.',durationMs:5000});return;
  }
  const position=input.getCursorPosition();
  if(position.parentParaIndex===undefined||position.controlIndex===undefined||position.cellIndex===undefined)return;
  const cellPath=(position.cellPath?.length?position.cellPath:[{
    controlIndex:position.controlIndex,cellIndex:position.cellIndex,cellParaIndex:position.cellParaIndex??0,
  }]).map(entry=>({...entry}));
  const generation=services.wasm.documentGeneration;
  const dialog=new TableCreateDialog();
  dialog.onApply=(rows,cols,options)=>{
    if(generation!==services.wasm.documentGeneration) {
      showToast({message:'문서가 바뀌었습니다. 표를 넣을 위치를 다시 선택해 주세요.'});return;
    }
    try {
      input.executeOperation({kind:'snapshot',operationType:'createNestedTable',operation:wasm=>{
        const result=wasm.createTableEx({sectionIdx:position.sectionIndex,paraIdx:position.paragraphIndex,
          parentParaIdx:position.parentParaIndex!,cellPath,charOffset:position.charOffset,
          rowCount:rows,colCount:cols,...options});
        if(!result.ok)throw Error('선택한 셀에 표를 넣지 못했습니다.');
        return {...position,paragraphIndex:0,charOffset:0,cellIndex:0,cellParaIndex:0,
          cellPath:[...cellPath,{controlIndex:result.controlIdx,cellIndex:0,cellParaIndex:0}]};
      }});
      input.exitCellSelectionMode();
    } catch(error) {
      showToast({message:error instanceof Error?error.message:'표를 만들지 못했습니다.',durationMs:7000});
    }
    (input as any).textarea?.focus();
  };
  dialog.onClose=()=>{(input as any).textarea?.focus();};
  if(params?.pwhDetailed)dialog.showInputDialog();else dialog.show();
}

export function wrapTableCommands(commands: CommandDef[]): CommandDef[] {
  return commands.map(command=>{
    if(command.id==='table:create')return {...command,
      canExecute:ctx=>ctx.hasDocument&&!ctx.isFormMode&&!ctx.hasMultiCellSelection,
      execute(services,params) {
        if(services.getInputHandler()?.getCursorPosition().parentParaIndex!==undefined)createInsideCell(services,params);
        else command.execute(services,params);
      }};
    if(needsPathBackend.has(command.id))return {...command,
      canExecute:ctx=>!ctx.inNestedTable&&(command.canExecute?.(ctx)??true),
      execute(services,params) {
        if(nestedTarget(services)) {
          showToast({message:'이 명령의 중첩 표 편집은 아직 지원하지 않습니다.',durationMs:5000});return;
        }
        command.execute(services,params);
      }};
    if(!scopedCommands.has(command.id))return command;
    return {...command,execute(services,params) {
      try {command.execute(scopeTableCommandServices(services),params);}
      catch(error) {showToast({message:error instanceof Error?error.message:'표를 변경하지 못했습니다.',durationMs:7000});}
    }};
  });
}
