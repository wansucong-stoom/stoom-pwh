import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

/** Load real engine source; no engine source file is changed by this harness. */
export async function loadEngineSource() {
  const input = process.argv[2] || process.env.PWH_ENGINE_SOURCE;
  if (!input) throw Error('Pass the engine source root as the first argument or set PWH_ENGINE_SOURCE.');
  const root = path.resolve(input);
  const sourcePath = path.join(root, 'src/renderer/layout/table_layout.rs');
  const source = await fs.readFile(sourcePath, 'utf8');
  return {root, sourcePath, source, sourceSha256: createHash('sha256').update(source).digest('hex')};
}

/** Extract the original Rust block without maintaining a second implementation. */
export function sourceBlock(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) !== -1) {
    throw Error('Expected one original source block: ' + marker);
  }
  const opening = source.indexOf('{', start);
  if (opening < 0) throw Error('Source block has no opening brace: ' + marker);
  let depth = 1, index = opening + 1, commentDepth = 0, state = 'code', rawEnding = '';
  while (index < source.length && depth) {
    const current = source[index], next = source[index + 1];
    if (state === 'line-comment') {
      if (current === '\n') state = 'code';
    } else if (state === 'block-comment') {
      if (current === '/' && next === '*') { commentDepth++; index++; }
      else if (current === '*' && next === '/') { if (--commentDepth === 0) state = 'code'; index++; }
    } else if (state === 'string' || state === 'character') {
      if (current === '\\') index++;
      else if (current === (state === 'string' ? '"' : "'")) state = 'code';
    } else if (state === 'raw-string') {
      if (source.startsWith(rawEnding, index)) { index += rawEnding.length - 1; state = 'code'; }
    } else if (current === '/' && next === '/') { state = 'line-comment'; index++; }
    else if (current === '/' && next === '*') { state = 'block-comment'; commentDepth = 1; index++; }
    else if (current === 'r' && /^r#*"/.test(source.slice(index))) {
      const prefix = source.slice(index).match(/^r(#*)"/)[0];
      rawEnding = '"' + '#'.repeat(prefix.length - 2);
      index += prefix.length - 1; state = 'raw-string';
    } else if (current === '"') state = 'string';
    else if (current === "'" && (source[index + 2] === "'" || next === '\\')) state = 'character';
    else if (current === '{') depth++;
    else if (current === '}') depth--;
    index++;
  }
  if (depth) throw Error('Unclosed original source block: ' + marker);
  return source.slice(start, index);
}

/** Compile extracted code with std-only fixture adapters and execute its tests. */
export async function runRustTests({name, sourceSha256, code}) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const prefix = 'pwh-engine-source-ownership-';
  const output = await fs.mkdtemp(path.join(temporaryRoot, prefix));
  if (path.dirname(path.resolve(output)) !== temporaryRoot || !path.basename(output).startsWith(prefix)) {
    throw Error('Generated test directory is outside the intended temporary parent.');
  }
  const generated = path.join(output, name + '.rs');
  const executable = path.join(output, name + (process.platform === 'win32' ? '.exe' : ''));
  await fs.writeFile(generated,
    '// Extracted engine source SHA256: ' + sourceSha256 + '\n#![allow(dead_code)]\n' + code);
  const rustc = process.env.PWH_RUSTC || 'rustc';
  try {
    execFileSync(rustc, ['--edition=2021', '--test', generated, '-o', executable], {stdio: 'inherit', windowsHide: true});
    execFileSync(executable, ['--nocapture'], {stdio: 'inherit', windowsHide: true});
    console.log('Verified original source SHA256:', sourceSha256);
    if (process.env.PWH_ENGINE_TEST_KEEP === '1') console.log('Generated harness retained at:', output);
    else await fs.rm(output, {recursive: true, force: true});
  } catch (error) {
    console.error('Generated harness retained for diagnostics at:', output);
    throw error;
  }
}
