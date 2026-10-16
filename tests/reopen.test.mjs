import test from 'node:test';import assert from 'node:assert/strict';import {isViewerResourceUri,VIEWER_URI,handleRequest,TOOLS} from '../src/server.mjs';
test('fresh file entrypoint identifies the current release instead of reusing stale host HTML',()=>{assert.equal(VIEWER_URI,'ui://pwh/inline-editor-0.6.11');});
test('reopening accepts previous inline resource versions and rejects unrelated resources',()=>{
 for(const uri of ['ui://pwh/inline-editor','ui://pwh/inline-editor-0.5.0','ui://pwh/inline-editor-0.5.8','ui://pwh/inline-editor-0.5.9'])assert.equal(isViewerResourceUri(uri),true);
 for(const uri of ['file:///any','ui://evil/inline-editor-0.5.8','ui://pwh/inline-editor-0.5.8/../../x',null])assert.equal(isViewerResourceUri(uri),false);
});

test('latest file handler uses the fresh resource while previous frame identities remain advertised',async()=>{
 const response=await handleRequest({jsonrpc:'2.0',id:1,method:'resources/list'});
 const uris=response.result.resources.map(r=>r.uri);
 assert.equal(uris[0],VIEWER_URI);assert.ok(uris.includes('ui://pwh/inline-editor-0.6.0'));assert.ok(uris.includes('ui://pwh/inline-editor-0.6.4'));
 assert.equal(TOOLS.find(t=>t._meta?.['openai/ui']?.entrypoints)?.['_meta'].ui.resourceUri,VIEWER_URI);
});
