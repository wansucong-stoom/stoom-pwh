#!/usr/bin/env node
// Build a separate candidate. This script never installs or overwrites a runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const pinned = {
  upstreamCommit: '1a76570e833917d15817415a53c09ad61ab3203f',
  sourceArchiveSha256: '067feefc25d36921ee41fea5df6fead00255ffa86441891fbaa202f96de202a2',
  blankTemplateSha256: '43f472751fafefb8c66b0f831660ebed51e443a46bebe44c75bba918154ce4c9',
  unchangedGlueSha256: '70cde06a369fa7fd4fc8bc8f3d6acaee158596ba1a116a2c72159002b0b5654e',
};
const patches = [
  {
    file: 'rhwp-0.8.7-nols-row-content-floor.patch',
    sha256: '5a2427c162ee3928b7edecbaabad10936700c7db02f25a5436fb0a74a92bd221',
    sources: [{
      path: 'src/renderer/layout/table_layout.rs',
      originalSha256: '1dcbd3254a0f68b7de40c922f10e15cb62f2ef85e2c59fb24050bb143fa5f5f9',
      patchedSha256: 'c3df908c978e4aef7876b555c4a4c7b85749587194b4755d43e4c5ae9c67c238',
    }],
  },
  {
    file: 'rhwp-0.8.7-inline-table-affect-line-spacing.patch',
    sha256: 'a9f6a533debe686f6e89ec06870e47ccb0357635f8303775467ceb6cfca9da7a',
    sources: [
      {
        path: 'src/renderer/mod.rs',
        originalSha256: 'b27c1148d0496fe02dfef5ee3375511c3f2cd110925ebbfe90398a67b018f15d',
        patchedSha256: 'c9191193db4a0b14a936887fac5ffd99f47d77311f60dc58b961574048c3271a',
      },
      {
        path: 'src/renderer/composer/line_breaking.rs',
        originalSha256: '42a685bc83d81e01356a5576fcc03d0c92117d5054d018c84f77ddbad297921e',
        patchedSha256: '6ced0b75cf4b46090801dd05adabe6e715d9ff06e22468ead3dbd5e6fbc9b940',
      },
      {
        path: 'src/renderer/layout.rs',
        originalSha256: 'eb561f70fed2217db8e17efc8b33a5639de4dd5c8087797cd2cf876be4bc4ca5',
        patchedSha256: '81fef37b2cd464f007d721edcdaf938d6ba47439dc9418c8745bc7da927d7a61',
      },
    ],
  },
  {
    "file": "rhwp-0.8.7-nested-source-ownership.patch",
    "sha256": "346e2885cb5720574515167db94448f256e5d210d729ee63e2c0ac732e5b2a96",
    "sources": [
      {
        "path": "src/renderer/layout/table_layout.rs",
        "originalSha256": "c3df908c978e4aef7876b555c4a4c7b85749587194b4755d43e4c5ae9c67c238",
        "patchedSha256": "7f294df11f7dc48611cdcfbf8a7fa813763778dd9c4573cd619c06bc4c26990a"
      },
      {
        "path": "src/renderer/layout/table_partial.rs",
        "originalSha256": "9e0a4d66d00906d4c949481088dba04d81d1f04ac1091b09188d65a9140ddeab",
        "patchedSha256": "cebac7b673a9c051bf31e64bcc6d2310f669b74a97bfd6351d663a9cc5b452d6"
      }
    ]
  },
];
const help = `Usage: node scripts/build-patched-core.mjs
  --source-archive <fixed upstream source ZIP>
  --source-root <new directory to extract and patch>
  --output-root <new candidate core directory>
  --blank-template <fixed-commit saved/blank2010.hwp>
  [--cargo <executable>] [--rustc <executable>] [--python <executable>]
  [--wasm-bindgen <0.2.127 executable>] [--target-dir <build cache directory>]
  [--offline] [--prepare-only]

Requires Rust/Cargo 1.93.1 with wasm32-unknown-unknown, wasm-bindgen 0.2.127,
Git, Python 3.11+, and Node.js 22.12+. RUSTUP_HOME, CARGO_HOME and PATH are
inherited. Set RUSTUP_TOOLCHAIN to an installed 1.93.1 toolchain if needed.
Inputs are hash-pinned. Source/output roots must not already exist.
--prepare-only verifies and applies the patch without compiling.
No downloads or runtime installation are performed by this script. Cargo may
fetch missing dependencies unless --offline is supplied.
`;
const allowed = new Set(['source-archive','source-root','output-root','blank-template',
  'cargo','rustc','python','wasm-bindgen','target-dir','offline','prepare-only','help']);
