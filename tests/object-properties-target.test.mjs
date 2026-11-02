import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTablePropertiesTarget} from '../src/object-properties-target.mjs';

test('table object address wins over an unrelated body caret', () => {
  const target = resolveTablePropertiesTarget({
    isInTableObjectSelection: () => true,
    getSelectedTableRef: () => ({sec: 2, ppi: 6, ci: 3}),
    getCursorPosition: () => ({sectionIndex: 0, paragraphIndex: 0}),
  });
  assert.deepEqual(target, {tableCtx: {sec: 2, ppi: 6, ci: 3}, cellIdx: 0, mode: 'table'});
});

test('a caret or cell block opens properties for its owning table', () => {
  const input = {
    isInTableObjectSelection: () => false,
    getCellTableContext: () => ({sec: 1, ppi: 5, ci: 2}),
    getCursorPosition: () => ({sectionIndex: 1, parentParaIndex: 5, controlIndex: 2, cellIndex: 4}),
  };
  assert.deepEqual(resolveTablePropertiesTarget(input), {tableCtx: {sec: 1, ppi: 5, ci: 2}, cellIdx: 4, mode: 'table'});
  assert.equal(resolveTablePropertiesTarget(input, 'cell').mode, 'cell');
});

test('nested selection and caret never degrade to the outer flat address', () => {
  const cellPath = [{controlIndex: 2, cellIndex: 0, cellParaIndex: 1}, {controlIndex: 0, cellIndex: 3, cellParaIndex: 0}];
  for (const selected of [true, false]) {
    const ref = {sec: 0, ppi: 2, ci: 2, cellPath};
    assert.deepEqual(resolveTablePropertiesTarget({
      isInTableObjectSelection: () => selected,
      getSelectedTableRef: () => ref,
      getCellTableContext: () => ref,
      getCursorPosition: () => ({cellIndex: 3, cellPath}),
    }), {unsupported: 'nested-table'});
  }
});

test('unavailable or malformed table references cannot open a dialog', () => {
  assert.equal(resolveTablePropertiesTarget(null), null);
  assert.equal(resolveTablePropertiesTarget({getCursorPosition: () => ({})}), null);
  assert.equal(resolveTablePropertiesTarget({
    isInTableObjectSelection: () => true,
    getSelectedTableRef: () => ({sec: 0, ppi: undefined, ci: 0}),
  }), null);
});
