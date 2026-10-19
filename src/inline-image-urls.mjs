// Adapt verified preserved Studio code for hosts that block blob: image URLs.
// The engine archive and the HWPX document remain unchanged.
export function pwhEmbeddedImageDataUrl(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || !/^image\/[a-z0-9][a-z0-9.+-]*$/i.test(mime)) return null;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}

export function inlineEditorImageUrls(editor) {
  if (typeof editor !== 'string') throw new TypeError('Inline editor source is required');
  const regions = [...editor.matchAll(/\/\/#region [^\r\n]*\/flow-image-url-cache\.ts\r?\n[\s\S]*?\/\/#endregion/g)];
  if (regions.length !== 1) throw new Error('Unsupported inline image cache; review the preserved Studio bundle');
  const region = regions[0][0];
  const objectUrl = /URL\.createObjectURL\(new Blob\(\[([\w$]+)\],\s*\{\s*type:\s*([\w$]+)\s*\}\)\)/g;
  if ([...region.matchAll(objectUrl)].length !== 1)
    throw new Error('Unsupported inline image URL factory; review the preserved Studio bundle');
  const patched = region.replace(objectUrl, 'pwhEmbeddedImageDataUrl($1, $2)');
  return `// pwh embedded flow images: no object URL dependency in the host sandbox.\n${pwhEmbeddedImageDataUrl.toString()}\n${editor.replace(region, patched)}`;
}
