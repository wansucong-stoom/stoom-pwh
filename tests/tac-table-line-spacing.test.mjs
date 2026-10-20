import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {zipEntries} from '../scripts/setup.mjs';

const coreJs = process.env.PWH_CORE_JS;
const coreWasm = process.env.PWH_CORE_WASM;
const runtimeSkip = !coreJs || !coreWasm
  ? 'Set PWH_CORE_JS and PWH_CORE_WASM to a real rhwp WASM build.' : false;
const fixtureRoot = new URL('./fixtures/tac-line-spacing/', import.meta.url);
const variants = JSON.parse(await fs.readFile(new URL('variants.json', fixtureRoot), 'utf8'));
const dualVariants = JSON.parse(await fs.readFile(new URL('dual-variants.json', fixtureRoot), 'utf8'));
const boundaryVariants = JSON.parse(await fs.readFile(new URL('boundary-variants.json', fixtureRoot), 'utf8'));
const HWPUNIT_PER_PIXEL = 75;
const TOLERANCE_HU = 2.5;

function* layerWalk(node) {
  yield node;
  for (const child of node.children || []) yield* layerWalk(child);
  if (node.child) yield* layerWalk(node.child);
}

function memberText(bytes, name) {
  const entry = zipEntries(bytes).find(entry => entry.name === name);
  assert.ok(entry, `Missing HWPX member ${name}`);
  return entry.read().toString('utf8');
}

function attrs(source = '') {
  return Object.fromEntries([...source.matchAll(/([\w:]+)="([^"]*)"/g)]
    .map(([,key,value]) => [key,value]));
}

function snapshot(bytes) {
  const xml = memberText(bytes, 'Contents/section0.xml');
  const pick = (tag, keys) => {
    const found = attrs(new RegExp(`<hp:${tag}\\b([^>]*)>`).exec(xml)?.[1]);
    return Object.fromEntries(keys.map(key => [key, found[key]]));
  };
  const all = (tag, keys) => [...xml.matchAll(new RegExp(`<hp:${tag}\\b([^>]*)>`, 'g'))]
    .map(([,source]) => {const values = attrs(source);
      return Object.fromEntries(keys.map(key => [key, values[key]]));});
  return {
    table: pick('tbl', ['rowCnt', 'colCnt', 'pageBreak']),
    size: pick('sz', ['width', 'height']),
    position: pick('pos', ['treatAsChar', 'affectLSpacing', 'flowWithText']),
    outerMargin: pick('outMargin', ['left', 'right', 'top', 'bottom']),
    cellSize: pick('cellSz', ['width', 'height']),
    cellMargin: pick('cellMargin', ['left', 'right', 'top', 'bottom']),
    tableSizes: all('sz', ['width', 'height']),
    tablePositions: all('pos', ['treatAsChar', 'affectLSpacing', 'flowWithText']),
    allCellSizes: all('cellSz', ['width', 'height']),
    paragraphPageBreaks: all('p', ['pageBreak']),
    // No escaped markup appears in these wholly synthetic test sentences.
    text: [...xml.matchAll(/<hp:t\b(?![^>]*\/>)[^>]*>([\s\S]*?)<\/hp:t>/g)]
      .map(([,text]) => text).filter(Boolean),
    storedLineSegments: [...xml.matchAll(/<hp:lineseg\b([^>]*)\/>/g)].map(([,value]) => attrs(value)),
  };
}

function closeHU(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= TOLERANCE_HU,
    `${label}: ${actual.toFixed(3)} HWPUNIT; expected ${expected} ±${TOLERANCE_HU}`);
}

function measuredSpacing(doc, variant) {
  // Render-tree/text-layout JSON rounds to 0.1px (=7.5 HU). Layer bounds have
  // 0.001px precision, allowing an oracle tighter than the expected HU rounding.
  const {tables,lines} = renderedParts(doc);
  const table = tables[0];
  const following = lines.find(node => node.groupKind?.kind === 'textLine'
    && [...layerWalk(node)].flatMap(child => child.ops || [])
      .filter(op => op.type === 'textRun').map(op => op.text).join('') === '표 다음 본문입니다.');
  assert.ok(table && following, 'Expected table and following text line');
  closeHU(table.bounds.height * HWPUNIT_PER_PIXEL, variant.objectHeight, 'Table painted height');
  return (following.bounds.y - table.bounds.y - table.bounds.height) * HWPUNIT_PER_PIXEL
    - variant.outerBottom;
}

