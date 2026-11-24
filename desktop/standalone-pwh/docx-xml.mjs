import {zipEntries} from '../release-source/scripts/setup.mjs';

export const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const xmlEscape = value => String(value ?? '').replace(/[&<>"'\x00-\x08\x0b\x0c\x0e-\x1f]/g, character =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[character] ?? ''));
const local = name => name.slice(name.indexOf(':') + 1);
const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'"};

function decode(value) {
  return value.replace(/&([^&;]+);|&/g, (_, entity) => {
    if (Object.hasOwn(entities, entity)) return entities[entity];
    if (/^#(?:x[\da-f]+|\d+)$/i.test(entity ?? '')) {
      const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) return String.fromCodePoint(code);
    }
    throw Error('문서 XML의 문자 참조가 올바르지 않습니다.');
  });
}

export function parseXml(source) {
  if (source.length > 64 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
    throw Error('지원하지 않는 문서 XML입니다.');
  }
  const root = {children:[]}, stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>|[^<]+/gy;
  const attribute = /\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
  let count = 0;
  while (token.lastIndex < source.length) {
    const match = token.exec(source);
    if (!match) throw Error('문서 XML을 읽을 수 없습니다.');
    const part = match[0], parent = stack.at(-1);
    if (part.startsWith('<?') || part.startsWith('<!--')) continue;
    if (!part.startsWith('<') || part.startsWith('<![CDATA[')) {
      const value = part.startsWith('<') ? part.slice(9, -3) : decode(part);
      if (stack.length > 1) parent.children.push(value);
      else if (value.trim()) throw Error('문서 XML의 최상위 요소가 올바르지 않습니다.');
      continue;
    }
    if (part.startsWith('</')) {
      if (stack.length === 1 || parent.qualified !== part.slice(2, -1).trim()) throw Error('문서 XML 태그가 일치하지 않습니다.');
      stack.pop();
      continue;
    }
    const qualified = /^<[^\s/>]+/.exec(part)[0].slice(1);
    const node = {name:local(qualified), qualified, attrs:Object.create(null), children:[]};
    attribute.lastIndex = qualified.length + 1;
    let offset = attribute.lastIndex, field;
    while ((field = attribute.exec(part))) {
      const [, key, double, single] = field;
      if (Object.hasOwn(node.attrs, key)) throw Error('중복된 문서 XML 속성이 있습니다.');
      const value = decode(double ?? single);
      node.attrs[key] = value;
      if (key.includes(':') && !Object.hasOwn(node.attrs, local(key))) node.attrs[local(key)] = value;
      offset = attribute.lastIndex;
    }
    if (!/^\s*\/?>$/.test(part.slice(offset)) || ++count > 1000000 || stack.length > 100) {
      throw Error('문서 XML 구조를 읽을 수 없습니다.');
    }
    parent.children.push(node);
    if (!part.endsWith('/>')) stack.push(node);
  }
  if (stack.length !== 1 || root.children.length !== 1) throw Error('문서 XML이 완전하지 않습니다.');
  return root.children[0];
}

export const elements = node => (node?.children ?? []).filter(child => typeof child !== 'string');
export const children = (node, name) => elements(node).filter(child => child.name === name);
export const child = (node, name) => node?.children.find(item => typeof item !== 'string' && item.name === name);
export const attr = (node, name) => node?.attrs[name];
export const textOf = node => (node?.children ?? []).map(item => typeof item === 'string' ? item : textOf(item)).join('');
export function* descendants(node) {
  for (const item of elements(node)) {
    yield item;
    yield* descendants(item);
  }
}

export function packageParts(bytes) {
  const entries = new Map(), cache = new Map();
  let expanded = 0;
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const entry of zipEntries(buffer, {maxMember:128 * 1024 * 1024})) {
    if (entry.name.endsWith('/')) continue;
    if (entries.size >= 8192 || entries.has(entry.name)
        || entry.name.split('/').some(piece => !piece || piece === '.' || piece === '..' || /[:\\\x00]/.test(piece))) {
      throw Error('문서 패키지의 구성 파일 경로가 올바르지 않습니다.');
    }
    entries.set(entry.name, entry);
  }
  const data = name => {
    if (!entries.has(name)) return undefined;
    if (!cache.has(name)) {
      const part = entries.get(name);
      if ((expanded += part.size) > 512 * 1024 * 1024) throw Error('문서 변환에 필요한 메모리 범위를 넘었습니다.');
      cache.set(name, part.read());
    }
    return cache.get(name);
  };
  return {entries, data, xml(name) {
    const bytes = data(name);
    if (!bytes) return undefined;
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' :
      bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    return parseXml(new TextDecoder(encoding, {fatal:true}).decode(bytes));
  }};
}
