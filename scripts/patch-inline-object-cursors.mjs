import fs from 'node:fs/promises';import path from 'node:path';
export async function patchInlineObjectCursors(studio){
  await fs.copyFile(new URL('../src/inline-table-boundary.mjs',import.meta.url),path.join(studio,'src/engine/pwh-inline-table-boundary.mjs'));
  const change=async(relative,edits)=>{
    const file=path.join(studio,'src',relative);let source=await fs.readFile(file,'utf8');const marker='// Pwh inline object cursor boundaries';if(source.split(/\r?\n/).includes(marker))return;
    for(const [a,b]of edits){if(source.split(a).length!==2)throw Error('Unsupported inline cursor source '+relative+' '+a.slice(0,80));source=source.replace(a,b);}await fs.writeFile(file,marker+'\n'+source);
  };
  const types=path.join(studio,'src/core/types.ts');let typeSource=await fs.readFile(types,'utf8');
  typeSource=typeSource.replaceAll('textOffset:number;logicalOffset:number}','textOffset:number;logicalOffset:number;canonicalOffset?:number}');await fs.writeFile(types,typeSource);
  await change('core/wasm-bridge.ts',[
    ['  getBodyCursorRect(pos: DocumentPosition): CursorRect {',`  bodyPositionFromLogical(pos: DocumentPosition): DocumentPosition {
    if(!this.doc)throw Error('문서가 로드되지 않았습니다');return bodyPositionFromLogical(this.doc,pos);
  }
  getInlineControlPositions(sec:number,para:number): {controlIndex:number;offset:number}[] {
    return JSON.parse((this.doc as any).getInlineControlPositions(sec,para));
  }
  getBodySelectionRects(start:DocumentPosition,end:DocumentPosition): SelectionRect[] {
    return this.getSelectionRects(start.sectionIndex,start.paragraphIndex,this.bodyPositionToLogical(start),end.paragraphIndex,this.bodyPositionToLogical(end));
  }
  copyBodySelection(start:DocumentPosition,end:DocumentPosition): string {
    return (this.doc as any).copySelectionLogical(start.sectionIndex,start.paragraphIndex,this.bodyPositionToLogical(start),end.paragraphIndex,this.bodyPositionToLogical(end));
  }
  deleteBodySelection(start:DocumentPosition,end:DocumentPosition): void {
    const result=JSON.parse((this.doc as any).deleteRangeLogical(start.sectionIndex,start.paragraphIndex,this.bodyPositionToLogical(start),end.paragraphIndex,this.bodyPositionToLogical(end)));
    if(!result.ok)throw Error('선택한 범위를 삭제하지 못했습니다.');
  }
  getBodyCursorRect(pos: DocumentPosition): CursorRect {`],
  ]);
  await change('engine/cursor.ts',[
    ["    if (!aInCell && !bInCell) {\n      // 둘 다 본문", "    if (!aInCell && !bInCell) {\n      const boundary=compareBodyCursorAffinity(a,b);if(boundary)return boundary;\n      // 둘 다 본문"],
    ['      this.position = { ...this.position, charOffset: lineInfo.charStart };','      this.position = this.isInCell()?{ ...this.position, charOffset: lineInfo.charStart }:this.wasm.bodyPositionFromLogical({...this.position,charOffset:lineInfo.charStart});'],
    ['      this.position = { ...this.position, charOffset: lineInfo.charEnd };','      this.position = this.isInCell()?{ ...this.position, charOffset: lineInfo.charEnd }:this.wasm.bodyPositionFromLogical({...this.position,charOffset:lineInfo.charEnd});'],
    ['return this.wasm.getLineInfo(pos.sectionIndex, pos.paragraphIndex, charOffset);','return this.wasm.getLineInfo(pos.sectionIndex, pos.paragraphIndex, this.wasm.bodyPositionToLogical({...pos,charOffset}));'],
  ]);
  const cursor=path.join(studio,'src/engine/cursor.ts');let text=await fs.readFile(cursor,'utf8');if(!text.includes('import {compareBodyCursorAffinity}')){text='import {compareBodyCursorAffinity} from \'../core/pwh-body-cursor-position.mjs\';\n'+text;await fs.writeFile(cursor,text);}
  await change('engine/input-handler.ts',[
    ['    const hit = this.hitTestFromClientPoint(this.dragLastClientX, this.dragLastClientY);',`    let hit = this.hitTestFromClientPoint(this.dragLastClientX, this.dragLastClientY);
    const range=this.cursor.getSelection();
    if(range&&range.anchor.parentParaIndex===undefined){
      hit=inlineTableBoundaryFromClient(this,this.dragLastClientX,this.dragLastClientY,{drag:true})??hit;
    }`],
    ["rects = this.wasm.getSelectionRects(\n          start.sectionIndex,\n          start.paragraphIndex, start.charOffset,\n          end.paragraphIndex, end.charOffset,\n        );","rects = this.wasm.getBodySelectionRects(start,end);"],
    ["const off = this.wasm.getControlTextPositions(sec, para)[c.controlIndex];", "const off = this.wasm.getInlineControlPositions(sec,para).find(p=>p.controlIndex===c.controlIndex)?.offset;"],
    ["    const tables = this.bodyTableAnchors();\n    if (!tables.length)","    start={...start,charOffset:this.wasm.bodyPositionToLogical(start)};\n    end={...end,charOffset:this.wasm.bodyPositionToLogical(end)};\n    const tables = this.bodyTableAnchors();\n    if (!tables.length)"],
  ]);
  const handler=path.join(studio,'src/engine/input-handler.ts');text=await fs.readFile(handler,'utf8');if(!text.includes('import {inlineTableBoundaryFromClient}'))await fs.writeFile(handler,'import {inlineTableBoundaryFromClient} from \'./pwh-inline-table-boundary.mjs\';\n'+text);
  await change('engine/command.ts',[[`          wasm.deleteRange(
            start.sectionIndex, start.paragraphIndex, start.charOffset,
            end.paragraphIndex, end.charOffset,
          );`,`          wasm.deleteBodySelection(start,end);`]]);
  await change('core/mutation-method-registry.ts',[["'deleteText', 'deleteRange',", "'deleteText', 'deleteRange', 'deleteBodySelection',"]]);
  await change('engine/input-handler-keyboard.ts',[[`      result = this.wasm.copySelection(
        start.sectionIndex,
        start.paragraphIndex, start.charOffset,
        end.paragraphIndex, end.charOffset,
      );`,`      result = this.wasm.copyBodySelection(start,end);`]]);
  await change('engine/input-handler-mouse.ts',[
    ['    // 핸들 밖 클릭 → 본체 클릭이면 이동 드래그 시작, 아니면 선택 해제 (수식은 이동 미지원)',`    // A selected group's unique text story owns its interior; handles above
    // still resize the group, and all other object kinds retain their route.
    if(e.button===0&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey){
      const ref=this.cursor.getSelectedPictureRef();
      const sc=this.container.querySelector('#scroll-content');
      if(ref?.type==='group'&&sc){
        const z=this.viewportManager.getZoom(),r=sc.getBoundingClientRect();
        const cx=e.clientX-r.left,cy=e.clientY-r.top,pi=this.virtualScroll.getPageAtPoint(cx,cy);
        const x=(cx-this.virtualScroll.getPageLeftResolved(pi,sc.clientWidth))/z,y=(cy-this.virtualScroll.getPageOffset(pi))/z;
        const h=this.wasm.hitTest(pi,x,y);
        if(h.isTextBox&&h.sectionIndex===ref.sec&&h.parentParaIndex===ref.ppi&&h.controlIndex===ref.ci
          &&!this.isShapeBorderClickByRef(x,y,ref.sec,ref.ppi,ref.ci)){
          e.preventDefault();this.exitPictureObjectSelectionIfNeeded();this.cursor.clearSelection();
          this.cursor.moveToHit(h);this.cursor.resetPreferredX();this.cursor.setAnchor();
          this.active=true;this.startTextSelectionDrag(e);this.updateCaret();this.updateSelection();
          document.addEventListener('mouseup',this.onMouseUpBound,{once:true});this.textarea.focus();return;
        }
      }
    }
    // 핸들 밖 클릭 → 본체 클릭이면 이동 드래그 시작, 아니면 선택 해제 (수식은 이동 미지원)`],
    ['  const earlyObjectHit = this.findPictureAtClick(pageIdx, pageX, pageY);',`  const earlyObjectHit = this.findPictureAtClick(pageIdx, pageX, pageY);
  if(e.button===0&&!e.ctrlKey&&!e.altKey&&!e.metaKey){
    const boundary=inlineTableBoundaryAtPoint(this,pageIdx,pageX,pageY);
    if(boundary){
      e.preventDefault();this.exitPictureObjectSelectionIfNeeded();
      if(this.cursor.isInTableObjectSelection()){this.cursor.exitTableObjectSelection();this.tableObjectRenderer?.clear();this.eventBus.emit('table-object-selection-changed',false);}
      if(e.shiftKey)this.cursor.setAnchor();else this.cursor.clearSelection();
      this.cursor.moveToHit(boundary);this.cursor.resetPreferredX();if(!e.shiftKey)this.cursor.setAnchor();
      this.active=true;this.startTextSelectionDrag(e);this.updateCaret();this.updateSelection();
      document.addEventListener('mouseup',this.onMouseUpBound,{once:true});this.textarea.focus();return;
    }
  }`],
    ["if (ref && ref.type === 'shape'\n          && ref.sec", "if (ref && (ref.type === 'shape'||ref.type === 'group')\n          && ref.sec"],
    ["hit.sectionIndex, hit.parentParaIndex, hit.controlIndex, 'shape',", "hit.sectionIndex, hit.parentParaIndex, hit.controlIndex, earlyObjectHit?.type==='group'?'group':'shape',"],
  ]);
  const mouse=path.join(studio,'src/engine/input-handler-mouse.ts');text=await fs.readFile(mouse,'utf8');if(!text.includes('import {inlineTableBoundaryAtPoint}'))await fs.writeFile(mouse,'import {inlineTableBoundaryAtPoint} from \'./pwh-inline-table-boundary.mjs\';\n'+text);
}
