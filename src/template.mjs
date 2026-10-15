import {spawn} from 'node:child_process';
import {createReadStream, promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import config from './config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = config.outputRoot;
const python = config.pythonPath;
const script = path.join(root, 'scripts', 'inspect_template.py');
const MAX_BYTES = 24 * 1024 * 1024;
const CAPS = {sections: 32, paragraphs: 200, namedStyles: 256, fonts: 256, examples: 3, formats: 12,
  selectedParagraphs: 96, selectedTables: 16, selectedCells: 128, selectedObjects: 16, selectedFormats: 32};
const pending = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');

async function fileHash(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function runInspector(source) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-B', script, source], {shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const chunks = [];
    let size = 0, stderr = '', done = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('서식 분석 시간이 120초를 넘었습니다.')); }, 120000);
    function finish(error, value) {
      if (done) return;
      done = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    }
    child.on('error', error => finish(new Error(`Python 서식 분석기 실행 실패: ${error.message}`)));
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BYTES) { child.kill(); finish(new Error('서식 분석 응답이 24MiB를 넘습니다.')); return; }
      if (!done) chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { if (stderr.length < 65536) stderr += chunk.toString('utf8').slice(0, 65536 - stderr.length); });
    child.on('close', code => {
      if (done) return;
      let result;
      try { result = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
      catch { finish(new Error(`서식 분석기가 JSON을 반환하지 않았습니다.${stderr ? ` ${stderr.slice(0, 2000)}` : ''}`)); return; }
      if (code !== 0 || result?.ok === false) { finish(new Error(`서식 분석 실패: ${result?.error || stderr.slice(0, 2000) || `종료 코드 ${code}`}`)); return; }
      finish(null, result);
    });
  });
}

function validAnalysis(value, source, sourceSha256, inspectorScriptSha256, cached = false) {
  return value?.schemaVersion === '1.0' && value.source === source && value.sourceSha256 === sourceSha256 &&
    (!cached || value.inspectorScriptSha256 === inspectorScriptSha256) && Array.isArray(value.sections) &&
    Array.isArray(value.header?.charPr) && Array.isArray(value.header?.paraPr) && Array.isArray(value.header?.styles) &&
    Array.isArray(value.header?.fontFaces) && Array.isArray(value.header?.borderFills) &&
    value.sections.every(section => Array.isArray(section.paragraphs) && Array.isArray(section.tables)) &&
    typeof value.truncated === 'boolean' && Array.isArray(value.limitations);
}

async function loadAnalysis(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || !/\.hwpx$/i.test(input)) throw new Error('서식 분석에는 HWPX 파일의 절대 경로가 필요합니다.');
  const source = await fs.realpath(input);
  const stat = await fs.stat(source);
  if (!/\.hwpx$/i.test(source) || !stat.isFile() || stat.size > 256 * 1024 * 1024) throw new Error('256MiB 이하의 일반 HWPX 파일을 지정하세요.');
  const [sourceSha256, inspectorScriptSha256] = await Promise.all([fileHash(source), fileHash(script)]);
  const key = digest(`${source}\0${sourceSha256}`);
  const directory = path.join(outputRoot, 'template-analysis');
  const analysisPath = path.join(directory, `${key}-${inspectorScriptSha256}.json`);
  let analysis, cached = false;
  try {
    if ((await fs.stat(analysisPath)).size <= MAX_BYTES) {
      const candidate = JSON.parse(await fs.readFile(analysisPath, 'utf8'));
      if (validAnalysis(candidate, source, sourceSha256, inspectorScriptSha256, true)) { analysis = candidate; cached = true; }
    }
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  if (!analysis) {
    let job = pending.get(analysisPath);
    if (!job) {
      job = (async () => {
        const result = await runInspector(source);
        if (!validAnalysis(result, source, sourceSha256, inspectorScriptSha256)) throw new Error('서식 분석 결과의 구조 또는 원본 지문이 올바르지 않습니다.');
        const [currentSource, currentScript] = await Promise.all([fileHash(source), fileHash(script)]);
        if (currentSource !== sourceSha256 || currentScript !== inspectorScriptSha256) throw new Error('분석 중 원본 또는 분석기가 변경되었습니다. 다시 분석하세요.');
        result.inspectorScriptSha256 = inspectorScriptSha256;
        await fs.mkdir(directory, {recursive: true});
        const temporary = path.join(directory, `.analysis-${randomUUID()}.json`);
        try { await fs.writeFile(temporary, JSON.stringify(result), {flag: 'wx'}); await fs.rename(temporary, analysisPath); }
        finally { await fs.rm(temporary, {force: true}); }
        return result;
      })();
      pending.set(analysisPath, job);
      void job.finally(() => pending.delete(analysisPath)).catch(() => {});
    }
    analysis = await job;
  }
  if (await fileHash(source) !== sourceSha256) throw new Error('서식 분석을 읽는 동안 원본이 변경되었습니다. 다시 분석하세요.');
  return {analysis, source, sourceSha256, inspectorScriptSha256, analysisPath, cached};
}

