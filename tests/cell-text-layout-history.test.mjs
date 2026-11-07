import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {emptyCellCaretFixture,emptyCellCaretTwoSectionFixture} from './engine-cursor/empty-cell-fixture.mjs';
import {declaredNestedFixture} from './engine-source-ownership/declared-nested-fixture.mjs';
import {storedInlineFrameFixture} from './engine-source-ownership/stored-inline-frame-fixture.mjs';
import {zipEntries} from '../scripts/setup.mjs';

const skip = !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM ? 'Requires actual core paths' : false;
let corePromise;
const core = () => corePromise ??= (async () => {
  const module = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await module.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  return module;
})();
const ok = value => assert.equal(JSON.parse(value).ok,true);
function state(doc) {
  const xml = zipEntries(Buffer.from(doc.exportHwpx()))
    .filter(e => e.name.endsWith('.xml') || e.name === 'META-INF/rhwp-source-layout-history.json')
    .map(e => [e.name,e.read().toString('utf8')]).sort(([a],[b]) => a.localeCompare(b));
  return {xml,text:doc.getTextFileText(),pages:doc.pageCount(),
    view:Array.from({length:doc.pageCount()},(_,i) => [doc.renderPageSvgWithProfile(i,'print'),doc.getPageTextLayout(i)])};
}
function owner(doc,marker) {
  const run = Array.from({length:doc.pageCount()},(_,i) => JSON.parse(doc.getPageTextLayout(i)).runs).flat().find(r => r.text === marker);
  assert.ok(run?.cellPath?.length,marker);
  return [run.secIdx,run.parentParaIdx,JSON.stringify(run.cellPath)];
}
const fixtures = [
  {name:'flat cell with following paragraphs',bytes:() => emptyCellCaretFixture({paragraphs:12,rightParagraphs:4}),marker:'RIGHT_0_END'},
  {name:'nested cell',bytes:() => declaredNestedFixture({inlineInner:true,objectFirst:true}),marker:'INNER_0'},
  {name:'stored mixed inline table host',bytes:() => storedInlineFrameFixture(),marker:'TITLE'},
  {name:'two sections',bytes:emptyCellCaretTwoSectionFixture,marker:'LEFT_0'},
];
const edits = {
  insert: (doc,args) => ok(doc.insertTextInCellByPath(...args,2,'한😀Z'.repeat(45))),
  delete: (doc,args) => ok(doc.deleteTextInCellByPath(...args,1,2)),
  overwrite: (doc,args) => {
    ok(doc.deleteTextInCellByPath(...args,2,1));
    ok(doc.insertTextInCellByPath(...args,2,'한'));
  },
};
for (const fixture of fixtures) for (const [edit,apply] of Object.entries(edits)) {
  test(`cell text history restores pre-edit layout: ${fixture.name} / ${edit}`,{skip},async () => {
    const {HwpDocument} = await core(),doc = new HwpDocument(fixture.bytes());
    try {
      assert.equal(typeof doc.captureCellTextFragment,'function','The tested core must include scoped cell checkpoints');
      const args = owner(doc,fixture.marker),before = state(doc),savedBefore = doc.exportHwpx();
      const fragment = doc.captureCellTextFragment(...args);
      apply(doc,args);
      const edited = state(doc);
      assert.notDeepEqual(edited,before,'The exercise must actually change the document');
      ok(doc.restoreDeleteFragment(fragment));
      assert.deepEqual(state(doc),before,'Undo must equal its own pre-edit state, not another inverse edit');
      assert.throws(() => doc.restoreDeleteFragment(fragment),'A successfully restored checkpoint is consumed');
      const reopened = new HwpDocument(doc.exportHwpx()),baseline = new HwpDocument(savedBefore);
      try {assert.deepEqual(state(reopened),state(baseline),'Undo survives save and reopen');}
      finally {reopened.free();baseline.free();}
      // Redo is execution from the restored source, with a fresh checkpoint.
      const again = doc.captureCellTextFragment(...args);
      apply(doc,args);
      assert.deepEqual(state(doc),edited,'Redo restores the edited state');
      ok(doc.restoreDeleteFragment(again));
      assert.deepEqual(state(doc),before,'Second Undo restores the original state');
    } finally {doc.free();}
  });
}
test('cell checkpoints are LIFO, retryable on structural mismatch, and explicitly discardable',{skip},async () => {
  const {HwpDocument} = await core(),doc = new HwpDocument(storedInlineFrameFixture());
  try {
    const args = owner(doc,'TITLE'),before = state(doc),first = doc.captureCellTextFragment(...args);
    ok(doc.insertTextInCellByPath(...args,2,'A'));
    const middle = state(doc),second = doc.captureCellTextFragment(...args);
    ok(doc.insertTextInCellByPath(...args,3,'😀'));
    ok(doc.restoreDeleteFragment(second));assert.deepEqual(state(doc),middle);
    ok(doc.restoreDeleteFragment(first));assert.deepEqual(state(doc),before);
    const discarded = doc.captureCellTextFragment(...args);doc.discardDeleteFragment(discarded);
    assert.throws(() => doc.restoreDeleteFragment(discarded));assert.deepEqual(state(doc),before);
    assert.throws(() => doc.captureCellTextFragment(args[0],args[1],'[]'));
    assert.throws(() => doc.captureCellTextFragment(999,args[1],args[2]));
    assert.deepEqual(state(doc),before,'Failed capture does not mutate the source');
    const checkpoint = doc.captureCellTextFragment(...args),structural = doc.captureDeleteRange(args[0],args[1],args[1]);
    ok(doc.splitParagraphInCellByPath(...args,2));
    const split = state(doc);
    assert.throws(() => doc.restoreDeleteFragment(checkpoint),'Changed paragraph count rejects the narrow checkpoint');
    assert.deepEqual(state(doc),split,'Rejected restore is atomic');
    ok(doc.restoreDeleteFragment(structural));
    ok(doc.restoreDeleteFragment(checkpoint));
    assert.deepEqual(state(doc),before,'Failed restore retained a usable checkpoint');
  } finally {doc.free();}
});
