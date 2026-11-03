import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {emptyCellCaretTwoSectionFixture} from './engine-cursor/empty-cell-fixture.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Requires PWH_CORE_JS and PWH_CORE_WASM paths':false;
let corePromise;
const loadCore=()=>corePromise??=(async()=>{
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});return core;
})();

test('table bbox queries keep section ownership even when all local indices match', {skip}, async()=>{
  const core=await loadCore(),doc=new core.HwpDocument(emptyCellCaretTwoSectionFixture());
  try {
    assert.equal(doc.pageCount(),2);
    const before=[doc.renderPageSvg(0),doc.renderPageSvg(1)];
    const path=JSON.stringify([{controlIndex:1,cellIndex:0,cellParaIndex:0}]);
    for(const section of [0,1]) {
      const byPath=JSON.parse(doc.getTableCellBboxesByPath(section,0,path));
      assert.equal(byPath.length,2,'only the requested section supplies cells');
      assert.ok(byPath.every(cell=>cell.pageIndex===section));
      for(const hint of [0,1,3]) {
        const flat=JSON.parse(doc.getTableCellBboxes(section,0,1,hint));
        assert.deepEqual(flat,byPath,'before/after/out-of-range hints cannot borrow foreign cells');
      }
    }
    assert.deepEqual([doc.renderPageSvg(0),doc.renderPageSvg(1)],before,'geometry queries do not alter layout');
  } finally {doc.free();}
});
