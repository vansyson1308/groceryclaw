import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function stopProcess(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const force = setTimeout(() => proc.kill('SIGKILL'), 2000);
    proc.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

/**
 * Spawns a node service and waits until `readyUrl` answers 2xx.
 * The process is always stopped when the test `t` finishes, pass or fail,
 * so a failed assertion can never leak a server that holds a port.
 */
export async function startService(t, { script, env, readyUrl, timeoutMs = 8000 }) {
  const proc = spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => stopProcess(proc));

  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk; });
  proc.stderr.on('data', (chunk) => { output += chunk; });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`${script} exited early (code=${proc.exitCode}):\n${output}`);
    }
    try {
      const resp = await fetch(readyUrl);
      if (resp.ok) return proc;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`${script} not ready at ${readyUrl} within ${timeoutMs} ms:\n${output}`);
}
