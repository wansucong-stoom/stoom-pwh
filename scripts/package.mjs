#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const FILES = Object.freeze([
  'plugin.json', 'mcp.json', '.mcp.json', '.codex-plugin/plugin.json', 'package.json',
  'engine.config.json', 'engine.config.example.json', 'runtime-lock.json', 'README.md', 'LICENSE',
  'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'scripts/setup.mjs',
  'scripts/inspect_template.py', 'scripts/fill_form.py', 'scripts/replace_image.py', 'scripts/inspect_image.py', 'scripts/build-studio.ps1',
  'scripts/package.mjs', 'scripts/build-inline.mjs', 'scripts/save-dialog.ps1', 'scripts/launch.mjs', 'scripts/preserved-runtime.mjs', 'scripts/preserve-engine.py',
]);
const DIRECTORIES = Object.freeze(['docs', 'licenses', 'skills', 'src', 'examples']);
const SOURCE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.mjs', '.js', '.ts', '.html', '.css', '.svg']);
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const REQUIRED = ['scripts/launch.mjs','scripts/build-inline.mjs','src/inline-host.js','src/studio-inline-adapter.ts','src/editor-session.mjs','src/server.mjs', 'src/native-mcp.mjs', 'src/cli.mjs', 'src/engine.mjs',
  'src/config.mjs', 'src/live.mjs', 'src/editor.html', 'src/editor-client.mjs', 'src/viewer.html',
  'src/studio-selection.ts', 'src/template.mjs', 'src/form.mjs', 'skills/pwh/SKILL.md',
  'licenses/naver-nanum-OFL-1.1.txt', 'examples/demo.json', 'examples/changes.json'];
