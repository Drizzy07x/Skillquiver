const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const forward = require('../benchmarks/improve-agent-instructions/forward.cjs');
const root = path.resolve(__dirname, '..');

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
const RECOVERY_LEAF = '20300102T030405678Z';
const SECOND_RECOVERY_LEAF = '20300102T030405679Z';
const PNPM_VERSION = '10.0.0\n';
const CHECKPOINT_FILES = {
  audit: ['audit-complete.json'],
  apply: ['apply-pass-1.json', 'apply-pass-2.json'],
  partial: [
    'partial-01-inventory-plan.json',
    'partial-02-recovery-complete.json',
    'partial-03-marker.json',
    'partial-04-prewrite-recheck.json',
    'partial-05-independent-writes.json',
    'partial-06-verifier-failure.json',
    'partial-07-project-rollback.json',
    'partial-08-verifier-success.json',
  ],
};

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertCommonRequest(runRoot, subject, scenarioId, cwd) {
  const prompt = fs.readFileSync(path.join(runRoot, 'logs', 'prompt.md'), 'utf8');
  const project = path.join(subject, 'repo');
  const home = path.join(subject, 'home');
  const inventory = path.join(root, 'skills', 'improve-agent-instructions',
    'scripts', 'inventory.mjs');

  assert.ok(prompt.includes(`Sandbox boundary: ${subject}`));
  assert.ok(prompt.includes(`Project root: ${project}`));
  assert.ok(prompt.includes(`Working directory: ${cwd}`));
  assert.ok(prompt.includes('Requested hosts: Codex and Claude Code.'));
  assert.ok(prompt.includes('Requested scopes: global and project.'));
  assert.ok(prompt.includes(`Skill bundle (read-only): ${path.dirname(path.dirname(inventory))}`));
  assert.ok(prompt.includes(`Worker evidence directory: ${path.join(subject, 'evidence')}`));
  assert.ok(prompt.includes('The evidence directory is neither a target nor a backup directory.'));
  for (const argument of [
    `--host both`, `--cwd ${cwd}`, `--project ${project}`, `--home ${home}`,
    `--codex-home ${path.join(home, '.codex')}`,
    `--claude-home ${path.join(home, '.claude')}`,
    `--claude-managed-dir ${path.join(subject, 'managed', 'claude')}`,
  ]) assert.ok(prompt.includes(argument), `Missing inventory argument: ${argument}`);
  assert.ok(prompt.includes(`node ${inventory}`));
  assert.doesNotMatch(prompt, /capture-challenges|evaluator nonce|expected hashes/i);

  const contract = readJson(path.join(subject, 'controls', 'evidence-contract.json'));
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.evidenceRoot, 'subject/evidence');
  assert.deepEqual(contract.workerArtifacts.checkpoints[scenarioId], CHECKPOINT_FILES[scenarioId]);
  assert.equal(JSON.stringify(contract).includes('expectedStatus'), false);
  assert.equal(JSON.stringify(contract).includes('nonce'), false);
  assert.equal(JSON.stringify(contract).includes('PRIVATE-'), false);
}

function inventoryManifest(subject, generatedAt) {
  return {
    schemaVersion: 1,
    run: { generatedAt, host: 'both' },
    roots: {
      home: { logicalPath: path.join(subject, 'home') },
      project: { logicalPath: path.join(subject, 'repo') },
      cwd: { logicalPath: path.join(subject, 'repo') },
      codexHome: { logicalPath: path.join(subject, 'home', '.codex') },
      claudeHome: { logicalPath: path.join(subject, 'home', '.claude') },
      claudeManaged: { logicalPath: path.join(subject, 'managed', 'claude') },
    },
    sources: [],
    chains: { codex: { sourceIds: [] }, claude: { sourceIds: [] } },
    warnings: [],
  };
}

