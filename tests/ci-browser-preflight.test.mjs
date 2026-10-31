import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

for (const explicit of [false, true]) {
  test(`browser runner refuses a missing ${explicit ? 'explicit' : 'Playwright default'} browser before opening a document or server`, async t => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-browser-preflight-test-'));
    t.after(async () => {
      assert.equal(path.dirname(path.resolve(work)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(work).startsWith('pwh-browser-preflight-test-'));
      await fs.rm(work, {recursive: true, force: true});
    });
    const module = path.join(work, 'playwright.mjs');
    await fs.writeFile(module, `export const chromium={executablePath:()=>${JSON.stringify(path.join(work, 'missing-default.exe'))}};\n`);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/run-ci-tests.mjs', import.meta.url)), 'browser'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 10000, windowsHide: true,
      env: {...process.env, PWH_RUNTIME_ROOT: path.join(work, 'unused-runtime'), PWH_PLAYWRIGHT_MODULE: pathToFileURL(module).href,
        PWH_BROWSER_EXECUTABLE: explicit ? path.join(work, 'missing-override.exe') : ''},
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /BROWSER_EXECUTABLE_NOT_FOUND/);
    assert.doesNotMatch(result.stdout, /TAP version/);
    await assert.rejects(fs.access(path.join(work, 'unused-runtime')));
  });
}
