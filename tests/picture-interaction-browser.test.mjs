import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {clientViewerHtml, registerClientDocument} from '../src/client-assets.mjs';
import {handleRequest} from '../src/server.mjs';

test('pictures open properties on double click and return a blinking caret to text', {
  skip: process.env.PWH_BROWSER_TESTS !== '1' ? 'Set browser and WASM paths' : false,
  timeout: 120000,
}, async () => {
  const {chromium} = await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
  const {default:init, HwpDocument} = await import(pathToFileURL(process.env.PWH_CORE_JS));
  await init({module_or_path: await fs.readFile(process.env.PWH_CORE_WASM)});
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-picture-mouse-'));
  const filename = path.join(dir, 'picture.hwpx');
  const doc = HwpDocument.createEmpty(); doc.createBlankDocument();
  const ok = result => { const parsed = JSON.parse(result); assert.equal(parsed.ok, true, JSON.stringify(parsed)); return parsed; };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64');
  const picture = ok(doc.insertPicture(0, 0, 0, '[]', png, 9000, 4500, 1, 1, 'png', 'synthetic picture'));
  ok(doc.setPictureProperties(0, 0, picture.controlIdx, JSON.stringify(process.env.PWH_PICTURE_FLOATING === '1'
    ? {treatAsChar: false, horzOffset: 16000, vertOffset: 22000}
    : {treatAsChar: true})));
  ok(doc.insertParagraph(0, 1)); ok(doc.insertText(0, 1, 0, '본문 커서 확인'));
  await fs.writeFile(filename, doc.exportHwpx()); doc.free();
  const registered = await registerClientDocument(filename), html = await clientViewerHtml();
  const server = createServer(async (req, res) => { try {
    if (req.url === '/editor') { res.setHeader('content-type', 'text/html'); return res.end(html); }
    if (req.url === '/rpc') { let body = ''; for await (const part of req) body += part; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(await handleRequest(JSON.parse(body)))); }
    res.setHeader('content-type', 'text/html'); res.end(`<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe src="/editor"></iframe><script>addEventListener('message',async e=>{const m=e.data;if(m?.jsonrpc!=='2.0')return;if(m.method==='ui/notifications/initialized'){e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:${JSON.stringify(registered)}}},location.origin);return;}if(m.id===undefined)return;const r=m.method==='ui/initialize'?{jsonrpc:'2.0',id:m.id,result:{hostCapabilities:{}}}:await(await fetch('/rpc',{method:'POST',body:JSON.stringify(m)})).json();e.source.postMessage(r,location.origin);});</script>`);
  } catch (e) { res.statusCode = 500; res.end(String(e.stack)); }});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless: true, ...(process.env.PWH_BROWSER_EXECUTABLE ? {executablePath: process.env.PWH_BROWSER_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 1150, height: 950}});
    if (process.env.PWH_PICTURE_DEBUG) page.on('console', m => console.log('BROWSER', m.type(), m.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const frame = page.frames().find(f => f.url().endsWith('/editor'));
    await frame.waitForFunction(() => window.pwhRecoveryReady?.() === true, null, {timeout: 60000});
    const box = await page.locator('iframe').boundingBox();
    const points = await frame.evaluate(() => {
      let image, text;
      for (let y = 150; y < 850 && (!image || !text); y += 5) for (let x = 130; x < 1050 && (!image || !text); x += 5) {
        if (!document.elementFromPoint(x, y)?.closest('#scroll-content')) continue;
        const hit = window.rhwpStudio.collaboration.hitTest({clientX: x, clientY: y});
        if (!image && hit.objectCandidates?.some(c => c.type === 'image' && hit.x > c.x + 10 && hit.x < c.x + c.w - 10 && hit.y > c.y + 10 && hit.y < c.y + c.h - 10)) image = {x, y};
        const p = hit.position, r = p?.cursorRect;
        if (!text && p?.paragraphIndex === 1 && p.parentParaIndex === undefined && p.charOffset === 1 && r && hit.y >= r.y && hit.y < r.y + r.height) text = {x, y};
      }
      return {image, text};
    });
    assert.ok(points.image, 'image is visible'); assert.ok(points.text, 'text is visible');
    const click = point => page.mouse.click(box.x + point.x, box.y + point.y);
    await click(points.image);
    assert.equal((await frame.evaluate(() => window.pwhEditor.context())).kind, 'object');
    await click(points.text);
    assert.equal((await frame.evaluate(() => window.pwhEditor.context())).kind, 'body_text');
    const caret = frame.locator('#scroll-content .caret');
    await caret.waitFor({state: 'visible'});
    const firstOpacity = await caret.evaluate(el => getComputedStyle(el).opacity);
    await page.waitForTimeout(550);
    const secondOpacity = await caret.evaluate(el => getComputedStyle(el).opacity);
    assert.notEqual(firstOpacity, secondOpacity, 'caret continues blinking after selecting a picture');
    assert.equal(await frame.locator('textarea[aria-label="문서 편집 입력"]').evaluate(el => document.activeElement === el), true, 'editing input has focus');
    await page.mouse.dblclick(box.x + points.image.x, box.y + points.image.y);
    await frame.locator('.dialog-title').filter({hasText: '개체 속성'}).waitFor({state: 'visible', timeout: 4000});
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, {recursive: true, force: true}); }
});