function createCheckpoints(artifactRoot, scenarioId, payloads) {
  let predecessorSha256 = null;
  return CHECKPOINT_FILES[scenarioId].map((fileName, index) => {
    const checkpoint = {
      schemaVersion: 1,
      scenarioId,
      id: fileName.slice(0, -'.json'.length),
      ordinal: index + 1,
      predecessorSha256,
      ...payloads[index],
    };
    const checkpointPath = path.join(artifactRoot, 'checkpoints', fileName);
    writeJson(checkpointPath, checkpoint);
    predecessorSha256 = sha256(fs.readFileSync(checkpointPath));
    return { ...checkpoint, fileName, sha256: predecessorSha256 };
  });
}

function createWorkerArtifacts(runRoot, subject, scenarioId, host, options) {
  const artifactRoot = path.join(subject, 'evidence', host);
  fs.mkdirSync(artifactRoot, { recursive: true });
  const firstInventory = path.join(artifactRoot, 'inventory-1.stdout.json');
  const secondInventory = path.join(artifactRoot, 'inventory-2.stdout.json');
  writeJson(firstInventory, options.firstInventory ||
    inventoryManifest(subject, '2030-01-01T00:00:00.000Z'));
  writeJson(secondInventory, options.secondInventory ||
    inventoryManifest(subject, '2030-01-02T00:00:00.000Z'));
  const rawFinal = path.join(artifactRoot, 'worker-final.md');
  fs.writeFileSync(rawFinal, options.rawFinal ||
    Buffer.from(`scenario=${scenarioId}\nhost=${host}\n`));
  completeReport(artifactRoot, scenarioId, subject);
  const checkpoints = createCheckpoints(artifactRoot, scenarioId, options.checkpoints);
  writeJson(path.join(artifactRoot, 'command-trace.json'), {
    schemaVersion: 1,
    scenarioId,
    invocations: options.invocations,
    checkpoints: checkpoints.map(({ id, ordinal, fileName, sha256: digest }) => ({
      id,
      ordinal,
      path: `checkpoints/${fileName}`,
      sha256: digest,
    })),
    ...(options.facts ? { facts: options.facts } : {}),
  });
  const relative = (filePath) => path.relative(runRoot, filePath).split(path.sep).join('/');
  const descriptor = {
    schemaVersion: 1,
    scenarioId,
    host,
    rawFinalPath: relative(rawFinal),
    inventoryPaths: [relative(firstInventory), relative(secondInventory)],
  };
  const descriptorPath = path.join(artifactRoot, 'capture.json');
  writeJson(descriptorPath, descriptor);
  return { artifactRoot, descriptor, descriptorPath, firstInventory, secondInventory };
}

function captureWorker(runRoot, scenarioId, created, useCli = false) {
  if (!useCli) return forward.captureEvidence(scenarioId, runRoot, created.descriptor);
  const output = [];
  const status = forward.runCli(['capture', scenarioId, runRoot, created.descriptorPath], {
    stdout: { write: (text) => output.push(text) },
    stderr: { write: (text) => assert.fail(text) },
  });
  assert.equal(status, 0);
  return JSON.parse(output.join(''));
}

function completeReport(artifactRoot, scenarioId, subject) {
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
  reports[scenarioId].targetMatrix[0].evidence = {
    path: 'repo/AGENTS.md',
    sha256: sha256(fs.readFileSync(path.join(subject, 'repo', 'AGENTS.md'))),
  };
  const report = { schemaVersion: 1, scenarioId, ...reports[scenarioId] };
  writeJson(path.join(artifactRoot, 'machine-report.json'), report);
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
      for (const name of fs.readdirSync(entryPath).sort()) {
        if (name !== '.git') visit(path.join(entryPath, name));
      }
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

function representation(bytes) {
  const bom = bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM) ? 'utf8' : 'none';
  const text = bytes.subarray(bom === 'utf8' ? UTF8_BOM.length : 0).toString('utf8');
  const hasCrLf = text.includes('\r\n');
  const hasLf = text.replaceAll('\r\n', '').includes('\n');
  return {
    encoding: 'utf8',
    bom,
    lineEndings: hasCrLf && hasLf ? 'mixed' : hasCrLf ? 'crlf' : hasLf ? 'lf' : 'none',
  };
}

