import fs from 'node:fs/promises';
import path from 'node:path';

export async function patchFormatProperties(studio) {
  await fs.copyFile(new URL('../src/format-property-changes.mjs',import.meta.url),path.join(studio,'src/ui/pwh-format-property-changes.mjs'));
  for(const [name,anchor,values]of [
    ['para-shape-dialog.ts','    this.borderResult.bgPatShapeSelect.value = String(p.patternType ?? 0);','[this.borderResult.bgFillSelect.value,this.borderResult.bgFillPicker.value,this.borderResult.bgPatColorInput.value,this.borderResult.bgPatShapeSelect.value]'],
    ['char-shape-dialog.ts','    this.patShapeSelect.value = String(p.patternType || 0);','[this.faceColorSelect.value,this.faceColorPicker.value,this.patColorInput.value,this.patShapeSelect.value]'],
  ]){
    const file=path.join(studio,'src/ui',name);let source=await fs.readFile(file,'utf8');
    if(source.includes('// pwh preserve property edit intent'))continue;
    // Character controls use different historical member names; fail before
    // replacing an upstream shape that no longer has this exact contract.
    const collect=source.indexOf('  private collectMods()');
    const end=source.indexOf('\n    return mods;',collect);
    if(collect<0||end<0||source.split(anchor).length!==2)throw Error('Unsupported format dialog: '+name);
    source=source.slice(0,end)+'\n    preserveFillEditIntent(mods, this.pwhInitialFillUi, '+values+', p);\n    discardUneditedDialogValues(mods, this.pwhInitialUiMods);'+source.slice(end);
    source=source.replace(anchor,anchor+'\n    this.pwhInitialFillUi = '+values+';');
    const populated=source.indexOf('    this.updatePreview();',source.indexOf(anchor));
    if(populated<0)throw Error('Unsupported format preview boundary');
    source=source.slice(0,populated)+'    this.pwhInitialUiMods = {};\n    this.pwhInitialUiMods = this.collectMods();\n'+source.slice(populated);
    source=source.replace('  private initialProps:', '  private pwhInitialFillUi: string[] = [];\n  private pwhInitialUiMods: Record<string, unknown> = {};\n  private initialProps:');
    if(name==='para-shape-dialog.ts'){
      const units=[['pxToPt(p.spacingBefore ?? 0)','pxToPt((p.spacingBefore ?? 0) / 2)'],['pxToPt(p.spacingAfter ?? 0)','pxToPt((p.spacingAfter ?? 0) / 2)'],['const newSB = ptToRaw(','const newSB = ptToRaw2x('],['const newSA = ptToRaw(','const newSA = ptToRaw2x(']];
      for(const [before,after]of units){if(source.split(before).length!==2)throw Error('Unsupported paragraph spacing units');source=source.replace(before,after);}
      source=source.replace('    this.spacingBeforeInput = numberInput(0, 999, 0.1);','    this.spacingBeforeInput = numberInput(0, 999, 0.1);\n    this.spacingBeforeInput.setAttribute(\'aria-label\', \'문단 위 간격(pt)\');');
      source=source.replace('    this.spacingAfterInput = numberInput(0, 999, 0.1);','    this.spacingAfterInput = numberInput(0, 999, 0.1);\n    this.spacingAfterInput.setAttribute(\'aria-label\', \'문단 아래 간격(pt)\');');
    }
    source='// pwh preserve property edit intent\nimport {preserveFillEditIntent,discardUneditedDialogValues} from \'./pwh-format-property-changes.mjs\';\n'+source;
    await fs.writeFile(file,source);
  }
}
