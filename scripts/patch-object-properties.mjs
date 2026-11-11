import fs from 'node:fs/promises';
import path from 'node:path';

// Keep toolbar, menu, P shortcut and table double-click on the same command.
export async function patchObjectProperties(studio) {
  const commands = path.join(studio, 'src/command/commands');
  await fs.copyFile(new URL('../src/pwh-object-properties.ts', import.meta.url), path.join(commands, 'pwh-object-properties.ts'));
  await fs.copyFile(new URL('../src/object-properties-target.mjs', import.meta.url), path.join(commands, 'pwh-object-properties-target.mjs'));
  await fs.copyFile(new URL('../src/path-table-properties.mjs', import.meta.url), path.join(studio,'src/ui/pwh-path-table-properties.mjs'));
  await fs.copyFile(new URL('../src/table-border-selection.mjs', import.meta.url), path.join(studio,'src/engine/pwh-table-border-selection.mjs'));
  const bridgeFile=path.join(studio,'src/core/wasm-bridge.ts');let bridge=await fs.readFile(bridgeFile,'utf8');
  if(!bridge.includes('// pwh table property path bridge')){
    const anchor='  getTableProperties(sec: number, parentPara: number, controlIdx: number): TableProperties {';
    if(bridge.split(anchor).length!==2)throw Error('Unsupported table property bridge');
    bridge=bridge.replace(anchor,`  // pwh table property path bridge
  hasTablePropertyPaths(): boolean {
    const doc = this.doc as any;
    return !!doc && ['getTablePropertiesByPath','setTablePropertiesByPath','setCellPropertiesByPath'].every(name => typeof doc[name] === 'function');
  }
  getTablePropertiesByPath(sec: number, ppi: number, cellPath: string): TableProperties {
    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');
    return JSON.parse((this.doc as any).getTablePropertiesByPath(sec, ppi, cellPath));
  }
  setTablePropertiesByPath(sec: number, ppi: number, cellPath: string, props: Partial<TableProperties>): {ok: boolean} {
    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');
    return JSON.parse((this.doc as any).setTablePropertiesByPath(sec, ppi, cellPath, JSON.stringify(props)));
  }
  setCellPropertiesByPath(sec: number, ppi: number, cellPath: string, cell: number, props: Partial<CellProperties>): {ok: boolean} {
    if (!this.doc) throw new Error('문서가 로드되지 않았습니다');
    return JSON.parse((this.doc as any).setCellPropertiesByPath(sec, ppi, cellPath, cell, JSON.stringify(props)));
  }
`+anchor);await fs.writeFile(bridgeFile,bridge);
  }
  const dialogFile=path.join(studio,'src/ui/table-cell-props-dialog.ts');let dialog=await fs.readFile(dialogFile,'utf8');
  if(!dialog.includes('// pwh path-owned table properties dialog')){
    const contextType='{ sec: number; ppi: number; ci: number }';
    const contextWithPath='{ sec: number; ppi: number; ci: number; cellPath?: {controlIndex:number;cellIndex:number;cellParaIndex:number}[] }';
    if(dialog.split(contextType).length!==3||!dialog.includes('    this.wasm = wasm;'))throw Error('Unsupported table dialog context');
    dialog='// pwh path-owned table properties dialog\nimport {createPathTablePropertiesBridge,tablePropertiesPathKey,changedPropertyFields} from \'./pwh-path-table-properties.mjs\';\n'+dialog.replaceAll(contextType,contextWithPath)
      .replace('    this.wasm = wasm;','    this.wasm = tableCtx.cellPath?.length ? createPathTablePropertiesBridge(wasm, tableCtx.cellPath) : wasm;');
    // The later build stage adds selected-cell handling. Its path routing is
    // patched there so the same binding applies to cursor and cell blocks.
    await fs.writeFile(dialogFile,dialog);
  }
  const change = async (name, id, expected, replacement, imports, enabled) => {
    const file = path.join(commands, name);
    let source = await fs.readFile(file, 'utf8');
    if (source.includes('// pwh complete object properties routing')) return;
    const start = source.indexOf("    id: '" + id + "',");
    let end = source.indexOf('\n  {\n    id:', start);
    if (end < 0) end = source.indexOf('\n];', start);
    const block = source.slice(start, end);
    const execute = block.indexOf('    execute(services) {\n');
    const close = block.lastIndexOf('\n    },');
    if (start < 0 || end < 0 || execute < 0 || close < execute || !block.includes(expected)) {
      throw Error('Unsupported object properties command: ' + name);
    }
    let patched = block.slice(0, execute) + '    execute(services) {\n      ' + replacement + '\n' + block.slice(close);
    if (enabled) {
      const original = 'canExecute: (ctx) => ctx.inPictureObjectSelection || ctx.inTableObjectSelection,';
      if (!patched.includes(original)) throw Error('Unsupported object properties enablement');
      patched = patched.replace(original, 'canExecute: (ctx) => ctx.inPictureObjectSelection || ctx.inTableObjectSelection || ctx.inTable || ctx.inCellSelectionMode,');
    }
    source = '// pwh complete object properties routing\n' + imports + '\n' + source.slice(0, start) + patched + source.slice(end);
    await fs.writeFile(file, source);
  };
  await change('format.ts', 'format:object-properties', 'dialog.open(ref.sec, ref.ppi, ref.ci, ref.type);', 'openPwhObjectProperties(services);', "import {openPwhObjectProperties} from './pwh-object-properties';", true);
  await change('table.ts', 'table:cell-props', "pos.cellIndex, 'cell', services", "openPwhTableProperties(services, 'cell');", "import {openPwhTableProperties} from './pwh-object-properties';", false);
  const mainFile = path.join(studio, 'src/main.ts');
  let main = await fs.readFile(mainFile, 'utf8');
  if (!main.includes('// pwh object properties toolbar enablement')) {
    const anchor = '    // 툴바 내 data-cmd 버튼 클릭 → 커맨드 디스패치';
    if (!main.includes(anchor)) throw Error('Unsupported object properties toolbar binding');
    main = main.replace(anchor, `    // pwh object properties toolbar enablement
    const syncObjectPropertiesButton = (): void => {
      const enabled = dispatcher.isEnabled('format:object-properties');
      document.querySelectorAll<HTMLButtonElement>('button[data-cmd="format:object-properties"]').forEach(button => {
        button.disabled = !enabled;
        button.setAttribute('aria-disabled', String(!enabled));
      });
    };
    for (const event of ['command-state-changed', 'cursor-cell-changed', 'cursor-format-changed', 'picture-object-selection-changed', 'table-object-selection-changed', 'document-loaded']) eventBus.on(event, syncObjectPropertiesButton);
    syncObjectPropertiesButton();

` + anchor);
    await fs.writeFile(mainFile, main);
  }
}

