import assert from 'node:assert/strict';
import {textLineCaretFixture, textLinePictureCaretFixture} from './text-line-caret-fixture.mjs';
import {mapHwpxMember} from '../engine-source-ownership/hwpx-fixture-utils.mjs';

const cases = [];
const near = (a, b) => assert.ok(Math.abs(a - b) <= .15, `${a} != ${b}`);
const allSvg = doc => Array.from({length:doc.pageCount()}, (_, page) => doc.renderPageSvg(page));
function query(doc, run, offset, page = 0) {
  return JSON.parse(run.cellPath?.length
    ? doc.getCursorRectByPathNear(run.secIdx, run.parentParaIdx, JSON.stringify(run.cellPath), offset, page)
    : doc.getCursorRect(run.secIdx, run.paraIdx, offset));
}
function hitQuery(doc, hit, page) {
  return JSON.parse(hit.cellPath?.length
    ? doc.getCursorRectByPathNear(hit.sectionIndex, hit.parentParaIndex, JSON.stringify(hit.cellPath), hit.charOffset, page)
    : doc.getCursorRect(hit.sectionIndex, hit.paragraphIndex, hit.charOffset));
}
function check(name, run) { cases.push({name, run}); }

const variants = [];
for (const depth of [0, 1, 2]) for (const fontPoints of [8, 24]) {
  variants.push({depth, fontPoints, object:false, text:'CARET', tall:true});
}
for (const depth of [1, 2]) for (const fontPoints of [8, 24]) {
  variants.push({depth, fontPoints, object:true, text:'  ', tall:true});
}
for (const depth of [1, 2]) variants.push({depth, object:true, text:'', tall:true});
for (const depth of [0, 1, 2]) variants.push({depth, object:false, text:'CARET', tall:false});
variants.push({depth:2, fontPoints:24, object:false, text:'CARET', tall:true, dpi:144});

for (const options of variants) check('text run caret uses font metrics ' + JSON.stringify(options), core => {
  const doc = new core.HwpDocument(textLineCaretFixture(options));
  try {
    if (options.dpi) doc.setDpi(options.dpi);
    const before = allSvg(doc), scan = doc.getScanItems();
    const font = (options.fontPoints || 10) * (options.dpi || 96) / 72;
    const runs = Array.from({length:doc.pageCount()}, (_, page) =>
      JSON.parse(doc.getPageTextLayout(page)).runs.map(run => ({page, ...run}))).flat();
    const targets = runs.filter(run => run.text === options.text
      && (options.depth === 0 || !options.tall || run.h > font * 1.2));
    assert.ok(targets.length, 'synthetic target must exist');
    for (const run of targets) {
      const rect = query(doc, run, run.charStart + run.text.length, run.page);
      near(rect.height, font);
      if (run.cellPath?.length === 1) {
        const entry = run.cellPath[0];
        const legacy = JSON.parse(doc.getCursorRectInCell(run.secIdx, run.parentParaIdx,
          entry.controlIndex, entry.cellIndex, entry.cellParaIndex, run.charStart + run.text.length));
        near(rect.y, legacy.y); near(rect.height, legacy.height);
      }
      const hit = JSON.parse(doc.hitTest(run.page, run.x + .1, run.y + run.h - 1));
      const queried = hitQuery(doc, hit, run.page);
      assert.ok(hit.cursorRect.height <= font + .15, 'caret must not inherit object or line height');
      assert.equal(hit.cursorRect.pageIndex, queried.pageIndex);
      near(hit.cursorRect.y, queried.y); near(hit.cursorRect.height, queried.height);
      if (!options.object && (!run.cellPath || run.cellPath.length === 1)) {
        const entry = run.cellPath?.[0];
        for (const atEnd of [false, true]) {
          const line = JSON.parse(doc.getCursorRectOnLine(run.secIdx, run.paraIdx, 0, atEnd,
            entry ? run.parentParaIdx : -1, entry?.controlIndex ?? -1,
            entry?.cellIndex ?? -1, entry?.cellParaIndex ?? -1));
          const endpoint = query(doc, run, run.charStart + (atEnd ? run.text.length : 0), run.page);
          near(line.height, font); near(line.y, endpoint.y); near(line.x, endpoint.x);
        }
      }
    }
    assert.deepEqual(allSvg(doc), before, 'queries preserve page layout');
    assert.equal(doc.getScanItems(), scan, 'queries preserve document text');
    const reopened = new core.HwpDocument(doc.exportHwpx());
    try { assert.equal(reopened.pageCount(), doc.pageCount()); } finally { reopened.free(); }
  } finally { doc.free(); }
});

