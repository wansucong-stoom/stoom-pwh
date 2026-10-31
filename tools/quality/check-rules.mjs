import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';
import {clientViewerHtml} from '../../src/client-assets.mjs';

const lint = new ESLint({cwd: fileURLToPath(new URL('../../', import.meta.url))});
const cases = [
  {file: 'src/table-clipboard.mjs', valid: 'document.body.focus();', invalid: 'process.exitCode = 1;', name: 'process'},
  {file: 'src/server.mjs', valid: 'process.stdout.write("ok");', invalid: 'document.body.focus();', name: 'document'},
  {file: 'desktop/standalone-pwh/electron-shell.cjs', valid: 'require("node:fs");', invalid: 'missingPwhFunction();', name: 'missingPwhFunction'},
];
for (const test of cases) {
  const [valid] = await lint.lintText(test.valid, {filePath: test.file});
  assert.equal(valid.errorCount, 0, `Valid runtime rejected: ${test.file}`);
  const [invalid] = await lint.lintText(test.invalid, {filePath: test.file});
  assert.ok(invalid.messages.some(message => message.ruleId === 'no-undef' && message.message.includes(test.name)), `Incorrect runtime accepted: ${test.file}`);
}
const html = await clientViewerHtml();
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1);
const original = scripts[0][1];
const broken = original.replace('const readFontFace=createVerifiedFontReader();', 'const readFontFace=missingVerifiedFontReader();');
assert.notEqual(broken, original, 'Missing font-reader call in the linked host');
const [result] = await lint.lintText(broken, {filePath: 'src/inline-host.linked.js'});
assert.ok(result.messages.some(message => message.ruleId === 'no-undef' && message.message.includes('missingVerifiedFontReader')));
console.log(JSON.stringify({ok: true, negativeCases: 4, actualLinkedHostChecked: true}));