function textOf(paragraph) { return paragraph.runs.map(run => run.text || '').join(''); }
function sourceExample(paragraph, run) {
  return {sectionIndex: paragraph.sectionIndex, topParagraphIndex: paragraph.topParagraphIndex,
    location: paragraph.location, paragraphInContainerIndex: paragraph.paragraphInContainerIndex,
    xmlPath: paragraph.xmlPath, tablePath: paragraph.tablePath,
    ...(run ? {runIndex: run.runIndex} : {}), text: (run ? run.text || '' : textOf(paragraph)).slice(0, 120)};
}

function usageMaps(analysis) {
  const maps = {charPr: new Map(), paraPr: new Map(), styles: new Map()};
  function add(map, id, paragraph, run) {
    if (id == null) return;
    let entry = map.get(id);
    if (!entry) { entry = {id, referenceCount: 0, textReferenceCount: 0, sourceExamples: []}; map.set(id, entry); }
    entry.referenceCount++;
    if (run ? !!run.text : !!textOf(paragraph)) entry.textReferenceCount++;
    if (entry.sourceExamples.length < CAPS.examples) entry.sourceExamples.push(sourceExample(paragraph, run));
  }
  for (const section of analysis.sections) for (const paragraph of section.paragraphs) {
    add(maps.paraPr, paragraph.paraPrIDRef, paragraph);
    add(maps.styles, paragraph.styleIDRef, paragraph);
    for (const run of paragraph.runs) add(maps.charPr, run.charPrIDRef, paragraph, run);
  }
  return maps;
}

function propertyVariants(properties, target, branches = []) {
  const result = [];
  for (const node of properties || []) {
    const next = ['case', 'default'].includes(node.tag) ? [...branches, {tag: node.tag, rawAttrs: node.rawAttrs}] : branches;
    if (node.tag === target) result.push({branches: next, rawAttrs: node.rawAttrs,
      ...(node.measurements ? {measurements: node.measurements} : {}),
      ...(node.children ? {values: node.children.map(child => ({tag: child.tag, rawAttrs: child.rawAttrs, measurements: child.measurements}))} : {})});
    result.push(...propertyVariants(node.children, target, next));
  }
  return result;
}

function formatSummary(record, type) {
  if (!record) return {missingDefinition: true};
  if (type === 'charPr') return {id: record.id, rawAttrs: record.rawAttrs, height: record.height,
    bold: record.bold, italic: record.italic, textColor: record.textColor,
    fonts: Object.fromEntries(Object.entries(record.resolvedFonts || {}).map(([language, font]) => [language, font.face])),
    typography: record.properties.filter(node => ['fontRef', 'ratio', 'spacing', 'relSz', 'offset', 'underline', 'strikeout'].includes(node.tag))};
  return {id: record.id, rawAttrs: record.rawAttrs,
    properties: record.properties.filter(node => ['align', 'heading', 'breakSetting', 'autoSpacing', 'border'].includes(node.tag)),
    margins: propertyVariants(record.properties, 'margin'), lineSpacing: propertyVariants(record.properties, 'lineSpacing')};
}

