const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const forward = require('../benchmarks/improve-agent-instructions/forward.cjs');

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const APPLY_AGENTS_BEFORE = Buffer.concat([UTF8_BOM, Buffer.from(
  '# Project\r\n\r\nUse npm from the repository root.\r\nKeep dirty dependency guidance.\r\n')]);
const APPLY_AGENTS_AFTER = Buffer.concat([UTF8_BOM, Buffer.from(
  '# Project\r\n\r\nUse pnpm from the repository root.\r\nKeep dirty dependency guidance.\r\n')]);
const APPLY_CLAUDE_BEFORE = Buffer.from(
  '# Shared rules\n\nUse npm from the repository root.\n\nClaude-only: use /context.\n');
const APPLY_CLAUDE_AFTER = Buffer.from('@AGENTS.md\n\nClaude-only: use /context.\n');
const APPLY_CODEX_GLOBAL_BEFORE = Buffer.from('# Codex global\n\nUse npm from PATH.\n');
const APPLY_CLAUDE_GLOBAL_BEFORE = Buffer.from('# Claude global\n\nUse npm from PATH.\n');
const PARTIAL_CODEX_AFTER = Buffer.from(
  '# Codex global\n\nKeep commands read-only unless writes are authorized.\n');
const PARTIAL_CODEX_BEFORE = Buffer.from('# Codex global\n\nKeep the original host delta.\n');
const PARTIAL_CLAUDE_BEFORE = Buffer.from('# Claude global\n\nKeep the original host delta.\n');
const PARTIAL_MARKER = Buffer.from('\n<!-- evaluator-concurrent-marker -->\n');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hostEvidence(logs) {
  writeJson(path.join(logs, 'host-evidence.json'), {
    schemaVersion: 1,
    hosts: [
      { host: 'codex', status: 'verified' },
      { host: 'claude', status: 'verified' },
    ],
  });
}

function completeReport(logs, scenarioId, verificationMatrix) {
  writeJson(path.join(logs, 'report.json'), {
    schemaVersion: 1,
    scenarioId,
    targetMatrix: [{ path: 'subject', status: 'verified' }],
    effectiveChain: [
      { host: 'codex', status: 'verified' },
      { host: 'claude', status: 'verified' },
    ],
    decisionLedger: [{ id: `${scenarioId}-decision`, status: 'verified' }],
    changesAndRecovery: { status: 'verified' },
    verificationMatrix,
    pendingQuestions: scenarioId === 'partial'
      ? [{ id: 'nested-ambiguity', status: 'blocked' }]
      : [],
  });
}

function snapshotForEvidence(subject) {
  const entries = {};
  const roots = [
    path.join(subject, 'home', '.codex', 'AGENTS.override.md'),
    path.join(subject, 'home', '.codex', 'AGENTS.md'),
    path.join(subject, 'repo'),
    path.join(subject, 'home', '.skillquiver', 'backups'),
  ];
  const visit = (entryPath) => {
    if (!fs.existsSync(entryPath)) return;
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entryPath).sort()) visit(path.join(entryPath, name));
      return;
    }
    const bytes = fs.readFileSync(entryPath);
    entries[path.relative(subject, entryPath).split(path.sep).join('/')] = {
      sha256: sha256(bytes),
      size: bytes.length,
    };
  };
  for (const entryPath of roots) visit(entryPath);
  const claudeRoot = path.join(subject, 'home', '.claude');
  const visitClaude = (entryPath) => {
    if (!fs.existsSync(entryPath)) return;
    const stat = fs.statSync(entryPath);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entryPath).sort()) visitClaude(path.join(entryPath, name));
    } else if (path.extname(entryPath) === '.md') {
      const bytes = fs.readFileSync(entryPath);
      entries[path.relative(subject, entryPath).split(path.sep).join('/')] = {
        sha256: sha256(bytes),
        size: bytes.length,
      };
    }
  };
  visitClaude(claudeRoot);
  return entries;
}

function temporaryRun(t, scenarioId) {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), `instruction-forward-${scenarioId}-`));
  t.after(() => fs.rmSync(runRoot, { recursive: true, force: true }));
  const prepared = forward.prepareFixture(scenarioId, runRoot);
  return {
    runRoot,
    subject: prepared.subjectRoot,
    logs: path.join(runRoot, 'logs'),
  };
}

