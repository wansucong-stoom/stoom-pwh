import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, promises as fs} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {findPython, makeHwpxFixture, testTempDirectory, exec, pythonOptions} from './helpers/hwpx-fixture.mjs';

const python = await findPython();
const hash = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex');
const verifyOutput = String.raw`
import json,sys,zipfile,copy,re
from xml.etree import ElementTree as E
report=json.loads(sys.argv[3])
name=lambda e:e.tag.rsplit('}',1)[-1]
with zipfile.ZipFile(sys.argv[1]) as a,zipfile.ZipFile(sys.argv[2]) as b:
 assert a.namelist()==b.namelist()
 actual=[n for n in a.namelist() if a.read(n)!=b.read(n)]
 assert sorted(actual)==report['changedEntries']
 assert set(actual)<=set(['Contents/header.xml','Contents/section0.xml','Preview/PrvText.txt'])
 old_raw,new_raw=a.read('Contents/section0.xml'),b.read('Contents/section0.xml')
 old,new=E.fromstring(old_raw),E.fromstring(new_raw)
 # Independently verify preserved control subtrees, merged grid and cell geometry.
 protected={'secPr','ctrl','cellAddr','cellSpan','cellSz','cellMargin','pos','sz'}
 def normalized(node):
  node=copy.deepcopy(node)
  for parent in node.iter():
   for child in list(parent):
    if name(child)=='linesegarray':parent.remove(child)
  return E.tostring(node)
 snapshot=lambda root:[normalized(n) for n in root.iter() if name(n) in protected]
 assert snapshot(old)==snapshot(new)
 assert old_raw.split(b'>',2)[:2]==new_raw.split(b'>',2)[:2]
 old_header,new_header=a.read('Contents/header.xml'),b.read('Contents/header.xml')
 ah,bh=E.fromstring(old_header),E.fromstring(new_header)
 old_chars={n.get('id'):n for n in ah.iter() if name(n)=='charPr'}
 new_chars={n.get('id'):n for n in bh.iter() if name(n)=='charPr'}
 records=lambda raw:re.findall(br'<hh:charPr\s[^>]*>.*?</hh:charPr>',raw,re.S)
 for record in records(old_header):assert record in records(new_header)
 for clone in report['clonedStyles']:
  base,copied=copy.deepcopy(old_chars[clone['sourceId']]),copy.deepcopy(new_chars[clone['id']])
  assert copied.get('textColor')=='#000000'
  for n in [base,copied]:
   n.attrib.pop('id',None);n.attrib.pop('textColor',None)
   n.tail=None
  assert E.tostring(base)==E.tostring(copied)
 assert int(next(n for n in bh.iter() if name(n)=='charProperties').get('itemCnt'))==len(new_chars)
 assert report['headerChanged']==bool(report['clonedStyles'])
 if not report['headerChanged']:assert old_header==new_header
 print(json.dumps({'changedEntries':actual,'lineSegments':sum(name(n)=='lineseg' for n in new.iter()),
  'text':'\n'.join((n.text or '') for n in new.iter() if name(n)=='t'),
  'oldCharacterStyles':len(old_chars),'newCharacterStyles':len(new_chars)},ensure_ascii=False))
`;

