import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const PATH_KEYS = ['rhwpPath', 'studioDistPath', 'editorSdkPath', 'outputRoot', 'fontRoot', 'hopPath', 'documentFontsManifest'];

async function readObject(filename, optional = true) {
  try {
    const value = JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required');
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error('Unsupported config schemaVersion');
    return value;
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw new Error(`Cannot read pwh configuration ${filename}: ${error.message}`);
  }
}

function expandPath(value, { home, runtimeRoot, root, base }) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Configuration paths must be nonempty strings');
  let expanded = value.replaceAll('${PLUGIN_ROOT}', root).replaceAll('${RUNTIME_ROOT}', runtimeRoot);
  if (expanded === '~') expanded = home;
  else if (/^~[\\/]/.test(expanded)) expanded = path.join(home, expanded.slice(2));
  return path.resolve(base, expanded);
}

function systemFontPaths(platform, env, home) {
  if (platform === 'win32') return [path.join(env.WINDIR || env.SystemRoot || 'C:/Windows', 'Fonts')];
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library', 'Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.local', 'share', 'fonts')];
}

/**
 * Public defaults live with the plugin; assets and generated files live outside it.
 * PWH_CONFIG selects an explicit private configuration and skips automatic local
 * overrides. Otherwise runtime/config.json then engine.config.local.json apply.
 * PWH_* environment paths take precedence; legacy HWPXYZ_* paths remain accepted.
 */
export async function loadConfig({ env = process.env, home = os.homedir(), platform = process.platform, root = pluginRoot } = {}) {
  const values = {}, origins = {}, files = [];
  const merge = (data, filename) => {
    if (!data) return;
    for (const [key, value] of Object.entries(data)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid configuration key');
      values[key] = value;
      origins[key] = path.dirname(filename);
    }
    files.push(filename);
  };
  const publicFile = path.join(root, 'engine.config.json');
  merge(await readObject(publicFile), publicFile);
  const defaultRuntime = path.join(home, '.stoom-pwh');
  const runtimeFrom = () => expandPath(env.PWH_RUNTIME_ROOT || values.runtimeRoot || defaultRuntime,
    { home, runtimeRoot: defaultRuntime, root, base: origins.runtimeRoot || root });
  if (env.PWH_CONFIG) {
    const selected = path.resolve(env.PWH_CONFIG);
    merge(await readObject(selected, false), selected);
  } else {
    const runtimeConfig = path.join(runtimeFrom(), 'config.json');
    merge(await readObject(runtimeConfig), runtimeConfig);
    const localFile = path.join(root, 'engine.config.local.json');
    merge(await readObject(localFile), localFile);
  }
  const runtimeRoot = runtimeFrom();
  const context = (key) => ({ home, runtimeRoot, root, base: origins[key] || root });
  const defaults = {
    rhwpPath: path.join(runtimeRoot, 'rhwp', platform === 'win32' ? 'rhwp.exe' : 'rhwp'),
    studioDistPath: path.join(runtimeRoot, 'studio'),
    editorSdkPath: path.join(runtimeRoot, 'editor-sdk'),
    outputRoot: path.join(runtimeRoot, 'documents'),
    fontRoot: path.join(runtimeRoot, 'fonts'),
  };
  const overrides = {
    rhwpPath: env.PWH_RHWP_PATH || env.HWPXYZ_RHWP_PATH,
    studioDistPath: env.PWH_STUDIO_PATH,
    editorSdkPath: env.PWH_EDITOR_SDK_PATH,
    outputRoot: env.PWH_OUTPUT_ROOT || env.HWPXYZ_OUTPUT_ROOT,
    fontRoot: env.PWH_FONT_ROOT,
    hopPath: env.PWH_HOP_PATH,
  };
  const config = { schemaVersion: 1, pluginRoot: root, runtimeRoot, configFiles: files };
  for (const key of PATH_KEYS) {
    const selected = overrides[key] || values[key] || defaults[key];
    config[key] = selected ? expandPath(selected, context(key)) : null;
  }
  config.documentFontsManifest ||= path.join(config.fontRoot, 'document-fonts.json');
  const selectedPython = env.PWH_PYTHON_PATH || env.HWPXYZ_PYTHON_PATH || values.pythonPath || (platform === 'win32' ? 'python' : 'python3');
  // A command name uses PATH; an explicit path is relative to its config file.
  config.pythonPath = /[\\/]/.test(selectedPython) || selectedPython.startsWith('~')
    ? expandPath(selectedPython, context('pythonPath')) : selectedPython;
  const envFonts = env.PWH_FONT_PATHS?.split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const chosenFonts = envFonts || values.fontPaths || [config.fontRoot, ...systemFontPaths(platform, env, home)];
  if (!Array.isArray(chosenFonts)) throw new Error('fontPaths must be an array');
  config.fontPaths = [...new Set(chosenFonts.map(value => expandPath(value, context('fontPaths'))))];

  let runtimeFonts = [];
  try {
    const manifest = JSON.parse((await fs.readFile(config.documentFontsManifest, 'utf8')).replace(/^\uFEFF/, ''));
    runtimeFonts = Array.isArray(manifest) ? manifest : manifest.documentFonts;
    if (!Array.isArray(runtimeFonts)) throw new Error('Expected a font record array');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read pwh font catalog: ${error.message}`);
  }
  if (values.documentFonts !== undefined && !Array.isArray(values.documentFonts)) throw new Error('documentFonts must be an array');
  const fonts = new Map();
  for (const [records, base] of [[runtimeFonts, path.dirname(config.documentFontsManifest)],
    [values.documentFonts || [], origins.documentFonts || root]]) {
    for (const record of records) {
      if (!record || typeof record !== 'object' || typeof record.id !== 'string' || typeof record.path !== 'string') {
        throw new Error('Document font records require id and path strings');
      }
      fonts.set(record.id, { ...record, path: expandPath(record.path, { home, runtimeRoot, root, base }) });
    }
  }
  config.documentFonts = [...fonts.values()];
  return config;
}

export const config = await loadConfig();
export default config;
