import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {zipEntries} from '../scripts/setup.mjs';

// Optional real-core regression: ordinary unit tests do not require a runtime.
// Both paths are explicit, so this cannot silently test an installed old build.
const coreJs = process.env.PWH_CORE_JS;
const coreWasm = process.env.PWH_CORE_WASM;
const runtimeSkip = !coreJs || !coreWasm
  ? 'Set PWH_CORE_JS and PWH_CORE_WASM to a real rhwp WASM build.'
  : false;

function* walk(node) {
  yield node;
  for (const child of node.children || []) yield* walk(child);
}

function attrs(xml = '') {
  return Object.fromEntries([...xml.matchAll(/([\w:]+)=(?:"([^"]*)"|'([^']*)')/g)]
    .map(([,key,double,single]) => [key, double ?? single]));
}

function archiveText(bytes, name) {
  const entry = zipEntries(bytes).find(entry => entry.name === name);
  assert.ok(entry, `Missing HWPX member ${name}`);
  return entry.read().toString('utf8');
}

function decodedText(xml) {
  return [...xml.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)]
    .map(([,text]) => text.replace(/<[^>]+>/g, '')
      .replace(/&#x([\da-f]+);/gi, (_,value) => String.fromCodePoint(parseInt(value, 16)))
      .replace(/&#(\d+);/g, (_,value) => String.fromCodePoint(Number(value)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
    .join('');
}

// These fixtures have one non-nested table. Compare semantic fields instead of
// requiring byte-identical XML after the engine has serialized the document.
function tableSnapshot(bytes) {
  const xml = archiveText(bytes, 'Contents/section0.xml');
  const table = /<hp:tbl\b([^>]*)>([\s\S]*?)<\/hp:tbl>/.exec(xml);
  assert.ok(table, 'Missing synthetic table');
  const a = attrs(table[1]);
  const pick = (tag, names, source = table[2]) => {
    const values = attrs(new RegExp(`<hp:${tag}\\b([^>]*)>`).exec(source)?.[1]);
    return Object.fromEntries(names.map(name => [name, values[name]]));
  };
  return {
    rows: a.rowCnt, cols: a.colCnt, pageBreak: a.pageBreak, repeatHeader: a.repeatHeader,
    size: pick('sz', ['width', 'height', 'widthRelTo', 'heightRelTo']),
    position: pick('pos', ['treatAsChar', 'flowWithText', 'vertRelTo', 'horzRelTo']),
    cells: [...table[2].matchAll(/<hp:tc\b[^>]*>([\s\S]*?)<\/hp:tc>/g)]
      .map(([,cell]) => ({
        address: pick('cellAddr', ['colAddr', 'rowAddr'], cell),
        span: pick('cellSpan', ['colSpan', 'rowSpan'], cell),
        size: pick('cellSz', ['width', 'height'], cell),
        margin: pick('cellMargin', ['left', 'right', 'top', 'bottom'], cell),
        text: decodedText(cell),
      })),
  };
}

const variants = [
  ['synthetic-rowbreak-overflow.hwpx', 3],
  ['synthetic-rowbreak-two-line-control.hwpx', 2],
  ['synthetic-rowbreak-single-line-control.hwpx', 1],
];
const normalized = text => text.replace(/\s/g, '');

test('real WASM contains no-lineseg inline RowBreak table text without rewriting stored geometry',
  {skip: runtimeSkip, timeout: 120000}, async t => {
    const {default: init, HwpDocument} = await import(pathToFileURL(path.resolve(coreJs)));
    await init({module_or_path: await fs.readFile(coreWasm)});
    for (const [name, lineCount] of variants) {
      await t.test(name, () => assertVariant(name, lineCount, HwpDocument));
    }
  });

async function assertVariant(name, lineCount, HwpDocument) {
  const input = await fs.readFile(new URL(`./fixtures/rowbreak-table/${name}`, import.meta.url));
  const section = archiveText(input, 'Contents/section0.xml');
  assert.doesNotMatch(section, /lineseg/, 'Fixture must exercise synthesized layout');
  const original = tableSnapshot(input);
  assert.equal(original.rows, '7');
  assert.equal(original.cols, '3');
  assert.equal(original.cells.length, 21);
  assert.deepEqual(original.cells[19].size, {width: '14173', height: '4050'});
  const doc = new HwpDocument(input);
  try {
    assert.equal(doc.pageCount(), 1);
    const properties = JSON.parse(doc.getTableProperties(0, 1, 0));
    assert.equal(properties.pageBreak, 2, 'CELL must map to RowBreak');
    assert.equal(properties.treatAsChar, true);
    const table = [...walk(JSON.parse(doc.getPageRenderTree(0)))].find(node => node.type === 'Table');
    assert.ok(table, 'Table was not rendered');
    const cells = [...walk(table)].filter(node => node.type === 'Cell');
    assert.equal(cells.length, 21, 'Every cell must be rendered');
    const renderedTexts = [];
    for (const cell of cells) {
      const lines = [...walk(cell)].filter(node => node.type === 'TextLine');
      assert.ok(lines.length > 0, `Empty rendered cell ${cell.row},${cell.col}`);
      if (cell.row === 6 && cell.col === 1) assert.equal(lines.length, lineCount);
      const top = cell.bbox.y, bottom = top + cell.bbox.h;
      for (const line of lines) {
        assert.ok(line.bbox.y >= top - 0.2, `Text above cell ${cell.row},${cell.col}`);
        assert.ok(line.bbox.y + line.bbox.h <= bottom + 0.2,
          `Text below cell ${cell.row},${cell.col}: ${line.bbox.y + line.bbox.h} > ${bottom}`);
      }
      renderedTexts.push([...walk(cell)].filter(node => node.type === 'TextRun')
        .map(node => node.text).join(''));
    }
    assert.deepEqual(renderedTexts.map(normalized), original.cells.map(cell => normalized(cell.text)),
      'Rendering must preserve every cell text in row/column order');
    // The renderer may redistribute vertical slack. Do not insist every painted
    // row keep its declared height; the saved document must keep those values.
    const exported = tableSnapshot(Buffer.from(doc.exportHwpx()));
    assert.deepEqual(exported, original,
      'Rendering/export must preserve table settings, widths, heights, spans, margins and text');
    assert.equal(doc.pageCount(), 1);
  } finally {
    doc.free();
  }
}
