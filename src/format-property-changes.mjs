const fillFields=['fillType','fillColor','patternColor','patternType'];
const borderFields=['borderLeft','borderRight','borderTop','borderBottom'];

// Compare the values actually displayed by controls, including unsupported
// stored pattern values normalized by a select. Opening a dialog is no edit.
export function preserveFillEditIntent(mods, initialUi, currentUi, original) {
  for(const [index,key]of fillFields.entries())if(initialUi[index]===currentUi[index])delete mods[key];
  if(fillFields.some(key=>Object.hasOwn(mods,key))&&!Object.hasOwn(mods,'fillType'))mods.fillType=currentUi[0];
  if([...fillFields,...borderFields].some(key=>Object.hasOwn(mods,key))&&Number.isSafeInteger(original.borderFillId)&&original.borderFillId>=0)mods.borderFillId=original.borderFillId;
  return mods;
}

export function discardUneditedDialogValues(mods, initialMods) {
  for(const key of Object.keys(mods))if(Object.hasOwn(initialMods,key)&&JSON.stringify(mods[key])===JSON.stringify(initialMods[key]))delete mods[key];
  return mods;
}
