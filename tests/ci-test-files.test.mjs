import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {discoverCiTests} from '../scripts/ci-test-files.mjs';

test('core and browser discovery partition the test tree without selecting fixtures or staged checks', async t => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-ci-discovery-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(work)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(work).startsWith('pwh-ci-discovery-'));
    await fs.rm(work, {recursive: true, force: true});
  });
  await fs.mkdir(path.join(work, 'tests/nested'), {recursive: true});
  for (const name of ['unit.test.mjs', 'ui-browser.test.mjs', 'nested/another-browser.test.mjs',
    'fixture.mjs', 'staged.check.mjs']) await fs.writeFile(path.join(work, 'tests', name), '');
  assert.deepEqual(await discoverCiTests(work, 'core'), ['tests/unit.test.mjs']);
  assert.deepEqual(await discoverCiTests(work, 'browser'),
    ['tests/nested/another-browser.test.mjs', 'tests/ui-browser.test.mjs']);
  await assert.rejects(discoverCiTests(work, 'unknown'), /Unknown CI test mode/);
});

test('all browser opt-ins are discovered and core includes both picture-placement regressions', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const core = await discoverCiTests(root, 'core'), browser = await discoverCiTests(root, 'browser');
  const optedIn = [];
  const guard = new RegExp(['process', 'env', 'PWH_BROWSER_TESTS'].join('\\.'));
  for (const file of [...core, ...browser]) {
    if (guard.test(await fs.readFile(path.join(root, file), 'utf8'))) optedIn.push(file);
  }
  assert.ok(optedIn.length > 0);
  assert.deepEqual(optedIn.sort(), browser, 'Every real browser opt-in uses -browser.test.mjs');
  assert.equal(new Set([...core, ...browser]).size, core.length + browser.length);
  assert.ok(core.includes('tests/inline-picture-frame.test.mjs'));
  assert.ok(core.includes('tests/continued-flow-picture.test.mjs'));
  assert.ok(browser.includes('tests/table-content-browser.test.mjs'));
});
