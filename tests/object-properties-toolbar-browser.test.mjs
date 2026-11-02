import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {clientViewerHtml, registerClientDocument} from '../src/client-assets.mjs';
import {handleRequest} from '../src/server.mjs';
import {mapHwpxMember} from './engine-source-ownership/hwpx-fixture-utils.mjs';

const enabled = process.env.PWH_BROWSER_TESTS === '1';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64');
const ok = result => { const value = JSON.parse(result); assert.equal(value.ok, true, JSON.stringify(value)); return value; };

async function fixture(HwpDocument) {
  const doc = HwpDocument.createEmpty(); doc.createBlankDocument();
  try {
    const outer = ok(doc.createTable(0, 0, 0, 2, 2));
    ok(doc.setTableProperties(0, 0, outer.controlIdx, JSON.stringify({treatAsChar: true})));
    for (let cell = 0; cell < 4; cell++) ok(doc.setCellProperties(0, 0, outer.controlIdx, cell, JSON.stringify({height: 10000})));
    ok(doc.insertTextInCell(0, outer.paraIdx, outer.controlIdx, 1, 0, 0, 'Cell target word'));
    ok(doc.insertParagraph(0, 1));
    const inner = ok(doc.createTable(0, 1, 0, 1, 1));
    ok(doc.setTableProperties(0, 1, inner.controlIdx, JSON.stringify({treatAsChar: true})));
    ok(doc.setCellProperties(0, 1, inner.controlIdx, 0, JSON.stringify({height: 7500})));
    ok(doc.insertTextInCell(0, 1, inner.controlIdx, 0, 0, 0, 'Nested target'));
    ok(doc.copyControl(0, 1, '[]', inner.controlIdx));
    ok(doc.deleteTableControl(0, 1, inner.controlIdx));
    ok(doc.pasteInternalInCell(0, 0, outer.controlIdx, 0, 0, 0));
    for (const [description, width] of [['cell picture', 6000], ['nested picture', 4500]]) {
      const picture = ok(doc.insertPicture(0, 1, 0, '[]', png, width, 4500, 1, 1, 'png', description));
      ok(doc.setPictureProperties(0, 1, picture.controlIdx, JSON.stringify({treatAsChar: true})));
    }
    const rootPicture = ok(doc.insertPicture(0, 1, 0, '[]', png, 9000, 4500, 1, 1, 'png', 'body picture'));
    ok(doc.setPictureProperties(0, 1, rootPicture.controlIdx, JSON.stringify({treatAsChar: true})));
    ok(doc.insertParagraph(0, 2)); ok(doc.insertText(0, 2, 0, 'Plain body word'));
    // The insertion API deliberately creates floating body siblings for a cell
    // placement. Build true inline-cell pictures as synthetic XML fixtures so
    // this regression exercises the older saved-document property paths too.
    const bytes = mapHwpxMember(doc.exportHwpx(), 'Contents/section0.xml', xml => {
      for (const [description, marker] of [['cell picture', 'Cell target word'], ['nested picture', 'Nested target']]) {
        const picture = [...xml.matchAll(/<hp:pic\b[\s\S]*?<\/hp:pic>/g)].map(match => match[0]).find(tag => tag.includes(`<hp:shapeComment>${description}</hp:shapeComment>`));
        assert.ok(picture); xml = xml.replace(picture, '');
        const text = `<hp:t>${marker}</hp:t>`; assert.equal(xml.split(text).length, 2);
        xml = xml.replace(text, picture + text);
      }
      return xml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, '');
    });
    return {bytes, outer};
  } finally { doc.free(); }
}

