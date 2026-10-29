import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {zipEntries} from '../scripts/setup.mjs';

const js = process.env.PWH_CORE_JS;
const wasm = process.env.PWH_CORE_WASM;
const skip = !js || !wasm ? 'Requires the candidate Pwh core.' : false;
const fixture = new URL('./fixtures/grown-table-pagination/stored-grown.hwpx', import.meta.url);

function documentData(bytes) {
  const xml = zipEntries(bytes).find(e => e.name === 'Contents/section0.xml').read().toString('utf8');
  return {
    cells: [...xml.matchAll(/<hp:tc(?:\s|>)/g)].length,
    text: [...xml.matchAll(/<hp:t\b[^>]*>([^<]*)<\/hp:t>/g)].map(m => m[1]).join(''),
  };
}

function assertOnPages(doc) {
  assert.equal(doc.pageCount(), 2, 'A grown inline table must reserve space before subsequent text');
  for (let page = 0; page < doc.pageCount(); page++) {
    const runs = JSON.parse(doc.getPageTextLayout(page)).runs;
    assert.ok(runs.length > 0);
    for (const run of runs) assert.ok(run.y + run.h <= 640.1,
      `Text crosses the ${640}px page boundary on page ${page + 1}`);
  }
}

test('stored grown table reserves its actual height and survives export/reopen', {skip}, async () => {
  const core = await import(pathToFileURL(js));
  await core.default({module_or_path: await fs.readFile(wasm)});
  const input = await fs.readFile(fixture);
  const before = documentData(input);
  assert.equal(before.cells, 15);
  const doc = new core.HwpDocument(input);
  try {
    assertOnPages(doc);
    const saved = Buffer.from(doc.exportHwpx());
    assert.deepEqual(documentData(saved), before, 'Table cells and text must be retained');
    const reopened = new core.HwpDocument(saved);
    try { assertOnPages(reopened); } finally { reopened.free(); }
  } finally { doc.free(); }
});
