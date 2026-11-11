#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repository = 'wansucong-stoom/stoom-pwh';
const prefix = '/' + repository + '/releases/download/';

export function ciReleaseInputs(lock) {
  const inputs = [...lock.preservationAssets].reverse().find(pin => /^pwh-inline-build-inputs-/.test(pin.file));
  const dependencies = lock.preservationAssets.find(pin => /^pwh-studio-dependencies-/.test(pin.file));
  if (!inputs || !dependencies) throw Error('Missing pinned editor inputs');
  const pins = [lock.runtime, inputs, dependencies];
  return pins.map(pin => {
    const url = new URL(pin.url);
    const suffix = url.pathname.slice(prefix.length).split('/');
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
      || !url.pathname.startsWith(prefix) || suffix.length !== 2
      || decodeURIComponent(suffix[1]) !== pin.file || !/^[\w.-]+$/.test(pin.file)
      || !/^[a-f0-9]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.size) || pin.size <= 0) {
      throw Error('Invalid pinned CI input');
    }
    return {...pin, tag: decodeURIComponent(suffix[0])};
  });
}

export async function checkCiReleaseInputs(lock, {eventName = 'workflow_dispatch', fetchImpl = fetch, token} = {}) {
  const pins = ciReleaseInputs(lock);
  const tags = [...new Set(pins.map(pin => pin.tag))];
  const headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'Pwh-CI-release-inputs'};
  if (token) headers.Authorization = 'Bearer ' + token;
  const responses = await Promise.allSettled(tags.map(async tag => {
    const response = await fetchImpl('https://api.github.com/repos/' + repository
      + '/releases/tags/' + encodeURIComponent(tag), {headers, signal: AbortSignal.timeout(30000)});
    if (response.status === 404) return {tag, unpublished: true};
    if (!response.ok) throw Error('Release metadata request failed: HTTP ' + response.status + ' (' + tag + ')');
    const release = await response.json();
    if (release.tag_name !== tag) throw Error('Release tag differs from pinned input: ' + tag);
    return {tag, unpublished: release.draft === true, release};
  }));
  const pending = [];
  let verified = 0;
  for (const response of responses) {
    if (response.status === 'rejected') throw response.reason;
    const {tag, unpublished, release} = response.value;
    if (unpublished) {
      if (tag !== lock.releaseTag || !['push', 'pull_request'].includes(eventName)) {
        throw Error('Required release is not public: ' + tag);
      }
      pending.push(tag);
      continue;
    }
    for (const pin of pins.filter(pin => pin.tag === tag)) {
      const assets = (release.assets || []).filter(asset => asset.name === pin.file);
      if (assets.length !== 1 || assets[0].state !== 'uploaded') {
        throw Error('Published release is missing a completed CI input: ' + pin.file);
      }
      const asset = assets[0];
      if (asset.size !== pin.size || (asset.digest && asset.digest !== 'sha256:' + pin.sha256)) {
        throw Error('Published CI input metadata differs from its lock: ' + pin.file);
      }
      verified++;
    }
  }
  return {available: pending.length === 0, pendingReleases: pending, verifiedInputs: verified,
    reason: pending.length ? 'Runtime release is not public yet; dependent tests run on release publication.'
      : 'All pinned runtime and editor inputs are public.'};
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'runtime-lock.json'), 'utf8'));
  const result = await checkCiReleaseInputs(lock, {eventName: process.env.GITHUB_EVENT_NAME,
    token: process.env.GITHUB_TOKEN});
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, 'available=' + result.available + '\n');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = result.available
      ? '### Runtime inputs ready\n\nPinned runtime and editor inputs are public. Dependent tests run normally.\n'
      : '### Runtime tests pending publication\n\nSource checks run in this workflow. Runtime, browser and '
        + 'reproducible-editor checks have **not run** because the locked release is not public: '
        + result.pendingReleases.map(tag => '`' + tag + '`').join(', ')
        + '. They run automatically on the **release published** event. '
        + 'This source-only result does not verify a release.\n';
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  console.log(JSON.stringify(result));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
