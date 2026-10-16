import test from 'node:test';import assert from 'node:assert/strict';import {isViewerResourceUri,VIEWER_URI} from '../src/server.mjs';
test('file entrypoint identity remains stable across package releases',()=>{assert.equal(VIEWER_URI,'ui://pwh/inline-editor-0.6.0');});
test('reopening accepts previous inline resource versions and rejects unrelated resources',()=>{
 for(const uri of ['ui://pwh/inline-editor','ui://pwh/inline-editor-0.5.0','ui://pwh/inline-editor-0.5.8','ui://pwh/inline-editor-0.5.9'])assert.equal(isViewerResourceUri(uri),true);
 for(const uri of ['file:///any','ui://evil/inline-editor-0.5.8','ui://pwh/inline-editor-0.5.8/../../x',null])assert.equal(isViewerResourceUri(uri),false);
});