function buildSummary(analysis, reasons) {
  const maps = usageMaps(analysis), allParagraphs = analysis.sections.flatMap(section => section.paragraphs);
  const allTables = analysis.sections.flatMap(section => section.tables);
  const fontNames = [...new Set(analysis.header.fontFaces.flatMap(face => face.fonts.map(font => font?.rawAttrs?.face).filter(Boolean)))];
  const cap = (items, limit, label) => { if (items.length > limit) reasons.add(label); return items.slice(0, limit); };
  const frequent = type => [...maps[type].values()].sort((a, b) => b.referenceCount - a.referenceCount || a.id.localeCompare(b.id)).slice(0, CAPS.formats)
    .map(use => ({...use, format: formatSummary(analysis.header[type].find(record => record.id === use.id), type)}));
  let paragraphBudget = CAPS.paragraphs;
  const sections = cap(analysis.sections, CAPS.sections, 'summary.sections').map(section => {
    const body = section.paragraphs.filter(paragraph => paragraph.location === 'body');
    const shown = cap(body, paragraphBudget, 'summary.paragraphs'); paragraphBudget -= shown.length;
    return {sectionIndex: section.sectionIndex, entry: section.entry, topParagraphCount: section.topParagraphCount,
      pageGeometry: section.sectionProperties.map(item => ({...item, property: item.property?.tag === 'secPr'
        ? {...item.property, children: item.property.children?.filter(child => ['pagePr', 'pageBorderFill', 'grid', 'visibility'].includes(child.tag))} : item.property})),
      headersFooters: cap(section.headersFooters || [], 16, 'summary.headersFooters'),
      paragraphs: shown.map(paragraph => {
        const tables = section.tables.filter(table => table.topParagraphIndex === paragraph.topParagraphIndex);
        const objects = (section.objects || []).filter(object => object.topParagraphIndex === paragraph.topParagraphIndex);
        const para = analysis.header.paraPr.find(record => record.id === paragraph.paraPrIDRef);
        const heading = para?.properties.find(node => node.tag === 'heading')?.rawAttrs?.type;
        const text = textOf(paragraph).slice(0, 120);
        return {...sourceExample(paragraph), xmlParagraphId: paragraph.xmlParagraphId, styleIDRef: paragraph.styleIDRef,
          paraPrIDRef: paragraph.paraPrIDRef, charPrIDRefs: [...new Set(paragraph.runs.map(run => run.charPrIDRef))],
          type: tables.length ? (text ? 'textAndTable' : 'tableAnchor') : objects.length && !text ? 'objectAnchor' : heading && heading !== 'NONE' ? 'heading' : 'paragraph',
          hasTable: tables.length > 0, tableCount: tables.length, objectCount: objects.length};
      })};
  });
  return {counts: {sections: analysis.sections.length, fontFaces: analysis.header.fontFaces.length, fontNames: fontNames.length,
      charPr: analysis.header.charPr.length, paraPr: analysis.header.paraPr.length, namedStyles: analysis.header.styles.length,
      borderFills: analysis.header.borderFills.length, paragraphs: allParagraphs.length,
      bodyParagraphs: allParagraphs.filter(paragraph => paragraph.location === 'body').length,
      tables: allTables.length, cells: allTables.reduce((sum, table) => sum + table.cells.length, 0),
      objects: analysis.sections.reduce((sum, section) => sum + (section.objects?.length || 0), 0),
      savedLineSegments: allParagraphs.reduce((sum, paragraph) => sum + (paragraph.savedLineSegments?.length || 0), 0)},
    fontNames: cap(fontNames, CAPS.fonts, 'summary.fontNames'),
    namedStyles: cap(analysis.header.styles, CAPS.namedStyles, 'summary.namedStyles').map(record => ({id: record.id,
      ...record.rawAttrs, referenceCount: maps.styles.get(record.id)?.referenceCount || 0})),
    frequentlyUsedCharPr: frequent('charPr'), frequentlyUsedParaPr: frequent('paraPr'), sections};
}

function normalizeTablePath(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 8) throw new Error('tablePath는 반환된 표 경로 또는 tableOrdinal의 1~8개 배열이어야 합니다.');
  return value.map(step => {
    if (Number.isInteger(step) && step >= 0) return {tableOrdinal: step};
    if (!step || typeof step !== 'object' || !Number.isInteger(step.tableOrdinal) || step.tableOrdinal < 0) throw new Error('tablePath 항목에는 0부터 시작하는 tableOrdinal이 필요합니다.');
    return {tableOrdinal: step.tableOrdinal, ...(step.cellAddr ? {cellAddr: step.cellAddr} : {})};
  });
}
function matchesTablePath(actual, selected, ignoreCell = false) {
  if (!selected) return true;
  return actual.length >= selected.length && selected.every((step, index) => step.tableOrdinal === actual[index].tableOrdinal &&
    (!step.cellAddr || (ignoreCell && index === selected.length - 1 && actual.length === selected.length && !actual[index].cellAddr) ||
      Object.entries(step.cellAddr).every(([key, value]) => String(actual[index].cellAddr?.[key]) === String(value))));
}

