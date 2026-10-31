#!/usr/bin/env node
// Windows x64 bootstrap. Downloads are pinned; existing installations are never replaced.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import {installPreservedRuntime} from './preserved-runtime.mjs';

export const PINS = Object.freeze({
  version: '0.8.7',
  sourceCommit: '1a76570e833917d15817415a53c09ad61ab3203f',
  sourceUrl: 'https://github.com/edwardkim/rhwp.git',
  cli: {
    file: 'rhwp-v0.8.7-windows-x86_64.zip',
    url: 'https://github.com/edwardkim/rhwp/releases/download/v0.8.7/rhwp-v0.8.7-windows-x86_64.zip',
    sha256: 'f7ac326e98f595ae8fecd8da7a614ee9a37db77bdf938782a8e07c9da473ec6f',
  },
  core: {
    file: 'core-0.8.7.tgz', url: 'https://registry.npmjs.org/@rhwp/core/-/core-0.8.7.tgz',
    integrity: 'sha512-qgNpY9aclCvy9D7cPnpuplu42kUFZCCPhdjAS5HBso4Z4XeHG3uchYdUleQBoas/zEuwfJ7H4/ulepqdL/LXDA==',
  },
  editor: {
    file: 'editor-0.8.7.tgz', url: 'https://registry.npmjs.org/@rhwp/editor/-/editor-0.8.7.tgz',
    integrity: 'sha512-+765+dsh45HHb0o1fzGJyS8JBsGUtnX9oN/0a+9xGERztPEzkemdiGsVpje+awy/Cn033/KDK2LyiaFhWfAr/g==',
  },
  nanum: {
    file: 'nanum-all_new.zip', url: 'https://hangeul.naver.com/hangeul_static/webfont/zips/nanum-all_new.zip',
    sha256: '173fd24bf38914f385401f602572dca3481f7669966e91ad289066f719f6cc56',
  },
});
const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MARKER = '.pwh-install.json';
const DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com',
  'objects.githubusercontent.com', 'github-releases.githubusercontent.com', 'registry.npmjs.org',
  'hangeul.naver.com', 'hangeul.pstatic.net']);
const MAX_DOWNLOAD = 256 * 1024 * 1024;
const MAX_MEMBER = 128 * 1024 * 1024;

