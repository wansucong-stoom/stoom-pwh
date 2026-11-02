import fs from 'node:fs/promises';
import path from 'node:path';

// Keep toolbar, menu, P shortcut and table double-click on the same command.
export async function patchObjectProperties(studio) {
  const commands = path.join(studio, 'src/command/commands');
  await fs.copyFile(new URL('../src/pwh-object-properties.ts', import.meta.url), path.join(commands, 'pwh-object-properties.ts'));
  await fs.copyFile(new URL('../src/object-properties-target.mjs', import.meta.url), path.join(commands, 'pwh-object-properties-target.mjs'));
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