function renderedParts(doc) {
  const tables = [], lines = [];
  for (let page = 0; page < doc.pageCount(); page++) {
    const nodes = [...layerWalk(JSON.parse(doc.getPageLayerTree(page)).root)];
    for (const node of nodes) {
      if (node.groupKind?.kind === 'table') tables.push({...node,page});
      if (node.groupKind?.kind === 'textLine') lines.push({...node,page});
    }
  }
  return {tables,lines};
}

function findLine(lines, text) {
  return lines.find(node => [...layerWalk(node)].flatMap(child => child.ops || [])
    .filter(op => op.type === 'textRun').map(op => op.text).join('') === text);
}

function spacingAfter(table, line, outerBottom) {
  assert.equal(table.page, line.page, 'This spacing measurement must stay on one page');
  return (line.bounds.y - table.bounds.y - table.bounds.height) * HWPUNIT_PER_PIXEL - outerBottom;
}

test('synthetic spacing fixtures separate object height, font height and stored layout', async () => {
  assert.equal(variants.length, 14);
  for (const variant of variants) {
    const bytes = await fs.readFile(new URL(variant.name, fixtureRoot));
    const data = snapshot(bytes);
    assert.equal(data.position.treatAsChar, '1');
    assert.equal(data.position.affectLSpacing, String(Number(variant.affect)));
    assert.equal(Number(data.size.height), variant.objectHeight);
    assert.equal(Number(data.outerMargin.top), variant.outerTop);
    assert.equal(Number(data.outerMargin.bottom), variant.outerBottom);
    assert.equal(data.storedLineSegments.length, variant.storedSpacing === null ? 0 : 1);
  }
  assert.equal(dualVariants.length, 2);
  assert.equal(boundaryVariants.length, 2);
  for (const variant of [...dualVariants, ...boundaryVariants]) {
    const data = snapshot(await fs.readFile(new URL(variant.name, fixtureRoot)));
    assert.equal(data.tablePositions.length, dualVariants.includes(variant) ? 2 : 1);
    assert.equal(data.storedLineSegments.length, 0);
  }
});

