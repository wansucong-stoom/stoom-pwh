import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('packaged Desktop persists provider selection and scopes disconnect to Pwh', {
  skip: !process.env.PWH_TEST_DESKTOP_PAYLOAD,
  timeout: 60000,
}, async () => {
  const payload = path.resolve(process.env.PWH_TEST_DESKTOP_PAYLOAD);
  const isolatedData = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-provider-test-'));
  process.env.PWH_STANDALONE_DATA = isolatedData;
  process.env.PWH_RUNTIME_ROOT = path.join(payload, 'engine');
  const {createAppServer} = await import(pathToFileURL(path.join(payload, 'standalone-pwh', 'host.mjs')).href);
  const {server, url} = await createAppServer({idleTimeoutMs: 60000});
  const origin = new URL(url).origin;
  const call = async (route, body = {}, requestOrigin = origin) => {
    const response = await fetch(new URL(route, url), {
      method: 'POST',
      headers: {origin: requestOrigin, 'x-pwh-request': '1', 'content-type': 'application/json'},
      body: JSON.stringify(body),
    });
    return {response, data: await response.json()};
  };
  try {
    assert.equal((await call('settings/read')).data.provider, 'chatgpt');
    assert.equal((await call('settings/write', {provider: 'codex'})).data.provider, 'codex');
    assert.equal((await call('settings/read')).data.provider, 'codex');
    assert.equal((await call('codex/disconnect', {}, 'http://unauthorized.invalid')).response.status, 403);
    assert.equal((await call('settings/read')).data.provider, 'codex');
    assert.deepEqual((await call('codex/disconnect')).data, {ok: true});
    assert.equal((await call('settings/read')).data.provider, 'chatgpt');
    assert.equal((await call('settings/write', {provider: 'local'})).data.provider, 'local');
    assert.equal((await call('settings/read')).data.provider, 'local');
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(isolatedData, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
});
