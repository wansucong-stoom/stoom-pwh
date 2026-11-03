import test from 'node:test';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {cellTextOwnedUndoCases,verifyCellTextOwnedUndo} from './engine-cursor/cell-text-owned-undo.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM
  ? 'Requires PWH_CORE_JS and PWH_CORE_WASM paths' : false;
let corePromise;
function loadCore() {
  return corePromise??=(async()=>{
    const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
    await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
    return core;
  })();
}
for(const definition of cellTextOwnedUndoCases) {
  test('cell owned Undo: '+definition.name,{skip},async()=>verifyCellTextOwnedUndo(await loadCore(),definition));
}
