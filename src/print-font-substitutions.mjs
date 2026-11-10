import {tryLoadExactLocalFont} from './local-font-face.mjs';

/** Resolve declared targets for one print window. Keep every loaded face local to it. */
export async function loadPrintFontSubstitutions(view, pairs, {records, resolve, load, normalize}) {
 const targets = [...new Set(pairs.map(([, to]) => to))];
 const names = record => [record.fullName, record.postscriptName].filter(Boolean);
 const canonical = name => name.normalize('NFC').toLowerCase();
 const results = await Promise.all(targets.map(async target => {
  const faces = [];
  for (const [weight, slant] of [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']]) {
   const exact = records.filter(record => names(record).some(name => canonical(name) === canonical(target))
     && (record.hostReference?.face.weight ?? 400) === weight
     && (record.hostReference?.face.slant ?? 'normal') === slant);
   const record = exact.length === 1 ? exact[0] : resolve(target, {weight, slant});
   if (!record || ![record.family, record.fullName, record.postscriptName].filter(Boolean)
     .some(name => canonical(name) === canonical(target))) {
    if (!faces.length && !exact.length) {
     const installed = await tryLoadExactLocalFont(target, {fullName: target, weight, slant}, view.FontFace);
     if (installed) faces.push(installed);
    }
    if (!faces.length) return null;
    continue;
   }
   const unique = name => records.filter(item => names(item).some(other => canonical(name) === canonical(other))).length === 1;
   const details = {
    fullName: record.fullName && unique(record.fullName) ? record.fullName : undefined,
    postscriptName: record.postscriptName && unique(record.postscriptName) ? record.postscriptName : undefined,
    weight, slant,
   };
   let face = await tryLoadExactLocalFont(target, details, view.FontFace);
   if (!face) {
    try {
     const data = await load(record);
     const bytes = data && normalize(data.bytes, data.faceIndex ?? 0);
     if (bytes) face = await new view.FontFace(target, bytes, {weight: String(weight), style: slant}).load();
    } catch {
     // A missing or rejected face does not authorize a substitution.
    }
   }
   if (face?.status === 'loaded') faces.push(face);
   if (!faces.length) return null;
  }
  return {target, faces};
 }));
 const resolved = results.filter(Boolean);
 const available = new Set(resolved.map(({target}) => target));
 return {
  environment: {id: 'pwh-print-document-substitutes', substitutions: Object.fromEntries(pairs.filter(([, to]) => available.has(to)))},
  faces: resolved.flatMap(({faces}) => faces),
  missing: targets.filter(target => !available.has(target)),
 };
}
