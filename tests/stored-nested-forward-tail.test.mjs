import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {forwardTailInlineFixture} from './engine-source-ownership/stored-nested-forward-tail-fixture.mjs';
import {multiPageTailFixture, followupMarkers} from './engine-source-ownership/stored-nested-forward-multipage-fixture.mjs';
import {resumedMarginFixture} from './engine-source-ownership/stored-nested-resumed-margin-fixture.mjs';
import {verifySourceHistory} from './engine-source-ownership/stored-nested-source-history.mjs';

const coreSkip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM paths' : false;
const referenceSkip = coreSkip || (!process.env.PWH_REFERENCE_CORE_JS || !process.env.PWH_REFERENCE_CORE_WASM
  ? 'Requires an independent PWH_REFERENCE_CORE_JS and PWH_REFERENCE_CORE_WASM' : false);
const hash = value => createHash('sha256').update(value).digest('hex');
async function load(js, wasm) {
  const module = await import(pathToFileURL(path.resolve(js)));
  const bytes = await fs.readFile(wasm);
  await module.default({module_or_path: bytes});
  return {module, wasmSha256: hash(bytes)};
}
let candidatePromise, referencePromise;
const candidate = () => candidatePromise ||= load(process.env.PWH_CORE_JS, process.env.PWH_CORE_WASM);
const reference = () => referencePromise ||= load(process.env.PWH_REFERENCE_CORE_JS, process.env.PWH_REFERENCE_CORE_WASM);
const sourceText = doc => JSON.parse(doc.getScanItems())
  .filter(item => item.kind === 0 && item.text).map(item => item.text).join('');
const markers = ['WRAPPER', 'LEAD_0', 'LEAD_1', 'LEAD_2',
  ...Array.from({length: 4}, (_, row) => [0, 1].map(col => `ROW_${row}_${col}`)).flat(),
  'INLINE_A', 'INLINE_B', 'ROW_4_1', 'ROW_5_0', 'ROW_5_1', 'AFTER_TABLE'];
const tailMarkers = ['INLINE_A', 'INLINE_B', 'ROW_4_1', 'ROW_5_0', 'ROW_5_1', 'AFTER_TABLE'];
const owner = (pages, marker) => pages.findIndex(page => page.runs.some(run => run.text === marker));
function capture(doc) {
  return Array.from({length: doc.pageCount()}, (_, page) => ({
    svgSha256: hash(doc.renderPageSvgWithProfile(page, 'print')),
    runs: JSON.parse(doc.getPageTextLayout(page)).runs,
  }));
}
function appearance(pages) {
  // HWPX serialization may insert frame-setting controls and renumber control
  // indexes. Compare the complete SVG bytes and visible text geometry, while
  // retaining original run paths in capture() for the real deep-edit operation.
  return pages.map(page => ({
    svgSha256: page.svgSha256,
    runs: page.runs.map(({text, x, y, w, h, charX}) => ({text, x, y, w, h, charX})),
  }));
}
function assertOwners(pages, expectedMarkers, label) {
  const runs = pages.flatMap(page => page.runs);
  for (const marker of expectedMarkers) {
    assert.equal(runs.filter(run => run.text === marker).length, 1, `${label}: exactly one visible owner for ${marker}`);
  }
  // The synthetic paper is 22000 HU high at the engine's 96-dpi layout scale.
  // This bound independently catches the historical 9-page -> 2-page collapse.
  for (const run of runs) {
    assert.ok(Number.isFinite(run.y) && run.y >= 0 && run.y < 22000 * 96 / 7200,
      `${label}: visible source remains inside its physical page`);
  }
}
function assertForwardOwners(pages) {
  const opening = owner(pages, 'ROW_0_0');
  assert.ok(opening >= 0);
  for (const marker of tailMarkers) {
    assert.equal(owner(pages, marker), opening + 1, `${marker}: the independently closed tail owns the following frame`);
  }
}
function editInline(doc, pages) {
  const hit = pages.flatMap(page => page.runs).find(run => run.text === 'INLINE_A');
  assert.ok(hit?.cellPath?.length >= 3, 'The fixture exercises a genuine deep nested cell');
  doc.insertTextInCellByPath(hit.secIdx, hit.parentParaIdx, JSON.stringify(hit.cellPath), hit.charStart, 'EDIT');
}
function verifyLifecycle(core, bytes, {multipage = false, resumed = false, closed = false} = {}) {
  const doc = new core.HwpDocument(bytes);
  try {
    const before = capture(doc), text = sourceText(doc);
    const expectedMarkers = multipage ? [...markers, ...followupMarkers] : resumed ? ['OUTER_HEADER', ...markers] : markers;
    assertOwners(before, expectedMarkers, 'initial');
    assert.equal(before.length, multipage ? 9 : resumed ? 3 : 2, 'Independent synthetic source owns the expected physical page count');
    if (closed) assertForwardOwners(before);
    for (let page = before.length - 1; page >= 0; page--) {
      doc.getPageTextLayout(page);
      assert.equal(hash(doc.renderPageSvgWithProfile(page, 'print')), before[page].svgSha256,
        'Reverse page access cannot change warmed geometry');
    }
    assert.deepEqual(capture(doc), before, 'Forward and reverse layout access agree');
    const reopened = new core.HwpDocument(doc.exportHwpx());
    try {
      assert.equal(sourceText(reopened), text, 'Save/reopen preserves exact source text');
      assert.deepEqual(appearance(capture(reopened)), appearance(before), 'Save/reopen preserves complete print geometry and text positions');
    } finally { reopened.free(); }
    const snapshot = doc.saveSnapshot();
    let edited;
    try {
      editInline(doc, before);
      assert.equal(sourceText(doc), text.replace('INLINE_A', 'EDITINLINE_A'), 'Deep edit replaces only the selected source');
      edited = capture(doc);
      assertOwners(edited, expectedMarkers.map(marker => marker === 'INLINE_A' ? 'EDITINLINE_A' : marker), 'edited');
      const editedReopened = new core.HwpDocument(doc.exportHwpx());
      try {
        assert.equal(sourceText(editedReopened), sourceText(doc));
        assert.deepEqual(appearance(capture(editedReopened)), appearance(edited), 'An edited document cannot regain stale source geometry on reopen');
      } finally { editedReopened.free(); }
    } finally {
      doc.restoreSnapshot(snapshot);
      doc.discardSnapshot(snapshot);
    }
    assert.equal(sourceText(doc), text, 'Undo restores the exact source');
    assert.deepEqual(capture(doc), before, 'Undo restores the original physical frames');
    return {before, edited};
  } finally { doc.free(); }
}

