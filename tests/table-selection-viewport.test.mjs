import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {declaredNestedFixture} from './engine-source-ownership/declared-nested-fixture.mjs';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM
  ? 'Requires explicit PWH_CORE_JS and PWH_CORE_WASM paths' : false;

test('table grid and visible cell boxes retain model identity across split pages', {skip}, async t=>{
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  if (!core.HwpDocument.prototype.getTableCellLayout) {
    t.skip('The installed core predates the viewport table selection API');
    return;
  }
  const doc=new core.HwpDocument(declaredNestedFixture({inlineInner:true,objectFirst:true,innerRows:20,pageHeight:22000}));
  const step=(controlIndex,cellIndex=0,cellParaIndex=0)=>({controlIndex,cellIndex,cellParaIndex});
  try {
    const outer=JSON.parse(doc.getControls()).find(item=>item.ctrlId==='tbl');
    assert.ok(outer);
    const root=step(outer.controlIndex);
    const paths=[[root],[step(root.controlIndex,1),step(0)], [step(root.controlIndex,1),step(0,3,2),step(0)]];
    for(const [index,path] of paths.entries()){
      const query=(page)=>JSON.parse(doc.getTableCellLayout(0,outer.para,JSON.stringify(path),page));
      const grid=query();
      assert.equal(grid.length,[2,4,20][index]);
      assert.deepEqual(grid.map(cell=>cell.cellIdx),Array.from({length:grid.length},(_,i)=>i));
      const pages=Array.from({length:doc.pageCount()},(_,page)=>query(page));
      assert.ok(pages.some(cells=>cells.length>0));
      assert.deepEqual(query(doc.pageCount()),[]);
      for(const [page,cells] of pages.entries()){
        assert.ok(cells.every(cell=>cell.pageIndex===page));
        for(const {cellIdx,row,col,rowSpan,colSpan} of cells){
          assert.deepEqual({cellIdx,row,col,rowSpan,colSpan},grid[cellIdx]);
        }
      }
    }
  }finally{doc.free();}
});
