import type {CommandServices} from '../types';
import {TableCellPropsDialog} from '@/ui/table-cell-props-dialog';
import {showToast} from '@/ui/toast';
import {insertCommands} from './insert';
import {resolveTablePropertiesTarget} from './pwh-object-properties-target.mjs';

export function openPwhTableProperties(services: CommandServices, mode: 'table' | 'cell' = 'table'): void {
  const target = resolveTablePropertiesTarget(services.getInputHandler(), mode);
  if (!target) return;
  if (target.tableCtx?.cellPath && !services.wasm.hasTablePropertyPaths()) {
    showToast({message:'중첩 표 속성에는 새 공통 코어가 필요합니다. 편집기와 코어를 함께 업데이트해 주세요.',durationMs:7000});
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
