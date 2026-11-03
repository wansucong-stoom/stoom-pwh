#!/usr/bin/env node
// Prepare isolated, hash-pinned inputs for actual-core and extracted-source CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {zipEntries} from './setup.mjs';
import {readRuntimeArchive} from './preserved-runtime.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!['--work-root', '--cache-dir'].includes(key) || options[key] || !args[i + 1])
    throw Error('Use --work-root NEW_PATH and optional --cache-dir PATH');
  options[key] = path.resolve(args[i + 1]);
}
if (!options['--work-root']) throw Error('A new isolated --work-root is required');
const work = options['--work-root'];
await fs.mkdir(work); // Refuse an existing workspace; never update an installation.
const cache = options['--cache-dir'] || path.join(work, 'downloads');
await fs.mkdir(cache, {recursive: true});
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const lock = await json(path.join(project, 'runtime-lock.json'));
const pins = await json(path.join(project, 'docs/verification/r14-regression-inputs.json'));
if (pins.schemaVersion !== 1) throw Error('Unknown core regression input schema');
const source = lock.preservationAssets.find(pin => /^pwh-upstream-rhwp-/.test(pin.file));
if (!source) throw Error('Missing preserved upstream source');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function download(pin) {
  if (!/^[\w.-]+$/.test(pin.file) || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw Error('Unsafe regression input');
  const file = path.join(cache, pin.file);
  let bytes;
  try { bytes = await fs.readFile(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const url = new URL(pin.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !['github.com', 'raw.githubusercontent.com'].includes(url.hostname)) throw Error('Untrusted regression input URL');
    const response = await fetch(url, {signal: AbortSignal.timeout(180000)});
    if (!response.ok) throw Error('Regression input download failed: ' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
    verify(bytes, pin);
    await fs.writeFile(file, bytes, {flag: 'wx'});
  }
  verify(bytes, pin);
  return {file, bytes};
}
function verify(bytes, pin) {
  if (bytes.length > 128 * 1024 * 1024 || (pin.size !== undefined && bytes.length !== pin.size)
    || hash(bytes) !== pin.sha256) throw Error('Regression input checksum mismatch: ' + pin.file);
}
const upstream = await download(source), blank = await download(pins.blank), reference = await download(pins.reference);
const {id, ...runtime} = pins.reference;
const {files} = readRuntimeArchive(reference.bytes,
  {schemaVersion: 1, id, platform: 'win32-x64', upstreamCommit: lock.upstreamCommit, runtime}, zipEntries);
const referenceRoot = path.join(work, 'reference');
await fs.mkdir(referenceRoot);
for (const name of ['rhwp.js', 'rhwp_bg.wasm']) {
  const bytes = files.get('core/' + name);
  if (!bytes) throw Error('Incomplete reference core');
  await fs.writeFile(path.join(referenceRoot, name), bytes, {flag: 'wx'});
}
await fs.writeFile(path.join(referenceRoot, 'package.json'), '{"type":"module"}\n', {flag: 'wx'});
const sourceRoot = path.join(work, 'source');
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(project, 'scripts/build-patched-core.mjs'),
    '--source-archive', upstream.file, '--source-root', sourceRoot,
    '--output-root', path.join(work, 'prepared-only'), '--blank-template', blank.file, '--prepare-only'],
  {cwd: project, windowsHide: true, stdio: 'inherit'});
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(Error('Core source preparation failed: ' + code)));
});
const environment = {
  PWH_ENGINE_SOURCE: sourceRoot,
  PWH_REFERENCE_CORE_JS: path.join(referenceRoot, 'rhwp.js'),
  PWH_REFERENCE_CORE_WASM: path.join(referenceRoot, 'rhwp_bg.wasm'),
  // The smaller-paper preservation tests use this same independent r13 core.
  PWH_FLOAT_FRAME_BASE_JS: path.join(referenceRoot, 'rhwp.js'),
  PWH_FLOAT_FRAME_BASE_WASM: path.join(referenceRoot, 'rhwp_bg.wasm'),
};
await fs.writeFile(path.join(work, 'environment.json'), JSON.stringify(environment, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({ok: true, patchedSourcePrepared: true, referenceRuntime: id, installed: false}));