function createRecovery(subject, scenarioId, targets, restoration) {
  const backup = path.join(subject, 'home', '.skillquiver', 'backups',
    'improve-agent-instructions', RECOVERY_LEAF);
  const entries = targets.map(({ targetPath, transaction, preimageName }) => {
    const absoluteTarget = path.join(subject, ...targetPath.split('/'));
    const bytes = fs.readFileSync(absoluteTarget);
    const preimagePath = `preimages/${preimageName}`;
    fs.mkdirSync(path.dirname(path.join(backup, preimagePath)), { recursive: true });
    fs.writeFileSync(path.join(backup, preimagePath), bytes);
    return {
      targetPath,
      transaction,
      existed: true,
      preimagePath,
      absent: false,
      sha256: sha256(bytes),
      ...representation(bytes),
      permissions: { mode: fs.statSync(absoluteTarget).mode & 0o777, source: 'stat' },
    };
  });
  writeJson(path.join(backup, 'manifest.json'), {
    schemaVersion: 1,
    scenarioId,
    entries,
  });
  writeJson(path.join(backup, 'restoration.json'), {
    schemaVersion: 1,
    scenarioId,
    ...restoration,
  });
  return backup;
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
    ['captureEvidence', 'gradeScenario', 'prepareFixture', 'runCli', 'snapshotTargets']);
  const { runRoot, subject, logs } = temporaryRun(t, 'audit');
  assertCommonRequest(runRoot, subject, 'audit', path.join(subject, 'repo', 'packages', 'api'));
  assert.equal(fs.existsSync(path.join(runRoot, 'evaluator', 'capture-challenges.json')), true,
    'prepare must issue evaluator-private capture challenges');
  assert.equal(fs.existsSync(path.join(runRoot, 'evaluator', 'receipts')), false,
    'prepare must not prepopulate passing receipts');
  assert.equal(Object.keys(forward.snapshotTargets(subject))
    .some((relativePath) => relativePath.startsWith('repo/.git/')), false);
  const gitStatus = childProcess.spawnSync('git', ['-C', path.join(subject, 'repo'),
    'status', '--porcelain'], { encoding: 'utf8', shell: false });
  assert.equal(gitStatus.status, 0, gitStatus.stderr);
  assert.equal(gitStatus.stdout, '');

  const sources = [
    { id: 'source-0001', logicalPath: path.join(subject, 'home', '.claude', 'CLAUDE.md'),
      host: 'claude', loadState: 'active' },
    { id: 'source-0002', logicalPath: path.join(subject, 'home', '.codex', 'AGENTS.md'),
      host: 'codex', loadState: 'shadowed' },
    { id: 'source-0003', logicalPath: path.join(subject, 'home', '.codex', 'AGENTS.override.md'),
      host: 'codex', loadState: 'active' },
    { id: 'source-0004', logicalPath: path.join(subject, 'repo', '.claude', 'rules', 'source.md'),
      host: 'claude', loadState: 'conditional' },
    { id: 'source-0005', logicalPath: path.join(subject, 'repo', 'CLAUDE.md'),
      host: 'claude', loadState: 'active' },
    { id: 'source-0006', logicalPath: path.join(subject, 'repo', 'TEAM.md'),
      host: 'codex', loadState: 'shadowed' },
    { id: 'source-0007', logicalPath: path.join(subject, 'repo', 'packages', 'TEAM.md'),
      host: 'codex', loadState: 'active' },
    { id: 'source-0008', logicalPath: path.join(subject, 'repo', 'packages', 'api', 'AGENTS.md'),
      host: 'codex', loadState: 'truncated' },
  ];
  const firstInventory = inventoryManifest(subject, '2030-01-01T00:00:00.000Z');
  const secondInventory = inventoryManifest(subject, '2030-01-02T00:00:00.000Z');
  firstInventory.sources = sources;
  secondInventory.sources = structuredClone(sources);
  const auditOptions = {
    firstInventory,
    secondInventory,
    checkpoints: [{ targetSnapshot: snapshotForEvidence(subject) }],
    invocations: [
      { id: 'inventory-1', ordinal: 1, kind: 'inventory', exitCode: 0 },
      { id: 'inventory-2', ordinal: 2, after: 'inventory-1', kind: 'inventory', exitCode: 0 },
    ],
  };
  const malformed = createWorkerArtifacts(runRoot, subject, 'audit', 'codex', {
    ...auditOptions,
    firstInventory: { schemaVersion: 0 },
  });
  assert.throws(() => captureWorker(runRoot, 'audit', malformed), /schema version 1/i);
  const codexCapture = createWorkerArtifacts(runRoot, subject, 'audit', 'codex', auditOptions);
  captureWorker(runRoot, 'audit', codexCapture);
  const claudeCapture = createWorkerArtifacts(runRoot, subject, 'audit', 'claude', auditOptions);
  captureWorker(runRoot, 'audit', claudeCapture, true);
  assert.throws(() => captureWorker(runRoot, 'audit', codexCapture), /already captured/i);
  const auditReport = readJson(path.join(logs, 'report.json'));

  assert.equal(forward.gradeScenario('audit', runRoot).outcome, 'pass');
  const output = [];
  assert.equal(forward.runCli(['grade', 'audit', runRoot], {
    stdout: { write: (text) => output.push(text) },
    stderr: { write: () => assert.fail('grade should not write stderr') },
  }), 0);
  assert.equal(JSON.parse(output.join('')).outcome, 'pass');

  const hostIndexPath = path.join(logs, 'host-evidence.json');
  const originalHostIndex = fs.readFileSync(hostIndexPath);
  const incompleteHostEvidence = readJson(path.join(logs, 'host-evidence.json'));
  incompleteHostEvidence.hosts = incompleteHostEvidence.hosts.filter(
    (item) => item.host === 'codex');
  writeJson(hostIndexPath, incompleteHostEvidence);
  const missingHostEntry = forward.gradeScenario('audit', runRoot);
  assert.equal(missingHostEntry.outcome, 'unverified');
  assert.equal(missingHostEntry.checks.find((check) => check.id === 'host_evidence').status,
    'unverified');
  fs.writeFileSync(hostIndexPath, originalHostIndex);

  const codexReport = path.join(logs, 'hosts', 'codex', 'machine-report.json');
  const codexReportBytes = fs.readFileSync(codexReport);
  fs.rmSync(codexReport);
  const missingPrimary = forward.gradeScenario('audit', runRoot);
  assert.equal(missingPrimary.outcome, 'unverified');
  assert.equal(missingPrimary.checks.find((check) => check.id === 'host_evidence').status,
    'unverified');
  assert.equal(missingPrimary.checks.find((check) => check.id === 'report_complete').status,
    'pass');
  fs.writeFileSync(codexReport, codexReportBytes);

  const codexWorkerFinal = path.join(logs, 'hosts', 'codex', 'worker-final.md');
  const codexWorkerFinalBytes = fs.readFileSync(codexWorkerFinal);
  fs.rmSync(codexWorkerFinal);
  const missingRawFinal = forward.gradeScenario('audit', runRoot);
  assert.equal(missingRawFinal.outcome, 'unverified');
  assert.equal(missingRawFinal.checks.find((check) => check.id === 'host_evidence').status,
    'unverified');
  fs.writeFileSync(codexWorkerFinal, codexWorkerFinalBytes);

  fs.appendFileSync(codexWorkerFinal, 'tampered\n');
  const tamperedRawFinal = forward.gradeScenario('audit', runRoot);
  assert.equal(tamperedRawFinal.outcome, 'fail');
  assert.equal(tamperedRawFinal.checks.find((check) => check.id === 'host_evidence').status,
    'fail');
  fs.writeFileSync(codexWorkerFinal, codexWorkerFinalBytes);

  const codexReceiptPath = path.join(runRoot, 'evaluator', 'receipts', 'hosts', 'codex.json');
  const codexReceiptBytes = fs.readFileSync(codexReceiptPath);
  const fabricatedReceipt = readJson(codexReceiptPath);
  fabricatedReceipt.evaluatorNonce = '0'.repeat(64);
  writeJson(codexReceiptPath, fabricatedReceipt);
  const fabricated = forward.gradeScenario('audit', runRoot);
  assert.equal(fabricated.outcome, 'fail');
  assert.equal(fabricated.checks.find((check) => check.id === 'host_evidence').status, 'fail');
  fs.writeFileSync(codexReceiptPath, codexReceiptBytes);

  const contradictoryReport = structuredClone(auditReport);
  contradictoryReport.verificationMatrix[0].status = 'unverified';
  writeJson(path.join(logs, 'report.json'), contradictoryReport);
  const contradictory = forward.gradeScenario('audit', runRoot);
  assert.equal(contradictory.outcome, 'fail');
  assert.equal(contradictory.checks.find((check) => check.id === 'report_complete').status,
    'fail');
  writeJson(path.join(logs, 'report.json'), auditReport);

  fs.appendFileSync(path.join(subject, 'repo', 'AGENTS.md'), 'changed\n');
  const corrupted = forward.gradeScenario('audit', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'targets_unchanged').status, 'fail');
});

