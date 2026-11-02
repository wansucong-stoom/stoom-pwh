import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadCore, inspectVariants, verifyFrameAndMargins, verifyIndependentReflow}
  from './engine-source-ownership/nested-opening-frame-regression.mjs';

const hasCore = Boolean(process.env.PWH_CORE_JS && process.env.PWH_CORE_WASM);
const candidateSkip = process.env.PWH_CANDIDATE_CORE_TESTS !== '1'
  ? 'Set PWH_CANDIDATE_CORE_TESTS=1 to qualify the explicit r14 candidate' : false;
const coreSkip = candidateSkip || (!hasCore ? 'Requires PWH_CORE_JS and PWH_CORE_WASM candidate paths' : false);
let candidate;
async function candidateRecords() {
  if (!candidate) {
    const loaded = await loadCore(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
    candidate = {...loaded, records: inspectVariants(loaded.core)};
  }
  return candidate;
}

test('nested opening frame: original physical frame, exact margins, save and Undo', {skip: coreSkip}, async () => {
  verifyFrameAndMargins((await candidateRecords()).records);
});

test('nested opening frame: deep edits and ineligible source shapes use an independent ordinary-reflow oracle',
  {skip: coreSkip || !process.env.PWH_REFERENCE_CORE_JS || !process.env.PWH_REFERENCE_CORE_WASM}, async () => {
    const value = await candidateRecords();
    const reference = await loadCore(process.env.PWH_REFERENCE_CORE_JS, process.env.PWH_REFERENCE_CORE_WASM);
    verifyIndependentReflow(value.records, inspectVariants(reference.core), value.wasmSha256, reference.wasmSha256);
  });

test('nested opening frame: extracted source rejects unowned or recomposed hosts (18 Rust cases)',
  {skip: candidateSkip || !process.env.PWH_ENGINE_SOURCE}, () => {
    execFileSync(process.execPath, [fileURLToPath(new URL('./engine-source-ownership/nested-opening-frame-source.mjs', import.meta.url))],
      {stdio: 'inherit', windowsHide: true, env: process.env});
  });