test('audit fixture passes complete evidence and rejects a changed target', (t) => {
  assert.deepEqual(Object.keys(forward).sort(),
    ['gradeScenario', 'prepareFixture', 'runCli', 'snapshotTargets']);
  const { runRoot, subject, logs } = temporaryRun(t, 'audit');
  const sources = [
    { id: 'claude-project', host: 'claude', loadState: 'active' },
    { id: 'claude-rule', host: 'claude', loadState: 'conditional' },
    { id: 'claude-user', host: 'claude', loadState: 'active' },
    { id: 'codex-deep', host: 'codex', loadState: 'truncated' },
    { id: 'codex-global', host: 'codex', loadState: 'active' },
    { id: 'codex-global-base', host: 'codex', loadState: 'shadowed' },
    { id: 'codex-nested', host: 'codex', loadState: 'active' },
    { id: 'codex-root-fallback', host: 'codex', loadState: 'shadowed' },
  ];
  writeJson(path.join(logs, 'manifest-1.json'), {
    schemaVersion: 1,
    run: { generatedAt: '2030-01-01T00:00:00.000Z', inspector: 'node' },
    sources,
  });
  writeJson(path.join(logs, 'manifest-2.json'), {
    schemaVersion: 1,
    run: { generatedAt: '2030-01-02T00:00:00.000Z', inspector: 'node' },
    sources,
  });
  writeJson(path.join(logs, 'command-trace.json'), {
    invocations: [
      { command: 'inventory', host: 'both', status: 'verified' },
      { command: 'inventory', host: 'both', status: 'verified' },
    ],
  });
  hostEvidence(logs);
  completeReport(logs, 'audit', [
    { claim: 'static-chain', status: 'verified' },
    { claim: 'unsafe-runtime-probe', status: 'unverified' },
  ]);

  assert.equal(forward.gradeScenario('audit', runRoot).outcome, 'pass');
  const output = [];
  assert.equal(forward.runCli(['grade', 'audit', runRoot], {
    stdout: { write: (text) => output.push(text) },
    stderr: { write: () => assert.fail('grade should not write stderr') },
  }), 0);
  assert.equal(JSON.parse(output.join('')).outcome, 'pass');

  fs.appendFileSync(path.join(subject, 'repo', 'AGENTS.md'), 'changed\n');
  const corrupted = forward.gradeScenario('audit', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'targets_unchanged').status, 'fail');
});

