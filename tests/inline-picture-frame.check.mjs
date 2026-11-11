import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {zipEntries} from '../scripts/setup.mjs';
import {textLinePictureCaretFixture} from './engine-cursor/text-line-caret-fixture.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

// Explicit core paths also allow checking a candidate before runtime promotion.
const sectionName = 'Contents/section0.xml';
const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM paths'
  : false;

function paragraph(text, y, height = 1100, spacing = 500, control = '') {
  return '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
    + '<hp:run charPrIDRef="0">' + control + '<hp:t>' + text + '</hp:t></hp:run>'
    + '<hp:linesegarray><hp:lineseg textpos="0" vertpos="' + y + '" vertsize="' + height
    + '" textheight="' + height + '" baseline="' + Math.min(900, height) + '" spacing="' + spacing
    + '" horzpos="0" horzsize="21800" flags="393216"/></hp:linesegarray></hp:p>';
}

function table(id, content, height, cellHeight, inline = false) {
  const width = inline ? 20000 : 22000;
  return '<hp:tbl id="' + id + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM"'
    + ' textFlow="BOTH_SIDES" pageBreak="CELL" repeatHeader="0" noAdjust="1" rowCnt="1" colCnt="1"'
    + ' cellSpacing="0" borderFillIDRef="1"><hp:sz width="' + width + '" height="' + height
    + '" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE"/><hp:pos treatAsChar="' + Number(inline)
    + '" affectLSpacing="0" flowWithText="1" allowOverlap="0" vertRelTo="PARA" horzRelTo="PARA"'
    + ' vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    + '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
    + '<hp:inMargin left="100" right="100" top="100" bottom="100"/>'
    + '<hp:tr><hp:tc hasMargin="1" borderFillIDRef="1">'
    + '<hp:subList textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP">' + content
    + '</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>'
    + '<hp:cellSz width="' + width + '" height="' + cellHeight
    + '"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc></hp:tr></hp:tbl>';
}

function fixture(core, sheetHeight) {
  const material = textLinePictureCaretFixture(core);
  const sectionXml = zipEntries(material).find(entry => entry.name === sectionName).read().toString('utf8');
  const picture = sectionXml.match(/<hp:pic\b[\s\S]*?<\/hp:pic>/)[0]
    .replace(/flowWithText="\d"/, 'flowWithText="1"')
    .replace(/treatAsChar="\d"/, 'treatAsChar="1"')
    .replace(/allowOverlap="\d"/, 'allowOverlap="0"');
  const section = '<hp:secPr id="0"><hp:pagePr width="30000" height="' + sheetHeight
    + '" landscape="WIDELY"><hp:margin left="0" right="0" top="0" bottom="0" header="0"'
    + ' footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  const before = Array.from({length: 11}, (_, index) => paragraph('LEAD_' + index, index * 1600)).join('');
  const after = paragraph('', 0, 6200, 500, table(20, paragraph('NEXT_TABLE', 0), 6200, 6200, true))
    + paragraph('NEXT_TAIL', 6700);
  const outer = table(10, before + paragraph('', 17600, 6000, 500, picture) + after, 23800, 31000);
  return mapHwpxMember(material, sectionName, xml =>
    xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + paragraph('', 0, 800, 0, section + outer) + '</hs:sec>'));
}

function inspect(doc) {
  return Array.from({length: doc.pageCount()}, (_, page) => {
    const svg = doc.renderPageSvgWithProfile(page, 'print');
    const images = [...svg.matchAll(/<image\b[^>]*\by="([^"]+)"[^>]*\bheight="([^"]+)"/g)]
      .map(([, y, height]) => ({top: Number(y), bottom: Number(y) + Number(height)}));
    const runs = JSON.parse(doc.getPageTextLayout(page)).runs;
    const footerY = JSON.parse(doc.getPageInfo(page)).footerArea.y;
    return {images, table: runs.some(run => run.text === 'NEXT_TABLE'), footerY};
  });
}

test('the inline picture closes its saved page and the following table starts on a new page', {skip}, async () => {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
  const doc = new core.HwpDocument(fixture(core, 23800));
  try {
    const layout = inspect(doc);
    assert.deepEqual(layout.map(page => [page.images.length, page.table]), [[1, false], [0, true]]);
    assert.ok(layout[0].images[0].bottom <= layout[0].footerY);
    const reopened = new core.HwpDocument(doc.exportHwpx());
    try { assert.deepEqual(inspect(reopened), layout); }
    finally { reopened.free(); }
  } finally { doc.free(); }
});
