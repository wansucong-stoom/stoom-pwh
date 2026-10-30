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
  expectedGlueSha256: 'e4b17c467ec6e5955393f7b9b162150ea0f16271085dcec7955bcd87c0014d47',
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
  {
    file: 'rhwp-0.8.7-stored-grown-table-pagination.patch',
    sha256: '596bf711aaf4494438c76e0b77aa29741c93f2cdb9b75c5b49e3e4c3364eade3',
    sources: [
      {path: 'src/renderer/height_measurer.rs', originalSha256: 'c71e4166c3d701bf702d6ebd2efbb9a7e53fa6046f45beb9ec2469c1c18e1ddd', patchedSha256: '15b9761d3a5273238c533af3f6a1ddc95bffa365a03eb0e456c989914c41e3a6'},
      {path: 'src/renderer/typeset.rs', originalSha256: '62b9c40af3cc06a63d0ab63b25d02f7740942d016dba198619883d091687cf14', patchedSha256: '1a46e4655e19c95083dd7e5501224e5ca73d9d3dd54d0ecc1341b4fa51bfdac7'},
      {path: 'src/renderer/typeset/controls/tac_fit.rs', originalSha256: '31a9dfe9482ca8798b25b2c42ad2bf2ef02ce73b309959234a851276855be6d3', patchedSha256: '0168df5eacacf3b7c31fb6b13e1d18a6c7011e5415cce86dfefeecdc3f8d3b6f'},
    ],
  },
  {
    file: 'rhwp-0.8.7-unsegmented-float-flow.patch',
    sha256: '174b98deb82291af3238e56b08b807c177e0478898091c652664ead2737c3f11',
    sources: [
      {path: 'src/renderer/float_placement.rs', originalSha256: '82759ab163aa6fe8f57aee13fefd68bcddbde11c57e468cbc34a2e2320b4044a', patchedSha256: '505a0bd578cc15d33a8bc84a2057250d5cbdf6227c0683e609aece799e6db013'},
      {path: 'src/renderer/layout.rs', originalSha256: '81fef37b2cd464f007d721edcdaf938d6ba47439dc9418c8745bc7da927d7a61', patchedSha256: '9a331572f891129fb1674d29a1db72e209285f1c6e6904498fda6e81f19c223d'},
      {path: 'src/renderer/typeset/table/host_spacing.rs', originalSha256: 'cd6908b0f9c258db1898418124c17d23e8e9ad3124176e4b1afa5663047ad4ef', patchedSha256: 'e355cff05386365f4637dee606251d4edbdd4ca6921410b24d70a44fe2ab195c'},
    ],
  },
  {
    file: 'rhwp-0.8.7-interior-float-anchor.patch',
    sha256: '1d3499dc7a5154c5b04467b4197a3a793e47d56f702dc6853a7bbae090bc8a4b',
    sources: [
      {path: 'src/renderer/float_placement.rs', originalSha256: '505a0bd578cc15d33a8bc84a2057250d5cbdf6227c0683e609aece799e6db013', patchedSha256: 'fcfab96c017a160429fa9873371ea59dd6564480daaaa08ec90d87aea7e6bad3'},
      {path: 'src/renderer/typeset/table/block/entry.rs', originalSha256: '90389834b32c48190b4ebab7b1261385dc56953823f5616ced89aecbdd3e4cbc', patchedSha256: '2a2be46cfc35b58ff08664a47598ee0b51997afe51cb51232654ff0c92432a3a'},
    ],
  },
  {
    "file": "rhwp-0.8.7-note-cursor-source-offsets.patch",
    "sha256": "909e7741914ed83f695b904cccb5400c5501c19271f6eb77641d7a761f988d50",
    "sources": [
      {
        "path": "src/document_core/queries/cursor_rect.rs",
        "originalSha256": "b8f9b7913e68f1e72919c6487d6c0cedfe1175338ba644e1a49428fd521cb069",
        "patchedSha256": "c7dd6bedf24033a2e221bc7f64f7ac69592307c48821128021353696cdb80906"
      },
      {
        "path": "src/document_core/commands/footnote_ops.rs",
        "originalSha256": "cb3ddbd3977d106072695e2223ab0206a9816cc156cc742c2983d4c9b9a0009a",
        "patchedSha256": "32f00884b41a1e7dc8455a0c7bb299cab688abceb869419b8314bce5576f21af"
      },
      {
        "path": "src/renderer/layout/paragraph_layout.rs",
        "originalSha256": "cb2deb845baa718284658576a44ae2db3cfb20f3eea4f83ee5714bce9295d91f",
        "patchedSha256": "d792ae300068a718003ab67ab12dde113ed34a7fb1e0f9546d570ba710565186"
      },
      {
        "path": "src/renderer/render_tree.rs",
        "originalSha256": "7b0a9e3920ebaa24f9a645b3a1a3f5aecf2a82bcc85bf6c2aaf3e2f0971b5d60",
        "patchedSha256": "c5c70b4de04ac0a4a1d9993963293bb14b818a0dda79a71e97871cd2c3b9445c"
      },
      {
        "path": "src/paint/json.rs",
        "originalSha256": "c40bf373d6b1fd102b100b20f3721413672150a7506162ba011bbe09753ca089",
        "patchedSha256": "b48086acd0590d6bc3d81cc9e182bcb5440eadf3102cdbacc003d039a9ce7ff8"
      }
    ]
  },
{
  "file": "rhwp-0.8.7-closed-float-successor-frame.patch",
  "sha256": "dd454d191de066be2fbbb659f9e63681b011ec2067f9280355743a05f50294cf",
  "sources": [
    {
      "path": "src/renderer/typeset/controls/empty_float.rs",
      "originalSha256": "ee4305f04e2869e2bb2ac16b7d85b91264c80ae929ae54516f2a721debfbb645",
      "patchedSha256": "60f45e29d40a79386f6811c5cfcd85084a210227a4f56b8360e350c508a202e3"
    }
  ]
},

