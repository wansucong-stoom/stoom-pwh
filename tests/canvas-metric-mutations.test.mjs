import test from 'node:test';import assert from 'node:assert/strict';
import {isVerticalParagraphFormat,preservesCanvasMetricRequests,installCanvasMetricMutationGuards} from '../src/canvas-metric-mutations.mjs';
test('only known vertical paragraph geometry preserves glyph requests',()=>{
 assert.equal(isVerticalParagraphFormat({lineSpacing:180,lineSpacingType:'Percent'}),true);
 for(const props of [{lineSpacing:Infinity},{lineSpacing:NaN},{lineSpacing:-1},{lineSpacingType:'unknown'},{lineSpacing:180,fontSize:1200},{alignment:'Center'},{},null,[]])assert.equal(isVerticalParagraphFormat(props),false);
 assert.equal(preservesCanvasMetricRequests('applyParaFormatInCellByPath',[0,1,'[]','{"lineSpacing":200}']),true);
 assert.equal(preservesCanvasMetricRequests('applyParaFormat',[0,0,'broken']),false);
 assert.equal(preservesCanvasMetricRequests('applyCharFormat',[0,0,0,1,{lineSpacing:200}]),false);
});
test('text, character, definitions, undo restores and unknown paragraph fields invalidate before mutation',()=>{
 const calls=[],bridge={applyParaFormat(...args){calls.push(['paragraph',args]);return 'done';},insertText(){calls.push(['text']);},applyCharFormat(){calls.push(['character']);},restoreSnapshot(){calls.push(['restore']);}};
 installCanvasMetricMutationGuards(bridge,['applyParaFormat','insertText','applyCharFormat'],()=>calls.push(['invalidated']));
 assert.equal(bridge.applyParaFormat(0,0,'{"lineSpacing":180,"lineSpacingType":"Percent"}'),'done');assert.deepEqual(calls.map(c=>c[0]),['paragraph']);calls.length=0;
 bridge.applyParaFormat(0,0,'{"headingType":"Number"}');bridge.insertText();bridge.applyCharFormat();bridge.restoreSnapshot();assert.deepEqual(calls.map(c=>c[0]),['invalidated','paragraph','invalidated','text','invalidated','character','invalidated','restore']);
});