const flags = new Set(['offline','prepare-only','help']);
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const name = process.argv[i].replace(/^--/, '');
  if (!process.argv[i].startsWith('--') || !allowed.has(name) || name in args) throw Error('Invalid or repeated argument: ' + process.argv[i]);
  if (flags.has(name)) args[name] = true;
  else {
    const value = process.argv[++i];
    if (!value || value.startsWith('--')) throw Error('Missing value for --' + name);
    args[name] = value;
  }
}
if (args.help) { process.stdout.write(help); process.exit(0); }
for (const name of ['source-archive','source-root','output-root','blank-template']) {
  if (!args[name]) throw Error('Required: --' + name + '\n' + help);
}
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const archive = path.resolve(args['source-archive']);
const sourceRoot = path.resolve(args['source-root']);
const outputRoot = path.resolve(args['output-root']);
const blank = path.resolve(args['blank-template']);
const targetDir = path.resolve(args['target-dir'] || path.join(sourceRoot, 'target'));
const python = args.python || 'python';
const cargo = args.cargo || 'cargo';
const rustc = args.rustc || 'rustc';
const bindgen = args['wasm-bindgen'] || 'wasm-bindgen';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function assertHash(file, expected) {
  const actual = hash(await fs.readFile(file));
  if (actual !== expected) throw Error('SHA256 mismatch: ' + path.basename(file));
  return actual;
}
async function assertNewRoot(root) {
  if (root === path.parse(root).root) throw Error('A filesystem root cannot be a build directory');
  try { await fs.lstat(root); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  throw Error('Build directory already exists; choose a new directory: ' + root);
}
function contains(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
if (contains(sourceRoot, outputRoot) || contains(outputRoot, sourceRoot)) throw Error('Source and output roots must be separate');
for (const root of [sourceRoot, outputRoot]) await assertNewRoot(root);
await assertHash(archive, pinned.sourceArchiveSha256);
await assertHash(blank, pinned.blankTemplateSha256);
for (const patch of patches) {
  await assertHash(path.join(repoRoot, 'docs/engine-patches', patch.file), patch.sha256);
}

async function run(command, commandArgs, {cwd, capture = false, env = {}} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd, env: {...process.env, ...env}, windowsHide: true,
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
    });
    let output = '';
    child.stdout?.on('data', data => { output += data; if (output.length > 8 * 1024 * 1024) child.kill(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(Error(command + ' failed: exit ' + code)));
  });
}
const extract = String.raw`
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import sys
archive, destination = Path(sys.argv[1]), Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=False)
with ZipFile(archive) as z:
    for entry in z.infolist():
        p = PurePosixPath(entry.filename)
        if p.is_absolute() or '..' in p.parts or '\\' in entry.filename or ':' in entry.filename:
            raise SystemExit('Unsafe archive member')
        if (entry.external_attr >> 16) & 0o170000 == 0o120000:
            raise SystemExit('Archive symlinks are not supported')
    z.extractall(destination)
`;
await run(python, ['-c', extract, archive, sourceRoot]);
// A source snapshot may sit below another Git worktree. Make its working tree
// explicit so Git cannot silently skip diff paths outside the parent's prefix.
const applyArgs = ['--work-tree=.', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'apply'];
for (const patch of patches) {
  const patchFile = path.join(repoRoot, 'docs/engine-patches', patch.file);
  for (const source of patch.sources) {
    await assertHash(path.join(sourceRoot, source.path), source.originalSha256);
  }
  await run('git', [...applyArgs, '--check', patchFile], {cwd: sourceRoot});
  await run('git', [...applyArgs, patchFile], {cwd: sourceRoot});
  for (const source of patch.sources) {
    await assertHash(path.join(sourceRoot, source.path), source.patchedSha256);
  }
}

