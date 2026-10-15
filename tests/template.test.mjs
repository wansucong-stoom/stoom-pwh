import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {findPython, makeHwpxFixture, testTempDirectory} from './helpers/hwpx-fixture.mjs';

const python = await findPython();
const scratch = await testTempDirectory('pwh-template-test-');
after(() => fs.rm(scratch, {recursive: true, force: true}));
process.env.PWH_PYTHON_PATH = process.env.HWPXYZ_PYTHON_PATH = python;
process.env.PWH_OUTPUT_ROOT = process.env.HWPXYZ_OUTPUT_ROOT = path.join(scratch, 'analysis');
const {inspectTemplate} = await import('../src/template.mjs');
const sha256 = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex');

test('synthetic template reports typography, nested source paths and merged geometry without rewriting its source', async t => {
  const {source} = await makeHwpxFixture(scratch, python);
  const before = await sha256(source);
  const summary = await inspectTemplate(source);
  assert.equal(summary.sourceSha256, before);
  assert.equal(summary.truncated, false);
  assert.equal(summary.untrustedContent, true);
  for (const [key, value] of Object.entries({sections: 1, charPr: 2, paraPr: 2, namedStyles: 2, tables: 1, cells: 2}))
    assert.equal(summary.summary.counts[key], value, key);
  assert.deepEqual(summary.summary.fontNames, ['Fixture Sans']);
  assert.equal(summary.summary.namedStyles.find(record => record.id === '1').name, 'Fixture Heading');
  assert.equal(summary.summary.sections[0].paragraphs.length, 4);
  assert.ok(summary.summary.sections[0].paragraphs.every(paragraph => paragraph.text.length <= 120));
  assert.ok(summary.summary.counts.savedLineSegments >= 7);
  assert.ok(JSON.stringify(summary).length < 30000);
  const cached = JSON.parse(await fs.readFile(summary.analysisPath, 'utf8'));
  assert.equal(cached.sourceSha256, before);
  assert.equal(cached.inspectorScriptSha256, summary.inspectorScriptSha256);
  const page = cached.sections[0].sectionProperties.find(item => item.property.tag === 'secPr').property.children.find(item => item.tag === 'pagePr');
  assert.equal(page.rawAttrs.width, '59528');
  assert.equal(page.children.find(item => item.tag === 'margin').rawAttrs.left, '8504');

  await t.test('format queries preserve font, width, tracking and real reference locations', async () => {
    const selected = await inspectTemplate(source, {detail: 'format', recordType: 'charPr', id: '5'});
    assert.equal(selected.cached, true);
    assert.equal(selected.analysisPath, summary.analysisPath);
    assert.equal(selected.record.height.pt, 11);
    assert.equal(selected.record.resolvedFonts.hangul.face, 'Fixture Sans');
    assert.equal(selected.record.properties.find(node => node.tag === 'ratio').rawAttrs.hangul, '95');
    assert.equal(selected.record.properties.find(node => node.tag === 'spacing').rawAttrs.hangul, '-9');
    assert.ok(selected.usage.referenceCount >= 4);
    assert.ok(selected.usage.sourceExamples.every(item => Number.isInteger(item.topParagraphIndex)));
  });
  await t.test('scoped paragraphs distinguish table anchors, cells and captions', async () => {
    const selected = await inspectTemplate(source, {detail: 'paragraph', sectionIndex: 0, topParagraphIndex: 2});
    const anchor = selected.paragraphs.find(paragraph => paragraph.location === 'body');
    assert.ok(anchor);
    assert.equal(anchor.runs.map(run => run.text).join(''), '', 'table text must not be duplicated in its anchor run');
    const cell = selected.paragraphs.find(paragraph => paragraph.location === 'tableCell');
    assert.ok(cell.tablePath.length > 0);
    assert.ok(cell.savedLineSegments.length > 0);
    assert.ok(selected.paragraphs.some(paragraph => paragraph.location === 'caption'));
    assert.ok(selected.formats.paraPr.some(record => record.id === cell.paraPrIDRef));
    assert.equal(selected.tables[0].cells[1].cellSpan.colSpan, '2');
    assert.equal(selected.tables[0].cells[1].properties.cellSz.rawAttrs.width, '32000');
    assert.ok(selected.paragraphs.every(paragraph => paragraph.sectionIndex === 0 && paragraph.topParagraphIndex === 2));
    const scoped = await inspectTemplate(source, {detail: 'paragraph', sectionIndex: 0, topParagraphIndex: 2, tablePath: cell.tablePath});
    assert.ok(scoped.paragraphs.length > 0);
    assert.ok(scoped.paragraphs.every(paragraph => paragraph.location === 'tableCell'));
  });
  assert.equal(await sha256(source), before);
});

const localTemplate = process.env.PWH_TEMPLATE_TEST_FILE;
test('optional local HWPX integration preserves its original bytes',
  {skip: !localTemplate && 'Set PWH_TEMPLATE_TEST_FILE to an absolute local HWPX path.', timeout: 180000}, async () => {
    assert.ok(path.isAbsolute(localTemplate));
    const before = await sha256(localTemplate);
    const summary = await inspectTemplate(localTemplate);
    assert.equal(summary.sourceSha256, before);
    assert.ok(summary.summary.counts.sections > 0);
    const used = summary.summary.frequentlyUsedCharPr[0];
    if (used) {
      const selected = await inspectTemplate(localTemplate, {detail: 'format', recordType: 'charPr', id: used.id});
      assert.equal(selected.record.id, used.id);
      assert.ok(selected.usage.referenceCount > 0);
    }
    const anchor = summary.summary.sections.flatMap(section => section.paragraphs).find(paragraph => paragraph.hasTable);
    if (anchor) {
      const selected = await inspectTemplate(localTemplate, {detail: 'paragraph', sectionIndex: anchor.sectionIndex, topParagraphIndex: anchor.topParagraphIndex});
      assert.ok(selected.tables.length > 0);
    }
    assert.equal(await sha256(localTemplate), before);
  });