test('apply fixture passes durable idempotent evidence and rejects a bad backup', (t) => {
  const { runRoot, subject, logs } = temporaryRun(t, 'apply');
  fs.writeFileSync(path.join(subject, 'home', '.codex', 'AGENTS.md'),
    '# Codex global\n\nUse pnpm from the verified executable path.\n');
  fs.writeFileSync(path.join(subject, 'home', '.claude', 'CLAUDE.md'),
    '# Claude global\n\nUse pnpm from the verified executable path.\n');
  fs.writeFileSync(path.join(subject, 'repo', 'AGENTS.md'), APPLY_AGENTS_AFTER);
  fs.writeFileSync(path.join(subject, 'repo', 'CLAUDE.md'), APPLY_CLAUDE_AFTER);

  const backup = path.join(subject, 'home', '.skillquiver', 'backups',
    'improve-agent-instructions', 'apply-001');
  fs.mkdirSync(path.join(backup, 'preimages'), { recursive: true });
  fs.writeFileSync(path.join(backup, 'preimages', 'codex-AGENTS.md'),
    APPLY_CODEX_GLOBAL_BEFORE);
  fs.writeFileSync(path.join(backup, 'preimages', 'claude-CLAUDE.md'),
    APPLY_CLAUDE_GLOBAL_BEFORE);
  fs.writeFileSync(path.join(backup, 'preimages', 'AGENTS.md'), APPLY_AGENTS_BEFORE);
  fs.writeFileSync(path.join(backup, 'preimages', 'CLAUDE.md'), APPLY_CLAUDE_BEFORE);
  writeJson(path.join(backup, 'restoration.json'), {
    schemaVersion: 1,
    status: 'verified',
    files: [
      { path: 'home/.codex/AGENTS.md', preimage: 'preimages/codex-AGENTS.md', status: 'verified' },
      { path: 'home/.claude/CLAUDE.md', preimage: 'preimages/claude-CLAUDE.md', status: 'verified' },
      { path: 'repo/AGENTS.md', preimage: 'preimages/AGENTS.md', status: 'verified' },
      { path: 'repo/CLAUDE.md', preimage: 'preimages/CLAUDE.md', status: 'verified' },
    ],
  });
  writeJson(path.join(logs, 'facts.json'), {
    facts: [
      { id: 'package-manager', value: 'pnpm', status: 'verified' },
      { id: 'pnpm-path', path: 'subject/tools/pnpm', status: 'verified' },
    ],
  });
  hostEvidence(logs);
  completeReport(logs, 'apply', [
    { claim: 'static-chain', status: 'verified' },
    { claim: 'idempotence', status: 'verified' },
  ]);
  const stableSnapshot = snapshotForEvidence(subject);
  writeJson(path.join(logs, 'first-target-snapshot.json'), stableSnapshot);
  writeJson(path.join(logs, 'second-target-snapshot.json'), stableSnapshot);

  assert.equal(forward.gradeScenario('apply', runRoot).outcome, 'pass');

  fs.writeFileSync(path.join(backup, 'preimages', 'AGENTS.md'), 'not the original bytes\n');
  const corrupted = forward.gradeScenario('apply', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'backup_preimages').status, 'fail');
});

test('partial fixture passes selective recovery evidence and rejects incomplete rollback', (t) => {
  const { runRoot, subject, logs } = temporaryRun(t, 'partial');
  fs.writeFileSync(path.join(subject, 'home', '.codex', 'AGENTS.md'), PARTIAL_CODEX_AFTER);
  fs.writeFileSync(path.join(subject, 'home', '.claude', 'CLAUDE.md'),
    Buffer.concat([PARTIAL_CLAUDE_BEFORE, PARTIAL_MARKER]));

  const backup = path.join(subject, 'home', '.skillquiver', 'backups',
    'improve-agent-instructions', 'partial-001');
  fs.mkdirSync(path.join(backup, 'preimages'), { recursive: true });
  fs.writeFileSync(path.join(backup, 'preimages', 'codex-AGENTS.md'), PARTIAL_CODEX_BEFORE);
  fs.writeFileSync(path.join(backup, 'preimages', 'claude-CLAUDE.md'), PARTIAL_CLAUDE_BEFORE);
  fs.writeFileSync(path.join(backup, 'preimages', 'AGENTS.md'),
    '# Shared project\n\nUse npm until the migration is verified.\n');
  fs.writeFileSync(path.join(backup, 'preimages', 'CLAUDE.md'),
    '# Claude project\n\nKeep the project-only delta.\n');
  writeJson(path.join(backup, 'restoration.json'), {
    schemaVersion: 1,
    transactions: [
      { id: 'codex-global', status: 'applied' },
      { id: 'claude-global', status: 'concurrent-change' },
      { id: 'project-shared', status: 'rolled-back' },
      { id: 'nested-scope', status: 'blocked' },
    ],
  });
  writeJson(path.join(logs, 'verification-trace.json'), {
    projectShared: [
      { phase: 'before-rollback', status: 'fail' },
      { phase: 'after-rollback', status: 'pass' },
    ],
  });
  hostEvidence(logs);
  completeReport(logs, 'partial', [
    { claim: 'codex-global', status: 'verified' },
    { claim: 'nested-ambiguity', status: 'blocked' },
    { claim: 'runtime-loading', status: 'unverified' },
  ]);

  assert.equal(forward.gradeScenario('partial', runRoot).outcome, 'pass');

  fs.appendFileSync(path.join(subject, 'repo', 'CLAUDE.md'), 'rollback incomplete\n');
  const corrupted = forward.gradeScenario('partial', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'project_pair_rolled_back').status,
    'fail');
});