const HOME_PATH = /(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+|\/(?:Users|home)\/[^/\s"'`]+)/;

function inside(root, target) {
  const relative = path.relative(root, target);
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function usage() {
  return `Usage: node scripts/package.mjs [--output ABSOLUTE.zip]

Create a public source/plugin ZIP containing one pwh/ folder.
Only the fixed public file/directory allowlist is included. Tests, private local
configuration, institution-specific scripts, documents and runtime binaries are excluded.
No npm dependencies or external archiver are required.

  --output PATH  New absolute .zip path outside the project; its parent must exist.
                 Default: the OS temporary directory, pwh-VERSION-UUID.zip.
  --help, -h     Show this help without writing a file.

An existing output file is never overwritten.
`;
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--help' || args[index] === '-h') options.help = true;
    else if (args[index] === '--output' && !options.output) {
      options.output = args[++index];
      if (!options.output || options.output.startsWith('--')) throw new Error('--output requires an absolute .zip path.');
    } else throw new Error(`Unknown or repeated option: ${args[index]}. Use --help.`);
  }
  return options;
}

async function collect(root) {
  const entries = new Map();
  let total = 0;
  async function add(relative, directoryAllowed = false) {
    const filename = path.join(root, ...relative.split('/'));
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not packaged: ${relative}`);
    if (stat.isDirectory()) {
      if (!directoryAllowed) throw new Error(`Expected an allowlisted file: ${relative}`);
      for (const child of (await fs.readdir(filename)).sort()) await add(`${relative}/${child}`, true);
      return;
    }
    if (!stat.isFile()) throw new Error(`Not a regular source file: ${relative}`);
    if (directoryAllowed && !SOURCE_EXTENSIONS.has(path.posix.extname(relative).toLowerCase()))
      throw new Error(`Public directories may contain only source/text assets: ${relative}`);
    if (!inside(root, await fs.realpath(filename))) throw new Error(`Source is outside the project: ${relative}`);
    if ((total += stat.size) > MAX_SOURCE_BYTES) throw new Error('Public source bundle exceeds 64 MiB. Runtime assets must stay outside the package.');
    const bytes = await fs.readFile(filename);
    if (bytes.length !== stat.size) throw new Error(`Source changed while being read; retry: ${relative}`);
    if (HOME_PATH.test(bytes.toString('utf8'))) throw new Error(`A machine-specific home path remains in: ${relative}`);
    entries.set(relative, bytes);
  }
  for (const filename of FILES) await add(filename);
  for (const directory of DIRECTORIES) await add(directory, true);
  return entries;
}

function validate(entries) {
  const json = filename => {
    try { return JSON.parse(entries.get(filename)?.toString('utf8')); }
    catch (error) { throw new Error(`Invalid JSON in ${filename}: ${error.message}`); }
  };
  const requireFile = filename => {
    if (!entries.has(filename)) throw new Error(`Required referenced file is absent: ${filename}`);
  };
  for (const filename of REQUIRED) requireFile(filename);
  const plugin = json('plugin.json'), codex = json('.codex-plugin/plugin.json'), pkg = json('package.json');
  if ([plugin, codex, pkg].some(item => item.name !== 'pwh')) throw new Error('Plugin and package names must be pwh.');
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)
    || plugin.version !== pkg.version || codex.version !== pkg.version) throw new Error('Plugin/package versions must agree.');
  if (codex.skills !== './skills' || codex.mcpServers !== './.mcp.json') throw new Error('Codex manifest must reference the packaged skills and .mcp.json.');
  for (const filename of ['mcp.json', '.mcp.json']) {
    const mcp = json(filename);
    if (!mcp.mcpServers?.pwh || !mcp.mcpServers?.['rhwp-core']) throw new Error(`${filename} must declare pwh and rhwp-core.`);
    for (const [name, server] of Object.entries(mcp.mcpServers)) {
      if (server.command !== 'node' || server.cwd !== '${PLUGIN_ROOT}' || !Array.isArray(server.args))
        throw new Error(`Unexpected local server configuration: ${filename}/${name}`);
      let entrypoint = false;
      for (const value of server.args) if (typeof value === 'string' && value.startsWith('${PLUGIN_ROOT}/')) {
        const target = value.slice('${PLUGIN_ROOT}/'.length);
        requireFile(target); entrypoint = true;
      }
      if (!entrypoint) throw new Error(`No packaged server entrypoint: ${filename}/${name}`);
    }
  }
  for (const filename of ['engine.config.json', 'engine.config.example.json', 'examples/demo.json', 'examples/changes.json']) json(filename);
  // Check pwh's relative runtime module imports. The TS bridge is compiled inside upstream Studio.
  for (const [filename, bytes] of entries) if (filename.endsWith('.mjs')) {
    const pattern = /\b(?:from\s*|import\s*\()(['"])(\.{1,2}\/[^'"]+\.mjs)\1/g;
    for (const match of bytes.toString('utf8').matchAll(pattern))
      requireFile(path.posix.normalize(path.posix.join(path.posix.dirname(filename), match[2])));
  }
  return {version: pkg.version, manifestFiles: ['plugin.json', '.codex-plugin/plugin.json', 'mcp.json', '.mcp.json', 'package.json']};
}

const CRC_TABLE = Uint32Array.from({length: 256}, (_, index) => {
  for (let bit = 0; bit < 8; bit++) index = (index >>> 1) ^ ((index & 1) ? 0xedb88320 : 0);
  return index >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const local = [], central = [];
  let offset = 0, centralBytes = 0;
  const records = [['', Buffer.alloc(0)], ...[...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)];
  if (records.length > 65535) throw new Error('Too many source files for ZIP32.');
  for (const [relative, bytes] of records) {
    const directory = relative === '', name = Buffer.from(`pwh/${relative}`, 'utf8');
    const compressed = directory ? bytes : deflateRawSync(bytes, {level: 9});
    const method = directory ? 0 : 8, crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(method, 8);
    header.writeUInt16LE(0x21, 12); // Fixed 1980-01-01: source bytes determine ZIP bytes.
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(0x0314, 4);
    record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(method, 10);
    record.writeUInt16LE(0x21, 14); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(directory ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name); centralBytes += record.length + name.length;
    offset += header.length + name.length + compressed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10); end.writeUInt32LE(centralBytes, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

export async function packagePlugin({output} = {}) {
  const root = await fs.realpath(PROJECT_ROOT);
  const entries = await collect(root);
  const validated = validate(entries);
  output ??= path.join(os.tmpdir(), `pwh-${validated.version}-${randomUUID()}.zip`);
  if (!path.isAbsolute(output) || path.extname(output).toLowerCase() !== '.zip') throw new Error('--output must be an absolute .zip path.');
  const parent = await fs.realpath(path.dirname(output));
  output = path.join(parent, path.basename(output));
  if (inside(root, output)) throw new Error('Output must be outside the project directory.');
  const archive = makeZip(entries);
  const handle = await fs.open(output, 'wx', 0o600);
  try {
    try { await handle.writeFile(archive); }
    finally { await handle.close(); }
  } catch (error) {
    await fs.unlink(output).catch(() => {}); // Only the file just exclusively created above.
    throw error;
  }
  return {output, archiveRoot: 'pwh/', version: validated.version, fileCount: entries.size,
    bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex'),
    manifestFiles: validated.manifestFiles, files: [...entries.keys()].sort()};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else process.stdout.write(`${JSON.stringify(await packagePlugin(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`pwh package: ${error.message}\n`);
    process.exitCode = 1;
  }
}