test('synthetic form filling preserves invisible controls, raw styles and merged cells', {timeout: 180000}, async t => {
  const scratch = await testTempDirectory('pwh-fill-test-');
  t.after(() => fs.rm(scratch, {recursive: true, force: true}));
  const fixture = await makeHwpxFixture(scratch, python);
  const {source} = fixture;
  const originalHash = await hash(source);
  async function fill(edits, extra = {}) {
    const output = extra.output || path.join(scratch, `${randomUUID()}.hwpx`);
    const spec = {input: source, output, expectedSourceSha256: originalHash, edits, ...extra};
    const filename = path.join(scratch, `${randomUUID()}.json`);
    await fs.writeFile(filename, JSON.stringify(spec));
    try {
      const result = await exec(python, ['-B', 'scripts/fill_form.py', '--spec', filename], pythonOptions);
      return {code: 0, report: JSON.parse(result.stdout), output};
    } catch (error) {
      if (!error.stdout) throw error;
      return {code: error.code, report: JSON.parse(error.stdout), output};
    }
  }
  async function verify(result) {
    assert.equal(result.code, 0, result.report.error);
    assert.equal(result.report.ok, true);
    assert.deepEqual(result.report.controlCounts.before, result.report.controlCounts.after);
    assert.deepEqual(result.report.protectedControlSha256.before, result.report.protectedControlSha256.after);
    return JSON.parse((await exec(python, ['-B', '-c', verifyOutput, source, result.output, JSON.stringify(result.report)], pythonOptions)).stdout);
  }

  await t.test('multiple paragraphs preserve header bytes, namespace prefixes, geometry and escaped text', async () => {
    const edit = {xmlPath: fixture.cellPath, expectedText: fixture.cellText,
      paragraphs: ['합성 프로그램 계획', '두 번째 문단 & <ctrl> 검증']};
    const result = await fill([edit]);
    const checked = await verify(result);
    assert.equal(result.report.headerChanged, false);
    assert.deepEqual(result.report.changedEntries, ['Contents/section0.xml', 'Preview/PrvText.txt']);
    assert.ok(checked.lineSegments > 0, 'unchanged paragraphs retain saved layout hints');
    assert.ok(checked.text.includes('두 번째 문단 & <ctrl> 검증'));
    const savedHash = await hash(result.output);
    assert.notEqual((await fill([edit], {output: result.output})).code, 0);
    assert.equal(await hash(result.output), savedHash, 'existing output must not be overwritten');
  });

  await t.test('control-containing cells and table-anchor paragraphs are rejected', async () => {
    for (const xmlPath of [fixture.protectedCellPath, fixture.protectedParagraphPath]) {
      const result = await fill([{xmlPath, text: '보호된 부호 유지'}]);
      assert.notEqual(result.code, 0);
      assert.equal(result.report.ok, false);
      assert.match(result.report.error, /protected|control|table|field|shape/i);
      assert.equal(existsSync(result.output), false);
    }
  });

  await t.test('a safe text leaf beside a column control gets an explicit copied black style', async () => {
    const result = await fill([{xmlPath: fixture.leafPath, expectedText: fixture.leafText,
      text: '합성 양식 제목', charPrIDRef: '5', textColor: '#000000'}], {dropSavedLineSegments: true});
    const checked = await verify(result);
    assert.equal(result.report.headerChanged, true);
    assert.equal(result.report.clonedStyles.length, 1);
    assert.equal(result.report.clonedStyles[0].sourceId, '5');
    assert.equal(checked.newCharacterStyles, checked.oldCharacterStyles + 1);
    assert.equal(checked.lineSegments, 0);
    assert.ok(checked.text.includes('합성 양식 제목'));
  });

  await t.test('stale guards, unknown styles, overlapping targets and ambiguous run restyling publish nothing', async () => {
    const edit = {xmlPath: fixture.cellPath, text: '검증'};
    const cases = [
      [[edit], {expectedSourceSha256: '0'.repeat(64)}],
      [[{...edit, expectedText: '원문과 다른 값'}], {}],
      [[{...edit, charPrIDRef: '99999999'}], {}],
      [[edit, edit], {}],
      [[{xmlPath: fixture.multipleTextLeafPath, text: '변경', charPrIDRef: '5'}], {}],
    ];
    for (const [edits, extra] of cases) {
      const result = await fill(edits, extra);
      assert.notEqual(result.code, 0);
      assert.equal(result.report.ok, false);
      assert.equal(existsSync(result.output), false);
    }
  });
  assert.equal(await hash(source), originalHash, 'source remains byte-for-byte unchanged');
});
