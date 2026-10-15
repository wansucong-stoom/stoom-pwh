import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { prepareRenderFonts } from '../src/render-fonts.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pwh-render-fonts-'));
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const work = path.join(root, 'work'); await fs.mkdir(work);
  // Synthetic headers, never proprietary font bytes.
  const font = async (folder, name, marker) => {
    const file = path.join(root, folder, name); await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.concat([Buffer.from('00010000', 'hex'), Buffer.from(marker)])); return file;
  };
  return { root, work, font };
}

test('explicit font files exclude broad discovery and retain distinct same-basename fonts', async t => {
  const w = await fixture(t);
  const regular = await w.font('regular', 'font.ttf', 'regular'), bold = await w.font('bold', 'font.ttf', 'bold');
  const unselected = await w.font('other', 'light.ttf', 'unselected');
  const selected = await prepareRenderFonts({renderFontFiles:[regular,bold],fontPaths:[path.dirname(unselected)]}, w.work);
  assert.equal(selected.diagnostics.mode, 'explicit-files');
  assert.deepEqual(selected.args, ['--font-path',path.join(w.work, 'render-fonts')]);
  const staged = await fs.readdir(selected.args[1]); assert.equal(staged.length,2);
  for (const face of selected.diagnostics.files) {
    const bytes = await fs.readFile(face.path);
    assert.equal(face.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(await fs.readFile(path.join(selected.args[1],face.sha256+'.ttf')),bytes);
  }
  assert.equal(selected.diagnostics.exactFaceSelectionVerified,false);
  assert.ok(selected.diagnostics.requiresVisualReview);
});

test('missing or invalid explicit fonts fail instead of silently using fallback paths', async t => {
  const w=await fixture(t);
  await assert.rejects(prepareRenderFonts({renderFontFiles:[path.join(w.root,'missing.ttf')]},w.work), /ENOENT/);
  const invalid=path.join(w.root,'bad.ttf');await fs.writeFile(invalid,'not a font');
  await assert.rejects(prepareRenderFonts({renderFontFiles:[invalid]},w.work),/signature/);
  await assert.rejects(prepareRenderFonts({renderFontFiles:[invalid+'.woff2']},w.work),/Unsupported/);
});

test('discovery mode remains compatible and reports its font-matching limitation', async () => {
  const result=await prepareRenderFonts({fontPaths:['a','b']},'unused');
  assert.deepEqual(result.args,['--font-path','a','--font-path','b']);
  assert.equal(result.diagnostics.mode,'search-paths');
  assert.ok(result.diagnostics.warnings.length);
});
