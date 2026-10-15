import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { parseArgs, childPath, verifyBytes, zipEntries, extractNpm, assertOfficialLock,
  graftSelectionBridge, setup, PINS } from '../scripts/setup.mjs';

const fixture = async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-setup-test-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('pwh-setup-test-'));
    return fs.rm(resolved, { recursive: true, force: true });
  });
  return root;
};
function zip(name, value) {
  const data = Buffer.from(value), compressed = deflateRawSync(data), filename = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + compressed.length, 16);
  return Buffer.concat([local, filename, compressed, central, filename, end]);
}
function tarMember(name, data, type = '0') {
  const bytes = Buffer.from(data), header = Buffer.alloc(512);
  header.write(name); header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124); header.write(type, 156);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}

test('setup defaults and explicit runtime paths never inherit personal machine paths', () => {
  assert.equal(parseArgs([], { PWH_RUNTIME_ROOT: path.join(os.tmpdir(), 'portable-root') }).runtimeRoot,
    path.join(os.tmpdir(), 'portable-root'));
  assert.equal(parseArgs(['--with-nanum', '--skip-download', '--cli-only']).withNanum, true);
  assert.throws(() => parseArgs(['--runtime-root', '--dry-run']), /requires a path/);
  assert.throws(() => parseArgs(['--nanum-archive', 'fonts.zip']), /requires --with-nanum/);
  assert.throws(() => parseArgs(['--force']), /Unknown option/);
});

test('dry-run performs no file writes or downloads even for absent offline inputs', async t => {
  const parent = await fixture(t), root = path.join(parent, 'must-not-exist');
  await setup(parseArgs(['--runtime-root', root, '--dry-run', '--skip-download', '--with-nanum']));
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});

test('archive paths and digests reject traversal and mismatches', () => {
  const root = path.join(os.tmpdir(), 'pwh-archive-destination');
  for (const name of ['../escape', '/absolute', 'C:/absolute', 'one\\two', 'one/../../escape', '\0bad']) {
    assert.throws(() => childPath(root, name), /Unsafe archive path/);
  }
  assert.equal(childPath(root, 'package/index.js'), path.join(root, 'package', 'index.js'));
  const bytes = Buffer.from('verified');
  verifyBytes(bytes, { file: 'test.zip', sha256: createHash('sha256').update(bytes).digest('hex') });
  verifyBytes(bytes, { file: 'test.tgz', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` });
  assert.throws(() => verifyBytes(bytes, PINS.cli), /Integrity mismatch/);
});

test('ZIP reader decodes a bounded selected face and rejects truncated input', () => {
  const bytes = zip('fonts/Nanum.ttf', 'font-byte-fixture'), entries = zipEntries(bytes);
  assert.equal(entries[0].name, 'fonts/Nanum.ttf');
  assert.equal(entries[0].read().toString(), 'font-byte-fixture');
  assert.throws(() => zipEntries(bytes.subarray(0, bytes.length - 1)), /ZIP/);
  const tooLarge = Buffer.from(bytes);
  const directory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  tooLarge.writeUInt32LE(0x7fffffff, directory + 24);
  assert.throws(() => zipEntries(tooLarge), /size/);
});

test('npm extraction checks identity and rejects links and package traversal', async t => {
  const root = await fixture(t), archive = path.join(root, 'fixture.tgz'), destination = path.join(root, 'package');
  const pkg = JSON.stringify({ name: '@rhwp/editor', version: PINS.version });
  await fs.writeFile(archive, gzipSync(Buffer.concat([tarMember('package/package.json', pkg),
    tarMember('package/index.js', 'export const safe = true;'), Buffer.alloc(1024)])));
  await extractNpm(archive, destination, '@rhwp/editor');
  assert.match(await fs.readFile(path.join(destination, 'index.js'), 'utf8'), /safe/);
  await fs.writeFile(archive, gzipSync(tarMember('package/../escape', 'bad')));
  await assert.rejects(extractNpm(archive, path.join(root, 'second'), '@rhwp/editor'), /Unsafe archive path/);
  await fs.writeFile(archive, gzipSync(tarMember('package/link', 'target', '2')));
  await assert.rejects(extractNpm(archive, path.join(root, 'third'), '@rhwp/editor'), /link/);
});

test('locked dependencies must all use integrity-pinned official npm URLs', () => {
  const lock = { name: 'rhwp-studio', version: PINS.version, lockfileVersion: 3,
    packages: { '': {}, 'node_modules/example': { resolved: 'https://registry.npmjs.org/example/-/example-1.tgz', integrity: 'sha512-test' } } };
  assert.doesNotThrow(() => assertOfficialLock(lock));
  const changed = structuredClone(lock); changed.packages['node_modules/example'].resolved = 'https://example.com/package.tgz';
  assert.throws(() => assertOfficialLock(changed), /Non-official/);
  delete changed.packages['node_modules/example'].resolved;
  assert.throws(() => assertOfficialLock(changed), /Unpinned/);
});

test('the selection bridge is additive and refuses a second graft', async t => {
  const root = await fixture(t), project = path.join(root, 'project'), source = path.join(root, 'upstream');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(source, 'rhwp-studio', 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'studio-selection.ts'), 'export function installSelectionBridge() {}\n');
  const main = path.join(source, 'rhwp-studio', 'src', 'main.ts');
  await fs.writeFile(main, 'const preservedSource = true;\n');
  await graftSelectionBridge(source, project);
  const next = await fs.readFile(main, 'utf8');
  assert.ok(next.startsWith('const preservedSource = true;\n'));
  assert.match(next, /getInputHandler: \(\) => inputHandler/);
  assert.equal(await fs.readFile(path.join(source, 'rhwp-studio', 'src', 'collaboration-selection.ts'), 'utf8'),
    'export function installSelectionBridge() {}\n');
  await assert.rejects(graftSelectionBridge(source, project), /already present/);
});
