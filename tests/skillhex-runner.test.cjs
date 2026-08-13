const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { digestPayload } = require('../benchmarks/skillhex/integrity.cjs');
const {
  createSchedule,
  installPlugin,
  writeCodexConfig
} = require('../benchmarks/skillhex/runner.cjs');

test('runner freezes three paired repeats with both orders', () => {
  const values = [0, 1];
  const schedule = createSchedule({
    evaluationId: 'example',
    cases: [{ id: 'case-1' }]
  }, () => values.shift());

  assert.equal(schedule.cases[0].repeats.length, 3);
  assert.deepEqual(schedule.cases[0].repeats[0].order, ['baseline', 'candidate']);
  assert.deepEqual(schedule.cases[0].repeats[1].order, ['candidate', 'baseline']);
  assert.deepEqual(schedule.cases[0].repeats[2].order, ['candidate', 'baseline']);
});

test('runner installs the exact staged payload before execution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-runner-'));
  const installedPath = path.join(root, 'installed');
  fs.mkdirSync(installedPath);
  fs.writeFileSync(path.join(installedPath, 'payload.txt'), 'sealed');
  const expectedDigest = digestPayload(installedPath).digest;
  const calls = [];
  const commandRunner = (executable, args) => {
    calls.push([executable, ...args]);
    return args[1] === 'add' && args[0] === 'plugin'
      ? { stdout: JSON.stringify({ name: 'skillquiver', installedPath }) }
      : { stdout: '{}' };
  };

  const result = installPlugin({
    executable: 'codex',
    workspacePath: root,
    homePath: path.join(root, 'home'),
    codexHomePath: path.join(root, 'home', '.codex'),
    expectedDigest,
    commandRunner
  });

  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ['codex', 'plugin', 'marketplace'],
    ['codex', 'plugin', 'add']
  ]);
  assert.equal(result.installedDigest, expectedDigest);
  fs.rmSync(root, { recursive: true, force: true });
});

test('runner rejects an installed payload with a different digest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-runner-'));
  const installedPath = path.join(root, 'installed');
  fs.mkdirSync(installedPath);
  fs.writeFileSync(path.join(installedPath, 'payload.txt'), 'different');
  const commandRunner = (executable, args) => args[1] === 'add' && args[0] === 'plugin'
    ? { stdout: JSON.stringify({ name: 'skillquiver', installedPath }) }
    : { stdout: '{}' };

  assert.throws(() => installPlugin({
    executable: 'codex',
    workspacePath: root,
    homePath: path.join(root, 'home'),
    codexHomePath: path.join(root, 'home', '.codex'),
    expectedDigest: '0'.repeat(64),
    commandRunner
  }), /Installed payload digest mismatch/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('runner enables the isolated Windows workspace sandbox', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-runner-'));
  writeCodexConfig(root);
  const config = fs.readFileSync(path.join(root, 'config.toml'), 'utf8');

  assert.match(config, /approval_policy = "never"/);
  assert.match(config, /\[windows\]\nsandbox = "unelevated"/);
  assert.doesNotMatch(config, /marketplaces|plugins\./);
  fs.rmSync(root, { recursive: true, force: true });
});
