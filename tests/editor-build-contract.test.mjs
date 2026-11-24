import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {normalizeEditorBundle,assertPortableEditorBundle,editorBuildInputs,assertEditorBuildInputs} from '../scripts/editor-build-contract.mjs';

test('module labels are stable across build directories without changing executable text',()=>{
  const code='const value = "unchanged";\n';
  const a='//#region pwh-test-temp/build-one/rhwp-studio/src/core/a.ts\n'+code;
  const b='//#region C:\\Users\\builder\\Temp\\desktop-editor-build-uuid\\rhwp-studio\\src\\core\\a.ts\n'+code;
  assert.equal(normalizeEditorBundle(a),normalizeEditorBundle(b));
  assert.equal(normalizeEditorBundle(a),'//#region @rhwp/studio/src/core/a.ts\n'+code);
  assert.throws(()=>assertPortableEditorBundle('//#region pwh-test-temp/unknown/a.js'),/Build-specific/);
  assert.equal(normalizeEditorBundle('const path = "pwh-test-temp/data";'),'const path = "pwh-test-temp/data";');
});

test('source changes, new source modules and Desktop-only changes invalidate the correct input record',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-build-contract-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=fileURLToPath(new URL('../',import.meta.url));
  const projectInputs=await editorBuildInputs(project,'desktop');
  const fixtureInputs=projectInputs.files.map(file=>file.path).filter(name=>!name.startsWith('src/'));
  for(const name of [...fixtureInputs,'src/a.ts']) {
    const filename=path.join(root,name);
    await fs.mkdir(path.dirname(filename),{recursive:true});
    await fs.writeFile(filename,'original\n');
  }
  const common=await editorBuildInputs(root),desktop=await editorBuildInputs(root,'desktop');
  await assertEditorBuildInputs(root,common);await assertEditorBuildInputs(root,desktop,'desktop');
  for(const name of ['scripts/patch-section-edit.mjs','scripts/patch-document-compare.mjs','scripts/patch-host-font-settings.mjs','scripts/patch-table-resize-grid.mjs','scripts/patch-auto-fill.mjs','scripts/patch-dialog-focus.mjs','scripts/patch-picture-drag.mjs','scripts/patch-background-recovery.mjs','scripts/patch-nested-paragraph-format.mjs','docs/engine-patches/studio/nested-paragraph-format.patch']) {
    await fs.writeFile(path.join(root,name),'changed\n');
    await assert.rejects(assertEditorBuildInputs(root,common),/sources changed/);
    await assert.rejects(assertEditorBuildInputs(root,desktop,'desktop'),/sources changed/);
    await fs.writeFile(path.join(root,name),'original\n');
  }
  await fs.writeFile(path.join(root,'scripts/patch-pointer-hit-geometry.mjs'),'changed\n');
  await assert.rejects(assertEditorBuildInputs(root,common),/sources changed/);await assert.rejects(assertEditorBuildInputs(root,desktop,'desktop'),/sources changed/);
  await fs.writeFile(path.join(root,'scripts/patch-pointer-hit-geometry.mjs'),'original\n');
  await fs.writeFile(path.join(root,'desktop/standalone-pwh/table-plan.mjs'),'changed\n');
  await assertEditorBuildInputs(root,common);await assert.rejects(assertEditorBuildInputs(root,desktop,'desktop'),/sources changed/);
  await fs.writeFile(path.join(root,'src/a.ts'),'changed\n');await assert.rejects(assertEditorBuildInputs(root,common),/sources changed/);
  const updated=await editorBuildInputs(root);await fs.writeFile(path.join(root,'src/new.mjs'),'new\n');await assert.rejects(assertEditorBuildInputs(root,updated),/sources changed/);
  const current=await editorBuildInputs(root);await fs.writeFile(path.join(root,'docs/engine-patches/studio/clipboard-safety.patch'),'changed\n');await assert.rejects(assertEditorBuildInputs(root,current),/sources changed/);
});