const inlineVariants = [
  ['closed source frame', {}],
  ['inexact successor closure', {successorDelta: 1}],
  ['two-column metadata', {columns: 2}],
  ['explicit page break', {pageBreak: 1}],
  ['inexact inline band', {inlineBandDelta: 1}],
  ['ordinary successor flow', {ordinaryFlow: true}],
];
const multipageVariants = [
  ['top-aligned minimum', {}],
  ['center-aligned minimum', {align: 'CENTER'}],
  ['short declared minimum', {declaredHeight: 5000}],
  ['inexact successor closure', {successorDelta: 1}],
];
const resumedVariants = [
  ['closed continuation', {}],
  ['zero outer margins', {top: 0, bottom: 0}],
  ['asymmetric outer margins', {top: 330, bottom: 540}],
  ['inexact successor closure', {successorDelta: 1}],
  ['independently offset child', {offset: 1}],
];
for (const [index, [name, options]] of inlineVariants.entries()) {
  test(`stored forward tail: ${name} preserves owners, cache, save and Undo`, {skip: coreSkip}, async () => {
    const {module} = await candidate();
    verifyLifecycle(module, forwardTailInlineFixture(options), {closed: index === 0});
  });
}
for (const [name, options] of multipageVariants) {
  test(`stored forward tail: 90 later paragraphs retain nine pages (${name})`, {skip: coreSkip}, async () => {
    const {module} = await candidate();
    verifyLifecycle(module, multiPageTailFixture(options), {multipage: true, closed: !options.successorDelta});
  });
}
for (const [name, options] of resumedVariants) {
  test(`stored forward tail: two enclosing owners retain three physical pages (${name})`, {skip: coreSkip}, async () => {
    const {module} = await candidate();
    verifyLifecycle(module, resumedMarginFixture(options), {resumed: true, closed: !options.successorDelta});
  });
}
test('stored forward tail: resumed child margins consume their own source distance exactly once', {skip: coreSkip}, async () => {
  const {module} = await candidate();
  const read = options => {
    const doc = new module.HwpDocument(resumedMarginFixture(options));
    try {
      const pages = capture(doc);
      const svg = doc.renderPageSvgWithProfile(2, 'print');
      // The outer wrapper is 24000 HU wide. Its final horizontal boundary
      // includes the child's bottom margin, even when the text origin is fixed.
      const outerBottom = Math.max(...Array.from(svg.matchAll(/<line\b[^>]*>/g), ([tag]) => {
        const attr = name => Number(tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]);
        return attr('x1') === 0 && attr('x2') === 24000 * 96 / 7200 && attr('y1') === attr('y2') ? attr('y1') : -Infinity;
      }));
      assert.ok(Number.isFinite(outerBottom));
      return {pages, outerBottom};
    } finally { doc.free(); }
  };
  const zeroResult = read({top: 0, bottom: 0}), zero = zeroResult.pages;
  assert.equal(zero.length, 3);
  // The continuation starts at physical page 2. A 100-HU outer-cell pad and
  // 100-HU nested-cell pad precede LEAD_0; child outer top belongs between them.
  const firstLine = page => page.runs.find(run => run.text === 'LEAD_0');
  assert.equal(firstLine(zero[1]).y, Math.round(200 * 96 / 7200 * 10) / 10);
  for (const {top, bottom} of [{top: 120, bottom: 270}, {top: 330, bottom: 540}]) {
    const actualResult = read({top, bottom}), actual = actualResult.pages;
    assert.equal(actual.length, 3);
    assert.deepEqual(actual[1].runs.map(run => run.text), zero[1].runs.map(run => run.text));
    const dy = top * 96 / 7200;
    for (const [index, run] of actual[1].runs.entries()) {
      const original = zero[1].runs[index];
      assert.ok(Math.abs(run.y - original.y - dy) < 1e-8, 'Each visible continuation run owns one source outer-top margin');
      assert.deepEqual({...run, y: original.y}, original, 'Only vertical origin changes; source owner and horizontal positions remain exact');
    }
    assert.deepEqual(actual[2].runs, zero[2].runs, 'The terminal text does not borrow the previous fragment top margin');
    assert.ok(Math.abs(actualResult.outerBottom - zeroResult.outerBottom - bottom * 96 / 7200) < 1e-8,
      'The final enclosing frame reserves the source child bottom margin exactly once');
    assert.equal(actual[0].runs.find(run => run.text === 'OUTER_HEADER').y,
      zero[0].runs.find(run => run.text === 'OUTER_HEADER').y, 'Child margin cannot move the enclosing header');
  }
  for (const options of [{successorDelta: 1}, {offset: 1}]) {
    assert.equal(firstLine(read(options).pages[1]).y, firstLine(zero[1]).y,
      'An unsupported child cannot borrow a saved continuation margin');
  }
});