async function commonServer(file) {
  const registered = await registerClientDocument(file), html = await clientViewerHtml();
  const server = createServer(async (req, res) => { try {
    if (req.url === '/editor') { res.setHeader('content-type', 'text/html'); return res.end(html); }
    if (req.url === '/rpc') { let body = ''; for await (const part of req) body += part; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(await handleRequest(JSON.parse(body)))); }
    res.setHeader('content-type', 'text/html'); res.end(`<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe id="editor" src="/editor"></iframe><script>addEventListener('message',async e=>{const m=e.data;if(m?.jsonrpc!=='2.0')return;if(m.method==='ui/notifications/initialized'){e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(registered)}}},location.origin);return;}if(m.id===undefined)return;const r=m.method==='ui/initialize'?{jsonrpc:'2.0',id:m.id,result:{hostCapabilities:{}}}:await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();e.source.postMessage(r,location.origin);});</script>`);
  } catch (error) { res.statusCode = 500; res.end(String(error.stack)); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, url: `http://127.0.0.1:${server.address().port}`};
}

for (const host of ['common', 'desktop']) {
  test(`${host}: actual object-properties toolbar clicks preserve table and picture owners`, {
    skip: !enabled || (host === 'desktop' && !process.env.PWH_DESKTOP_SOURCE_ROOT) ? 'Set browser, WASM and Desktop source paths' : false,
    timeout: 180000,
  }, async () => {
    const {chromium} = await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
    const {default: init, HwpDocument} = await import(pathToFileURL(process.env.PWH_CORE_JS));
    await init({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-object-toolbar-')), file = path.join(dir, 'synthetic.hwpx');
    const data = await fixture(HwpDocument); await fs.writeFile(file, data.bytes);
    process.env.PWH_STANDALONE_DATA = path.join(dir, 'profile');
    const app = host === 'desktop'
      ? await (await import(pathToFileURL(path.join(process.env.PWH_DESKTOP_SOURCE_ROOT, 'host.mjs')))).createAppServer({initialPath: file})
      : await commonServer(file);
    const browser = await chromium.launch({headless: true, ...(process.env.PWH_BROWSER_EXECUTABLE ? {executablePath: process.env.PWH_BROWSER_EXECUTABLE} : {})});
    try {
      const page = await browser.newPage({viewport: {width: 1300, height: 1000}}), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(app.url);
      const frame = page.frames().find(item => /\/editor(?:\?|$)/.test(item.url()));
      await frame.waitForFunction(() => window.pwhRecoveryReady?.() === true, null, {timeout: 90000});
      const button = frame.locator('button[data-cmd="format:object-properties"]');
      const outerBox = await page.locator('#editor').boundingBox();
      const click = point => page.mouse.click(outerBox.x + point.x, outerBox.y + point.y);
      const points = await frame.evaluate(() => {
        const images = new Map(); let cell, body, table;
        const zoom = window.rhwpStudio.plugins.deps.getInputHandler().viewportManager.getZoom();
        for (let y = 150; y < 930; y += 4) for (let x = 90; x < 1240; x += 4) {
          if (!document.elementFromPoint(x, y)?.closest('#scroll-content')) continue;
          const hit = window.rhwpStudio.collaboration.hitTest({clientX: x, clientY: y}), p = hit.position, r = p?.cursorRect;
          for (const c of hit.objectCandidates || []) {
            if (c.type === 'image' && hit.x > c.x + 5 && hit.x < c.x + c.w - 5 && hit.y > c.y + 5 && hit.y < c.y + c.h - 5) images.set([c.x, c.y, c.w, c.h].join(','), {x, y});
            if (!table && c.type === 'table' && !c.cellPath?.length) table = {left: x + (c.x - hit.x) * zoom, top: y + (c.y - hit.y) * zoom, width: c.w * zoom, height: c.h * zoom};
          }
          if (r && hit.y >= r.y && hit.y < r.y + r.height && p.charOffset === 2) {
            if (!cell && p.parentParaIndex !== undefined && p.cellIndex === 1 && (p.cellPath?.length || 1) === 1) cell = {x, y};
            if (!body && p.parentParaIndex === undefined && p.paragraphIndex === 2) body = {x, y};
          }
        }
        return {images: [...images.values()], cell, body, table};
      });
      if (process.env.PWH_OBJECT_DEBUG) console.log(host, JSON.stringify(points));
      if (process.env.PWH_OBJECT_SCREENSHOTS) await page.screenshot({path: path.join(process.env.PWH_OBJECT_SCREENSHOTS, host + '.png')});
      assert.ok(points.body); assert.ok(points.cell); assert.ok(points.table); assert.ok(points.images.length >= 2, 'picture hit targets are visible');
      await click(points.body); assert.equal(await button.isEnabled(), false, 'plain body has no object properties');
      await click(points.cell); assert.equal(await button.isEnabled(), true, 'cell caret enables table properties');
      await button.click(); await frame.locator('.tcp-dialog').waitFor({state: 'visible'});
      assert.equal(await frame.locator('.tcp-dialog [data-tab="basic"]').first().isVisible(), true);
      await frame.locator('.tcp-dialog .dialog-close').click();
      assert.equal(await frame.getByRole('textbox', {name: '문서 편집 입력'}).evaluate(el => document.activeElement === el), true, 'closing returns editing focus');

      let selectedTable = false;
      for (const dx of [-6, -4, -2, 0, 2]) {
        await click({x: points.table.left + dx, y: points.table.top + points.table.height / 2});
        selectedTable = await frame.evaluate(() => window.rhwpStudio.plugins.deps.getInputHandler().isInTableObjectSelection());
        if (selectedTable) break;
      }
      assert.equal(selectedTable, true); await button.click(); await frame.locator('.tcp-dialog').waitFor({state: 'visible'});
      await frame.locator('.tcp-dialog .dialog-close').click();

      const depths = []; let nestedRef;
      // A saved body picture is selected directly for its independent toolbar
      // address test; the cell pictures above use actual canvas mouse targets.
      for (const point of [...points.images, {bodyPicture: true}]) {
        await page.keyboard.press('Escape');
        if (point.bodyPicture) await frame.evaluate(() => {
          const ih = window.rhwpStudio.plugins.deps.getInputHandler();
          ih.cursor.enterPictureObjectSelectionDirect(0, 1, 0, 'image');
          ih.eventBus.emit('picture-object-selection-changed', true); ih.eventBus.emit('command-state-changed');
        });
        else await click(point);
        const ref = await frame.evaluate(() => window.rhwpStudio.plugins.deps.getInputHandler().getSelectedPictureRef());
        if (process.env.PWH_OBJECT_DEBUG) console.log(host, 'picture ref', JSON.stringify(ref));
        assert.ok(ref, 'real click selected the picture');
        const depth = ref.cellPath?.length || (ref.cellIdx === undefined ? 0 : 1); depths.push(depth);
        if (depth === 2) nestedRef = ref;
        await frame.evaluate(() => {
          window.__pwhObjectReads = [];
          const w = window.rhwpStudio.plugins.deps.wasm;
          for (const name of ['getPictureProperties', 'getCellPicturePropertiesByPath', 'getHeaderFooterPictureProperties']) {
            if (w[name].__pwhObserved) continue;
            const original = w[name].bind(w), observed = (...args) => { window.__pwhObjectReads.push({name, args}); return original(...args); };
            observed.__pwhObserved = true; w[name] = observed;
          }
        });
        assert.equal(await button.isEnabled(), true); await button.click(); await frame.locator('.pp-dialog').waitFor({state: 'visible'});
        const reads = await frame.evaluate(() => window.__pwhObjectReads);
        const read = reads.find(item => item.name === (depth ? 'getCellPicturePropertiesByPath' : 'getPictureProperties'));
        assert.ok(read, `picture depth ${depth} uses the correct getter`);
        assert.deepEqual(read.args.slice(0, 2), [ref.sec, ref.ppi]);
        if (depth) {
          const pathRef = ref.cellPath || [{controlIdx: ref.outerTableControlIdx, cellIdx: ref.cellIdx, cellParaIdx: ref.cellParaIdx}];
          assert.deepEqual(read.args[2], pathRef); assert.equal(read.args[3], ref.ci);
        } else assert.equal(read.args[2], ref.ci);
        if (depth === 2) {
          const before = await frame.evaluate(ref => window.rhwpStudio.plugins.deps.wasm.getCellPicturePropertiesByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci), ref);
          await frame.locator('.pp-dialog input[type="number"]').first().fill('18.0');
          await frame.locator('.pp-dialog .dialog-btn-primary').click();
          assert.notEqual(await frame.evaluate(ref => window.rhwpStudio.plugins.deps.wasm.getCellPicturePropertiesByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci).width, ref), before.width, 'nested picture properties apply to the selected path');
          assert.equal(await frame.evaluate(ci => window.rhwpStudio.plugins.deps.wasm.getCellPicturePropertiesByPath(0, 0, [{controlIndex: ci, cellIndex: 1, cellParaIndex: 0}], 0).width, data.outer.controlIdx), 6000, 'the neighbouring cell picture is unchanged');
          await frame.getByRole('textbox', {name: '문서 편집 입력'}).focus(); await page.keyboard.press('Control+z');
          assert.equal(await frame.evaluate(ref => window.rhwpStudio.plugins.deps.wasm.getCellPicturePropertiesByPath(ref.sec, ref.ppi, ref.cellPath, ref.ci).width, ref), before.width, 'one undo restores the nested picture width');
        } else await frame.locator('.pp-dialog .dialog-close').click();
      }
      assert.deepEqual(depths.sort(), [0, 1, 2]);
      assert.ok(nestedRef);
      await frame.evaluate(ref => {
        const ih = window.rhwpStudio.plugins.deps.getInputHandler();
        ih.cursor.exitPictureObjectSelection();
        ih.cursor.enterTableObjectSelectionDirect(ref.sec, ref.ppi, ref.cellPath[0].controlIndex, ref.cellPath);
        ih.eventBus.emit('table-object-selection-changed', true); ih.eventBus.emit('command-state-changed');
      }, nestedRef);
      await button.click();
      await frame.getByRole('status').filter({hasText: '중첩 표의 전체 속성 대화상자는 아직 지원하지 않습니다'}).waitFor({state: 'visible'});
      assert.equal(await frame.locator('.tcp-dialog').count(), 0, 'nested table does not open the outer flat dialog');
      const after = await frame.evaluate(() => Array.from(window.pwhEditor.export().bytes));
      const reopened = new HwpDocument(Uint8Array.from(after)), original = new HwpDocument(data.bytes);
      try { assert.deepEqual(JSON.parse(reopened.getTableProperties(0, data.outer.paraIdx, data.outer.controlIdx)), JSON.parse(original.getTableProperties(0, data.outer.paraIdx, data.outer.controlIdx))); }
      finally { reopened.free(); original.free(); }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));
      await fs.rm(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }
  });
}
