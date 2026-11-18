import test from 'node:test';
import assert from 'node:assert/strict';
import {documentTabStartupMessage} from '../desktop/standalone-pwh/workspace-shell.mjs';

test('missing packaged modules are named without exposing a truncated internal stack',()=>{
 const message=documentTabStartupMessage("node:internal/modules/esm/resolve:272\nError [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\Program Files\\WindowsApps\\Pwh\\standalone-pwh\\linux-credentials.mjs' imported from other.mjs\n at loader");
 assert.match(message,/linux-credentials\.mjs/);assert.match(message,/업데이트/);
 assert.doesNotMatch(message,/Program Files|node:internal|at loader/);
});
test('unknown startup failures refer to the diagnostic record',()=>{
 const message=documentTabStartupMessage('private internal details');assert.match(message,/진단 기록/);assert.doesNotMatch(message,/private internal details/);
});
