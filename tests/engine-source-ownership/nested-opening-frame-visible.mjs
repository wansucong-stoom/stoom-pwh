import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nestedOpeningFrameFixture} from './nested-opening-frame-fixture.mjs';
import {visibleSvgText} from './visible-svg-text.mjs';
import {loadCore, markers} from './nested-opening-frame-regression.mjs';

export async function verifyVisibleOpeningFrame({jsPath = process.env.PWH_CORE_JS,
  wasmPath = process.env.PWH_CORE_WASM} = {}) {
  const {chromium} = await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({headless: true,
    ...(process.env.PWH_BROWSER_EXECUTABLE ? {executablePath: process.env.PWH_BROWSER_EXECUTABLE} : {})});
  try {
    const {core, wasmSha256} = await loadCore(jsPath, wasmPath);
    const page = await browser.newPage({viewport: {width: 1400, height: 1100}});
    const doc = new core.HwpDocument(nestedOpeningFrameFixture());
    try {
      assert.equal(doc.pageCount(), 2, 'Synthetic content has one opening and one continuation frame');
      const pages = [];
      for (let index = 0; index < doc.pageCount(); index++) {
        const visible = await visibleSvgText(page, doc.renderPageSvgWithProfile(index, 'print'));
        assert.deepEqual(visible.limitations, [], 'All SVG clips are supported by the independent browser oracle');
        assert.equal(visible.hidden, 0, 'No glyph is fully hidden outside its owned clip');
        assert.equal(visible.partial, 0, 'No glyph is cut by its owned clip');
        pages.push(visible);
      }
      for (const marker of markers) assert.equal(pages.map(value => value.text).join('').split(marker).length - 1,
        1, `Exactly one actually visible ${marker}`);
      for (const marker of ['OPEN_LABEL', 'OPEN_LINE_A', 'OPEN_LINE_B']) assert.ok(pages[0].text.includes(marker));
      for (const marker of ['NEXT_0', 'NEXT_1', 'NEXT_TAIL']) assert.ok(pages[1].text.includes(marker));
      return {wasmSha256, pages: pages.length, visibleMarkers: markers.length,
        hidden: pages.reduce((sum, value) => sum + value.hidden, 0),
        partial: pages.reduce((sum, value) => sum + value.partial, 0)};
    } finally { doc.free(); }
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  console.log(JSON.stringify(await verifyVisibleOpeningFrame({jsPath: process.argv[2] || process.env.PWH_CORE_JS,
    wasmPath: process.argv[3] || process.env.PWH_CORE_WASM})));
