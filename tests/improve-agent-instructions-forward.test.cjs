const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
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

function hostEvidence(logs, subject, scenarioId) {
  const targetSha256 = sha256(JSON.stringify(snapshotForEvidence(subject)));
  const reportSha256 = sha256(fs.readFileSync(path.join(logs, 'report.json')));
  const hosts = ['codex', 'claude'].map((host) => {
    const inspectorPath = path.join(logs, 'hosts', host, 'inspector-stdout.json');
    const finalPath = path.join(logs, 'hosts', host, 'host-final.json');
    writeJson(inspectorPath, {
      schemaVersion: 1,
      scenarioId,
      host,
      status: 'captured',
      targetSha256,
    });
    writeJson(finalPath, {
      schemaVersion: 1,
      scenarioId,
      host,
      status: 'captured',
      reportSha256,
    });
    return {
      host,
      scenarioId,
      status: 'verified',
      inspector: {
        path: `logs/hosts/${host}/inspector-stdout.json`,
        sha256: sha256(fs.readFileSync(inspectorPath)),
      },
      final: {
        path: `logs/hosts/${host}/host-final.json`,
        sha256: sha256(fs.readFileSync(finalPath)),
      },
    };
  });
  writeJson(path.join(logs, 'host-evidence.json'), {
    schemaVersion: 1,
    scenarioId,
    hosts,
  });
}