test('apply fixture passes durable idempotent evidence and rejects a bad backup', (t) => {
  const { runRoot, subject, logs } = temporaryRun(t, 'apply');
  assertCommonRequest(runRoot, subject, 'apply', path.join(subject, 'repo'));
  const prompt = fs.readFileSync(path.join(logs, 'prompt.md'), 'utf8');
  for (const meaning of [
    'verify package.json', 'execute the harmless pnpm shim', 'replace stale npm guidance with pnpm',
    'preserve dirty guidance', 'make project AGENTS.md canonical', 'import it exactly once from Claude',
    'preserve the Claude-only delta and private local file', 'empty second transformation',
  ]) assert.ok(prompt.includes(meaning), `Missing APPLY intent: ${meaning}`);
  const gitStatus = childProcess.spawnSync('git', ['-C', path.join(subject, 'repo'),
    'status', '--porcelain', '--', 'AGENTS.md'], { encoding: 'utf8', shell: false });
  assert.equal(gitStatus.status, 0, gitStatus.stderr);
  assert.equal(gitStatus.stdout, ' M AGENTS.md\n');
  const shimPath = path.join(subject, 'tools', 'pnpm.cjs');
  const shimRun = childProcess.spawnSync(process.execPath, [shimPath, '--version'], {
    encoding: 'utf8', shell: false,
  });
  assert.equal(shimRun.status, 0, shimRun.stderr);
  assert.equal(shimRun.stdout, PNPM_VERSION);

  const targets = [
    { targetPath: 'home/.codex/AGENTS.md', transaction: 'codex-global',
      preimageName: 'codex-AGENTS.md' },
    { targetPath: 'home/.claude/CLAUDE.md', transaction: 'claude-global',
      preimageName: 'claude-CLAUDE.md' },
    { targetPath: 'repo/AGENTS.md', transaction: 'project-shared',
      preimageName: 'repo-AGENTS.md' },
    { targetPath: 'repo/CLAUDE.md', transaction: 'project-shared',
      preimageName: 'repo-CLAUDE.md' },
  ];
  const backup = createRecovery(subject, 'apply', targets, {
    transactions: [
      { id: 'codex-global', status: 'applied' },
      { id: 'claude-global', status: 'applied' },
      { id: 'project-shared', status: 'applied' },
    ],
    targets: targets.map(({ targetPath, transaction }) =>
      ({ path: targetPath, transaction, status: 'applied' })),
  });
  fs.writeFileSync(path.join(subject, 'home', '.codex', 'AGENTS.md'),
    '# Codex global\n\nUse pnpm from the verified executable path.\n');
  fs.writeFileSync(path.join(subject, 'home', '.claude', 'CLAUDE.md'),
    '# Claude global\n\nUse pnpm from the verified executable path.\n');
  fs.writeFileSync(path.join(subject, 'repo', 'AGENTS.md'), APPLY_AGENTS_AFTER);
  fs.writeFileSync(path.join(subject, 'repo', 'CLAUDE.md'), APPLY_CLAUDE_AFTER);
  const finalSnapshot = snapshotForEvidence(subject);
  const applyOptions = {
    checkpoints: [
      { transformationStatus: 'changed', targetSnapshot: finalSnapshot },
      { transformationStatus: 'no-change', targetSnapshot: finalSnapshot },
    ],
    invocations: [
      { id: 'inventory-1', ordinal: 1, kind: 'inventory', exitCode: 0 },
      { id: 'inventory-2', ordinal: 2, after: 'inventory-1', kind: 'inventory', exitCode: 0 },
      { id: 'apply-pass-1', ordinal: 3, after: 'inventory-2', kind: 'transformation' },
      { id: 'apply-pass-2', ordinal: 4, after: 'apply-pass-1', kind: 'transformation' },
    ],
    facts: [
      { id: 'package-manager', value: 'pnpm', source: 'subject/repo/package.json' },
      { id: 'pnpm-version', value: '10.0.0', path: 'subject/tools/pnpm.cjs', exitCode: 0 },
    ],
  };
  const codexCapture = createWorkerArtifacts(runRoot, subject, 'apply', 'codex', applyOptions);
  captureWorker(runRoot, 'apply', codexCapture);
  captureWorker(runRoot, 'apply',
    createWorkerArtifacts(runRoot, subject, 'apply', 'claude', applyOptions));
  const applyReport = readJson(path.join(logs, 'report.json'));

  assert.equal(forward.gradeScenario('apply', runRoot).outcome, 'pass');

  const unavailableReport = structuredClone(applyReport);
  unavailableReport.verificationMatrix.find((item) => item.claim === 'idempotence').status =
    'unverified';
  writeJson(path.join(logs, 'report.json'), unavailableReport);
  const firstReceiptPath = path.join(runRoot, 'evaluator', 'receipts', 'apply',
    'codex', 'run-1.json');
  const secondReceiptPath = path.join(runRoot, 'evaluator', 'receipts', 'apply',
    'codex', 'run-2.json');
  const firstReceiptBytes = fs.readFileSync(firstReceiptPath);
  const secondReceiptBytes = fs.readFileSync(secondReceiptPath);
  fs.rmSync(secondReceiptPath);
  const missingSecondReceipt = forward.gradeScenario('apply', runRoot);
  assert.equal(missingSecondReceipt.outcome, 'unverified');
  assert.equal(missingSecondReceipt.checks.find(
    (check) => check.id === 'second_run_idempotent').status, 'unverified');
  writeJson(path.join(logs, 'report.json'), applyReport);
  fs.writeFileSync(secondReceiptPath, secondReceiptBytes);

  fs.copyFileSync(firstReceiptPath, secondReceiptPath);
  const copiedReceipt = forward.gradeScenario('apply', runRoot);
  assert.equal(copiedReceipt.outcome, 'fail');
  assert.equal(copiedReceipt.checks.find(
    (check) => check.id === 'second_run_idempotent').status, 'fail');
  fs.writeFileSync(firstReceiptPath, firstReceiptBytes);
  fs.writeFileSync(secondReceiptPath, secondReceiptBytes);

  const wrongChainReceipt = readJson(secondReceiptPath);
  wrongChainReceipt.previousReceiptSha256 = '0'.repeat(64);
  writeJson(secondReceiptPath, wrongChainReceipt);
  const wrongChain = forward.gradeScenario('apply', runRoot);
  assert.equal(wrongChain.outcome, 'fail');
  assert.equal(wrongChain.checks.find(
    (check) => check.id === 'second_run_idempotent').status, 'fail');
  fs.writeFileSync(secondReceiptPath, secondReceiptBytes);

  const invalidBackup = path.join(path.dirname(backup), 'apply-001');
  fs.renameSync(backup, invalidBackup);
  const malformedLeaf = forward.gradeScenario('apply', runRoot);
  assert.equal(malformedLeaf.outcome, 'fail');
  assert.equal(malformedLeaf.checks.find(
    (check) => check.id === 'backup_outside_repository').status, 'fail');
  fs.renameSync(invalidBackup, backup);

  const secondLeaf = path.join(path.dirname(backup), SECOND_RECOVERY_LEAF);
  fs.mkdirSync(secondLeaf);
  const multipleLeaves = forward.gradeScenario('apply', runRoot);
  assert.equal(multipleLeaves.outcome, 'fail');
  fs.rmSync(secondLeaf, { recursive: true });

  fs.writeFileSync(path.join(backup, 'preimages', 'repo-AGENTS.md'),
    'not the original bytes\n');
  const corrupted = forward.gradeScenario('apply', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'backup_preimages').status, 'fail');
});