// Apply after keyboard/context patches have added nested table hit ownership.
export async function patchTablePropertyInteractions(studio) {
  const handlerFile=path.join(studio,'src/engine/input-handler.ts');
  let handler=await fs.readFile(handlerFile,'utf8');
  if(!handler.includes('// pwh zoom-aware table border selection')){
    const changes=[
      ["from './table-border-hit'", "from " + "'./pwh-table-border-selection.mjs'"],
      ['isPointNearBoxBorder(pageX, pageY, bbox)', 'isPointNearBoxBorder(pageX, pageY, bbox, this.viewportManager.getZoom())'],
      ['isPointNearBoxBorder(pageX, pageY, { x: minX, y: minY, width: maxX - minX, height: maxY - minY })', 'isPointNearBoxBorder(pageX, pageY, { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, this.viewportManager.getZoom())'],
      ['isPointNearBoxBorder(pageX, pageY, { x, y, width: w, height: h })', 'isPointNearBoxBorder(pageX, pageY, { x, y, width: w, height: h }, this.viewportManager.getZoom())'],
    ];
    for(const [before,after] of changes){if(handler.split(before).length!==2)throw Error('Unsupported table border selection anchor: '+before);handler=handler.replace(before,after);}
    await fs.writeFile(handlerFile,'// pwh zoom-aware table border selection\n'+handler);
  }
  const hitModule=await fs.readFile(new URL('../src/table-properties-hit.mjs',import.meta.url),'utf8');
  await fs.writeFile(path.join(studio,'src/engine/pwh-table-properties-hit.mjs'),hitModule.replace("'./table-border-selection.mjs'","'./pwh-table-border-selection.mjs'"));
  const mousePath=path.join(studio,'src/engine/input-handler-mouse.ts');
  let mouse=await fs.readFile(mousePath,'utf8');
if(!mouse.includes('pwh path property double-click')){
 const before=`  const selectedTable = this.cursor.isInTableObjectSelection() ? this.cursor.getSelectedTableRef() : null;
  if (selectedTable && !selectedTable.cellPath?.length) {
    e.preventDefault();
    this.eventBus.emit('pwh-table-properties-request');
    return;
  }`;
 const after=`  // pwh path property double-click
  const tableTarget = tablePropertiesAtPoint(this, e.clientX, e.clientY);
  if (tableTarget) {
    e.preventDefault();
    this.cursor.clearSelection();
    this.cursor.enterTableObjectSelectionDirect(tableTarget.sec, tableTarget.ppi, tableTarget.ci, tableTarget.cellPath);
    this.caret.hide(); this.selectionRenderer.clear(); this.renderTableObjectSelection();
    this.eventBus.emit('table-object-selection-changed', true);
    this.eventBus.emit('pwh-table-properties-request');
    return;
  }`;
 const moveBefore='    const ref = this.cursor.getSelectedTableRef();\n    if (ref && e.button === 0) {';
 if(mouse.split(before).length!==2||mouse.split(moveBefore).length!==2)throw Error('Unsupported nested table double-click/resize ownership');
 mouse="import {tablePropertiesAtPoint,tableBorderAtPagePoint} from " + "'./pwh-table-properties-hit.mjs';\n"+mouse.replace(before,after)
  .replace(moveBefore,'    const ref = this.cursor.getSelectedTableRef();\n    if (ref && e.button === 0 && (ref.cellPath?.length ?? 0) <= 1) {');
 await fs.writeFile(mousePath,mouse);
}
  if(!mouse.includes('// pwh source-owned table border route')){
    const start=mouse.indexOf('    // 표 경계선 클릭 감지 → 표 객체 선택 (셀 내부에서 외곽 클릭)');
    const end=mouse.indexOf('    // 보호 셀은 텍스트 커서를 넣지 않고 셀 선택 상태로 전환한다.',start);
    if(start<0||end<0)throw Error('Unsupported table single-click ownership');
    mouse=mouse.slice(0,start)+`    // pwh source-owned table border route
    const tableBorder = tableBorderAtPagePoint(this, pageIdx, pageX, pageY);
    if (tableBorder) {
      this.cursor.clearSelection();
      this.cursor.exitCellSelectionMode(); this.cellSelectionRenderer?.clear();
      this.exitPictureObjectSelectionIfNeeded();
      this.cursor.moveToHit(hit);
      this.cursor.enterTableObjectSelectionDirect(tableBorder.sec, tableBorder.ppi, tableBorder.ci, tableBorder.cellPath);
      this.active = true; this.caret.hide(); this.fieldMarker.hide();
      this.selectionRenderer.clear(); this.renderTableObjectSelection();
      this.eventBus.emit('table-object-selection-changed', true);
      this.eventBus.emit('command-state-changed');
      this.textarea.focus();
      return;
    }

`+mouse.slice(end);
    await fs.writeFile(mousePath,mouse);
  }
}

