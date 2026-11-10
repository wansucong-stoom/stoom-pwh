import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPrintFontSubstitutions} from '../src/print-font-substitutions.mjs';

test('print substitutes use an exact installed face and skip a rejected target', async () => {
 class TestFontFace {
  constructor(family, source) {
   this.family = family;
   this.source = source;
  }
  async load() {
   if (this.family === 'Missing') throw Error('unavailable');
   this.status = 'loaded';
   return this;
  }
 }
 const record = (family, fullName, postscriptName) => ({
  family, fullName, postscriptName,
  hostReference: {face: {weight: 400, slant: 'normal'}},
 });
 const records = [record('Family', 'Family', 'Family-Regular'), record('Family', 'Family Narrow', 'Family-Narrow')];
 const result = await loadPrintFontSubstitutions({FontFace: TestFontFace}, [
  ['Source', 'Family'], ['Other', 'Missing'],
 ], {
  records,
  resolve: () => null,
  load: () => assert.fail('The exact local face should load directly'),
  normalize: () => assert.fail('No font bytes are needed'),
 });
 assert.deepEqual(result.environment.substitutions, {Source: 'Family'});
 assert.equal(result.faces.length, 1);
 assert.match(result.faces[0].source, /local\("Family-Regular"\)/);
 assert.deepEqual(result.missing, ['Missing']);
});