test('real WASM honors inline-table affectLSpacing while retaining explicit stored spacing',
  {skip: runtimeSkip, timeout: 120000}, async t => {
    const {default: init, HwpDocument} = await import(pathToFileURL(path.resolve(coreJs)));
    await init({module_or_path: await fs.readFile(coreWasm)});
    const cursorSamples = new Map();
    for (const variant of variants) {
      await t.test(variant.name, async () => {
        const input = await fs.readFile(new URL(variant.name, fixtureRoot));
        const original = snapshot(input);
        const doc = new HwpDocument(input);
        try {
          assert.equal(doc.pageCount(), 1);
          const actual = measuredSpacing(doc, variant);
          const followingLine = findLine(renderedParts(doc).lines, '표 다음 본문입니다.');
          const cursor = JSON.parse(doc.getCursorRect(0, 2, 0));
          assert.equal(cursor.pageIndex, followingLine.page);
          if (variant.storedSpacing === null) cursorSamples.set(
            `${variant.objectHeight}/${variant.percent}/${Number(variant.affect)}`,
            {cursor,lineY:followingLine.bounds.y});
          const basis = variant.affect
            ? variant.objectHeight + variant.outerTop + variant.outerBottom : variant.fontHeight;
          const expected = variant.storedSpacing ?? basis * (variant.percent - 100) / 100;
          closeHU(actual, expected, 'Following text spacing');
          const exported = Buffer.from(doc.exportHwpx());
          assert.deepEqual(snapshot(exported), original,
            'Reading/rendering must retain geometry, margins, affectLSpacing, text and stored line segments');
          const reopened = new HwpDocument(exported);
          try {
            assert.equal(reopened.pageCount(), 1);
            closeHU(measuredSpacing(reopened, variant), expected, 'Reopened spacing');
          } finally { reopened.free(); }
        } finally { doc.free(); }
      });
    }
    await t.test('following-text cursor tracks the same object-leading change as the painted line', () => {
      // The public cursor API rounds to 0.1px; a difference of two cursor reads
      // has up to 7.5 HU quantization error. Keep the layer-spacing oracle at
      // 2.5 HU above and allow 8 HU only for this independently rounded delta.
      const cursorToleranceHU = 8;
      for (const height of [5000, 10000]) for (const percent of [135, 160]) {
        const off = cursorSamples.get(`${height}/${percent}/0`);
        const on = cursorSamples.get(`${height}/${percent}/1`);
        assert.ok(off && on, 'Both affectLSpacing cursor controls were measured');
        assert.equal(off.cursor.height, on.cursor.height, 'The following font/cursor height stays unchanged');
        const cursorDelta = (on.cursor.y - off.cursor.y) * HWPUNIT_PER_PIXEL;
        const paintedDelta = (on.lineY - off.lineY) * HWPUNIT_PER_PIXEL;
        const expectedDelta = (height + 300 - 1100) * (percent - 100) / 100;
        assert.ok(Math.abs(cursorDelta - expectedDelta) <= cursorToleranceHU,
          `Cursor delta ${cursorDelta} HU differs from inline-leading delta ${expectedDelta}`);
        assert.ok(Math.abs(cursorDelta - paintedDelta) <= cursorToleranceHU,
          'Painted text moved without the same cursor/typeset movement');
      }
    });
    for (const variant of dualVariants) {
      await t.test(variant.name, async () => {
        const input = await fs.readFile(new URL(variant.name, fixtureRoot));
        const original = snapshot(input);
        const doc = new HwpDocument(input);
        try {
          assert.equal(doc.pageCount(), variant.pageCount);
          const parts = renderedParts(doc);
          assert.equal(parts.tables.length, 2);
          for (let index = 0; index < 2; index++) {
            const expected = variant.following[index];
            const line = findLine(parts.lines, expected.text);
            assert.ok(line, 'Missing following paragraph');
            closeHU(spacingAfter(parts.tables[index], line, expected.outerBottom),
              expected.expectedSpacing, `Table ${index + 1} spacing`);
          }
          const exported = Buffer.from(doc.exportHwpx());
          assert.deepEqual(snapshot(exported), original);
          const reopened = new HwpDocument(exported);
          try {
            assert.equal(reopened.pageCount(), variant.pageCount);
            const reopenedParts = renderedParts(reopened);
            assert.equal(reopenedParts.tables.length, 2);
            for (let index = 0; index < 2; index++) {
              const expected = variant.following[index];
              const line = findLine(reopenedParts.lines, expected.text);
              assert.ok(line);
              closeHU(spacingAfter(reopenedParts.tables[index], line, expected.outerBottom),
                expected.expectedSpacing, `Reopened table ${index + 1} spacing`);
            }
          } finally { reopened.free(); }
        } finally { doc.free(); }
      });
    }
    for (const variant of boundaryVariants) {
      await t.test(variant.name, async () => {
        const input = await fs.readFile(new URL(variant.name, fixtureRoot));
        const original = snapshot(input);
        const doc = new HwpDocument(input);
        try {
          assert.ok(variant.pageHeight / HWPUNIT_PER_PIXEL < 500, 'Compact-page fixture');
          assert.equal(doc.pageCount(), variant.pageCount, 'Correct inline leading must participate in pagination');
          const parts = renderedParts(doc);
          assert.equal(parts.tables.length, 1);
          assert.equal(parts.tables[0].page, 0, 'The table itself fits on the first page');
          const line = findLine(parts.lines, '표 다음 본문입니다.');
          assert.ok(line);
          assert.equal(line.page, variant.pageCount - 1);
          assert.equal(JSON.parse(doc.getCursorRect(0, 2, 0)).pageIndex, line.page,
            'The following paragraph cursor must follow the same pagination');
          const bottomHU = (line.bounds.y + line.bounds.height) * HWPUNIT_PER_PIXEL;
          assert.ok(bottomHU <= variant.pageHeight - variant.pageBottom + TOLERANCE_HU,
            'Following text must fit its page body');
          if (variant.pageCount === 1) {
            closeHU(spacingAfter(parts.tables[0], line, variant.outerBottom),
              (variant.objectHeight + variant.outerTop + variant.outerBottom) * .35,
              'Near-boundary spacing');
          }
          const exported = Buffer.from(doc.exportHwpx());
          assert.deepEqual(snapshot(exported), original);
          const reopened = new HwpDocument(exported);
          try { assert.equal(reopened.pageCount(), variant.pageCount); } finally { reopened.free(); }
        } finally { doc.free(); }
      });
    }
  });
