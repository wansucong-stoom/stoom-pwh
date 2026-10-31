import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';
import {zipEntries} from '../scripts/setup.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit candidate core paths' : false;
const seed = await fs.readFile(new URL('./fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url));
const line = (height = 1100) => `<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="${height}" textheight="${height}" baseline="${Math.round(height * .85)}" spacing="500" horzpos="0" horzsize="18000" flags="393216"/></hp:linesegarray>`;
const para = (text, extra = '', height = 1100) => `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${extra}<hp:t>${text}</hp:t></hp:run>${line(height)}</hp:p>`;
const cell = (row, width, height, body, align = 'CENTER') => `<hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${align}">${body}</hp:subList><hp:cellAddr colAddr="0" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${width}" height="${height}"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`;
function table(id, width, height, rows, inline) {
  return `<hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" rowCnt="2" colCnt="1" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${width}" height="${height}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="${Number(inline)}" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="100" right="100" top="100" bottom="100"/><hp:inMargin left="100" right="100" top="100" bottom="100"/>${rows.map(r => '<hp:tr>' + r + '</hp:tr>').join('')}</hp:tbl>`;
}
function fixture({childHeight = 6000, placeholder = 1100, text = '', trailing = false, align = 'CENTER', pageHeight = 30000} = {}) {
  const nested = table(2, 12000, childHeight, [0, 1].map(row => cell(row, 12000, childHeight / 2, para(`CHILD ${row}`))), false);
  const host = para(text, nested, placeholder) + (trailing ? para('') : '');
  const outer = table(1, 18000, 3800, [cell(0, 18000, 2000, para('HEADER')), cell(1, 18000, 1800, host, align)], true);
  return mapHwpxMember(seed, 'Contents/section0.xml', xml => {
    const section = `<hp:secPr id="0"><hp:pagePr width="30000" height="${pageHeight}" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>`;
    return xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + para('', section + outer, 4000) + '</hs:sec>');
  });
}

test('pagination uses the same occupied child box near the page boundary', {skip}, async () => {
  const core = await loadCore(), doc = new core.HwpDocument(fixture({pageHeight: 9000}));
  try {
    assert.equal(doc.pageCount(), 1);
    const g = geometry(doc);
    assert.ok(g.child.y + g.child.height <= 9000 / 75);
    const texts = JSON.parse(doc.getPageTextLayout(0)).runs.map(r => r.text).filter(t => t.startsWith('CHILD'));
    assert.deepEqual(texts, ['CHILD 0', 'CHILD 1']);
  } finally { doc.free(); }
});
async function loadCore() {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
  return core;
}
function* walk(n) { yield n; for (const c of n.children || []) yield* walk(c); if (n.child) yield* walk(n.child); }
function geometry(doc) {
  const nodes = [...walk(JSON.parse(doc.getPageLayerTree(0)).root)];
  const parent = nodes.find(n => n.groupKind?.kind === 'tableCell' && n.groupKind.row === 1 && Math.abs(n.bounds.width - 18000 / 75) < .05);
  const child = nodes.filter(n => n.groupKind?.kind === 'table')[1];
  assert.ok(parent && child);
  return {parent: parent.bounds, child: child.bounds};
}
function sourceCellSizes(bytes) {
  const xml = zipEntries(Buffer.from(bytes)).find(e => e.name === 'Contents/section0.xml').read().toString('utf8');
  return [...xml.matchAll(/<hp:cellSz\b[^>]*>/g)].map(([tag]) => ({
    width: Number(/\bwidth="(\d+)"/.exec(tag)[1]), height: Number(/\bheight="(\d+)"/.exec(tag)[1]),
  }));
}

for (const [childHeight, placeholder] of [[6000, 1100], [8000, 1500]]) {
  for (const align of ['TOP', 'CENTER', 'BOTTOM']) {
    test(`stored empty nested host shares the object box: ${childHeight}/${placeholder}/${align}`, {skip}, async () => {
      const core = await loadCore(), bytes = fixture({childHeight, placeholder, align}), doc = new core.HwpDocument(bytes);
      try {
        const g = geometry(doc);
        assert.equal(doc.pageCount(), 1);
        assert.ok(Math.abs(g.parent.height - (childHeight + 400) / 75) < .1, `Parent height: ${g.parent.height}`);
        assert.ok(Math.abs(g.child.y - g.parent.y - 200 / 75) < .1, `Nested top: ${g.child.y - g.parent.y}`);
        assert.ok(g.child.y + g.child.height <= g.parent.y + g.parent.height + .1);
        const saved = doc.exportHwpx();
        assert.deepEqual(sourceCellSizes(saved), sourceCellSizes(bytes), 'Stored cell sizes must not be rewritten to fit');
        const reopened = new core.HwpDocument(saved);
        try { assert.deepEqual(geometry(reopened), g); } finally { reopened.free(); }
      } finally { doc.free(); }
    });
  }
}
for (const options of [{text: 'HOST'}, {trailing: true}]) {
  test(`visible or adjacent host lines retain their own space: ${JSON.stringify(options)}`, {skip}, async () => {
    const core = await loadCore(), doc = new core.HwpDocument(fixture(options));
    try { assert.ok(geometry(doc).parent.height > 6400 / 75 + 1); } finally { doc.free(); }
  });
}
