import { spawn } from 'node:child_process';
import config from './config.mjs';

// Keep the upstream stdio protocol intact: diagnostics only go to stderr.
const child = spawn(config.rhwpPath, ['mcp-serve'], { stdio: 'inherit', windowsHide: true, shell: false });
const forwarding = new Map();
for (const signal of ['SIGINT', 'SIGTERM']) {
  const forward = () => { if (!child.killed) child.kill(signal); };
  forwarding.set(signal, forward);
  process.on(signal, forward);
}
function cleanup() { for (const [signal, handler] of forwarding) process.off(signal, handler); }
child.once('error', error => {
  cleanup();
  process.stderr.write(`pwh: cannot start the configured rhwp MCP engine: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', code => { cleanup(); process.exitCode = code ?? 1; });
