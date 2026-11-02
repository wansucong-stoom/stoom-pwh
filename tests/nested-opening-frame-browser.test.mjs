import test from 'node:test';
import {verifyVisibleOpeningFrame} from './engine-source-ownership/nested-opening-frame-visible.mjs';

test('nested opening frame: actual browser SVG clipping preserves every opening and continuation owner',
  {skip: process.env.PWH_BROWSER_TESTS !== '1' || !process.env.PWH_CORE_JS || !process.env.PWH_CORE_WASM},
  async () => { await verifyVisibleOpeningFrame(); });