function buildParagraph(analysis, options, reasons) {
  const sectionIndex = options.sectionIndex ?? 0, topParagraphIndex = options.topParagraphIndex;
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || !Number.isInteger(topParagraphIndex) || topParagraphIndex < 0) throw new Error('paragraph 분석에는 0부터 시작하는 sectionIndex와 topParagraphIndex가 필요합니다.');
  const section = analysis.sections.find(item => item.sectionIndex === sectionIndex);
  if (!section || topParagraphIndex >= section.topParagraphCount) throw new Error('해당 본문 문단이 없습니다. summary의 원본 문단 인덱스를 확인하세요.');
  const tablePath = normalizeTablePath(options.tablePath);
  const paragraphs = section.paragraphs.filter(item => item.topParagraphIndex === topParagraphIndex && matchesTablePath(item.tablePath, tablePath));
  if (!paragraphs.length) throw new Error('선택한 표 경로에 해당하는 문단이 없습니다.');
  const tables = section.tables.filter(item => item.topParagraphIndex === topParagraphIndex && matchesTablePath(item.tablePath, tablePath, true));
  const objects = (section.objects || []).filter(item => item.topParagraphIndex === topParagraphIndex && matchesTablePath(item.tablePath, tablePath));
  const cap = (items, limit, label) => { if (items.length > limit) reasons.add(label); return items.slice(0, limit); };
  const shown = cap(paragraphs, CAPS.selectedParagraphs, 'paragraph.paragraphs');
  const formats = {};
  for (const type of ['charPr', 'paraPr', 'styles']) {
    const ids = new Set(shown.flatMap(item => type === 'charPr' ? item.runs.map(run => run.charPrIDRef) : [item[type === 'styles' ? 'styleIDRef' : 'paraPrIDRef']]));
    formats[type] = cap(analysis.header[type].filter(record => ids.has(record.id)), CAPS.selectedFormats, `paragraph.${type}`);
  }
  let cellBudget = CAPS.selectedCells;
  const selectedTables = cap(tables, CAPS.selectedTables, 'paragraph.tables').map(table => {
    const cells = cap(table.cells, cellBudget, 'paragraph.cells'); cellBudget -= cells.length;
    return {...table, cells};
  });
  const borderIDs = new Set(selectedTables.flatMap(table => [table.rawAttrs.borderFillIDRef, ...table.cells.map(cell => cell.rawAttrs.borderFillIDRef)]));
  formats.borderFills = cap(analysis.header.borderFills.filter(record => borderIDs.has(record.id)), CAPS.selectedFormats, 'paragraph.borderFills');
  return {selector: {sectionIndex, topParagraphIndex, ...(tablePath ? {tablePath} : {})},
    matchingCounts: {paragraphs: paragraphs.length, tables: tables.length, objects: objects.length},
    paragraphs: shown, tables: selectedTables, objects: cap(objects, CAPS.selectedObjects, 'paragraph.objects'), formats};
}

/** Inspect a saved HWPX. tablePath accepts the inspector's path objects or ordinal integers. */
export async function inspectTemplate(input, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('서식 분석 옵션 객체가 필요합니다.');
  const detail = options.detail ?? 'summary';
  if (!['summary', 'paragraph', 'format'].includes(detail)) throw new Error('detail은 summary, paragraph 또는 format이어야 합니다.');
  const loaded = await loadAnalysis(input), {analysis} = loaded;
  const reasons = new Set(analysis.truncatedCategories || []);
  let selected;
  if (detail === 'summary') selected = {summary: buildSummary(analysis, reasons)};
  else if (detail === 'paragraph') selected = buildParagraph(analysis, options, reasons);
  else {
    if (!['charPr', 'paraPr', 'styles'].includes(options.recordType) || typeof options.id !== 'string' || !options.id.length) throw new Error('format 분석에는 recordType(charPr/paraPr/styles)과 문자열 id가 필요합니다.');
    const record = analysis.header[options.recordType].find(item => item.id === options.id);
    if (!record) throw new Error('요청한 서식 ID가 없습니다.');
    selected = {recordType: options.recordType, id: options.id, record,
      usage: usageMaps(analysis)[options.recordType].get(options.id) || {id: options.id, referenceCount: 0, textReferenceCount: 0, sourceExamples: []}};
  }
  return {detail, source: loaded.source, sourceSha256: loaded.sourceSha256, inspectorScriptSha256: loaded.inspectorScriptSha256,
    analysisPath: loaded.analysisPath, cached: loaded.cached, untrustedContent: true,
    untrustedFields: Object.keys(selected), units: analysis.units, limits: {...CAPS, pythonStdoutBytes: MAX_BYTES},
    truncated: analysis.truncated || reasons.size > 0, analysisTruncated: analysis.truncated,
    truncationReasons: [...reasons], limitations: analysis.limitations, ...selected};
}
