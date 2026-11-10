import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { mapHwpxMember } from './engine-source-ownership/hwpx-fixture-utils.mjs';

const coreAvailable = Boolean(process.env.PWH_CORE_JS && process.env.PWH_CORE_WASM);

test('print SVG keeps faux-bold fill searchable and paints the stroke separately', {
  skip: coreAvailable ? false : 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM',
}, async () => {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({ module_or_path: await fs.readFile(process.env.PWH_CORE_WASM) });
  const fixture = await fs.readFile(new URL(
    './fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url,
  ));
  const bold = mapHwpxMember(fixture, 'Contents/header.xml', xml => xml.replace('</hh:charPr>', '<hh:bold/></hh:charPr>'));
  const doc = new core.HwpDocument(bold);
  try {
    const screen = doc.renderPageSvgWithProfile(0, 'screen');
    const print = doc.renderPageSvgWithProfile(0, 'print');
    const artwork = /<g aria-hidden="true" filter="url\(#rhwp-print-faux-bold-[^)]+\)">([\s\S]*?)<\/g>/g;
    const strokes = [...print.matchAll(artwork)].map(match => match[1]).join('');
    const searchable = print.replace(artwork, '');
    const text = (svg) => [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]);

    assert.match(screen, /<text\b[^>]*stroke-width="/);
    assert.doesNotMatch(screen, /rhwp-print-faux-bold/);
    assert.match(strokes, /<text\b[^>]*fill="none" stroke="#000000" stroke-width="0\.293"/);
    assert.doesNotMatch(searchable, /<text\b[^>]*stroke-width="/);
    assert.deepEqual(text(searchable), text(screen));
  } finally {
    doc.free();
  }
});

test('declared print substitutes relayout an isolated snapshot without changing the editor', {
  skip: coreAvailable ? false : 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM',
}, async () => {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({ module_or_path: await fs.readFile(process.env.PWH_CORE_WASM) });
  const blank = core.HwpDocument.createEmpty();
  let source;
  try {
    blank.createBlankDocument();
    blank.insertText(0, 0, 0, '조판 글꼴 검증');
    source = blank.exportHwpx();
  } finally {
    blank.free();
  }
  const target = 'Pwh Test Print Font';
  const declared = mapHwpxMember(source, 'Contents/header.xml', xml => xml.replace(
    /(<hh:font\b[^>]*>)([\s\S]*?)(<\/hh:font>)/g,
    (whole, start, contents, end) => contents.includes('<hh:substFont') ? whole
      : start + contents + `<hh:substFont face="${target}" type="TTF" isEmbedded="0" binaryItemIDRef=""/>` + end,
  ));
  const doc = new core.HwpDocument(declared);
  const snapshot = doc.createPrintFontSnapshot();
  try {
    const pairs = JSON.parse(doc.getDeclaredPrintFontSubstitutions());
    assert.ok(pairs.length > 0);
    const before = doc.renderPageSvgWithProfile(0, 'print');
    assert.equal(snapshot.setFontEnvironment(JSON.stringify({
      id: 'pwh-print-test', substitutions: Object.fromEntries(pairs),
    })), true);
    assert.equal(snapshot.pageCount(), doc.pageCount());
    assert.match(snapshot.renderPageSvgWithProfile(0, 'print'), /Pwh Test Print Font/);
    assert.equal(doc.renderPageSvgWithProfile(0, 'print'), before);
  } finally {
    snapshot.free();
    doc.free();
  }
});
