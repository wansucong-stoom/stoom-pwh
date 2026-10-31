import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const project = fileURLToPath(new URL('../../', import.meta.url));
const mode = process.argv[2];
const args = process.argv.slice(3);
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Development quality checks require Node.js 24 or newer');

if (mode === 'lint' && !args.length) {
  const {ESLint} = await import('eslint');
  const lint = new ESLint({cwd: project});
  const results = await lint.lintFiles([
    'src/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', 'desktop/**/*.{js,mjs,cjs}',
    'tests/**/*.mjs', 'tools/quality/**/*.mjs', 'eslint.config.mjs',
  ]);
  // Lint the actual linked classic script, including recovery/font/state
  // declarations. An allowlist of injected globals would hide renamed exports.
  const {clientViewerHtml} = await import('../../src/client-assets.mjs');
  const html = await clientViewerHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  if (scripts.length !== 1) throw new Error('Review the inline classic-script assembly before linting');
  results.push(...await lint.lintText(scripts[0][1], {filePath: 'src/inline-host.linked.js'}));
  const formatter = await lint.loadFormatter('stylish');
  const output = await formatter.format(results);
  if (output) process.stdout.write(output);
  const errors = results.reduce((count, result) => count + result.errorCount, 0);
  const warnings = results.reduce((count, result) => count + result.warningCount, 0);
  console.log(JSON.stringify({mode, files: results.length, errors, warnings}));
  if (errors || warnings) process.exitCode = 1;
} else if (mode === 'types' && args.length === 2 && args[0] === '--studio') {
  const studio = path.resolve(args[1]);
  await fs.access(path.join(studio, 'src/main.ts'));
  await fs.access(path.join(studio, '../pkg/rhwp.d.ts'));
  const base = JSON.parse(await fs.readFile(new URL('./tsconfig.studio.json', import.meta.url), 'utf8'));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-typecheck-'));
  const config = path.join(work, 'tsconfig.json');
  const slash = name => name.replaceAll('\\', '/');
  base.compilerOptions.paths = {
    '@/*': [slash(path.join(studio, 'src/*'))],
    '@wasm/*': [slash(path.join(studio, '../pkg/*'))],
  };
  base.compilerOptions.typeRoots = [fileURLToPath(new URL('./node_modules/@types/', import.meta.url))];
  base.include = [slash(path.join(studio, 'src/**/*.ts')), fileURLToPath(new URL('./studio-env.d.ts', import.meta.url))];
  base.exclude = ['**/node_modules/**', '**/*.test.ts'];
  await fs.writeFile(config, JSON.stringify(base, null, 2) + '\n', {flag: 'wx'});
  let output = '', code;
  try {
    code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./node_modules/typescript/bin/tsc', import.meta.url)), '--project', config, '--pretty', 'false', '--listFiles'], {
        cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'],
      });
      child.stdout.on('data', bytes => { output += bytes; });
      child.on('error', reject);
      child.on('exit', resolve);
    });
  } finally {
    // This contains only compiler options and paths; no output is emitted.
    await fs.unlink(config);
    await fs.rmdir(work);
  }
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (code !== 0) {
    for (const line of lines) if (!/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(line)) console.error(line);
    process.exitCode = code || 1;
  } else {
    const key = name => process.platform === 'win32' ? slash(name).toLowerCase() : slash(name);
    const checked = new Set(lines.map(key));
    const owned = ['pwh-blank-compose.ts', 'pwh-cell-delete-dialog.ts', 'pwh-collaboration-target.ts', 'pwh-inline-adapter.ts',
      'pwh-page-layout.ts', 'pwh-picture-replace.ts', 'collaboration-selection.ts', 'pwh-table-paste-dialog.ts',
      'ui/pwh-cell-border-dialog.ts', 'ui/pwh-color-palette.ts'];
    for (const name of ['main.ts', ...owned]) {
      if (!checked.has(key(path.join(studio, 'src', name)))) throw new Error('Studio source missing from type-check program: ' + name);
    }
    const prefix = key(path.join(studio, 'src')) + '/';
    const studioSources = lines.filter(name => key(name).startsWith(prefix) && name.endsWith('.ts')).length;
    console.log(JSON.stringify({mode, strict: true, noEmit: true, studioSources, pwhAdapters: owned.length, exitCode: code}));
  }
} else {
  throw new Error('Use lint or types --studio PATH after npm ci --prefix tools/quality');
}
