import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('Hancom editing and table shortcuts work through trusted input', {
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
  const bodyPara=doc.getParagraphCount(0);
  doc.insertParagraph(0,bodyPara);
  doc.insertText(0,bodyPara,0,'first second');
  doc.insertParagraph(0,bodyPara+1);
  doc.insertText(0,bodyPara+1,0,'last paragraph');
  const wrapped='abcdefghi '.repeat(33);
  doc.insertParagraph(0,bodyPara+2);
  doc.insertText(0,bodyPara+2,0,wrapped);
  doc.insertParagraph(0,bodyPara+3);
  const inner=JSON.parse(doc.createTable(0,bodyPara+3,0,2,2));
  assert.equal(inner.ok,true);
  assert.equal(JSON.parse(doc.copyControl(0,inner.paraIdx,'[]',inner.controlIdx)).ok,true);
  assert.equal(JSON.parse(doc.deleteTableControl(0,inner.paraIdx,inner.controlIdx)).ok,true);
  assert.equal(JSON.parse(doc.pasteInternalInCell(sec,para,ctrl,1,0,0)).ok,true);
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

    await page.keyboard.press('F5');
    await page.keyboard.press('p');
    await editor.locator('.tcp-dialog').waitFor({state:'visible'});
    await editor.locator('.tcp-dialog .dialog-close').click();
    if (!(await range())) await page.keyboard.press('F5');
    await page.keyboard.press('c');
    await editor.locator('.dialog-tab.active[data-tab="background"]').waitFor({state:'visible'});
    await editor.locator('.dialog-close:visible').click();
    if (!(await range())) await page.keyboard.press('F5');
    const fixedBefore=await dims();
    await page.keyboard.press('Alt+ArrowRight');
    const fixedAfter=await dims();
    assert.ok(fixedAfter[0].width>fixedBefore[0].width);
    assert.equal(fixedAfter[0].width+fixedAfter[1].width,fixedBefore[0].width+fixedBefore[1].width);
    assert.equal(fixedAfter[2].width+fixedAfter[3].width,fixedBefore[2].width+fixedBefore[3].width);
    await page.keyboard.press('Alt+ArrowDown');
    const fixedHeight=await dims();
    assert.ok(fixedHeight[0].height>fixedAfter[0].height);
    assert.equal(fixedHeight[0].height+fixedHeight[2].height,fixedBefore[0].height+fixedBefore[2].height);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await dims(),start);
    if (await range()) await page.keyboard.press('Escape');

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

    const position=()=>editor.evaluate(()=>window.rhwpStudio.plugins.deps.getInputHandler().getCursorPosition());
    await page.keyboard.press('Alt+ArrowDown');
    assert.equal((await position()).cellIndex,2);
    assert.equal(await range(),null);
    await page.keyboard.press('F5');
    await page.keyboard.press('Control+Backspace');
    const rowCount=()=>editor.evaluate(({sec,para,ctrl})=>
      window.rhwpStudio.plugins.deps.wasm.getTableDimensions(sec,para,ctrl).rowCount,context);
    assert.equal(await rowCount(),1);
    await page.keyboard.press('Control+z');
    assert.equal(await rowCount(),2);
    await page.keyboard.press('Shift+Escape');
    assert.equal((await position()).cellIndex,undefined);

    const moveInBody=(charOffset,paragraphIndex=bodyPara)=>editor.evaluate(({paragraphIndex,charOffset})=>{
      const input=window.rhwpStudio.plugins.deps.getInputHandler();
      input.cursor.clearSelection();
      input.cursor.moveTo({sectionIndex:0,paragraphIndex,charOffset});
      input.focus();
    },{paragraphIndex,charOffset});
    const readBody=(paragraphIndex=bodyPara)=>editor.evaluate(paragraphIndex=>{
      const doc=window.rhwpStudio.plugins.deps.wasm.doc;
      return doc.getTextRange(0,paragraphIndex,0,doc.getParagraphLength(0,paragraphIndex));
    },paragraphIndex);
    const paragraphCount=()=>editor.evaluate(()=>window.rhwpStudio.plugins.deps.wasm.doc.getParagraphCount(0));
    await moveInBody(6);
    await page.keyboard.press('Alt+y');
    assert.equal(await readBody(),'first ');
    await page.keyboard.press('Control+z');
    assert.equal(await readBody(),'first second');
    await moveInBody(6);
    await page.keyboard.press('Control+t');
    assert.equal(await readBody(),'first ');
    await page.keyboard.press('Control+z');
    assert.equal(await readBody(),'first second');
    await moveInBody(3);
    const beforeParagraphs=await paragraphCount();
    await page.keyboard.press('Control+y');
    assert.equal(await readBody(),'last paragraph');
    assert.equal(await paragraphCount(),beforeParagraphs-1);
    await page.keyboard.press('Control+z');
    assert.equal(await readBody(),'first second');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await readBody(),'last paragraph');
    await page.keyboard.press('Control+z');
    await moveInBody(0);
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Alt+Shift+b');
    const character=()=>editor.evaluate(()=>window.rhwpStudio.plugins.deps.getInputHandler().getCharProperties());
    assert.equal((await character()).bold,true);
    await page.keyboard.press('Alt+Shift+c');
    assert.equal((await character()).bold,false);
    assert.equal(await readBody(),'first second');
    await moveInBody(5,bodyPara+2);
    const lineEnd=await editor.evaluate(para=>JSON.parse(
      window.rhwpStudio.plugins.deps.wasm.doc.getLineInfo(0,para,5)).charEnd,bodyPara+2);
    assert.ok(lineEnd>5 && lineEnd<wrapped.length);
    await page.keyboard.press('Control+y');
    assert.equal(await readBody(bodyPara+2),wrapped.slice(lineEnd));
    assert.equal(await paragraphCount(),beforeParagraphs);
    await page.keyboard.press('Control+z');
    assert.equal(await readBody(bodyPara+2),wrapped);
    await page.keyboard.press('Control+PageUp');
    assert.deepEqual([(await position()).paragraphIndex,(await position()).charOffset],[0,0]);
    await page.keyboard.press('Control+PageDown');
    const lastParagraph=(await paragraphCount())-1;
    assert.deepEqual([(await position()).paragraphIndex,(await position()).charOffset],
      [lastParagraph,(await readBody(lastParagraph)).length]);
    const zoom=()=>editor.evaluate(()=>window.rhwpStudio.plugins.deps.getInputHandler().viewportManager.getZoom());
    const startZoom=await zoom();
    await page.keyboard.press('Shift+NumpadAdd');
    await editor.waitForFunction(start=>{
      const viewport=window.rhwpStudio.plugins.deps.getInputHandler().viewportManager;
      return !viewport.isZoomAnimating() && viewport.getZoom()>start;
    },startZoom);
    await page.keyboard.press('Shift+NumpadSubtract');
    await editor.waitForFunction(start=>{
      const viewport=window.rhwpStudio.plugins.deps.getInputHandler().viewportManager;
      return !viewport.isZoomAnimating() && Math.abs(viewport.getZoom()-start)<0.001;
    },startZoom);

    const innerPath=[{controlIndex:ctrl,cellIndex:1,cellParaIndex:0},{controlIndex:0,cellIndex:0,cellParaIndex:0}];
    await editor.evaluate(({sec,para,innerPath})=>{
      const input=window.rhwpStudio.plugins.deps.getInputHandler();
      input.cursor.moveTo({sectionIndex:sec,parentParaIndex:para,paragraphIndex:0,
        charOffset:0,...innerPath.at(-1),cellPath:innerPath});
      input.focus();
    },{...context,innerPath});
    const innerWidths=()=>editor.evaluate(({sec,para,innerPath})=>{
      const bridge=window.rhwpStudio.plugins.deps.wasm;
      return [0,1].map(cell=>bridge.getCellPropertiesByPath(sec,para,JSON.stringify(innerPath),cell).width);
    },{...context,innerPath});
    const innerBefore=await innerWidths();
    const outerBefore=await dims();
    await page.keyboard.press('Control+Enter');
    await page.keyboard.press('Control+Backspace');
    assert.equal(await rowCount(),2);
    assert.deepEqual(await innerWidths(),innerBefore);
    await page.keyboard.press('F5');
    await page.keyboard.press('Alt+ArrowRight');
    const innerAfter=await innerWidths();
    assert.ok(innerAfter[0]>innerBefore[0]);
    assert.equal(innerAfter[0]+innerAfter[1],innerBefore[0]+innerBefore[1]);
    assert.deepEqual(await dims(),outerBefore);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await innerWidths(),innerBefore);
    await page.keyboard.press('Shift+Escape');
    assert.equal((await position()).cellPath.length,1);
    assert.equal((await position()).cellIndex,1);

    await page.keyboard.press('Alt+n');
    const replaceDialog=page.getByRole('dialog',{name:'변경 내용 저장'});
    await replaceDialog.waitFor({state:'visible'});
    await replaceDialog.getByRole('button',{name:'취소',exact:true}).click();
    assert.equal(await readBody(),'first second');
  }finally{
    await browser.close();
    await new Promise(resolve=>app.server.close(resolve));
  }
});
