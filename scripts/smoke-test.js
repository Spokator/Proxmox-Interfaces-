'use strict';

const { spawn } = require('child_process');
const http = require('http');

const port = Number(process.env.SMOKE_PORT || 3100);
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const start = Date.now();

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getStatus() {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/api/status',
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ code: res.statusCode, body: data });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', reject);
  });
}

async function run() {
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await getStatus();
        if (result.code === 200) {
          const parsed = JSON.parse(result.body);
          if (!parsed || typeof parsed.total !== 'number') {
            throw new Error('Unexpected /api/status payload');
          }
          console.log('Smoke test OK on /api/status');
          child.kill('SIGTERM');
          process.exit(0);
        }
      } catch {
        // Server not ready yet, continue polling.
      }
      await wait(500);
    }

    throw new Error('Server did not become healthy before timeout');
  } catch (err) {
    child.kill('SIGTERM');
    const details = stderr ? `\nServer stderr:\n${stderr}` : '';
    console.error(`Smoke test failed: ${err.message}${details}`);
    process.exit(1);
  }
}

run();