// The preserved source snapshot intentionally omits these standalone tools.
// Prune only their workspace membership; package/dependency declarations stay intact.
const originalManifest = await fs.readFile(path.join(sourceRoot, 'Cargo.toml'), 'utf8');
const originalMembers = 'members = [".", "crates/*", "tools/rhwp-subsecond", "bindings/Native", "tools/batch-convert", "tools/llm_verifier/verdict_protocol", "tools/llm_verifier/claim_bind", "tools/llm_verifier/criteria_decomp"]';
if (originalManifest.split(originalMembers).length !== 2) throw Error('Unexpected upstream workspace declaration');
await fs.writeFile(path.join(sourceRoot, 'Cargo.toml'), originalManifest.replace(originalMembers, 'members = [".", "crates/*"]'));
await fs.mkdir(path.join(sourceRoot, 'saved'), {recursive: true});
await fs.copyFile(blank, path.join(sourceRoot, 'saved/blank2010.hwp'));
await fs.mkdir(outputRoot);
if (args['prepare-only']) {
  process.stdout.write('Pinned source, patch, workspace preparation and blank template verified. Compilation not requested.\n');
  process.exit(0);
}

const versions = {
  rustc: await run(rustc, ['--version'], {capture: true}),
  cargo: await run(cargo, ['--version'], {capture: true}),
  wasmBindgen: await run(bindgen, ['--version'], {capture: true}),
};
if (!/^rustc 1\.93\.1\b/.test(versions.rustc) || !/^cargo 1\.93\.1\b/.test(versions.cargo)
    || !/^wasm-bindgen 0\.2\.127\b/.test(versions.wasmBindgen)) throw Error('Required tool versions do not match: ' + JSON.stringify(versions));
const buildArgs = ['build', '--lib', '--target', 'wasm32-unknown-unknown', '--release'];
if (args.offline) buildArgs.push('--offline');
await run(cargo, buildArgs, {cwd: sourceRoot, env: {CARGO_TARGET_DIR: targetDir}});

const auditLock = String.raw`
from pathlib import Path
from zipfile import ZipFile
import tomllib, sys, json, hashlib
archive, source = Path(sys.argv[1]), Path(sys.argv[2])
with ZipFile(archive) as z:
    original = tomllib.loads(z.read('Cargo.lock').decode())
current_bytes = (source / 'Cargo.lock').read_bytes()
current = tomllib.loads(current_bytes.decode())
key = lambda p: (p['name'], p['version'], p.get('source'))
before = {key(p):p for p in original['package']}
after = {key(p):p for p in current['package']}
added = [k for k in after if k not in before]
changed = [k for k in after if k in before and after[k] != before[k]]
if added or changed:
    raise SystemExit('Cargo.lock dependency drift; candidate rejected: ' + json.dumps({'added':added,'changed':changed}))
print(json.dumps({'originalPackageCount':len(before),'retainedPackageCount':len(after),
 'removedPackageCount':len(before)-len(after),'addedPackages':0,'changedRetainedPackages':0,
 'cargoLockSha256':hashlib.sha256(current_bytes).hexdigest()}))
`;
const lockAudit = JSON.parse(await run(python, ['-c', auditLock, archive, sourceRoot], {capture: true}));
await run(bindgen, ['--target', 'web', '--out-name', 'rhwp', '--out-dir', outputRoot,
  path.join(targetDir, 'wasm32-unknown-unknown/release/rhwp.wasm')]);
await assertHash(path.join(outputRoot, 'rhwp.js'), pinned.unchangedGlueSha256);
const files = {};
for (const name of ['rhwp.js','rhwp.d.ts','rhwp_bg.wasm','rhwp_bg.wasm.d.ts']) {
  const bytes = await fs.readFile(path.join(outputRoot, name));
  files[name] = {size: bytes.length, sha256: hash(bytes)};
}
await fs.copyFile(path.join(sourceRoot, 'LICENSE'), path.join(outputRoot, 'LICENSE'));
await fs.writeFile(path.join(outputRoot, 'BUILD-RECORD.json'), JSON.stringify({
  schemaVersion: 1, id: 'rhwp-0.8.7-table-layout-fixes-candidate',
  ...pinned, patches, versions, target: 'wasm32-unknown-unknown', features: 'upstream defaults',
  buildArgs, lockAudit, files,
  installation: 'Not installed. Candidate requires regression checks and a new immutable engine release.',
}, null, 2) + '\n');
process.stdout.write('Separate candidate built and dependency drift checks passed. Run synthetic geometry/export/undo checks before packaging.\n');
