import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {cellHeightScopeCases, verifyCellHeightScope} from './engine-source-ownership/stored-cell-height-scope.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM paths' : false;
let corePromise;
function loadCore() {
  return corePromise ||= (async () => {
    const core = await import(pathToFileURL(path.resolve(process.env.PWH_CORE_JS)));
    await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
    return core;
  })();
}

for (const definition of cellHeightScopeCases) {
  test(`cell height scope: ${definition.name}`, {skip}, async () => {
    verifyCellHeightScope(await loadCore(), definition);
  });
}
