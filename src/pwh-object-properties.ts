import type {CommandServices} from '../types';
import {TableCellPropsDialog} from '@/ui/table-cell-props-dialog';
import {showToast} from '@/ui/toast';
import {insertCommands} from './insert';
import {resolveTablePropertiesTarget} from './pwh-object-properties-target.mjs';

export function openPwhTableProperties(services: CommandServices, mode: 'table' | 'cell' = 'table'): void {
  const target = resolveTablePropertiesTarget(services.getInputHandler(), mode);
  if (!target) return;
  if ('unsupported' in target && target.unsupported) {
    showToast({message: '중첩 표의 전체 속성 대화상자는 아직 지원하지 않습니다. 바깥 표는 변경하지 않았습니다.', durationMs: 7000});
    return;
  }
  if (!target.tableCtx || target.cellIdx === undefined || (target.mode !== 'table' && target.mode !== 'cell')) return;
  const dialog = new TableCellPropsDialog(
    services.wasm, services.eventBus, target.tableCtx, target.cellIdx, target.mode, services,
  );
  dialog.show();
}

// All picture entry points use the upstream command that already preserves
// image/shape/equation, header/footer and arbitrary cell-path ownership.
export function openPwhObjectProperties(services: CommandServices): void {
  if (services.getInputHandler()?.isInPictureObjectSelection()) {
    const command = insertCommands.find(item => item.id === 'insert:picture-props');
    if (!command) throw Error('그림 속성 명령을 찾지 못했습니다.');
    command.execute(services);
    return;
  }
  openPwhTableProperties(services);
}
