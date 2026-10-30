import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const skip=!process.env.PWH_CORE_JS||!process.env.PWH_CORE_WASM?'Set PWH_CORE_JS and PWH_CORE_WASM':false;

test('note display, cursor, mouse hit and deletion use the same logical boundary', {skip},async()=>{
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 for(const kind of ['Footnote','Endnote'])for(const at of [0,1,4])for(const codes of [false,true]){
  const doc=HwpDocument.createEmpty();doc.createBlankDocument();doc.insertText(0,0,0,'ABCD');
  doc.applyCharFormat(0,0,1,3,JSON.stringify({bold:true,textColor:'#123456'}));const expected=JSON.parse(doc.getCharShapeRuns(0,0,0,4));
  const inserted=JSON.parse(doc['insert'+kind](0,0,at));assert.equal(inserted.ok,true);doc.setShowControlCodes(codes);
  const before=JSON.parse(doc.getCursorRect(0,0,at)),after=JSON.parse(doc.getCursorRect(0,0,at+1));assert.ok(after.x>before.x);
  const hit=JSON.parse(doc.hitTest(after.pageIndex,after.x-.1,after.y+Math.min(6,after.height/2)));
  assert.equal(hit.charOffset,at+1,`${kind}, offset ${at}, codes ${codes}: visible right edge is after the note`);
  const target=JSON.parse(doc.getFootnoteAtCursor(0,0,hit.charOffset,'backward'));assert.equal(target.hit,true);assert.equal(target.controlIndex,inserted.controlIdx);
  assert.equal(JSON.parse(doc.getFootnoteAtCursor(0,0,at,'forward')).controlIndex,inserted.controlIdx);
  const saved=doc.exportHwpx();const removed=JSON.parse(doc.deleteFootnote(0,0,target.controlIndex));assert.equal(removed.ok,true);assert.equal(removed.charOffset,at);
  assert.equal(doc.getTextRange(0,0,0,4),'ABCD','deleting a note preserves body text');assert.deepEqual(JSON.parse(doc.getCharShapeRuns(0,0,0,4)),expected,'deleting a note preserves mixed character formatting');
  const reopened=new HwpDocument(saved);assert.equal(JSON.parse(reopened.getFootnoteAtCursor(0,0,at+1,'backward')).hit,true,'saved note retains its source boundary');reopened.free();doc.free();
 }
});

test('multiple notes keep distinct boundaries when another note is deleted', {skip},async()=>{
 const {default:init,HwpDocument}=await import(pathToFileURL(process.env.PWH_CORE_JS));await init({module_or_path:await fs.readFile(process.env.PWH_CORE_WASM)});
 const doc=HwpDocument.createEmpty();doc.createBlankDocument();doc.insertText(0,0,0,'ABCD');doc.insertFootnote(0,0,0);doc.insertEndnote(0,0,3);
 const first=JSON.parse(doc.getFootnoteAtCursor(0,0,1,'backward')),second=JSON.parse(doc.getFootnoteAtCursor(0,0,5,'backward'));
 assert.equal(first.hit,true);assert.equal(second.hit,true);assert.notEqual(first.controlIndex,second.controlIndex);
 doc.deleteFootnote(0,0,first.controlIndex);const remaining=JSON.parse(doc.getFootnoteAtCursor(0,0,4,'backward'));assert.equal(remaining.hit,true);assert.equal(doc.getTextRange(0,0,0,4),'ABCD');doc.free();
});