function completeReport(logs, scenarioId) {
  const reports = {
    audit: {
      targetMatrix: [
        { id: 'codex-global', status: 'verified' },
        { id: 'codex-project', status: 'verified' },
        { id: 'claude-global', status: 'verified' },
        { id: 'claude-project', status: 'verified' },
      ],
      effectiveChain: [
        { id: 'codex-chain', status: 'verified' },
        { id: 'claude-chain', status: 'verified' },
      ],
      decisionLedger: [
        { id: 'audit-read-only', disposition: 'keep', target: 'all-targets', status: 'verified' },
      ],
      changesAndRecovery: {
        transactions: [{ id: 'audit', status: 'unchanged', targets: ['all-targets'] }],
      },
      verificationMatrix: [
        { claim: 'targets-unchanged', status: 'verified' },
        { claim: 'manifests-deterministic', status: 'verified' },
        { claim: 'source-states', status: 'verified' },
        { claim: 'inspector-invocations', status: 'verified' },
        { claim: 'secret-free', status: 'verified' },
        { claim: 'unsafe-runtime-probe', status: 'unverified' },
        { claim: 'host-primary-evidence', status: 'verified' },
      ],
      pendingQuestions: [],
    },
    apply: {
      targetMatrix: [
        { id: 'codex-global', status: 'verified' },
        { id: 'claude-global', status: 'verified' },
        { id: 'project-agents', status: 'verified' },
        { id: 'project-claude', status: 'verified' },
        { id: 'project-private', status: 'verified' },
      ],
      effectiveChain: [
        { id: 'codex-chain', status: 'verified' },
        { id: 'claude-chain', status: 'verified' },
      ],
      decisionLedger: [
        { id: 'package-manager-guidance', disposition: 'sharpen', target: 'project-agents', status: 'verified' },
        { id: 'shared-guidance', disposition: 'move', target: 'project-agents', status: 'verified' },
        { id: 'claude-delta', disposition: 'keep', target: 'project-claude', status: 'verified' },
        { id: 'private-local', disposition: 'keep', target: 'project-private', status: 'verified' },
      ],
      changesAndRecovery: {
        transactions: [
          { id: 'codex-global', status: 'applied', targets: ['codex-global'] },
          { id: 'claude-global', status: 'applied', targets: ['claude-global'] },
          { id: 'project-shared', status: 'applied', targets: ['project-agents', 'project-claude'] },
        ],
      },
      verificationMatrix: [
        { claim: 'backup-location', status: 'verified' },
        { claim: 'backup-preimages', status: 'verified' },
        { claim: 'global-guidance', status: 'verified' },
        { claim: 'canonical-project', status: 'verified' },
        { claim: 'dirty-guidance', status: 'verified' },
        { claim: 'claude-import', status: 'verified' },
        { claim: 'private-local', status: 'verified' },
        { claim: 'representation', status: 'verified' },
        { claim: 'repository-facts', status: 'verified' },
        { claim: 'idempotence', status: 'verified' },
        { claim: 'secret-free', status: 'verified' },
        { claim: 'host-primary-evidence', status: 'verified' },
      ],
      pendingQuestions: [],
    },
    partial: {
      targetMatrix: [
        { id: 'codex-global', status: 'verified' },
        { id: 'claude-global', status: 'blocked' },
        { id: 'project-agents', status: 'verified' },
        { id: 'project-claude', status: 'verified' },
        { id: 'nested-scope', status: 'blocked' },
      ],
      effectiveChain: [
        { id: 'codex-chain', status: 'verified' },
        { id: 'claude-chain', status: 'unverified' },
      ],
      decisionLedger: [
        { id: 'safe-codex-global', disposition: 'sharpen', target: 'codex-global', status: 'verified' },
        { id: 'claude-concurrent', disposition: 'keep', target: 'claude-global', status: 'blocked' },
        { id: 'project-shared', disposition: 'sharpen', target: 'project-agents', status: 'verified' },
        { id: 'nested-ambiguity', disposition: 'blocked-decision', target: 'nested-scope', status: 'blocked' },
      ],
      changesAndRecovery: {
        transactions: [
          { id: 'codex-global', status: 'applied', targets: ['codex-global'] },
          { id: 'claude-global', status: 'concurrent-change', targets: ['claude-global'] },
          { id: 'project-shared', status: 'rolled-back', targets: ['project-agents', 'project-claude'] },
          { id: 'nested-scope', status: 'blocked', targets: ['nested-scope'] },
        ],
      },
      verificationMatrix: [
        { claim: 'backup-location', status: 'verified' },
        { claim: 'codex-global', status: 'verified' },
        { claim: 'claude-concurrent', status: 'verified' },
        { claim: 'project-rollback', status: 'verified' },
        { claim: 'nested-ambiguity', status: 'blocked' },
        { claim: 'restoration', status: 'verified' },
        { claim: 'control-sequence', status: 'verified' },
        { claim: 'runtime-loading', status: 'unverified' },
        { claim: 'host-primary-evidence', status: 'verified' },
      ],
      pendingQuestions: [{ id: 'nested-ambiguity', status: 'blocked' }],
    },
  };
  const report = { schemaVersion: 1, scenarioId, ...reports[scenarioId] };
  writeJson(path.join(logs, 'report.json'), report);
  return report;
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

function applyInvocationEvidence(logs, subject) {
  const firstSnapshotPath = path.join(logs, 'first-target-snapshot.json');
  const secondSnapshotPath = path.join(logs, 'second-target-snapshot.json');
  writeJson(firstSnapshotPath, snapshotForEvidence(subject));
  writeJson(secondSnapshotPath, snapshotForEvidence(subject));
  const firstOutputPath = path.join(logs, 'apply-1-output.json');
  const secondOutputPath = path.join(logs, 'apply-2-output.json');
  writeJson(firstOutputPath, {
    schemaVersion: 1,
    scenarioId: 'apply',
    invocationId: 'apply-1',
    status: 'changed',
    snapshotSha256: sha256(fs.readFileSync(firstSnapshotPath)),
  });
  writeJson(secondOutputPath, {
    schemaVersion: 1,
    scenarioId: 'apply',
    invocationId: 'apply-2',
    status: 'no-change',
    snapshotSha256: sha256(fs.readFileSync(secondSnapshotPath)),
  });
  const trace = {
    schemaVersion: 1,
    scenarioId: 'apply',
    invocations: [
      {
        invocationId: 'apply-1',
        ordinal: 1,
        snapshotPath: 'logs/first-target-snapshot.json',
        snapshotSha256: sha256(fs.readFileSync(firstSnapshotPath)),
        outputPath: 'logs/apply-1-output.json',
        outputSha256: sha256(fs.readFileSync(firstOutputPath)),
      },
      {
        invocationId: 'apply-2',
        previousInvocationId: 'apply-1',
        ordinal: 2,
        snapshotPath: 'logs/second-target-snapshot.json',
        snapshotSha256: sha256(fs.readFileSync(secondSnapshotPath)),
        outputPath: 'logs/apply-2-output.json',
        outputSha256: sha256(fs.readFileSync(secondOutputPath)),
      },
    ],
  };
  writeJson(path.join(logs, 'apply-invocations.json'), trace);
  return trace;
}

function partialSequenceEvidence(logs, subject, checkpoints, controlRuns) {
  const paths = {
    inventory: path.join(logs, 'partial-01-after-inventory.json'),
    marker: path.join(logs, 'partial-02-after-marker.json'),
    beforeRollback: path.join(logs, 'partial-03-before-rollback.json'),
    afterRollback: path.join(logs, 'partial-04-after-rollback.json'),
    markerOutput: path.join(logs, 'partial-marker-output.json'),
    beforeOutput: path.join(logs, 'partial-verifier-before.log'),
    afterOutput: path.join(logs, 'partial-verifier-after.log'),
  };
  writeJson(paths.inventory, checkpoints.inventory);
  writeJson(paths.marker, checkpoints.marker);
  writeJson(paths.beforeRollback, checkpoints.beforeRollback);
  writeJson(paths.afterRollback, checkpoints.afterRollback);
  writeJson(paths.markerOutput, {
    schemaVersion: 1,
    scenarioId: 'partial',
    invocationId: 'marker-1',
    status: 'appended',
    exitCode: controlRuns.marker.status,
  });
  fs.writeFileSync(paths.beforeOutput, controlRuns.before.stdout);
  fs.writeFileSync(paths.afterOutput, controlRuns.after.stdout);
  const controlPath = path.join(subject, 'controls', 'append-concurrent.cjs');
  const verifierPath = path.join(subject, 'controls', 'verify-project.cjs');
  const trace = {
    schemaVersion: 1,
    scenarioId: 'partial',
    events: [
      {
        id: 'inventory-1',
        ordinal: 1,
        kind: 'inventory',
        snapshotPath: 'logs/partial-01-after-inventory.json',
        snapshotSha256: sha256(fs.readFileSync(paths.inventory)),
      },
      {
        id: 'marker-1',
        after: 'inventory-1',
        ordinal: 2,
        kind: 'control',
        controlPath: 'subject/controls/append-concurrent.cjs',
        controlSha256: sha256(fs.readFileSync(controlPath)),
        outputPath: 'logs/partial-marker-output.json',
        outputSha256: sha256(fs.readFileSync(paths.markerOutput)),
        snapshotPath: 'logs/partial-02-after-marker.json',
        snapshotSha256: sha256(fs.readFileSync(paths.marker)),
      },
      {
        id: 'verify-before',
        after: 'marker-1',
        ordinal: 3,
        kind: 'verifier',
        controlPath: 'subject/controls/verify-project.cjs',
        controlSha256: sha256(fs.readFileSync(verifierPath)),
        outputPath: 'logs/partial-verifier-before.log',
        outputSha256: sha256(fs.readFileSync(paths.beforeOutput)),
        exitCode: controlRuns.before.status,
        snapshotPath: 'logs/partial-03-before-rollback.json',
        snapshotSha256: sha256(fs.readFileSync(paths.beforeRollback)),
      },
      {
        id: 'rollback-1',
        after: 'verify-before',
        ordinal: 4,
        kind: 'rollback',
        snapshotPath: 'logs/partial-04-after-rollback.json',
        snapshotSha256: sha256(fs.readFileSync(paths.afterRollback)),
      },
      {
        id: 'verify-after',
        after: 'rollback-1',
        ordinal: 5,
        kind: 'verifier',
        controlPath: 'subject/controls/verify-project.cjs',
        controlSha256: sha256(fs.readFileSync(verifierPath)),
        outputPath: 'logs/partial-verifier-after.log',
        outputSha256: sha256(fs.readFileSync(paths.afterOutput)),
        exitCode: controlRuns.after.status,
        snapshotPath: 'logs/partial-04-after-rollback.json',
        snapshotSha256: sha256(fs.readFileSync(paths.afterRollback)),
      },
    ],
  };
  writeJson(path.join(logs, 'partial-invocations.json'), trace);
  return trace;
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
  const auditReport = completeReport(logs, 'audit');
  hostEvidence(logs, subject, 'audit');

  assert.equal(forward.gradeScenario('audit', runRoot).outcome, 'pass');
  const output = [];
  assert.equal(forward.runCli(['grade', 'audit', runRoot], {
    stdout: { write: (text) => output.push(text) },
    stderr: { write: () => assert.fail('grade should not write stderr') },
  }), 0);
  assert.equal(JSON.parse(output.join('')).outcome, 'pass');

  const unavailableReport = structuredClone(auditReport);
  unavailableReport.verificationMatrix.find(
    (item) => item.claim === 'host-primary-evidence').status = 'unverified';
  writeJson(path.join(logs, 'report.json'), unavailableReport);
  hostEvidence(logs, subject, 'audit');
  const codexFinal = path.join(logs, 'hosts', 'codex', 'host-final.json');
  fs.rmSync(codexFinal);
  const missingPrimary = forward.gradeScenario('audit', runRoot);
  assert.equal(missingPrimary.outcome, 'unverified');
  assert.equal(missingPrimary.checks.find((check) => check.id === 'host_evidence').status,
    'unverified');
  assert.equal(missingPrimary.checks.find((check) => check.id === 'report_complete').status,
    'pass');
  writeJson(path.join(logs, 'report.json'), auditReport);
  hostEvidence(logs, subject, 'audit');

  const contradictoryReport = structuredClone(auditReport);
  contradictoryReport.verificationMatrix[0].status = 'unverified';
  writeJson(path.join(logs, 'report.json'), contradictoryReport);
  hostEvidence(logs, subject, 'audit');
  const contradictory = forward.gradeScenario('audit', runRoot);
  assert.equal(contradictory.outcome, 'fail');
  assert.equal(contradictory.checks.find((check) => check.id === 'report_complete').status,
    'fail');
  writeJson(path.join(logs, 'report.json'), auditReport);
  hostEvidence(logs, subject, 'audit');

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
  completeReport(logs, 'apply');
  const invocationTrace = applyInvocationEvidence(logs, subject);
  hostEvidence(logs, subject, 'apply');

  assert.equal(forward.gradeScenario('apply', runRoot).outcome, 'pass');

  const reusedTrace = structuredClone(invocationTrace);
  reusedTrace.invocations[1].invocationId = 'apply-1';
  writeJson(path.join(logs, 'apply-invocations.json'), reusedTrace);
  const reusedInvocation = forward.gradeScenario('apply', runRoot);
  assert.equal(reusedInvocation.outcome, 'fail');
  assert.equal(reusedInvocation.checks.find(
    (check) => check.id === 'second_run_idempotent').status, 'fail');
  writeJson(path.join(logs, 'apply-invocations.json'), invocationTrace);

  fs.writeFileSync(path.join(backup, 'preimages', 'AGENTS.md'), 'not the original bytes\n');
  const corrupted = forward.gradeScenario('apply', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'backup_preimages').status, 'fail');
});

