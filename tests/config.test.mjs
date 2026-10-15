import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';

async function workspace(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'pwh-config-test-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(temporaryRoot + path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const root = path.join(directory, 'plugin'), home = path.join(directory, 'home');
  await fs.mkdir(root);
  await fs.mkdir(home);
  const write = async (filename, value) => {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, JSON.stringify(value));
  };
  await write(path.join(root, 'engine.config.json'), { schemaVersion: 1 });
  return { root, home, directory, write };
}

test('portable defaults put all generated assets outside the plugin checkout', async t => {
  const w = await workspace(t);
  const config = await loadConfig({ ...w, env: {} });
  const runtime = path.join(w.home, '.stoom-pwh');
  assert.equal(config.runtimeRoot, runtime);
  assert.equal(config.rhwpPath, path.join(runtime, 'rhwp', process.platform === 'win32' ? 'rhwp.exe' : 'rhwp'));
  for (const [key, directory] of [['studioDistPath', 'studio'], ['editorSdkPath', 'editor-sdk'], ['outputRoot', 'documents'], ['fontRoot', 'fonts']]) {
    assert.equal(config[key], path.join(runtime, directory));
    assert.ok(!config[key].startsWith(w.root + path.sep));
  }
  assert.deepEqual(config.documentFonts, []);
});

test('PWH_CONFIG isolates machine overrides while explicit and legacy environment paths retain precedence', async t => {
  const w = await workspace(t);
  await w.write(path.join(w.root, 'engine.config.local.json'), { rhwpPath: './old-machine-engine', outputRoot: './old-output' });
  const selected = path.join(w.directory, 'private', 'custom.json');
  await w.write(selected, { schemaVersion: 1, rhwpPath: './tools/custom-engine', fontRoot: './fonts', pythonPath: 'python3' });
  const env = { PWH_CONFIG: selected, PWH_RUNTIME_ROOT: path.join(w.directory, 'runtime'),
    PWH_RHWP_PATH: path.join(w.directory, 'explicit-engine'), HWPXYZ_OUTPUT_ROOT: path.join(w.directory, 'legacy-output') };
  const config = await loadConfig({ ...w, env });
  assert.equal(config.runtimeRoot, env.PWH_RUNTIME_ROOT);
  assert.equal(config.rhwpPath, env.PWH_RHWP_PATH);
  assert.equal(config.outputRoot, env.HWPXYZ_OUTPUT_ROOT);
  assert.equal(config.fontRoot, path.join(path.dirname(selected), 'fonts'));
  assert.equal(config.pythonPath, 'python3');
  assert.ok(!config.configFiles.some(file => file.endsWith('engine.config.local.json')));
  await assert.rejects(loadConfig({ ...w, env: { PWH_CONFIG: selected + '.missing' } }), /Cannot read pwh configuration/);
});

test('runtime font records resolve beside their catalog and local records override matching IDs', async t => {
  const w = await workspace(t);
  const runtime = path.join(w.home, '.stoom-pwh');
  await w.write(path.join(runtime, 'fonts', 'document-fonts.json'), [
    { id: 'regular', path: 'Regular.ttf', weight: 400 },
    { id: 'bold', path: 'Bold.ttf', weight: 600 },
  ]);
  await w.write(path.join(w.root, 'engine.config.local.json'), {
    documentFonts: [{ id: 'regular', path: './private/Local.ttf', weight: 400 }],
  });
  const config = await loadConfig({ ...w, env: {} });
  assert.equal(config.documentFonts.length, 2);
  assert.equal(config.documentFonts.find(face => face.id === 'regular').path, path.join(w.root, 'private', 'Local.ttf'));
  assert.equal(config.documentFonts.find(face => face.id === 'bold').path, path.join(runtime, 'fonts', 'Bold.ttf'));
  assert.equal(config.documentFonts.find(face => face.id === 'bold').weight, 600);
});
