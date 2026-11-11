import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const names=['PWH_REFERENCE_CORE_JS','PWH_REFERENCE_CORE_WASM','PWH_FLOAT_FRAME_BASE_JS','PWH_FLOAT_FRAME_BASE_WASM'];
const cases=[
  {name:'uses the independent reference when no float baseline was supplied',reference:true,pass:true},
  {name:'preserves an explicit float baseline pair',reference:true,explicit:true,pass:true},
  {name:'rejects a partial explicit baseline instead of mixing reference versions',reference:true,partial:true,pass:false},
  {name:'rejects a partially configured independent reference',partialReference:true,pass:false},
  {name:'allows optional baseline tests to skip when no reference was configured',pass:true,optional:true},
];
for(const scenario of cases)test('core runner '+scenario.name,async t=>{
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-core-reference-test-'));
  t.after(async()=>{
    assert.equal(path.dirname(path.resolve(work)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(work).startsWith('pwh-core-reference-test-'));
    await fs.rm(work,{recursive:true,force:true});
  });
  await fs.mkdir(path.join(work,'scripts'));
  await fs.mkdir(path.join(work,'tests'));
  await fs.copyFile(new URL('../scripts/run-ci-tests.mjs',import.meta.url),path.join(work,'scripts/run-ci-tests.mjs'));
  await fs.copyFile(new URL('../scripts/ci-test-files.mjs',import.meta.url),path.join(work,'scripts/ci-test-files.mjs'));
  const probe=`import test from 'node:test';import assert from 'node:assert/strict';
const skip=!process.env.PWH_FLOAT_FRAME_BASE_JS||!process.env.PWH_FLOAT_FRAME_BASE_WASM?'Requires an explicit prior-core fallback baseline':false;
test('configured float baseline reaches the actual core test',{skip},()=>{
 assert.equal(process.env.PWH_FLOAT_FRAME_BASE_JS,process.env.PWH_EXPECT_FLOAT_JS);
 assert.equal(process.env.PWH_FLOAT_FRAME_BASE_WASM,process.env.PWH_EXPECT_FLOAT_WASM);
});\n`;
  await fs.writeFile(path.join(work,'tests/probe.test.mjs'),probe);
  const env={...process.env,PWH_RUNTIME_ROOT:path.join(work,'unused-runtime')};
  // This fixture launches an independent test runner, not a nested node:test worker.
  delete env.NODE_TEST_CONTEXT;
  delete env.GITHUB_STEP_SUMMARY;
  delete env.GITHUB_OUTPUT;
  for(const name of names)delete env[name];
  if(scenario.reference||scenario.partialReference)env.PWH_REFERENCE_CORE_JS=path.join(work,'reference/rhwp.js');
  if(scenario.reference)env.PWH_REFERENCE_CORE_WASM=path.join(work,'reference/rhwp_bg.wasm');
  if(scenario.explicit||scenario.partial)env.PWH_FLOAT_FRAME_BASE_JS=path.join(work,'explicit/rhwp.js');
  if(scenario.explicit)env.PWH_FLOAT_FRAME_BASE_WASM=path.join(work,'explicit/rhwp_bg.wasm');
  env.PWH_EXPECT_FLOAT_JS=scenario.explicit?env.PWH_FLOAT_FRAME_BASE_JS:env.PWH_REFERENCE_CORE_JS;
  env.PWH_EXPECT_FLOAT_WASM=scenario.explicit?env.PWH_FLOAT_FRAME_BASE_WASM:env.PWH_REFERENCE_CORE_WASM;
  const result=spawnSync(process.execPath,[path.join(work,'scripts/run-ci-tests.mjs'),'core','tests/probe.test.mjs'],{
    cwd:work,env,encoding:'utf8',timeout:15000,windowsHide:true,
  });
  assert.ifError(result.error);
  assert.equal(result.status,scenario.pass?0:1,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/# tests 1\b/);
  const summary=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(summary.missingConfiguredPrerequisites.length,scenario.pass?0:1);
  assert.equal(summary.skipped,scenario.optional||!scenario.pass?1:0);
  assert.equal(summary.total,1);
  assert.equal(summary.passed,scenario.optional||!scenario.pass?0:1);
  assert.equal(summary.failed,0);
  // The fixture exercises environment delivery and skip accounting only.
  await assert.rejects(fs.access(path.join(work,'unused-runtime')));
});
