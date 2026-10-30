import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const buildScripts = ['build-inline.mjs', 'bundle-client.mjs', 'patch-body-cursor-contract.mjs', 'editor-build-contract.mjs'];
const desktopInputs = ['build-desktop-editor.mjs', 'table-plan.mjs', 'desktop-body-style.mjs'];

// Rolldown's source-region labels are comments, but contain staging paths.
// Keep useful module names while removing the build directory and its UUID.
export function normalizeEditorBundle(text) {
  const normalized = text.replace(/^\/\/#region ([^\r\n]+)$/gm, (_, original) => {
    const name = original.replaceAll('\\', '/');
    for (const [part, prefix] of [['rhwp-studio/', '@rhwp/studio/'], ['pkg/', '@rhwp/core/'], ['node_modules/', 'node_modules/']]) {
      const index = name.indexOf(part);
      if (index !== -1) return '//#region ' + prefix + name.slice(index + part.length);
    }
    return '//#region ' + original;
  });
  assertPortableEditorBundle(normalized);
  return normalized;
}

export function assertPortableEditorBundle(text) {
  for (const label of text.match(/^\/\/#region [^\r\n]+/gm) || []) {
    if (/pwh-test-temp|desktop-editor-build-|rise-build-workspace|[a-z]:[\\/]|\/(?:Users|home|tmp)\//i.test(label)) {
      throw new Error('Build-specific editor module label: ' + label);
    }
  }
}

export async function editorBuildInputs(project, variant = 'common') {
  if (!['common', 'desktop'].includes(variant)) throw new Error('Unknown editor build variant');
  const names = ['package.json', ...buildScripts.map(name => 'scripts/' + name)];
  async function collect(relative) {
    for (const entry of await fs.readdir(path.join(project, relative), {withFileTypes: true})) {
      const name = relative + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Editor build input is a symlink');
      if (entry.isDirectory()) await collect(name);
      else if (/\.(?:mjs|js|ts|css)$/.test(name)) names.push(name);
    }
  }
  // A conservative input set also catches newly added frontend modules.
  await collect('src');
  if (variant === 'desktop') names.push(...desktopInputs.map(name => 'desktop/standalone-pwh/' + name));
  const files = [];
  for (const name of names.sort()) files.push({path: name, sha256: hash(await fs.readFile(path.join(project, name)))});
  return {schemaVersion: 1, variant, sha256: hash(JSON.stringify(files)), files};
}

export async function assertEditorBuildInputs(project, record, variant = 'common') {
  const current = await editorBuildInputs(project, variant);
  if (!record || JSON.stringify(record) !== JSON.stringify(current)) {
    throw new Error(variant + ' editor sources changed; rebuild both clients before packaging');
  }
  return current;
}
