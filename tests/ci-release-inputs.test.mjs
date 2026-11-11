import assert from 'node:assert/strict';
import test from 'node:test';
import {checkCiReleaseInputs, ciReleaseInputs} from '../scripts/check-ci-release-inputs.mjs';

const pin = (file, tag) => ({file, size: 42, sha256: 'a'.repeat(64),
  url: 'https://github.com/wansucong-stoom/stoom-pwh/releases/download/' + tag + '/' + file});
function fixture() {
  return {releaseTag: 'v1.2.3', runtime: pin('runtime.zip', 'v1.2.3'), preservationAssets: [
    pin('pwh-inline-build-inputs-old.zip', 'v1.2.2'),
    pin('pwh-inline-build-inputs-current.zip', 'v1.2.3'),
    pin('pwh-studio-dependencies-base.zip', 'engine-base'),
  ]};
}
function releases(lock) {
  const entries = new Map();
  for (const item of ciReleaseInputs(lock)) {
    const record = entries.get(item.tag) || {tag_name: item.tag, draft: false, assets: []};
    record.assets.push({name: item.file, size: item.size, digest: 'sha256:' + item.sha256, state: 'uploaded'});
    entries.set(item.tag, record);
  }
  return entries;
}
function mock(entries, unavailable = new Map()) {
  return async url => {
    const tag = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    const status = unavailable.get(tag) || 200;
    return {ok: status === 200, status, json: async () => entries.get(tag)};
  };
}

test('published inputs run all dependent checks and select the current editor archive', async () => {
  const lock = fixture(), inputs = ciReleaseInputs(lock);
  assert.equal(inputs[1].file, 'pwh-inline-build-inputs-current.zip');
  const result = await checkCiReleaseInputs(lock, {fetchImpl: mock(releases(lock)), eventName: 'release'});
  assert.equal(result.available, true);
  assert.equal(result.verifiedInputs, 3);
});

test('unpublished current release defers push and PR runtime checks explicitly', async () => {
  const lock = fixture(), fetchImpl = mock(releases(lock), new Map([['v1.2.3', 404]]));
  for (const eventName of ['push', 'pull_request']) {
    const result = await checkCiReleaseInputs(lock, {fetchImpl, eventName});
    assert.equal(result.available, false);
    assert.deepEqual(result.pendingReleases, ['v1.2.3']);
  }
});

test('release publication and manual verification cannot pass with missing inputs', async () => {
  const lock = fixture(), fetchImpl = mock(releases(lock), new Map([['v1.2.3', 404]]));
  for (const eventName of ['release', 'workflow_dispatch']) {
    await assert.rejects(checkCiReleaseInputs(lock, {fetchImpl, eventName}), /not public/);
  }
});

test('missing historical prerequisites fail instead of becoming an unpublished current release', async () => {
  const lock = fixture();
  await assert.rejects(checkCiReleaseInputs(lock, {eventName: 'push',
    fetchImpl: mock(releases(lock), new Map([['engine-base', 404]]))}), /not public: engine-base/);
});

test('a published release missing its editor input fails instead of skipping the job', async () => {
  const lock = fixture(), data = releases(lock);
  data.get('v1.2.3').assets.pop();
  await assert.rejects(checkCiReleaseInputs(lock, {fetchImpl: mock(data), eventName: 'push'}), /missing a completed/);
});

test('published file size, digest and upload state remain enforced', async () => {
  const lock = fixture();
  for (const mutation of [{size: 10}, {digest: 'sha256:' + 'b'.repeat(64)}, {state: 'new'}]) {
    const data = releases(lock);
    Object.assign(data.get('v1.2.3').assets[0], mutation);
    await assert.rejects(checkCiReleaseInputs(lock, {fetchImpl: mock(data), eventName: 'push'}));
  }
});

test('authentication, rate-limit and server errors fail explicitly', async () => {
  const lock = fixture();
  for (const status of [403, 429, 503]) {
    await assert.rejects(checkCiReleaseInputs(lock, {fetchImpl: mock(releases(lock),
      new Map([['v1.2.3', status]])), eventName: 'push'}), new RegExp('HTTP ' + status));
  }
});

test('a draft seen through an authenticated token is pending until actually public', async () => {
  const lock = fixture(), data = releases(lock);
  data.get('v1.2.3').draft = true;
  assert.equal((await checkCiReleaseInputs(lock, {fetchImpl: mock(data), eventName: 'push'})).available, false);
  await assert.rejects(checkCiReleaseInputs(lock, {fetchImpl: mock(data), eventName: 'release'}), /not public/);
});

test('CI refuses an input URL outside the pinned repository', () => {
  const lock = fixture();
  lock.runtime.url = lock.runtime.url.replace('wansucong-stoom/stoom-pwh', 'untrusted/project');
  assert.throws(() => ciReleaseInputs(lock), /Invalid pinned/);
});