test('partial fixture passes selective recovery evidence and rejects incomplete rollback', (t) => {
  const { runRoot, subject, logs } = temporaryRun(t, 'partial');
  const inventoryCheckpoint = snapshotForEvidence(subject);

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
  const markerRun = childProcess.spawnSync(process.execPath,
    [path.join(subject, 'controls', 'append-concurrent.cjs')], { encoding: 'utf8' });
  assert.equal(markerRun.status, 0, markerRun.stderr);
  const markerCheckpoint = snapshotForEvidence(subject);
  fs.writeFileSync(path.join(subject, 'home', '.codex', 'AGENTS.md'), PARTIAL_CODEX_AFTER);
  fs.writeFileSync(path.join(subject, 'repo', 'AGENTS.md'), '# Invalid shared project\n');
  fs.writeFileSync(path.join(subject, 'repo', 'CLAUDE.md'), '# Invalid Claude project\n');
  const beforeRollbackCheckpoint = snapshotForEvidence(subject);
  const verifierPath = path.join(subject, 'controls', 'verify-project.cjs');
  const beforeRollbackRun = childProcess.spawnSync(process.execPath, [verifierPath], {
    encoding: 'utf8',
  });
  assert.equal(beforeRollbackRun.status, 1);
  assert.equal(beforeRollbackRun.stdout, 'status=fail\n');
  fs.writeFileSync(path.join(subject, 'repo', 'AGENTS.md'),
    '# Shared project\n\nUse npm until the migration is verified.\n');
  fs.writeFileSync(path.join(subject, 'repo', 'CLAUDE.md'),
    '# Claude project\n\nKeep the project-only delta.\n');
  const afterRollbackCheckpoint = snapshotForEvidence(subject);
  const afterRollbackRun = childProcess.spawnSync(process.execPath, [verifierPath], {
    encoding: 'utf8',
  });
  assert.equal(afterRollbackRun.status, 0, afterRollbackRun.stderr);
  assert.equal(afterRollbackRun.stdout, 'status=pass\n');
  const sequenceTrace = partialSequenceEvidence(logs, subject, {
    inventory: inventoryCheckpoint,
    marker: markerCheckpoint,
    beforeRollback: beforeRollbackCheckpoint,
    afterRollback: afterRollbackCheckpoint,
  }, { marker: markerRun, before: beforeRollbackRun, after: afterRollbackRun });
  completeReport(logs, 'partial');
  hostEvidence(logs, subject, 'partial');

  assert.equal(forward.gradeScenario('partial', runRoot).outcome, 'pass');

  const reorderedTrace = structuredClone(sequenceTrace);
  reorderedTrace.events[1].ordinal = 1;
  writeJson(path.join(logs, 'partial-invocations.json'), reorderedTrace);
  const reordered = forward.gradeScenario('partial', runRoot);
  assert.equal(reordered.outcome, 'fail');
  assert.equal(reordered.checks.find((check) => check.id === 'control_sequence').status, 'fail');
  writeJson(path.join(logs, 'partial-invocations.json'), sequenceTrace);

  fs.appendFileSync(path.join(subject, 'repo', 'CLAUDE.md'), 'rollback incomplete\n');
  const corrupted = forward.gradeScenario('partial', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'project_pair_rolled_back').status,
    'fail');
});
