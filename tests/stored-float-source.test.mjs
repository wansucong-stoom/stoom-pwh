import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile);
const skip=!process.env.PWH_ENGINE_SOURCE?'Requires an explicit engine source root and Rust compiler':false;
for (const [script, cases] of [
  ['closed-float-source-frame', 38],
  ['sibling-table-offset', 9],
  ['stored-nested-table-row-heights', 11],
]) {
 test(`stored float source contract: ${script}`, {skip, timeout: 120000}, async t => {
  const engineSource = process.env.PWH_ENGINE_SOURCE;
  let expectedCount = cases;
  if (script === 'closed-float-source-frame') {
   const source = await fs.readFile(path.join(engineSource, 'src/renderer/layout/table_layout.rs'), 'utf8');
   if (source.includes('allow_original_blank_boundary: bool')) expectedCount += 2;
  } else if (script === 'stored-nested-table-row-heights') {
   const source = await fs.readFile(path.join(engineSource, 'src/renderer/float_placement.rs'), 'utf8');
   if (!source.includes('fn saved_inline_no_adjust_row_heights(')) {
    t.skip('Requires original nested row geometry');
    return;
   }
  }
  const file=fileURLToPath(new URL(`./engine-source-ownership/${script}.mjs`,import.meta.url));
  const {stdout}=await run(process.execPath,[file,process.env.PWH_ENGINE_SOURCE],{env:process.env,windowsHide:true,maxBuffer:2*1024*1024});
  assert.match(stdout,new RegExp(`test result: ok\\. ${expectedCount} passed; 0 failed;`));
 });
}
