import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {storedInlineFrameFixture} from './engine-source-ownership/stored-inline-frame-fixture.mjs';

test('split paragraph keyboard caret follows native path geometry after a fresh pointer hit', {
  skip:process.env.PWH_BROWSER_TESTS!=='1'||!process.env.PWH_DESKTOP_SOURCE_ROOT?'Set Desktop and browser paths':false,
  timeout:180000,
}, async()=>{
  const {chromium}=await import(process.env.PWH_PLAYWRIGHT_MODULE||'playwright');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pwh-pointer-hit-'));
  process.env.PWH_STANDALONE_DATA=path.join(temp,'data');
  const {createAppServer}=await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT,'host.mjs')));
  const app=await createAppServer({initialBytes:storedInlineFrameFixture()});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PWH_BROWSER_EXECUTABLE});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:600}});
    await page.goto(app.url);
    const editor=page.frames().find(frame=>/\/editor\?/.test(frame.url()));
    await editor.waitForFunction(()=>window.pwhRecoveryReady?.()===true,null,{timeout:120000});
    const settle=()=>editor.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const initial=await editor.evaluate(()=>{
      const d=window.rhwpStudio.plugins.deps,doc=d.wasm.doc,ih=d.getInputHandler();
      const runs=Array.from({length:doc.pageCount()},(_,pageIndex)=>JSON.parse(doc.getPageTextLayout(pageIndex)).runs.map(run=>({...run,pageIndex}))).flat();
      const line=runs.find(run=>run.pageIndex===1&&run.text===''&&run.cellPath?.length===2&&run.cellPath.at(-1).cellParaIndex===5);
      if(!line)throw Error('Synthetic continuation owner not found');
      const points=[];
      for(const dx of [line.w-20,line.w-15,line.w-10])for(const dy of [line.h/2,line.h*.6]){
        const x=line.x+dx,y=line.y+dy,hit=JSON.parse(doc.hitTest(1,x,y));
        if(hit.charOffset===5&&hit.cellPath?.length===2&&hit.cellPath.at(-1).cellParaIndex===5&&hit.cursorRect.pageIndex===1)points.push({pageIndex:1,x,y});
      }
      window.__pointerHitKeys=[];
      document.addEventListener('keydown',event=>window.__pointerHitKeys.push({key:event.key,trusted:event.isTrusted}),true);
      return{points,text:doc.getTextFileText(),pages:doc.pageCount(),cellPath:line.cellPath};
    });
    assert.equal(initial.pages,2);assert.ok(initial.points.length,'A real native pointer hit must identify the split host paragraph');
    const state=()=>editor.evaluate(()=>{
      const d=window.rhwpStudio.plugins.deps,ih=d.getInputHandler(),position=ih.cursor.getPosition(),rect=ih.cursor.getRect();
      const native=JSON.parse(d.wasm.doc.getCursorRectByPathNear(position.sectionIndex,position.parentParaIndex,JSON.stringify(position.cellPath),position.charOffset,1));
      const caret=[...document.querySelectorAll('.caret')].find(node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().height>0);
      return{position,rect,native,dom:caret?.getBoundingClientRect().toJSON(),zoom:ih.viewportManager.getZoom(),focused:document.activeElement===ih.textarea,selectedTable:ih.getSelectedTableRef()};
    });
    const click=async()=>{
      for(const point of initial.points){
        await editor.evaluate(pos=>{const ih=window.rhwpStudio.plugins.deps.getInputHandler();ih.container.scrollTop=ih.virtualScroll.getPageOffset(pos.pageIndex);},point);await settle();
        const located=await editor.evaluate(pos=>{
          const ih=window.rhwpStudio.plugins.deps.getInputHandler(),sc=document.getElementById('scroll-content'),r=sc.getBoundingClientRect(),zoom=ih.viewportManager.getZoom();
          return{x:r.left+ih.virtualScroll.getPageLeftResolved(pos.pageIndex,sc.clientWidth)+pos.x*zoom,y:r.top+ih.virtualScroll.getPageOffset(pos.pageIndex)+pos.y*zoom};
        },point),box=await page.locator('#editor').boundingBox();
        await page.mouse.move(box.x+located.x,box.y+located.y);await settle();
        const border=await editor.evaluate(pos=>{const ih=window.rhwpStudio.plugins.deps.getInputHandler();return ih.tableResizeRenderer?.hitTestBorder(pos.x,pos.y,(ih.cachedCellBboxes||[]).filter(cell=>cell.pageIndex===pos.pageIndex))||null;},point);
        if(border)continue;
        await page.mouse.click(box.x+located.x,box.y+located.y);await settle();
        const hit=await state();
        // The expanded table-border affordance deliberately owns some former
        // text hit points. Test keyboard caret navigation from a text target;
        // object selection has its own keyboard contract.
        if(hit.selectedTable)continue;
        assert.equal(hit.position.charOffset,5);assert.deepEqual(hit.position.cellPath,initial.cellPath);assert.equal(hit.rect.pageIndex,1);
        return;
      }
      assert.fail('All synthetic host hit points coincided with resize or object-selection borders');
    };
    for(const [key,offset]of [['ArrowLeft',4],['Home',0],['End',0]]){
      await click();await page.keyboard.press(key);await settle();
      const after=await state();
      assert.equal(after.position.charOffset,offset,'Existing logical endpoint is unchanged');
      assert.deepEqual(after.position.cellPath,initial.cellPath);
      assert.equal(after.rect.pageIndex,after.native.pageIndex,key+' uses the native destination page');
      for(const field of ['x','y','height'])assert.ok(Math.abs(after.rect[field]-after.native[field])<.2,key+' uses native '+field);
      assert.ok(after.dom&&Math.abs(after.dom.height-after.rect.height*after.zoom)<1,'Visible DOM caret uses native geometry and zoom');
      assert.ok(after.focused,'Keyboard navigation retains text input focus');
    }
    assert.equal(await editor.evaluate(()=>window.rhwpStudio.plugins.deps.wasm.doc.getTextFileText()),initial.text,'Clicks and navigation do not modify text');
    for(const key of ['ArrowLeft','Home','End'])assert.ok((await editor.evaluate(()=>window.__pointerHitKeys)).some(event=>event.key===key&&event.trusted));
  }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));}
});
