import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {createServer} from 'node:http';

test('model settings stay inside the AI pane across resizing and while the stop button is visible', {
  skip: process.env.PWH_BROWSER_TESTS !== '1', timeout: 60000,
}, async () => {
  const {chromium} = await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
  const root = new URL('../desktop/standalone-pwh/', import.meta.url);
  const assets = Object.fromEntries(await Promise.all(['app.html', 'app.js', 'app.css', 'stoom-mark.svg', 'stoom.ico'].map(async name => [name, await fs.readFile(new URL(name, root))])));
  const settings = {provider:'chatgpt', localBaseUrl:'http://127.0.0.1:11434/v1', localModel:'', codexModel:'gpt-6.1-sol', codexReasoningEffort:'medium'};
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const send = value => {res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value));};
    if (req.method === 'GET') {
      if (pathname === '/editor') {res.setHeader('content-type', 'text/html'); return res.end('<div id="editor-area"></div>');}
      const name = pathname === '/' ? 'app.html' : pathname.slice(1);
      if (assets[name]) {res.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.ico') ? 'image/x-icon' : 'text/html'); return res.end(assets[name]);}
    }
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body || '{}');
    if (pathname === '/initialize') return send({document:{name:'document.hwpx'}});
    if (pathname === '/settings/read') return send(settings);
    if (pathname === '/settings/write') {Object.assign(settings, input); return send(settings);}
    if (pathname === '/chatgpt/status') return send({active:'test-account', accounts:[{id:'test-account', connected:true}], pending:false, needsWelcome:false});
    if (pathname === '/ai/check') return send({ready:true, models:[{id:'gpt-6.1-sol', name:'GPT-6.1-Sol', reasoningEfforts:['low','medium','high']}]});
    res.statusCode = 404; return send({error:'unexpected request'});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true, ...(process.env.PWH_BROWSER_EXECUTABLE ? {executablePath:process.env.PWH_BROWSER_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1400, height:900}});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const defaultPane=await page.locator('#ai-pane').boundingBox();
    assert.ok(defaultPane.width / 1400 > .18 && defaultPane.width / 1400 < .21, 'the existing narrow default AI pane is preserved');
    await page.locator('#composer-model').click();
    await page.locator('#quick-model').selectOption('gpt-6.1-sol');
    const panel = page.locator('.model-panel'), pane = page.locator('#ai-pane');
    for (const scenario of [
      {viewport:{width:1400,height:900}, width:240, stop:true},
      {viewport:{width:1400,height:900}, width:300, stop:false},
      {viewport:{width:1400,height:900}, width:450, stop:true},
      {viewport:{width:700,height:500}, width:200, stop:true},
      {viewport:{width:700,height:320}, width:200, stop:true},
      {viewport:{width:700,height:500}, width:320, stop:false},
      {viewport:{width:700,height:320}, width:160, stop:true},
    ]) {
      await page.setViewportSize(scenario.viewport);
      await page.evaluate(({width,stop}) => {
        document.querySelector('main').style.setProperty('--chat-width', `${width}px`);
        document.querySelector('#stop').hidden = !stop;
      }, scenario);
      const box = await panel.boundingBox(), area = await pane.boundingBox();
      assert.ok(box.x >= area.x - 1, `model panel extends left of AI pane at ${scenario.width}px: ${box.x} < ${area.x}`);
      assert.ok(box.x + box.width <= area.x + area.width + 1, `model panel extends right of AI pane at ${scenario.width}px`);
      assert.ok(box.y >= 0 && box.y + box.height <= scenario.viewport.height, `model panel extends outside viewport at ${scenario.viewport.height}px height`);
    }
    await page.locator('#quick-effort').selectOption('high');
    await page.locator('#quick-apply').scrollIntoViewIfNeeded();
    await page.locator('#quick-apply').click();
    await page.waitForFunction(() => !document.querySelector('#model-menu').open);
    assert.equal(settings.codexReasoningEffort, 'high');
    assert.equal(await page.locator('#model-menu').evaluate(element => element.open), false);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