// Compare against populated UI values, not rounded HU values read from a file.
// Opening and accepting properties without editing must be a no-op.
export async function patchTablePropertyChanges(studio) {
  const file=path.join(studio,'src/ui/table-cell-props-dialog.ts');let code=await fs.readFile(file,'utf8');
  if(code.includes('// pwh apply only changed property fields'))return;
  const legacy='      if (!block || !block.cellIndices?.length || block.cellPath) {';
  if(code.includes(legacy)){
    code=code.replace(legacy,`      const nestedPath = this.tableCtx.cellPath;
      const ownsBlock = block && block.sec === sec && block.ppi === ppi &&
        (nestedPath ? block.cellPath && tablePropertiesPathKey(block.cellPath) === tablePropertiesPathKey(nestedPath)
          : !block.cellPath && block.ci === ci);
      if (!ownsBlock || !block.cellIndices?.length) {`);
    code=code.replace("operation:(wasm: WasmBridge)=>{\n        wasm.runInBatch(()=>{for(const index of block.cellIndices){const result=wasm.setCellProperties(block.sec,block.ppi,block.ci,index,changed as Partial<CellProperties>);if(!result?.ok)throw Error('셀 속성을 적용하지 못했습니다.');}});",
      "operation:()=>{\n        this.wasm.runInBatch(()=>{for(const index of block.cellIndices){const result=this.wasm.setCellProperties(sec,ppi,ci,index,changed as Partial<CellProperties>);if(!result?.ok)throw Error('셀 속성을 적용하지 못했습니다.');}});");
  }
  const start=code.indexOf('    // 표 속성 수정',code.indexOf('  protected onConfirm()'));
  const end=code.indexOf('    const applyProps = () => {',start);
  if(start<0||end<0)throw Error('Unsupported property value collection');
  const collection=code.slice(start,end);
  code=code.slice(0,start)+'    const newTableProps = this.pwhCurrentTableProps();\n\n'+code.slice(end);
  const method='  private pwhCurrentTableProps(): Record<string, unknown> {\n'+collection+'    return newTableProps;\n  }\n\n';
  code=code.replace('  protected onConfirm()',method+'  protected onConfirm()');
  const changes=[
    ['  private pwhInitialCellProps: Record<string, unknown> = {};','  private pwhInitialCellProps: Record<string, unknown> = {};\n  private pwhInitialTableProps: Record<string, unknown> = {};'],
    ['    this.pwhInitialCellProps = this.pwhCurrentCellProps();','    this.pwhInitialCellProps = this.pwhCurrentCellProps();\n    this.pwhInitialTableProps = JSON.parse(JSON.stringify(this.pwhCurrentTableProps()));'],
    ['      if (!Object.keys(changed).length) return true;','      const tableChanges = changedPropertyFields(this.pwhCurrentTableProps(), this.pwhInitialTableProps);\n      if (!Object.keys(changed).length && !Object.keys(tableChanges).length) return true;'],
    ["        this.wasm.runInBatch(()=>{for(const index of block.cellIndices){const result=this.wasm.setCellProperties(sec,ppi,ci,index,changed as Partial<CellProperties>);if(!result?.ok)throw Error('셀 속성을 적용하지 못했습니다.');}});",
     "        this.wasm.runInBatch(()=>{if(Object.keys(changed).length)for(const index of block.cellIndices){const result=this.wasm.setCellProperties(sec,ppi,ci,index,changed as Partial<CellProperties>);if(!result?.ok)throw Error('셀 속성을 적용하지 못했습니다.');}if(Object.keys(tableChanges).length){const result=this.wasm.setTableProperties(sec,ppi,ci,tableChanges as Partial<TableProperties>);if(!result?.ok)throw Error('표 속성을 적용하지 못했습니다.');}});"],
    ['    const applyProps = () => {\n      this.wasm.setCellProperties(sec, ppi, ci, this.cellIdx, newCellProps as Partial<CellProperties>);\n      this.wasm.setTableProperties(sec, ppi, ci, newTableProps as Partial<TableProperties>);\n    };',
     "    const cellChanges = changedPropertyFields(newCellProps, this.pwhInitialCellProps);\n    const tableChanges = changedPropertyFields(newTableProps, this.pwhInitialTableProps);\n    if (!Object.keys(cellChanges).length && !Object.keys(tableChanges).length) return true;\n    const applyProps = () => this.wasm.runInBatch(() => {\n      if (Object.keys(cellChanges).length && !this.wasm.setCellProperties(sec, ppi, ci, this.cellIdx, cellChanges as Partial<CellProperties>)?.ok) throw Error('셀 속성을 적용하지 못했습니다.');\n      if (Object.keys(tableChanges).length && !this.wasm.setTableProperties(sec, ppi, ci, tableChanges as Partial<TableProperties>)?.ok) throw Error('표 속성을 적용하지 못했습니다.');\n    });"],
  ];
  for(const [before,after] of changes){if(code.split(before).length!==2)throw Error('Unsupported changed-property dialog anchor: '+before.slice(0,100));code=code.replace(before,after);}
  await fs.writeFile(file,'// pwh apply only changed property fields\n'+code);
}
