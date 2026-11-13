import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {ribbonTabs,availableRibbonGroups,ribbonCommandIds} from '../src/pwh-ribbon-model.mjs';

test('the shared ribbon follows the document menu categories and keeps File separate',()=>{
 assert.deepEqual(ribbonTabs.map(tab=>tab.id),['edit','view','insert','format','page','table','tool']);
 assert.equal(new Set(ribbonTabs.map(tab=>tab.id)).size,ribbonTabs.length);
 for(const tab of ribbonTabs){assert.ok(tab.label);assert.ok(tab.groups.length);}
});
test('new graphic routes include existing table, layout and editing features',()=>{
 const ids=new Set(ribbonCommandIds());
 for(const id of ['edit:find-replace','edit:goto','format:style-dialog','format:char-shape','format:para-shape','view:zoom-fit-page','view:zoom-fit-width','insert:field','insert:bookmark','insert:symbols','page:setup','page:section-settings','table:insert-row-col','table:delete-row-col','table:cell-merge','table:cell-split','table:cell-width-equal','table:cell-height-equal','table:block-formula','tool:options'])assert.ok(ids.has(id),id);
 assert.equal(ids.size,ribbonCommandIds().length);
});
test('unsupported features and empty groups are not presented as working commands',()=>{
 const page=ribbonTabs.find(tab=>tab.id==='page');
 assert.ok(!ribbonCommandIds().some(id=>['insert:comment','insert:para-band'].includes(id)));
 const groups=availableRibbonGroups(page,id=>id==='page:setup');
 assert.equal(groups.length,1);assert.deepEqual(groups[0].items.map(item=>item.command),['page:setup']);
 assert.equal(availableRibbonGroups(page,()=>false).length,0);
});
test('styles remain available from the real document style selector',()=>{
 const tab=ribbonTabs.find(tab=>tab.id==='format');
 const groups=availableRibbonGroups(tab,()=>false);
 assert.equal(groups.length,1);assert.deepEqual(groups[0].items.map(item=>item.special),['styles']);
});
test('the icon set uses inline vectors without bitmap or product-resource dependencies',async()=>{
 const source=await fs.readFile(new URL('../src/pwh-ribbon-icons.ts',import.meta.url),'utf8');
 assert.ok(source.includes('createElementNS'));assert.ok(!/data:image|\.png|\.ico|background-image|fetch\(/.test(source));
});