// Only the externally supplied, CI-pinned reference is used here. Private
// development candidates and their SVG receipts are not public test inputs.
for (const [name, options] of inlineVariants.slice(1)) {
  test(`stored forward tail: unsupported ${name} retains independent ordinary reflow`, {skip: referenceSkip}, async () => {
    const actual = await candidate(), expected = await reference();
    assert.notEqual(actual.wasmSha256, expected.wasmSha256, 'The reference must be an independently built engine');
    const bytes = forwardTailInlineFixture(options);
    const left = verifyLifecycle(actual.module, bytes), right = verifyLifecycle(expected.module, bytes);
    assert.deepEqual(left, right);
  });
}
for (const [name, options] of multipageVariants.slice(2)) {
  test(`stored forward tail: multipage ${name} retains independent reflow after editing`, {skip: referenceSkip}, async () => {
    const actual = await candidate(), expected = await reference();
    assert.notEqual(actual.wasmSha256, expected.wasmSha256);
    const bytes = multiPageTailFixture(options);
    const left = verifyLifecycle(actual.module, bytes, {multipage: true});
    const right = verifyLifecycle(expected.module, bytes, {multipage: true});
    // A short row minimum does not invalidate the independent forward-tail
    // source witness. The reference lacks that fix, so only its ordinary
    // edited flow is a comparator. Inexact closure is wholly unsupported.
    assert.deepEqual(left.edited, right.edited);
    if (options.successorDelta) assert.deepEqual(left.before, right.before);
  });
}
test('stored forward tail: independent reference reproduces early tail consumption', {skip: referenceSkip}, async () => {
  const actual = await candidate(), expected = await reference();
  assert.notEqual(actual.wasmSha256, expected.wasmSha256);
  const bytes = forwardTailInlineFixture();
  const left = new actual.module.HwpDocument(bytes), right = new expected.module.HwpDocument(bytes);
  try {
    assert.equal(sourceText(left), sourceText(right));
    const before = capture(right), after = capture(left);
    assert.equal(owner(before, 'INLINE_A'), owner(before, 'ROW_0_0'), 'The independent baseline reproduces the defect');
    assertForwardOwners(after);
    editInline(left, after);
    editInline(right, before);
    assert.deepEqual(capture(left), capture(right), 'Deep edits invalidate saved frame authority in both engines');
  } finally { left.free(); right.free(); }
});
test('stored forward tail: validated source history survives edits and rejects unrelated metadata (21 checks)', {skip: coreSkip}, async () => {
  const {module} = await candidate();
  const report = await verifySourceHistory(module);
  assert.equal(report.checks.length, 21, 'All history lifecycle, isolation, inverse-edit and malformed-metadata checks execute');
});

for (const [name, script, count] of [
  ['source closure and metadata', 'stored-nested-forward-tail-source.mjs', 135],
  ['direct and recursive cursor ownership', 'stored-nested-forward-tail-consumer.mjs', 18],
  ['physical frame projection', 'stored-nested-forward-tail-physical.mjs', 26],
  ['resumed child outer margin ownership', 'stored-nested-forward-tail-margin-owner.mjs', 21],
]) {
  test(`stored forward tail: extracted ${name} contract (${count} Rust cases)`,
    {skip: !process.env.PWH_ENGINE_SOURCE ? 'Requires explicit source root' : false, timeout: 120000}, async () => {
      const file = fileURLToPath(new URL('./engine-source-ownership/' + script, import.meta.url));
      const {stdout} = await promisify(execFile)(process.execPath, [file, process.env.PWH_ENGINE_SOURCE],
        {windowsHide: true, env: process.env, maxBuffer: 2 * 1024 * 1024});
      assert.match(stdout, new RegExp(`test result: ok\\. ${count} passed; 0 failed;`));
    });
}
