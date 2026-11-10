import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('cell block W/H and Ctrl+F10 work through trusted input', {
  skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set browser paths':false,
  timeout:90000,
}, async()=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const core=await import(pathToFileURL(process.env.PWH_CORE_JS));
  await core.default({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
  const doc=core.HwpDocument.createEmpty();
  doc.createBlankDocument();
  doc.createTable(0,0,0,2,2);
  const table=JSON.parse(doc.getControls()).find(item=>item.ctrlId==='tbl');
  const sec=0,para=table.para,ctrl=table.controlIndex;
  doc.resizeTableCells(sec,para,ctrl,JSON.stringify([
    {cellIdx:0,widthDelta:600,heightDelta:600},{cellIdx:1,widthDelta:-600,heightDelta:600},
    {cellIdx:2,widthDelta:600,heightDelta:0},{cellIdx:3,widthDelta:-600,heightDelta:0},
  ]));
  const initialBytes=Buffer.from(doc.exportHwpx());
  doc.free();
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-symbols-'));
  process.env.PWH_STANDALONE_DATA=path.join(temp,'data');
  const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  const app=await createAppServer({initialBytes});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.goto(app.url);
    const editor=page.frames().find(frame=>/\/editor\?/.test(frame.url()));
    await editor.waitForFunction(()=>window.pwhRecoveryReady?.()===true,null,{timeout:60000});
    const context={sec,para,ctrl};
    const dims=()=>editor.evaluate(({sec,para,ctrl})=>{
      const d=window.rhwpStudio.plugins.deps.wasm.doc;
      return [0,1,2,3].map(i=>{
        const {width,height}=JSON.parse(d.getCellProperties(sec,para,ctrl,i));
        return {width,height};
      });
    },context);
    const start=await dims();
    assert.notEqual(start[0].width,start[1].width);
    assert.notEqual(start[0].height,start[2].height);
    await editor.evaluate(({sec,para,ctrl})=>{
      const ih=window.rhwpStudio.plugins.deps.getInputHandler();
      ih.cursor.moveTo({sectionIndex:sec,paragraphIndex:para,parentParaIndex:para,
        controlIndex:ctrl,cellIndex:0,cellParaIndex:0,charOffset:0});
      ih.focus();
    },context);
    await page.keyboard.press('F5');
    await page.keyboard.press('F7');
    const range=()=>editor.evaluate(()=>window.rhwpStudio.plugins.deps.getInputHandler().getSelectedCellRange());
    assert.deepEqual(await range(),{startRow:0,endRow:1,startCol:0,endCol:0});
    await page.keyboard.press('F8');
    assert.deepEqual(await range(),{startRow:1,endRow:1,startCol:0,endCol:1});
    await page.keyboard.press('Escape');
    for(let i=0;i<3;i++)await page.keyboard.press('F5');
    await editor.waitForFunction(()=>document.querySelectorAll('.cell-selection-highlight').length===4);
    await page.keyboard.press('w');
    const wide=await dims();
    assert.ok(Math.abs(wide[0].width-wide[1].width)<=1);
    assert.equal(wide[0].width+wide[1].width,start[0].width+start[1].width);
    await page.keyboard.press('h');
    const even=await dims();
    assert.ok(Math.abs(even[0].height-even[2].height)<=1);
    assert.equal(even[0].height+even[2].height,start[0].height+start[2].height);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await dims(),wide);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await dims(),start);

    await page.keyboard.press('Control+F10');
    const symbols=editor.locator('.sym-dialog');
    await symbols.waitFor({state:'visible'});
    await symbols.getByText('라틴 문자-1 보충',{exact:true}).click();
    assert.equal(await symbols.locator('[data-code="0080"]').count(),0);
    assert.ok(await symbols.locator('.sym-char-grid').evaluate(grid=>grid.scrollWidth<=grid.clientWidth+1));
    assert.equal(await symbols.locator('[data-code="00A0"]').textContent(),'␣');
    assert.equal(await symbols.locator('[data-code="00AD"]').textContent(),'◇');
    await symbols.getByText('원문자와 괄호 문자',{exact:true}).click();
    await symbols.locator('[data-code="2460"]').dblclick();
    const read=()=>editor.evaluate(({sec,para,ctrl})=>window.rhwpStudio.plugins.deps.wasm.doc.getTextInCell(sec,para,ctrl,0,0,0,20),context);
    assert.equal(await read(),'①');
    await page.keyboard.press('Escape');
    await page.keyboard.type('wh');
    assert.equal(await read(),'①wh');
    await page.keyboard.press('Control+Tab');
    assert.equal(await read(),'①wh\t');
    await page.keyboard.press('Control+m');
    await page.keyboard.press('r');
    await page.keyboard.type('gu');
    assert.equal(await read(),'①wh\tgu');
    const color=await editor.evaluate(()=>window.rhwpStudio.plugins.deps.getInputHandler().getCharProperties().textColor);
    assert.equal(color.toLowerCase(),'#ff0000');
  }finally{
    await browser.close();
    await new Promise(resolve=>app.server.close(resolve));
  }
});
