import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const FONT_SIGNATURES = new Set(['00010000', '4f54544f', '74746366', '74727565']);

/** Isolate explicitly selected native fonts; never scan broad directories as well.
 * Family/weight resolution remains rhwp's responsibility, not a filename heuristic.
 * The private workspace and its copies are removed by the calling render operation.
 */
export async function prepareRenderFonts(config, workspace) {
  const files = config.renderFontFiles || [];
  if (!files.length) return {
    args: config.fontPaths.flatMap(p => ['--font-path', p]),
    diagnostics: { mode: 'search-paths', paths: config.fontPaths, exactFaceSelectionVerified: false,
      requiresVisualReview: true,
      warnings: ['Automatic font discovery may substitute fonts or select a different family/weight. Inspect actual glyphs, boldness, wrapping and pagination; paths alone do not prove font matching.'] },
  };
  const directory = path.join(workspace, 'render-fonts');
  const faces = [];
  let totalBytes = 0;
  // Validate the complete selection before creating any render input.
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!['.ttf', '.otf', '.ttc'].includes(extension)) throw new Error(`Unsupported render font: ${file}`);
    const stat = await fs.stat(file);
    if (!stat.isFile() || !stat.size || stat.size > 64 * 1024 * 1024) throw new Error(`Invalid render font size/type: ${file}`);
    const bytes = await fs.readFile(file);
    if (bytes.length !== stat.size || (totalBytes += bytes.length) > 256 * 1024 * 1024)
      throw new Error('Render font selection changed or exceeds 256 MiB');
    if (!FONT_SIGNATURES.has(bytes.subarray(0, 4).toString('hex'))) throw new Error(`Invalid native font signature: ${file}`);
    faces.push({ path: file, sha256: digest(bytes), bytes, extension });
  }
  await fs.mkdir(directory);
  const seen = new Set();
  for (const face of faces) {
    // Hash names avoid basename collisions between fonts from different folders.
    if (seen.has(face.sha256)) continue;
    seen.add(face.sha256);
    await fs.writeFile(path.join(directory, face.sha256 + face.extension), face.bytes, { flag: 'wx' });
  }
  return { args: ['--font-path', directory], diagnostics: {
    mode: 'explicit-files', files: faces.map(({ path, sha256 }) => ({ path, sha256 })),
    exactFaceSelectionVerified: false, requiresVisualReview: true,
    warnings: ['Only selected font bytes were supplied. Internal family aliases, weight matching, TTC face selection, missing glyph fallback and Hancom-equivalent pagination are not verified by this selection.'],
  } };
}
