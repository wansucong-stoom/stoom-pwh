import fs from 'node:fs/promises';
import path from 'node:path';

export async function discoverCiTests(project, mode) {
  if (!['core', 'browser'].includes(mode)) throw Error('Unknown CI test mode');
  const files = [];
  async function visit(relative) {
    for (const entry of await fs.readdir(path.join(project, relative), {withFileTypes: true})) {
      const name = relative + '/' + entry.name;
      if (entry.isSymbolicLink()) throw Error('CI test input is a symlink: ' + name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        const browser = entry.name.endsWith('-browser.test.mjs');
        if ((mode === 'browser') === browser) files.push(name);
      }
    }
  }
  await visit('tests');
  if (!files.length) throw Error('No ' + mode + ' tests were discovered');
  return files.sort();
}
