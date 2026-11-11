import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM' : false;
const seed = await fs.readFile(new URL(
  './fixtures/rowbreak-table/synthetic-rowbreak-single-line-control.hwpx', import.meta.url,
));

function fixture(text) {
  let input = mapHwpxMember(seed, 'Contents/header.xml', xml => {
    const first = xml.match(/<hh:charPr\b[^>]*\bid="0"[^>]*>[\s\S]*?<\/hh:charPr>/)?.[0];
    assert.ok(first, 'synthetic seed has a character style');
    return xml.replace('</hh:charProperties>', first.replace('id="0"', 'id="1000"')
      .replace(/textColor="[^"]*"/, 'textColor="#003366"') + '</hh:charProperties>');
  });
  const paper = '<hp:secPr id="0"><hp:pagePr width="40000" height="20000" landscape="WIDELY"><hp:margin left="2000" right="2000" top="1000" bottom="1000" header="0" footer="0" gutter="0"/></hp:pagePr></hp:secPr>';
  const body = `<hp:p paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0">${paper}<hp:t>${text}</hp:t></hp:run><hp:run charPrIDRef="1000"><hp:t>AFTER</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="0" horzpos="0" horzsize="36000" flags="393216"/></hp:linesegarray></hp:p>`;
  input = mapHwpxMember(input, 'Contents/section0.xml', xml =>
    xml.replace(/(<hs:sec\b[^>]*>)[\s\S]*<\/hs:sec>/, '$1' + body + '</hs:sec>'));
  return input;
}

for (const prefix of ['\uf0a7 ', '\uf09f ', '\uf06c ', 'A ', '\u25aa ', '\uf0a7 A B ']) {
  test(`encoded symbol and plain run advances agree with caret boundaries: ${JSON.stringify(prefix)}`, {skip}, async () => {
    const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
    await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
    const doc = new core.HwpDocument(fixture(prefix));
    try {
      assert.equal(doc.pageCount(), 1);
      const runs = JSON.parse(doc.getPageTextLayout(0)).runs;
      const prefixRuns = runs.filter(run => run.text && run.text !== 'AFTER');
      const before = prefixRuns.at(-1);
      const after = runs.find(run => run.text === 'AFTER');
      assert.ok(before && after, 'style boundary is preserved');
      assert.equal(prefixRuns.map(run => run.text).join(''), prefix);
      for (const run of prefixRuns) {
        assert.ok(Math.abs(run.w - run.charX.at(-1)) < .21, JSON.stringify(run));
      }
      assert.ok(Math.abs(after.x - before.x - before.charX.at(-1)) < .21, JSON.stringify({before, after}));
      const reopened = new core.HwpDocument(doc.exportHwpx());
      try {
        const saved = JSON.parse(reopened.getPageTextLayout(0)).runs.filter(run => run.text && run.text !== 'AFTER');
        assert.equal(saved.map(run => run.text).join(''), prefix, 'save/reopen preserves original encoded characters');
        assert.ok(Math.abs(saved.at(-1).w - before.w) < .11, 'save/reopen preserves advance');
      } finally { reopened.free(); }
      if (prefix.charCodeAt(0) >= 0xf020) {
        const svg = doc.renderPageSvg(0);
        assert.ok(!svg.includes('>' + prefix[0] + '<'), 'paint substitutes the encoded symbol');
      }
    } finally { doc.free(); }
  });
}

test('full-width Hancom book brackets keep their existing display advance', {skip}, async () => {
  const core = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
  const docs = ['\u{f0854}', '\u300a'].map(text => new core.HwpDocument(fixture(text)));
  try {
    const origins = docs.map(doc => JSON.parse(doc.getPageTextLayout(0)).runs.find(run => run.text === 'AFTER').x);
    assert.ok(Math.abs(origins[0] - origins[1]) < .11, JSON.stringify(origins));
  } finally { docs.forEach(doc => doc.free()); }
});
