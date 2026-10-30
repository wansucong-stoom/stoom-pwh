/**
 * Font names are source metadata, independent of pagination. Resolving every
 * text weight/slant covers new text, headers, nested cells and later style
 * changes without constructing a render tree for every page on each edit.
 * Null requests the original renderer-based compatibility path.
 */
export function documentFontRequests(info,resolve,keyOf){
 if(!info||!Array.isArray(info.fontsUsed)||info.fontsUsed.some(name=>typeof name!=='string')||!Array.isArray(info.fontSubstitutions||[]))return null;
 const names=new Set(info.fontsUsed);
 for(const pair of info.fontSubstitutions||[]){if(!Array.isArray(pair)||pair.length!==2||pair.some(name=>typeof name!=='string'))return null;for(const name of pair)names.add(name);}
 if(typeof info.fallbackFont==='string'&&info.fallbackFont)names.add(info.fallbackFont);
 const records=new Map();
 for(const name of names){
  if(!name.trim())continue;
  for(const weight of [400,700])for(const slant of ['normal','italic']){
   const record=resolve(name,{weight,slant});
   if(record?.hostReference)records.set(keyOf(record),record);
  }
 }
 return [...records.values()];
}
