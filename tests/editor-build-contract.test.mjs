import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
  for(const dir of ['src','scripts','desktop/standalone-pwh'])await fs.mkdir(path.join(root,dir),{recursive:true});
  for(const name of ['package.json',...['build-inline.mjs','bundle-client.mjs','patch-body-cursor-contract.mjs','patch-pointer-hit-geometry.mjs','patch-cell-text-history.mjs','patch-object-properties.mjs', 'patch-viewport-table-selection.mjs', 'patch-table-and-symbol-shortcuts.mjs', 'patch-hancom-key-aliases.mjs', 'patch-hancom-key-contexts.mjs','editor-build-contract.mjs'].map(n=>'scripts/'+n),...['build-desktop-editor.mjs','table-plan.mjs','desktop-body-style.mjs'].map(n=>'desktop/standalone-pwh/'+n),'src/a.ts'])await fs.writeFile(path.join(root,name),'original\n');
  await fs.mkdir(path.join(root,'docs/engine-patches/studio'),{recursive:true});
  for(const name of ['scripts/patch-format-properties.mjs','scripts/patch-clipboard-safety.mjs','scripts/patch-table-command-access.mjs','scripts/patch-nested-paragraph-format.mjs','scripts/patch-inline-object-cursors.mjs','scripts/patch-context-ribbon.mjs','scripts/patch-format-copy-options.mjs','scripts/patch-control-marker-delete.mjs','scripts/patch-native-paste-command.mjs','docs/engine-patches/studio/clipboard-safety.patch','docs/engine-patches/studio/nested-paragraph-format.patch'])await fs.writeFile(path.join(root,name),'original\n');
  const common=await editorBuildInputs(root),desktop=await editorBuildInputs(root,'desktop');
  await assertEditorBuildInputs(root,common);await assertEditorBuildInputs(root,desktop,'desktop');
  for(const name of ['scripts/patch-nested-paragraph-format.mjs','docs/engine-patches/studio/nested-paragraph-format.patch']) {
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
