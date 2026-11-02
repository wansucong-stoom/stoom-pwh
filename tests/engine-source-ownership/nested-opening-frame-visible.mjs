import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nestedOpeningFrameFixture} from './nested-opening-frame-fixture.mjs';
import {visibleSvgInk} from './visible-svg-ink.mjs';
import {loadCore, markers} from './nested-opening-frame-regression.mjs';

export async function verifyVisibleOpeningFrame({jsPath = process.env.PWH_CORE_JS,
  wasmPath = process.env.PWH_CORE_WASM, fallbackFont = null} = {}) {
  assert.ok(fallbackFont === null || fallbackFont === 'Arial', 'Only the controlled fallback-font fixture is supported');
  const {chromium} = await import(process.env.PWH_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({headless: true,
    ...(process.env.PWH_BROWSER_EXECUTABLE ? {executablePath: process.env.PWH_BROWSER_EXECUTABLE} : {})});
  try {
    const {core, wasmSha256} = await loadCore(jsPath, wasmPath);
    const page = await browser.newPage({viewport: {width: 1400, height: 1100}, deviceScaleFactor: 150 / 96});
    const doc = new core.HwpDocument(nestedOpeningFrameFixture());
    try {
      assert.equal(doc.pageCount(), 2, 'Synthetic content has one opening and one continuation frame');
      const pages = [];
      for (let index = 0; index < doc.pageCount(); index++) {
        let svg = doc.renderPageSvgWithProfile(index, 'print');
        if (fallbackFont) svg = svg.replace(/(<svg\b[^>]*>)/, '$1<style>text{font-family:Arial!important}</style>');
        const visible = await visibleSvgInk(page, svg);
        assert.deepEqual(visible.limitations, [], 'All SVG clips are supported by the independent browser oracle');
        assert.equal(visible.hidden, 0, 'No source text run is fully hidden outside its owned clip');
        assert.equal(visible.partial, 0, 'No text run loses actual ink beyond the fixed 2-pixel edge budget');
        pages.push(visible);
      }
      for (const marker of markers) assert.equal(pages.map(value => value.text).join('').split(marker).length - 1,
        1, `Exactly one actually visible ${marker}`);
      for (const marker of ['OPEN_LABEL', 'OPEN_LINE_A', 'OPEN_LINE_B']) assert.ok(pages[0].text.includes(marker));
      for (const marker of ['NEXT_0', 'NEXT_1', 'NEXT_TAIL']) assert.ok(pages[1].text.includes(marker));
      return {wasmSha256, pages: pages.length, visibleMarkers: markers.length,
        hidden: pages.reduce((sum, value) => sum + value.hidden, 0),
        partial: pages.reduce((sum, value) => sum + value.partial, 0),
        edgeClippedRuns: pages.reduce((sum, value) => sum + value.edgeClippedRuns, 0),
        lostInkPixels: pages.reduce((sum, value) => sum + value.lostInkPixels, 0),
        maxClipDepthPixels: Math.max(...pages.map(value => value.maxClipDepthPixels)),
        dpi: 150, tolerancePixels: 2, fallbackFont};
    } finally { doc.free(); }
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  console.log(JSON.stringify(await verifyVisibleOpeningFrame({jsPath: process.argv[2] || process.env.PWH_CORE_JS,
    wasmPath: process.argv[3] || process.env.PWH_CORE_WASM})));
