import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { mapHwpxMember } from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM' : false;
async function loadCore() {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({ module_or_path: await fs.readFile(process.env.PWH_CORE_WASM) });
  return core;
}
let corePromise;
const seed = await fs.readFile(new URL(
  './fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url,
));
const px = hu => hu * 96 / 7200;
function paragraph(contents, vpos, width = 25000) {
  return `<hp:p paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0">${contents}</hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="${vpos}" vertsize="1100" textheight="1100" baseline="935" spacing="550" horzpos="0" horzsize="${width}" flags="393216"/></hp:linesegarray></hp:p>`;
}
function fixture({ width = 25700, offset = -950, right = 220, after = 0 } = {}) {
  const paper = '<hp:secPr id="0"><hp:pagePr width="30000" height="13600" landscape="WIDELY"><hp:margin left="2400" right="2600" top="200" bottom="200" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  const rows = ['CELL_ALPHA', 'CELL_BETA'].map((text, row) =>
    `<hp:tr><hp:tc hasMargin="1" borderFillIDRef="1"><hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">${paragraph(`<hp:t>${text}</hp:t>`, 0, width)}</hp:subList><hp:cellAddr colAddr="0" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${width}" height="1600"/><hp:cellMargin left="0" right="0" top="0" bottom="0"/></hp:tc></hp:tr>`,
  ).join('');
  const table = `<hp:tbl id="42" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="2" colCnt="1" cellSpacing="0" borderFillIDRef="1"><hp:sz width="${width}" height="3200" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="RIGHT" vertOffset="0" horzOffset="${offset >>> 0}"/><hp:outMargin left="110" right="${right}" top="300" bottom="140"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>${rows}</hp:tbl>`;
  const body = paragraph(paper + '<hp:t>START</hp:t>', 0)
    + paragraph('<hp:t>BEFORE</hp:t>', 1650)
    + paragraph(table + '<hp:t/>', 3300, 0)
    + paragraph('<hp:t>AFTER</hp:t>', after);
  return mapHwpxMember(seed, 'Contents/section0.xml',
    xml => xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + body + '</hs:sec>'));
}
function findTable(tree) {
  if (!tree || typeof tree !== 'object') return;
  if (tree.type === 'Table') return tree.bbox;
  for (const child of Object.values(tree)) {
    const table = findTable(child);
    if (table) return table;
  }
}

test('paragraph-right float aligns the outer edge using the signed offset', { skip }, async () => {
  const core = await (corePromise ??= loadCore());
  for (const width of [18000, 25700]) {
    for (const offset of [-950, 170]) {
      const right = 220;
      const doc = new core.HwpDocument(fixture({ width, offset, right }));
      try {
        const table = findTable(JSON.parse(doc.getPageRenderTree(0)));
        assert.ok(table);
        assert.ok(Math.abs(table.x - px(27400 - width - offset - right)) < 0.2,
          `Right edge must honor the signed offset and right margin at width ${width}, offset ${offset}`);
        assert.ok(Math.abs(table.w - px(width)) < 0.2, 'The declared table width is preserved');
      } finally {
        doc.free();
      }
    }
  }
});

test('a whole empty-host float uses the preceding stored line and the next page restart', { skip }, async () => {
  const core = await (corePromise ??= loadCore());
  const doc = new core.HwpDocument(fixture());
  try {
    const table = findTable(JSON.parse(doc.getPageRenderTree(0)));
    assert.ok(table);
    assert.ok(Math.abs(table.y - px(200 + 3300 + 300)) < 0.2,
      `Expected top margin on the independently confirmed outer origin, got ${table.y}`);
    assert.ok(Math.abs(table.h - px(3200)) < 0.2);
  } finally {
    doc.free();
  }
});