export function parseArgs(args, env = process.env) {
  const result = { runtimeRoot: path.resolve(env.PWH_RUNTIME_ROOT || path.join(os.homedir(), '.stoom-pwh')),
    dryRun: false, skipDownload: false, withNanum: false, cliOnly: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--skip-download') result.skipDownload = true;
    else if (arg === '--with-nanum') result.withNanum = true;
    else if (arg === '--cli-only') result.cliOnly = true;
    else if (arg === '--from-source') result.fromSource = true;
    else if (['--runtime-root', '--runtime-archive', '--nanum-archive', '--npm-cli', '--npm-cache'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path.`);
      result[{ '--runtime-root': 'runtimeRoot', '--runtime-archive':'runtimeArchive', '--nanum-archive': 'nanumArchive',
        '--npm-cli': 'npmCli', '--npm-cache': 'npmCache' }[arg]] = path.resolve(value);
    } else throw new Error(`Unknown option: ${arg}. Use --help.`);
  }
  if (result.nanumArchive && !result.withNanum) throw new Error('--nanum-archive requires --with-nanum.');
  if(result.runtimeArchive&&result.fromSource)throw Error('--runtime-archive cannot be combined with --from-source.');
  return result;
}

function usage() {
  return `Usage: node scripts/setup.mjs [options]

Requires Windows x64 and Node.js 22.12+ (or 24+). The default uses pwh's preserved prebuilt runtime.
  --runtime-root PATH  Install into PATH (default: PWH_RUNTIME_ROOT or ~/.stoom-pwh).
  --dry-run            Print the complete plan; do not write, run programs, or access the network.
  --skip-download      Offline: require the verified preserved ZIP in downloads/, or --runtime-archive.
  --runtime-archive PATH Use a local preserved runtime ZIP; its pinned SHA256 is required.
  --from-source        Explicit legacy source build. Requires Git/npm and pinned upstream inputs;
                       with --skip-download it also requires the source checkout and npm cache.
  --cli-only           Install the pinned CLI only; skip Studio/core/editor and Git/npm checks.
  --with-nanum         Opt in to NAVER's ~131 MB ZIP; install four unmodified TTFs and their license.
  --nanum-archive PATH Use a local NAVER ZIP instead (the same pinned SHA256 is required).
  --npm-cli PATH       Path to npm's npm-cli.js when npm is not available next to Node or on PATH.
  --npm-cache PATH     Explicit npm cache directory, useful for offline setup.
  --help               Show this help.

No service is started. Existing rhwp/, studio/, editor-sdk/ and fonts/ files are preserved.
Unknown or differently pinned installations cause an error; choose a fresh runtime root or
back up and move the old directories yourself. No OS or proprietary fonts are copied.
`;
}

export function childPath(root, member) {
  if (typeof member !== 'string' || !member || member.includes('\0')
    || member.includes('\\') || member.split('/').some(part => part === '..')
    || /^[A-Za-z]:|^\//.test(member)) throw new Error(`Unsafe archive path: ${member}`);
  const base = path.resolve(root);
  const target = path.resolve(base, ...member.split('/'));
  if (target === base || !target.startsWith(`${base}${path.sep}`)) throw new Error(`Unsafe archive path: ${member}`);
  return target;
}

async function exists(target) {
  try { await fs.lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function shaFile(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
export function verifyBytes(bytes, pin) {
  const algorithm = pin.sha256 ? 'sha256' : 'sha512';
  const expected = pin.sha256 || pin.integrity.slice('sha512-'.length);
  const actual = createHash(algorithm).update(bytes).digest(pin.sha256 ? 'hex' : 'base64');
  if (actual !== expected) throw new Error(`Integrity mismatch for ${pin.file}. Expected ${algorithm} ${expected}, got ${actual}.`);
}
async function verifyFile(file, pin) {
  const actual = await shaFile(file, pin.sha256 ? 'sha256' : 'sha512', pin.sha256 ? 'hex' : 'base64');
  if (actual !== (pin.sha256 || pin.integrity.slice(7))) throw new Error(`Integrity mismatch: ${file}. Existing file was preserved.`);
}

function openDownload(url, redirects = 0) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(parsed.hostname) || parsed.username || parsed.password
    || (parsed.port && parsed.port !== '443')) throw new Error(`Refusing unofficial download URL: ${parsed.origin}`);
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, { headers: { 'User-Agent': 'stoom-pwh-setup/0.1', 'Accept-Encoding': 'identity' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location || redirects >= 5) return reject(new Error('Too many download redirects.'));
        try { resolve(openDownload(new URL(response.headers.location, parsed), redirects + 1)); } catch (error) { reject(error); }
      } else if (response.statusCode !== 200) { response.resume(); reject(new Error(`Download failed: HTTP ${response.statusCode} (${parsed.hostname}).`)); }
      else resolve(response);
    });
    request.setTimeout(60_000, () => request.destroy(new Error('Download timed out.')));
    request.on('error', reject);
  });
}
async function cachedDownload(root, pin, options, localFile) {
  if (localFile) { await verifyFile(localFile, pin); return localFile; }
  const file = path.join(root, 'downloads', pin.file);
  if (await exists(file)) { await verifyFile(file, pin); return file; }
  if (options.skipDownload) throw new Error(`Offline archive missing: ${file}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.part-${randomUUID()}`;
  console.log(`Downloading ${pin.url}`);
  try {
    const response = await openDownload(pin.url);
    let length = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      length += chunk.length;
      callback(length > MAX_DOWNLOAD ? new Error('Download exceeds 256 MiB.') : null, chunk);
    } });
    await pipeline(response, limit, createWriteStream(temporary, { flags: 'wx' }));
    await verifyFile(temporary, pin);
    // The setup lock prevents another setup from racing this same cache path.
    await fs.rename(temporary, file);
    return file;
  } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}

/** Bounded ZIP reader for the verified release and font archives; no external unzip is needed. */
export function zipEntries(bytes, {maxMember = MAX_MEMBER} = {}) {
  if (!Number.isSafeInteger(maxMember) || maxMember < 1 || maxMember > 300 * 1024 * 1024) throw new Error('Invalid ZIP member limit.');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('Unsupported ZIP directory.');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);
  const centralEnd = cursor + centralSize;
  if (count === 0xffff || cursor === 0xffffffff || centralEnd > end) throw new Error('ZIP64 or malformed ZIP is unsupported.');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > centralEnd || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Malformed ZIP member.');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
    const offset = bytes.readUInt32LE(cursor + 42), next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > centralEnd || flags & 1 || ![0, 8].includes(method) || size > maxMember) throw new Error('Unsupported ZIP member encoding or size.');
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1');
    const unixMode = bytes.readUInt32LE(cursor + 38) >>> 16;
    if ((unixMode & 0xf000) === 0xa000) throw new Error('Archive symlinks are not allowed.');
    entries.push({ name, size, read() {
      if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('Malformed ZIP local header.');
      const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
      if (start + compressed > bytes.length) throw new Error('Truncated ZIP member.');
      const data = bytes.subarray(start, start + compressed);
      const decoded = method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: maxMember });
      if (decoded.length !== size) throw new Error('ZIP member size mismatch.');
      return decoded;
    } });
    cursor = next;
  }
  if (cursor !== centralEnd) throw new Error('ZIP directory size mismatch.');
  return entries;
}
async function extractZip(archive, destination) {
  const entries = zipEntries(await fs.readFile(archive));
  for (const entry of entries) {
    const output = childPath(destination, entry.name.replace(/\/$/, ''));
    if (entry.name.endsWith('/')) await fs.mkdir(output, { recursive: true });
    else { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, entry.read(), { flag: 'wx' }); }
  }
}

/** npm's pinned archives contain regular package/ files. Reject links and unexpected prefixes. */
export async function extractNpm(archive, destination, expectedName) {
  const tar = gunzipSync(await fs.readFile(archive), { maxOutputLength: 64 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const string = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
    const sizeText = string(124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Unsupported tar member size.');
    const size = parseInt(sizeText, 8), type = string(156, 1);
    const name = [string(345, 155), string(0, 100)].filter(Boolean).join('/');
    if (!Number.isSafeInteger(size) || size > MAX_MEMBER || offset + 512 + size > tar.length) throw new Error('Malformed npm archive.');
    if (type === 'x' || type === 'g') { offset += 512 + Math.ceil(size / 512) * 512; continue; }
    if (!name.startsWith('package/') || !['', '0', '5'].includes(type)) throw new Error('Unexpected npm archive path or link.');
    const relative = name.slice(8).replace(/\/$/, '');
    if (relative) {
      const output = childPath(destination, relative);
      if (type === '5') await fs.mkdir(output, { recursive: true });
      else { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, tar.subarray(offset + 512, offset + 512 + size), { flag: 'wx' }); }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const pkg = JSON.parse(await fs.readFile(path.join(destination, 'package.json'), 'utf8'));
  if (pkg.name !== expectedName || pkg.version !== PINS.version) throw new Error('npm package identity does not match the pin.');
}

async function run(command, args, { cwd, env, capture = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, windowsHide: true,
      shell: false, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    let output = '', errorOutput = '';
    child.stdout?.on('data', data => { output = (output + data).slice(-1024 * 1024); });
    child.stderr?.on('data', data => { errorOutput = (errorOutput + data).slice(-1024 * 1024); });
    child.on('error', reject);
    child.on('close', code => {
      if (code && !allowFailure) reject(new Error(`${path.basename(command)} failed (${code}). ${errorOutput.trim()}`));
      else resolve({ code, stdout: output.trim(), stderr: errorOutput.trim() });
    });
  });
}
async function npmRunner(options) {
  const candidates = [options.npmCli, process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].filter(Boolean);
  for (const file of candidates) if (file.endsWith('.js') && await exists(file)) return args => run(process.execPath, [file, ...args], { cwd: options.studioRoot });
  // Locate npm-cli.js without passing user paths through cmd.exe or a shell command string.
  const found = await run('where.exe', ['npm.cmd'], { capture: true, allowFailure: true }).catch(() => null);
  for (const file of found?.stdout.split(/\r?\n/).filter(Boolean) ?? []) {
    const cli = path.join(path.dirname(file), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (await exists(cli)) return args => run(process.execPath, [cli, ...args], { cwd: options.studioRoot });
  }
  throw new Error('npm is required. Install a normal Node.js distribution or pass --npm-cli C:\\path\\to\\npm-cli.js.');
}
export function assertOfficialLock(lock) {
  if (lock.name !== 'rhwp-studio' || lock.version !== PINS.version || lock.lockfileVersion !== 3 || !lock.packages) {
    throw new Error('Expected the pinned rhwp-studio npm lockfile v3.');
  }
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    if (!entry.resolved || !entry.integrity || entry.link) throw new Error(`Unpinned dependency: ${name}`);
    const url = new URL(entry.resolved);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password) {
      throw new Error(`Non-official registry dependency: ${name}`);
    }
  }
}
export async function graftSelectionBridge(sourceRoot, projectRoot = PROJECT_ROOT) {
  const studio = path.join(sourceRoot, 'rhwp-studio'), main = path.join(studio, 'src', 'main.ts');
  const source = await fs.readFile(main, 'utf8');
  if (source.includes("from './collaboration-selection'")) throw new Error('Selection bridge is already present; use an untouched tagged source checkout.');
  await fs.copyFile(path.join(projectRoot, 'src', 'studio-selection.ts'), path.join(studio, 'src', 'collaboration-selection.ts'));
  await fs.writeFile(main, `${source}\n// pwh: read-only coordinates for the actual editor selection.\nimport { installSelectionBridge } from './collaboration-selection';\ninstallSelectionBridge({ getInputHandler: () => inputHandler, wasm,\n  getDocumentAgent: () => documentAgent, getCanvasView: () => canvasView });\n`);
}

async function pinnedSource(root, options) {
  const source = path.join(root, 'source', `rhwp-${PINS.version}`);
  if (!await exists(source)) {
    if (options.skipDownload) throw new Error(`Offline source checkout missing: ${source}`);
    await fs.mkdir(path.dirname(source), { recursive: true });
    await run('git', ['-c', 'core.autocrlf=false', '-c', 'protocol.file.allow=never', 'clone', '--depth', '1',
      '--filter=blob:none', '--single-branch', '--branch', `v${PINS.version}`, '--no-checkout', PINS.sourceUrl, source]);
    await run('git', ['-C', source, 'sparse-checkout', 'set', '--cone', 'rhwp-studio', 'npm/hwpctrl-ocx', 'npm/editor']);
    await run('git', ['-c', 'core.autocrlf=false', '-C', source, 'checkout', '--detach', PINS.sourceCommit]);
  }
  const localGit = ['-c', 'protocol.allow=never', '-C', source];
  const readOptions = { capture: true, env: { GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } };
  const revision = await run('git', [...localGit, 'rev-parse', 'HEAD'], readOptions);
  if (revision.stdout !== PINS.sourceCommit) throw new Error(`Source checkout must be exactly ${PINS.sourceCommit}. Existing checkout was preserved.`);
  const clean = await run('git', [...localGit, 'status', '--porcelain', '--untracked-files=no'], readOptions);
  if (clean.stdout) throw new Error(`Source checkout has tracked changes: ${source}. It was preserved.`);
  return source;
}
async function copyPinnedBuildInputs(source, destination) {
  // Copy only tracked build inputs, so ignored .env files and unrelated local files cannot enter the build.
  const tracked = await run('git', ['-c', 'protocol.allow=never', '-C', source, 'ls-files', '-z', '--',
    'rhwp-studio', 'npm/hwpctrl-ocx', 'npm/editor', 'LICENSE'], { capture: true,
    env: { GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } });
  const files = tracked.stdout.split('\0').filter(Boolean);
  if (!files.includes('rhwp-studio/src/main.ts') || !files.includes('LICENSE')) throw new Error('Pinned source build inputs are incomplete.');
  for (const file of files) {
    const input = childPath(source, file), output = childPath(destination, file);
    const stat = await fs.lstat(input);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsupported source input: ${file}`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.copyFile(input, output, 1);
  }
}
async function installed(target, kind, bridgeHash) {
  if (!await exists(target)) return false;
  let marker;
  try { marker = JSON.parse(await fs.readFile(path.join(target, MARKER), 'utf8')); } catch { /* An unknown target is never adopted. */ }
  if (!marker || marker.version !== PINS.version || marker.kind !== kind || marker.sourceCommit !== PINS.sourceCommit
    || (kind === 'studio' && marker.bridgeSha256 !== bridgeHash)
    || (kind === 'rhwp' && marker.archiveSha256 !== PINS.cli.sha256)
    || !marker.files || !Object.hasOwn(marker.files, { rhwp: 'rhwp.exe', studio: 'index.html', 'editor-sdk': 'index.js', core:'rhwp_bg.wasm' }[kind])) {
    throw new Error(`Existing ${target} is not this pinned pwh installation. It was preserved; use a fresh --runtime-root or move it yourself.`);
  }
  for (const [file, sha256] of Object.entries(marker.files ?? {})) {
    if (await shaFile(childPath(target, file)) !== sha256) throw new Error(`Installed file changed: ${path.join(target, file)}. It was preserved.`);
  }
  console.log(`Keeping existing ${kind}: ${target}`);
  return true;
}
async function mark(target, kind, files, bridgeHash) {
  const hashes = {};
  for (const file of files) hashes[file] = await shaFile(childPath(target, file));
  await fs.writeFile(path.join(target, MARKER), JSON.stringify({ schemaVersion: 1, kind, version: PINS.version,
    sourceCommit: PINS.sourceCommit, ...(kind === 'rhwp' ? { archiveSha256: PINS.cli.sha256 } : {}),
    ...(kind === 'studio' ? { bridgeSha256: bridgeHash } : {}), files: hashes }, null, 2) + '\n', { flag: 'wx' });
}
async function filesUnder(root) {
  const found = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Installation tree contains a symlink.');
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) for (const child of await filesUnder(full)) found.push(`${entry.name}/${child}`);
    else if (entry.isFile()) found.push(entry.name);
  }
  return found;
}

const NANUM_FACES = [
  ['NanumBarunGothic.ttf', 'nanumbarun-regular', '나눔바른고딕', 'NanumBarunGothic', 'Regular', 400, '9b872773134e2e4d8c0b17021266786576db06c843ede0d0b523b214a450756c'],
  ['NanumBarunGothicBold.ttf', 'nanumbarun-bold', '나눔바른고딕', 'NanumBarunGothicBold', 'Bold', 600, '39bba4cd9bd2986143825c8654abbb62443914ab33b346c0c929a916f5d98bf2'],
  ['NanumGothic.ttf', 'nanumgothic-regular', '나눔고딕', 'NanumGothic', 'Regular', 400, '48a28e97b34fc8e5b157657633670cd1b7de126cfc414da65ce9c3d5bc8be733'],
  ['NanumGothicBold.ttf', 'nanumgothic-bold', '나눔고딕', 'NanumGothicBold', 'Bold', 600, '454eb3f503f377782a99eb84fc4bb7dde22a0f075d41b47427737f2985053bc9'],
];
async function installNanum(root, stage, options) {
  const target = path.join(root, 'fonts'), marker = path.join(target, 'document-fonts.json');
  if (await exists(marker)) {
    const previous = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (!Array.isArray(previous) || !NANUM_FACES.every(face => previous.some(item => item.id === face[1]
      && path.basename(item.path) === face[0]))) throw new Error(`Existing font manifest was preserved: ${marker}`);
    for (const [file, , , , , , sha256] of NANUM_FACES) await verifyFile(path.join(target, file), { sha256 });
    if (!await exists(path.join(target, 'LICENSE-NAVER.txt'))) throw new Error('Existing Nanum fonts have no bundled license. They were preserved.');
    console.log('Keeping existing verified NAVER fonts.'); return;
  }
  for (const [file] of NANUM_FACES) if (await exists(path.join(target, file))) throw new Error(`Existing font was preserved: ${path.join(target, file)}`);
  if (await exists(path.join(target, 'LICENSE-NAVER.txt'))) throw new Error('Existing font license was preserved.');
  const license = await fs.readFile(path.join(PROJECT_ROOT, 'licenses', 'naver-nanum-OFL-1.1.txt'));
  const archive = await cachedDownload(root, PINS.nanum, options, options.nanumArchive);
  const entries = zipEntries(await fs.readFile(archive));
  const prepared = path.join(stage, 'nanum'); await fs.mkdir(prepared);
  const records = [];
  for (const [file, id, family, postscriptName, style, intrinsicWeight, sha256] of NANUM_FACES) {
    const matches = entries.filter(entry => entry.name.split('/').at(-1) === file);
    if (matches.length !== 1) throw new Error(`Expected exactly one ${file} in the NAVER archive.`);
    const bytes = matches[0].read(); verifyBytes(bytes, { file, sha256 });
    await fs.writeFile(path.join(prepared, file), bytes, { flag: 'wx' });
    const latinFamily = family === '나눔바른고딕' ? 'NanumBarunGothic' : 'NanumGothic';
    records.push({ id, family, fullName: style === 'Bold' ? `${family} Bold` : family, postscriptName, style,
      // CSS matching slots: Studio asks for 400/700. Preserve the actual OS/2 weight separately.
      weight: style === 'Bold' ? 700 : 400, intrinsicWeight, slant: 'normal',
      aliases: [latinFamily, family === '나눔바른고딕' ? 'Nanum Barun Gothic' : 'Nanum Gothic'],
      faceIndex: 0, path: path.join(target, file) });
  }
  await fs.writeFile(path.join(prepared, 'LICENSE-NAVER.txt'), license, { flag: 'wx' });
  await fs.writeFile(path.join(prepared, 'document-fonts.json'), JSON.stringify(records, null, 2) + '\n', { flag: 'wx' });
  await fs.mkdir(target, { recursive: true });
  // All bytes and the license are validated before adding any files. Never overwrite a user's fonts.
  const additions = (await filesUnder(prepared)).filter(file => file !== 'document-fonts.json');
  additions.push('document-fonts.json'); // Publish the manifest only after every font and its license exist.
  for (const file of additions) await fs.copyFile(path.join(prepared, file), path.join(target, file), 1);
}

export async function setup(options) {
  if(!options.fromSource){
    const lock=JSON.parse(await fs.readFile(path.join(PROJECT_ROOT,'runtime-lock.json'),'utf8'));
    return installPreservedRuntime(options,lock,{download:cachedDownload,zipEntries,childPath,installNanum});
  }
  const root = path.resolve(options.runtimeRoot);
  console.log(`pwh runtime: ${root}\nrhwp ${PINS.version}; source ${PINS.sourceCommit}`);
  if (options.dryRun) {
    console.log(JSON.stringify({ runtimeRoot: root, requirements: options.cliOnly ? ['Windows x64', 'Node 22.12+ or 24+'] :
      ['Windows x64', 'Node 22.12+ or 24+', 'Git', 'npm'], cliOnly: options.cliOnly, offline: options.skipDownload,
      downloads: [PINS.cli, ...options.cliOnly ? [] : [PINS.core, PINS.editor], ...options.withNanum ? [PINS.nanum] : []],
      source: options.cliOnly ? null : { url: PINS.sourceUrl, commit: PINS.sourceCommit },
      directories: ['rhwp', 'studio', 'studio-inline', 'editor-sdk', 'core', 'fonts', 'documents'],
      preserveExisting: true, startService: false }, null, 2));
    return;
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This bootstrap supports Windows x64 only. --dry-run is available on any platform.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 12 || major === 23) throw new Error('Node.js 22.12+ LTS or 24+ is required by the pinned Vite build.');
  await fs.mkdir(root, { recursive: true });
  const lockPath = path.join(root, '.setup.lock');
  const lock = await fs.open(lockPath, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error(`Setup lock exists: ${lockPath}. Check that no setup is running before removing it.`); throw error; });
  const stage = path.join(root, `.setup-${randomUUID()}`);
  let completed = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    await fs.mkdir(stage);
    const bridgeHash = options.cliOnly ? null : await shaFile(path.join(PROJECT_ROOT, 'src', 'studio-selection.ts'));
    const needsCli = !await installed(path.join(root, 'rhwp'), 'rhwp', bridgeHash);
    const needsStudio = !options.cliOnly && !await installed(path.join(root, 'studio'), 'studio', bridgeHash);
    const needsSdk = !options.cliOnly && !await installed(path.join(root, 'editor-sdk'), 'editor-sdk', bridgeHash);
    const needsCore = !options.cliOnly && !await installed(path.join(root, 'core'), 'core', bridgeHash);
    const needsInline = !options.cliOnly && !await exists(path.join(root,'studio-inline','editor.js'));
    const publish = [];
    if (needsCore) {
      const archive = await cachedDownload(root, PINS.core, options);
      const prepared = path.join(stage, 'core');
      await extractNpm(archive, prepared, '@rhwp/core');
      await mark(prepared, 'core', await filesUnder(prepared), bridgeHash);
      publish.push([prepared, path.join(root, 'core')]);
    }
    if (needsCli) {
      const archive = await cachedDownload(root, PINS.cli, options);
      const extracted = path.join(stage, 'cli-archive'); await fs.mkdir(extracted);
      await extractZip(archive, extracted);
      const executables = (await filesUnder(extracted)).filter(file => file.split('/').at(-1).toLowerCase() === 'rhwp.exe');
      if (executables.length !== 1) throw new Error('Release archive must contain exactly one rhwp.exe.');
      const prepared = path.join(stage, 'rhwp');
      await fs.cp(path.dirname(childPath(extracted, executables[0])), prepared, { recursive: true, errorOnExist: true, force: false });
      const version = await run(path.join(prepared, 'rhwp.exe'), ['--version'], { capture: true });
      if (!/(?:^|\s)v?0\.8\.7(?=\s|$)/.test(version.stdout)) throw new Error('Downloaded CLI version does not match 0.8.7.');
      await mark(prepared, 'rhwp', await filesUnder(prepared), bridgeHash);
      publish.push([prepared, path.join(root, 'rhwp')]);
    }
    if (needsStudio || needsSdk || needsInline) {
      await run('git', ['--version'], { capture: true }).catch(() => { throw new Error('Git is required to verify and build the pinned Studio source.'); });
      const source = await pinnedSource(root, options);
      if (needsSdk) {
        const archive = await cachedDownload(root, PINS.editor, options);
        const sdk = path.join(stage, 'editor-sdk'); await extractNpm(archive, sdk, '@rhwp/editor');
        await fs.copyFile(path.join(source, 'LICENSE'), path.join(sdk, 'LICENSE'));
        await mark(sdk, 'editor-sdk', await filesUnder(sdk), bridgeHash); publish.push([sdk, path.join(root, 'editor-sdk')]);
      }
      if (needsStudio || needsInline) {
        const build = path.join(stage, 'build');
        await copyPinnedBuildInputs(source, build);
        const archive = await cachedDownload(root, PINS.core, options);
        await extractNpm(archive, path.join(build, 'pkg'), '@rhwp/core');
        await graftSelectionBridge(build);
        const studioRoot = path.join(build, 'rhwp-studio');
        assertOfficialLock(JSON.parse(await fs.readFile(path.join(studioRoot, 'package-lock.json'), 'utf8')));
        const npm = await npmRunner({ ...options, studioRoot });
        await npm(['ci', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/',
          ...options.skipDownload ? ['--offline'] : [], ...options.npmCache ? ['--cache', options.npmCache] : []]);
        if(needsStudio){
        await run(process.execPath, [path.join(studioRoot, 'node_modules', 'typescript', 'bin', 'tsc')], { cwd: studioRoot });
        await run(process.execPath, [path.join(studioRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--base=/studio/', '--outDir', 'dist-pwh'],
          { cwd: studioRoot, env: { RHWP_DISABLE_EXTERNAL_WEBFONTS: '1' } });
        const prepared = path.join(stage, 'studio');
        await fs.rename(path.join(studioRoot, 'dist-pwh'), prepared);
        await fs.copyFile(path.join(source, 'LICENSE'), path.join(prepared, 'LICENSE-RHWP.txt'));
        await fs.copyFile(path.join(build, 'pkg', 'LICENSE'), path.join(prepared, 'LICENSE-CORE.txt'));
        await mark(prepared, 'studio', await filesUnder(prepared), bridgeHash); publish.push([prepared, path.join(root, 'studio')]);
        }
        if(needsInline){
          await run(process.execPath,[path.join(PROJECT_ROOT,'scripts/build-inline.mjs'),build],{cwd:PROJECT_ROOT});
          const inline=path.join(build,'inline-dist');
          await fs.copyFile(path.join(source,'LICENSE'),path.join(inline,'LICENSE-RHWP.txt'));
          await mark(inline,'studio-inline',await filesUnder(inline),bridgeHash);
          publish.push([inline,path.join(root,'studio-inline')]);
        }
      }
    }
    if (options.withNanum) await installNanum(root, stage, options);
    // Each rename refuses an already-existing destination. There is no replacement/delete option.
    for (const [prepared, destination] of publish) {
      if (await exists(destination)) throw new Error(`Target appeared during setup and was preserved: ${destination}`);
      await fs.rename(prepared, destination);
    }
    for (const name of ['fonts', 'documents']) await fs.mkdir(path.join(root, name), { recursive: true });
    completed = true;
    console.log(`pwh setup complete. ${options.cliOnly ? 'CLI only; run again without --cli-only for the editor.' : 'CLI and browser editor are ready.'}\nNo service was started.`);
  } finally {
    await lock.close(); await fs.unlink(lockPath);
    if (completed) {
      // Only this invocation's checked, generated child directory may be removed.
      const resolvedStage = path.resolve(stage);
      // eslint-disable-next-line no-unsafe-finally -- Cleanup must fail closed for an unchecked path.
      if (path.dirname(resolvedStage) !== root || !path.basename(resolvedStage).startsWith('.setup-')) throw new Error('Refusing unsafe staging cleanup.');
      await fs.rm(resolvedStage, { recursive: true, force: true });
    } else console.error(`Incomplete staging was preserved for inspection: ${stage}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const options = parseArgs(process.argv.slice(2)); if (options.help) console.log(usage()); else await setup(options); }
  catch (error) { console.error(`pwh setup: ${error.message}`); process.exitCode = 1; }
}