{
  "file": "rhwp-0.8.7-implicit-bullet-marker.patch",
  "sha256": "466a63e2d72191e209c8992d6263a612bc0bccc45a6228b381510ab4ae6924d8",
  "sources": [
    {
      "path": "src/renderer/layout/paragraph_layout.rs",
      "originalSha256": "d792ae300068a718003ab67ab12dde113ed34a7fb1e0f9546d570ba710565186",
      "patchedSha256": "2aa9dca69eb9805a4484a088f611b6efc9037295b24224e317cea6d977bb250b"
    }
  ]
},

{
  "file": "rhwp-0.8.7-shape-fill-transparency.patch",
  "sha256": "0844a2a531175115f41cd9590f1c3337cf6ea10971c90cdfa88ba4d9275edfbb",
  "sources": [
    {
      "path": "src/model/style.rs",
      "originalSha256": "470787a168f4c2c7c69ece3d155bc4b3fe25a26b02c43dbc16b0f839c6a2844e",
      "patchedSha256": "1bddd1429e47a67557d32cacc3cfa71def112e56935e159435661cd18b6c3e0d"
    },
    {
      "path": "src/parser/hwpx/header.rs",
      "originalSha256": "4f6cd8163f9c4664ba0360e52a1b2027a59bcebd0d5f4291a16586c5d55e838b",
      "patchedSha256": "2bff680af2a0cad5d4cd279007046e7854d683a19e0d6765ab5abaae87f0b369"
    },
    {
      "path": "src/parser/hwpx/section.rs",
      "originalSha256": "7d5d38bb8060bbbd454029f7bbab3cf90af589262ab432b7e95a03034be056b7",
      "patchedSha256": "fbb0c39bb12d2cde98ac2c4ce1e26c824a5a4d6fd6769f5e9b0cd811cf9a1839"
    },
    {
      "path": "src/serializer/hwpx/shape.rs",
      "originalSha256": "dacb18a59d24230ecb7ac23a51e7b6876d9482b8d1fbc68a3589818669950ff2",
      "patchedSha256": "09118dcceb27c20076a816a4cd88520bbc8a92b428e9047f231c26f0e1e5c2e4"
    },
    {
      "path": "src/renderer/mod.rs",
      "originalSha256": "c9191193db4a0b14a936887fac5ffd99f47d77311f60dc58b961574048c3271a",
      "patchedSha256": "cd792f72450f912486acc319ad0c78fa0a36a465562246a653a1fb26f4f8d063"
    },
    {
      "path": "src/renderer/layout/utils.rs",
      "originalSha256": "e760b4117b7846d8b697891434c1cc9b2e04fde2d4f3e7ba6db84cd56e0e9564",
      "patchedSha256": "029011793cf3b968db2f4bc15ba789ffe21c7621259553a6d80a6e2594ffa66e"
    },
    {
      "path": "src/renderer/layout/shape_layout.rs",
      "originalSha256": "90d78f9bfd3b2f4765b71d9cd1bb8b35c5c4a5a8c5faf6e02361d4ec4998476c",
      "patchedSha256": "e2867b5ad92b002b83c30f2fc0ae7b34bcaaf86aa44935900be54b43ab986f4c"
    },
    {
      "path": "src/renderer/layout/picture_footnote.rs",
      "originalSha256": "1fc5b0eeed40194b052f6d2b617f56153a38834674931139e66173dcde3d8307",
      "patchedSha256": "17a454e04115e73dc8fb8fa3deca9acfd5f25db36d3ac4cb43dc0b4d13b95b55"
    },
    {
      "path": "src/renderer/svg.rs",
      "originalSha256": "a5f10616101d31582185eaba2283aa5d44a8529d23a681096d512a1341244829",
      "patchedSha256": "bb938cb2547addd9550ed716ea2c2b682c0cda4e3817222f4390bc202cb9cabd"
    },
    {
      "path": "src/renderer/web_canvas.rs",
      "originalSha256": "f5b7188590116134e35fd6a6a3c6e615485ed6bc6615d243d7b26becce28d015",
      "patchedSha256": "17427634c6f27fc02cf4f0c3472a49f431ac421f3e5b5ea3fa3420e3a512043e"
    },
    {
      "path": "src/renderer/skia/renderer.rs",
      "originalSha256": "7966150a7905d81089bbff77a9129bce2afe490ebb7fda1628f27a91da547d66",
      "patchedSha256": "229251985833374a9c400031765b528e3a593b5ea4430343fb1cd1c2123373a0"
    },
    {
      "path": "src/renderer/pdf.rs",
      "originalSha256": "6ec2b549e020e9d3e582076beba9e571a94672635c2fc0cc1c428efa751c5ebb",
      "patchedSha256": "d676ab27503e4630644aea7365ff20532a8a1d82522da484c00a8e9c3db62504"
    },
    {
      "path": "src/paint/json.rs",
      "originalSha256": "b48086acd0590d6bc3d81cc9e182bcb5440eadf3102cdbacc003d039a9ce7ff8",
      "patchedSha256": "f98509439b6bbfc0fe8ff2dff1e0b6cd3288e774f68a864d074fd54f3385bc2b"
    },
    {
      "path": "src/paint/replay_order.rs",
      "originalSha256": "039c08946c0988302e3d8765db96f0e984207ba767eb540d28594524a9c83b01",
      "patchedSha256": "571b72bc5dd43651dfbb5207c057dcb61cc1ddf04670191949363a8d02bcf473"
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
await assertHash(path.join(outputRoot, 'rhwp.js'), pinned.expectedGlueSha256);
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