test('partial fixture passes selective recovery evidence and rejects incomplete rollback', (t) => {
  const { runRoot, subject, logs } = temporaryRun(t, 'partial');
  assertCommonRequest(runRoot, subject, 'partial', path.join(subject, 'repo'));
  const prompt = fs.readFileSync(path.join(logs, 'prompt.md'), 'utf8');
  for (const meaning of ['sharpen Codex global guidance', 'sharpen Claude global guidance',
    'canonicalize shared project guidance', 'fast versus exhaustive choice is genuinely ambiguous']) {
    assert.ok(prompt.includes(meaning), `Missing PARTIAL intent: ${meaning}`);
  }
  assert.ok(prompt.includes(path.join(subject, 'controls', 'append-concurrent.cjs')));
  assert.ok(prompt.includes(path.join(subject, 'controls', 'verify-project.cjs')));
  const orderedStages = ['inventory and full plan', 'complete recovery evidence', 'marker',
    'prewrite hash recheck', 'independent writes', 'verifier failure', 'project-only rollback',
    'verifier success'];
  for (let index = 1; index < orderedStages.length; index += 1) {
    assert.ok(prompt.indexOf(orderedStages[index - 1]) < prompt.indexOf(orderedStages[index]));
  }
  const inventoryCheckpoint = snapshotForEvidence(subject);
  const targets = [
    { targetPath: 'home/.codex/AGENTS.md', transaction: 'codex-global',
      preimageName: 'codex-AGENTS.md' },
    { targetPath: 'home/.claude/CLAUDE.md', transaction: 'claude-global',
      preimageName: 'claude-CLAUDE.md' },
    { targetPath: 'repo/AGENTS.md', transaction: 'project-shared',
      preimageName: 'repo-AGENTS.md' },
    { targetPath: 'repo/CLAUDE.md', transaction: 'project-shared',
      preimageName: 'repo-CLAUDE.md' },
  ];
  createRecovery(subject, 'partial', targets, {
    transactions: [
      { id: 'codex-global', status: 'applied' },
      { id: 'claude-global', status: 'concurrent-change' },
      { id: 'project-shared', status: 'rolled-back' },
      { id: 'nested-scope', status: 'blocked' },
    ],
    targets: [
      { path: 'home/.codex/AGENTS.md', transaction: 'codex-global', status: 'applied' },
      { path: 'home/.claude/CLAUDE.md', transaction: 'claude-global',
        status: 'concurrent-change' },
      { path: 'repo/AGENTS.md', transaction: 'project-shared', status: 'rolled-back' },
      { path: 'repo/CLAUDE.md', transaction: 'project-shared', status: 'rolled-back' },
      { path: 'repo/packages/ambiguous/AGENTS.md', transaction: 'nested-scope',
        status: 'blocked' },
    ],
  });
  const recoveryCheckpoint = snapshotForEvidence(subject);
  const markerRun = childProcess.spawnSync(process.execPath,
    [path.join(subject, 'controls', 'append-concurrent.cjs')], {
      encoding: 'utf8', shell: false,
    });
  assert.equal(markerRun.status, 0, markerRun.stderr);
  const markerCheckpoint = snapshotForEvidence(subject);
  const prewriteCheckpoint = snapshotForEvidence(subject);
  fs.writeFileSync(path.join(subject, 'home', '.codex', 'AGENTS.md'), PARTIAL_CODEX_AFTER);
  fs.writeFileSync(path.join(subject, 'repo', 'AGENTS.md'), '# Invalid shared project\n');
  fs.writeFileSync(path.join(subject, 'repo', 'CLAUDE.md'), '# Invalid Claude project\n');
  const writeCheckpoint = snapshotForEvidence(subject);
  const verifierPath = path.join(subject, 'controls', 'verify-project.cjs');
  const beforeRollbackRun = childProcess.spawnSync(process.execPath, [verifierPath], {
    encoding: 'utf8', shell: false,
  });
  assert.equal(beforeRollbackRun.status, 1);
  assert.equal(beforeRollbackRun.stdout, 'status=fail\n');
  fs.writeFileSync(path.join(subject, 'repo', 'AGENTS.md'),
    '# Shared project\n\nUse npm until the migration is verified.\n');
  fs.writeFileSync(path.join(subject, 'repo', 'CLAUDE.md'),
    '# Claude project\n\nKeep the project-only delta.\n');
  const rollbackCheckpoint = snapshotForEvidence(subject);
  const afterRollbackRun = childProcess.spawnSync(process.execPath, [verifierPath], {
    encoding: 'utf8', shell: false,
  });
  assert.equal(afterRollbackRun.status, 0, afterRollbackRun.stderr);
  assert.equal(afterRollbackRun.stdout, 'status=pass\n');
  const partialOptions = {
    checkpoints: [
      { targetSnapshot: inventoryCheckpoint, planComplete: true },
      { targetSnapshot: recoveryCheckpoint, recoveryLeaf: RECOVERY_LEAF },
      { targetSnapshot: markerCheckpoint, controlPath: 'subject/controls/append-concurrent.cjs',
        controlSha256: sha256(fs.readFileSync(path.join(subject, 'controls',
          'append-concurrent.cjs'))), exitCode: markerRun.status },
      { targetSnapshot: prewriteCheckpoint, hashesRechecked: true },
      { targetSnapshot: writeCheckpoint, independentWritesComplete: true },
      { targetSnapshot: writeCheckpoint, controlPath: 'subject/controls/verify-project.cjs',
        controlSha256: sha256(fs.readFileSync(verifierPath)), exitCode: beforeRollbackRun.status,
        stdout: beforeRollbackRun.stdout },
      { targetSnapshot: rollbackCheckpoint, rolledBackTransaction: 'project-shared' },
      { targetSnapshot: rollbackCheckpoint, controlPath: 'subject/controls/verify-project.cjs',
        controlSha256: sha256(fs.readFileSync(verifierPath)), exitCode: afterRollbackRun.status,
        stdout: afterRollbackRun.stdout },
    ],
    invocations: [
      { id: 'inventory-1', ordinal: 1, kind: 'inventory', exitCode: 0 },
      { id: 'inventory-2', ordinal: 2, after: 'inventory-1', kind: 'inventory', exitCode: 0 },
      ...CHECKPOINT_FILES.partial.map((fileName, index) => ({
        id: fileName.slice(0, -'.json'.length),
        ordinal: index + 3,
        after: index === 0 ? 'inventory-2' : CHECKPOINT_FILES.partial[index - 1]
          .slice(0, -'.json'.length),
        kind: 'checkpoint',
      })),
    ],
  };
  captureWorker(runRoot, 'partial',
    createWorkerArtifacts(runRoot, subject, 'partial', 'codex', partialOptions));
  captureWorker(runRoot, 'partial',
    createWorkerArtifacts(runRoot, subject, 'partial', 'claude', partialOptions));

  assert.equal(forward.gradeScenario('partial', runRoot).outcome, 'pass');

  const markerEvidence = path.join(logs, 'hosts', 'codex', 'checkpoints',
    'partial-03-marker.json');
  const markerEvidenceBytes = fs.readFileSync(markerEvidence);
  const reorderedCheckpoint = readJson(markerEvidence);
  reorderedCheckpoint.ordinal = 2;
  writeJson(markerEvidence, reorderedCheckpoint);
  const reordered = forward.gradeScenario('partial', runRoot);
  assert.equal(reordered.outcome, 'fail');
  assert.equal(reordered.checks.find((check) => check.id === 'control_sequence').status, 'fail');
  fs.writeFileSync(markerEvidence, markerEvidenceBytes);

  fs.appendFileSync(path.join(subject, 'repo', 'CLAUDE.md'), 'rollback incomplete\n');
  const corrupted = forward.gradeScenario('partial', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'project_pair_rolled_back').status,
    'fail');
});
