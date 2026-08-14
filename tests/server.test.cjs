const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const server = require('../skills/brainstorming/scripts/server.cjs');
const helper = require('../skills/brainstorming/scripts/helper.js');

function maskedFrame(payload) {
  const data = Buffer.from(payload);
  const mask = Buffer.from([1, 2, 3, 4]);
  let header;

  if (data.length < 126) {
    header = Buffer.from([0x81, 0x80 | data.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  }

  const encoded = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) encoded[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, encoded]);
}

function waitForStartup(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let pending = '';
    const timer = setTimeout(() => reject(new Error(`startup timeout: ${stderr}`)), 5000);

    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) {
        try {
          const value = JSON.parse(line);
          if (value.type === 'server-started') {
            clearTimeout(timer);
            resolve(value);
          }
        } catch {}
      }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}: ${stderr}`));
    });
  });
}

test('WebSocket helpers handle protocol boundaries', () => {
  assert.equal(
    server.computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ=='),
    's3pPLMBiTxaQ9kYGzzhZRbK+xOo='
  );

  for (const size of [5, 200]) {
    const payload = 'x'.repeat(size);
    assert.equal(server.decodeFrame(maskedFrame(payload)).payload.toString(), payload);
  }

  assert.throws(
    () => server.decodeFrame(Buffer.from([0x81, 0x01, 0x61])),
    /masked/
  );
  assert.equal(helper.nextReconnectDelay(500, 30000), 1000);
  assert.equal(helper.nextReconnectDelay(20000, 30000), 30000);
});

test('version lookup walks ancestors and accepts either plugin manifest', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-version-'));
  const nested = path.join(fixtureRoot, 'skills', 'example', 'scripts');
  const codexManifest = path.join(fixtureRoot, '.codex-plugin', 'plugin.json');
  const claudeManifest = path.join(fixtureRoot, '.claude-plugin', 'plugin.json');

  try {
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(path.dirname(codexManifest), { recursive: true });
    fs.writeFileSync(codexManifest, JSON.stringify({ version: '2.0.0' }));
    assert.equal(server.readSkillquiverVersion(nested), '2.0.0');

    fs.rmSync(codexManifest);
    fs.mkdirSync(path.dirname(claudeManifest), { recursive: true });
    fs.writeFileSync(claudeManifest, JSON.stringify({ version: '2.0.0' }));
    assert.equal(server.readSkillquiverVersion(nested), '2.0.0');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('companion rejects unauthenticated and traversal requests', async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-test-'));
  const child = spawn(process.execPath, [
    'skills/brainstorming/scripts/server.cjs'
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      BRAINSTORM_DIR: sessionDir,
      BRAINSTORM_HOST: '127.0.0.1',
      BRAINSTORM_URL_HOST: '127.0.0.1',
      BRAINSTORM_IDLE_TIMEOUT_MS: '60000',
      BRAINSTORM_LIFECYCLE_CHECK_MS: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const info = await waitForStartup(child);
    const base = `http://localhost:${info.port}`;

    const denied = await fetch(`${base}/`);
    assert.equal(denied.status, 403);

    const bootstrap = await fetch(info.url, { redirect: 'manual' });
    assert.equal(bootstrap.status, 200);
    assert.match(await bootstrap.text(), /sessionStorage/);
    const cookie = bootstrap.headers.get('set-cookie').split(';', 1)[0];

    const page = await fetch(`${base}/`, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(await page.text(), /Skillquiver v2\.1\.0/);

    const traversal = await fetch(`${base}/files/..%2Fserver.cjs`, {
      headers: { cookie }
    });
    assert.equal(traversal.status, 404);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    if (child.exitCode === null) {
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});
