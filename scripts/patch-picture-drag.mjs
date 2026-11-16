import fs from 'node:fs/promises';import path from 'node:path';

export async function patchPictureDrag(studio){
 // This import belongs to the generated Studio tree, not to this script.
 const pointerModule=JSON.stringify('./pwh-latest-pointer-frame.mjs');
 await fs.copyFile(new URL('../src/latest-pointer-frame.mjs',import.meta.url),path.join(studio,'src/engine/pwh-latest-pointer-frame.mjs'));
 await fs.copyFile(new URL('../src/picture-move-history.ts',import.meta.url),path.join(studio,'src/pwh-picture-move-history.ts'));
 const change=async(relative,marker,edit)=>{const file=path.join(studio,'src',relative);let source=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');if(source.includes(marker))return;const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('Unsupported picture drag source: '+relative+' '+before.slice(0,70));source=source.replace(before,()=>after);};edit(replace);await fs.writeFile(file,'// '+marker+'\n'+source);};
 await change('document-agent/controller.ts','Pwh lightweight document revision',replace=>{
  replace('  getPresentationDocumentState(): RhwpDocumentStateV1 {',`  getPresentationDocumentRevision(): Omit<RhwpDocumentStateV1, 'documentSha256'> {
    this.syncGeneration();
    return {schemaVersion:1,documentEpoch:this.documentEpoch,changeSeq:this.changeSeq,format:this.currentFormat(),pageCount:this.deps.wasm.pageCount,dirty:this.deps.isDirty()};
  }
  getPresentationDocumentState(): RhwpDocumentStateV1 {`);
 });
 await change('engine/input-handler-mouse.ts','Pwh latest picture motion',replace=>{
  replace('/** input-handler mouse methods',`import {queuePictureMove,flushPictureMove} from ${pointerModule};
/** input-handler mouse methods`);
  replace(`    if (this.dragRafId) return;
    this.dragRafId = requestAnimationFrame(() => {
      this.dragRafId = 0;
      if (!this.isPictureMoveDragging || !this.pictureMoveState) return;
      this.updatePictureMoveDrag(e);
    });`,`    queuePictureMove(this,e);`);
  replace('    this.finishPictureMoveDrag();','    flushPictureMove(this,_e);\n    this.finishPictureMoveDrag();');
 });
 await change('engine/input-handler.ts','Pwh dispose picture motion',replace=>{
  replace("import * as _mouse from './input-handler-mouse';",`import {cancelPictureMove,flushPictureMove} from ${pointerModule};\nimport {closePictureMoveHistory} from '../pwh-picture-move-history';\nimport * as _mouse from './input-handler-mouse';`);
  replace('  dispose(): void {','  dispose(): void {\n    cancelPictureMove(this);\n    closePictureMoveHistory(this,true);');
  replace('    this.onInputBlurBound = () => {','    this.onInputBlurBound = () => {\n      if(this.isPictureMoveDragging){flushPictureMove(this);this.finishPictureMoveDrag();}');
  replace('  private onKeyDown(e: KeyboardEvent): void {',`  private onKeyDown(e: KeyboardEvent): void {
    if(this.isPictureMoveDragging&&!['Control','Shift','Alt','Meta'].includes(e.key)){
      if(e.key==='Escape'){
        cancelPictureMove(this);closePictureMoveHistory(this,true);
        this.isPictureMoveDragging=false;this.pictureMoveState=null;this.container.style.cursor='';
        this.renderPictureObjectSelection();e.preventDefault();return;
      }
      flushPictureMove(this);this.finishPictureMoveDrag();
    }`);
 });
 await change('engine/command.ts','Pwh adopted live move checkpoint',replace=>{
  replace('export class SnapshotCommand implements EditCommand {',`export class SnapshotCommand implements EditCommand {
  /** A live gesture already owns its pre-mutation checkpoint. Transfer it to
   * ordinary bounded history without capturing the mutated state as before. */
  static fromApplied(operationType:string,beforeId:number,cursorBefore:DocumentPosition,cursorAfter:DocumentPosition):SnapshotCommand {
    const command=new SnapshotCommand(operationType,cursorBefore,cursorAfter,null);
    command.beforeId=beforeId;command.executed=true;return command;
  }`);
 });
 await change('engine/input-handler-picture.ts','Pwh exact picture move history',replace=>{
  replace("import { MovePictureCommand, MoveShapeCommand, ResizeObjectCommand } from './command';","import { ResizeObjectCommand } from './command';\nimport {capturePictureMoveHistory,closePictureMoveHistory} from '../pwh-picture-move-history';");
  replace('    // 다중 선택: 모든 개체를 동일 delta로 이동','    capturePictureMoveHistory(this);\n    // 다중 선택: 모든 개체를 동일 delta로 이동');
  // The complete old per-object record block must match; no silent fallback.
  replace(`  if (this.pictureMoveState) {
    const { totalDeltaH, totalDeltaV, multiRefs } = this.pictureMoveState;
    if (totalDeltaH !== 0 || totalDeltaV !== 0) {
      const targets = multiRefs || [{ ...this.pictureMoveState.ref, origHorzOffset: this.pictureMoveState.origHorzOffset, origVertOffset: this.pictureMoveState.origVertOffset }];
      for (const r of targets) {
        const CmdClass = (r.type === 'shape' || r.type === 'line' || r.type === 'group' || r.type === 'ole') ? MoveShapeCommand : MovePictureCommand;
        this.executeOperation({
          kind: 'record',
          command: new CmdClass(
            r.sec, r.ppi, r.ci,
            totalDeltaH, totalDeltaV,
            r.origHorzOffset, r.origVertOffset,
            r.cellPath,
          ),
          meta: { domain: 'object', refresh: 'none', dirtyScope: 'object' },
        });
      }
    }
  }`,`  closePictureMoveHistory(this);`);
 });
}