for (const options of [{depth:0,fontPoints:8}, {depth:1,fontPoints:8}, {depth:2,fontPoints:24}]) {
  check('inline picture uses insertion font height ' + JSON.stringify(options), core => {
    const doc = new core.HwpDocument(textLinePictureCaretFixture(core, {...options,text:'  '}));
    try {
      const before = allSvg(doc), font = options.fontPoints * 96 / 72;
      const targets = JSON.parse(doc.getPageTextLayout(0)).runs.filter(run => run.text.trim() === '' && run.h > font * 1.2);
      assert.ok(targets.length, 'picture host whitespace must exist');
      for (const run of targets) near(query(doc, run, run.charStart + Math.min(1, run.text.length)).height, font);
      assert.deepEqual(allSvg(doc), before);
    } finally { doc.free(); }
  });
}

for (const depth of [0, 1, 2]) check('mixed-size caret uses its own run font ' + depth, core => {
  let secondId;
  let bytes = mapHwpxMember(textLineCaretFixture({depth,text:'SMALL',object:false}), 'Contents/header.xml', xml => {
    const entries = [...xml.matchAll(/<hh:charPr\b[\s\S]*?<\/hh:charPr>/g)];
    secondId = entries.length;
    const large = entries[0][0].replace(/\bid="\d+"/, `id="${secondId}"`).replace(/\bheight="\d+"/, 'height="2400"');
    return xml.replace(/(<hh:charProperties\b[^>]*itemCnt=")\d+/, `$1${secondId + 1}`)
      .replace('</hh:charProperties>', large + '</hh:charProperties>');
  });
  bytes = mapHwpxMember(bytes, 'Contents/section0.xml', xml => xml.replace('<hp:t>SMALL</hp:t>',
    `<hp:t>SMALL</hp:t></hp:run><hp:run charPrIDRef="${secondId}"><hp:t>LARGE</hp:t>`));
  const doc = new core.HwpDocument(bytes);
  try {
    const before = allSvg(doc);
    const targets = JSON.parse(doc.getPageTextLayout(0)).runs.filter(run => ['SMALL','LARGE'].includes(run.text));
    assert.equal(targets.length, 2);
    for (const run of targets) near(query(doc, run, run.charStart + 1).height, run.fontSize);
    assert.deepEqual(allSvg(doc), before);
  } finally { doc.free(); }
});

for (const depth of [1, 2]) check('vertical glyph caret retains existing orientation ' + depth, core => {
  let bytes = textLineCaretFixture({depth,vertical:true,text:'()CARET',object:false});
  // A horizontal enclosing cell allows the nested vertical target to be laid out.
  if (depth === 2) bytes = mapHwpxMember(bytes, 'Contents/section0.xml', xml =>
    xml.replace('textDirection="VERTICAL"', 'textDirection="HORIZONTAL"'));
  const doc = new core.HwpDocument(bytes);
  try {
    const before = allSvg(doc);
    const targets = JSON.parse(doc.getPageTextLayout(0)).runs.filter(run =>
      run.cellPath?.length === depth && run.cellPath.every(entry => entry.cellIndex === 0) && run.text.trim());
    assert.ok(targets.length >= 7, 'vertical glyphs and transformed parentheses must exist');
    for (const run of targets) {
      const rect = query(doc, run, run.charStart + Math.min(1, run.text.length));
      near(rect.y, run.y); near(rect.height, run.h);
    }
    assert.deepEqual(allSvg(doc), before);
  } finally { doc.free(); }
});

export {cases as textLineCaretCases};
