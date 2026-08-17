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
  apply: [
    'apply-01-recovery-complete.json',
    'apply-02-pass-1.json',
    'apply-03-pass-2.json',
  ],
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
const HUMAN_REPORT_SECTIONS = [
  'Target matrix', 'Effective chain', 'Decision ledger', 'Changes and recovery',
  'Verification matrix', 'Pending questions',
];

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
  assert.ok(prompt.includes(JSON.stringify(['node', inventory, '--host', 'both', '--cwd', cwd,
    '--project', project, '--home', home, '--codex-home', path.join(home, '.codex'),
    '--claude-home', path.join(home, '.claude'), '--claude-managed-dir',
    path.join(subject, 'managed', 'claude')])));
  assert.doesNotMatch(prompt, /capture-challenges|evaluator nonce|expected hashes/i);

  const contract = readJson(path.join(subject, 'controls', 'evidence-contract.json'));
  assert.equal(contract.schemaVersion, 1);
  assert.match(contract.runId, /^[0-9a-f-]{36}$/);
  assert.equal(contract.evidenceRoot, 'subject/evidence');
  assert.equal(contract.captureDescriptor.path, 'capture.json');
  assert.deepEqual(contract.workerArtifacts.artifactSet.allowedDirectories, ['checkpoints']);
  assert.equal(contract.workerArtifacts.artifactSet.additionalFiles, false);
  assert.deepEqual(contract.captureDescriptor.requiredFields,
    ['schemaVersion', 'scenarioId', 'host', 'runId', 'rawFinalPath', 'inventoryPaths']);
  assert.deepEqual(contract.workerArtifacts.rawFinal.requiredSections,
    ['Target matrix', 'Effective chain', 'Decision ledger', 'Changes and recovery',
      'Verification matrix', 'Pending questions']);
  assert.deepEqual(contract.workerArtifacts.inventory.requiredManifestFields,
    ['schemaVersion', 'run', 'roots', 'sources', 'chains', 'warnings']);
  assert.deepEqual(contract.workerArtifacts.inventory.invocations.map((entry) => entry.argv[0]),
    ['node', 'node']);
  assert.deepEqual(contract.workerArtifacts.commandTrace.invocation.requiredFields,
    ['schemaVersion', 'scenarioId', 'host', 'runId', 'id', 'ordinal', 'predecessorId',
      'kind', 'argv', 'cwd', 'exitCode', 'outputPath', 'outputSha256']);
  assert.deepEqual(contract.workerArtifacts.machineReport.allowedValues.status,
    ['verified', 'unverified', 'blocked']);
  assert.equal(contract.workerArtifacts.checkpointSchemas.fieldTypes.runId, 'string');
  assert.equal(contract.workerArtifacts.checkpointSchemas.fieldTypes.planComplete, 'boolean');
  assert.equal(contract.workerArtifacts.checkpointSchemas.fieldTypes.stdout, 'string');
  assert.deepEqual(contract.workerArtifacts.checkpointSchemas.recoveryMemberVariants.existing
    .requiredFields,
    ['targetPath', 'existed', 'preimagePath', 'preimageSha256', 'originalSha256',
      'permissions']);
  assert.deepEqual(contract.workerArtifacts.checkpointSchemas.recoveryMemberVariants.absent
    .requiredFields,
    ['targetPath', 'existed', 'preimagePath', 'preimageSha256', 'originalSha256',
      'permissions']);
  assert.deepEqual(contract.workerArtifacts.commandTrace.factSets.apply.map((item) => item.id),
    ['package-manager', 'pnpm-version']);
  assert.deepEqual(contract.workerArtifacts.inventory.allowedValues.sourceScope,
    ['global', 'project', 'managed']);
  assert.ok(contract.workerArtifacts.inventory.scenarioSources.length >= 4);
  assert.ok(contract.workerArtifacts.machineReport.allowedTargetEvidencePaths
    .includes('repo/AGENTS.md'));
  assert.deepEqual(contract.recovery.manifest.permissionFields, ['mode', 'owner']);
  assert.deepEqual(contract.recovery.restoration.requiredFields,
    ['schemaVersion', 'scenarioId', 'host', 'runId', 'transactions', 'targets']);
  assert.deepEqual(contract.recovery.restoration.transactionEntryFields, ['id', 'status']);
  assert.deepEqual(contract.recovery.restoration.targetEntryFields,
    ['path', 'transaction', 'status']);
  assert.deepEqual(contract.workerArtifacts.checkpoints[scenarioId], CHECKPOINT_FILES[scenarioId]);
  assert.equal(JSON.stringify(contract).includes('expectedStatus'), false);
  assert.equal(JSON.stringify(contract).includes('nonce'), false);
  assert.equal(JSON.stringify(contract).includes('PRIVATE-'), false);
}

function sourceRecord(subject, id, relativePath, host, loadState) {
  const logicalPath = path.join(subject, ...relativePath.split('/'));
  const bytes = fs.readFileSync(logicalPath);
  const global = relativePath.startsWith('home/');
  const origin = host === 'codex' ? (global ? 'codex-home' : 'project-tree') :
    global ? 'claude-home' : relativePath.includes('/.claude/rules/') ? 'rule' : 'project-tree';
  const inactiveReasons = {
    shadowed: 'higher-precedence-source',
    conditional: 'path-conditional',
    truncated: 'project-byte-budget-exhausted',
  };
  return {
    id,
    host,
    scope: global ? 'global' : 'project',
    origin,
    logicalPath,
    resolvedPath: fs.realpathSync.native(logicalPath),
    ownership: global ? 'user' : 'project',
    exists: true,
    loadState,
    loadPosition: loadState === 'active' ? 0 : null,
    byteCount: bytes.length,
    byteContribution: ['active', 'conditional'].includes(loadState) ? bytes.length : 0,
    sha256: sha256(bytes),
    encoding: 'utf8',
    lineEndings: bytes.includes(Buffer.from('\r\n')) ? 'crlf' : 'lf',
    gitState: relativePath.startsWith('repo/') ? 'tracked-clean' : 'not-applicable',
    import: null,
    conditions: [],
    inactiveReason: loadState === 'active' ? null : inactiveReasons[loadState] || loadState,
  };
}

function inventoryManifest(subject, generatedAt) {
  const sources = [
    sourceRecord(subject, 'source-0001', 'home/.claude/CLAUDE.md', 'claude', 'active'),
    sourceRecord(subject, 'source-0002', 'home/.codex/AGENTS.md', 'codex', 'active'),
    sourceRecord(subject, 'source-0003', 'repo/AGENTS.md', 'codex', 'active'),
    sourceRecord(subject, 'source-0004', 'repo/CLAUDE.md', 'claude', 'active'),
  ];
  return {
    schemaVersion: 1,
    run: { generatedAt, host: 'both' },
    roots: {
      home: { logicalPath: path.join(subject, 'home'), resolvedPath: path.join(subject, 'home'),
        exists: true },
      project: { logicalPath: path.join(subject, 'repo'), resolvedPath: path.join(subject, 'repo'),
        exists: true },
      cwd: { logicalPath: path.join(subject, 'repo'), resolvedPath: path.join(subject, 'repo'),
        exists: true },
      codexHome: { logicalPath: path.join(subject, 'home', '.codex'),
        resolvedPath: path.join(subject, 'home', '.codex'), exists: true },
      claudeHome: { logicalPath: path.join(subject, 'home', '.claude'),
        resolvedPath: path.join(subject, 'home', '.claude'), exists: true },
      claudeManaged: { logicalPath: path.join(subject, 'managed', 'claude'),
        resolvedPath: path.join(subject, 'managed', 'claude'), exists: true },
    },
    sources,
    chains: {
      codex: { sourceIds: ['source-0002', 'source-0003'] },
      claude: {
        sourceIds: ['source-0001', 'source-0004'],
        conditionalSourceIds: [],
        maxImportDepth: 4,
        excludes: [],
        settingSources: { state: 'explicit', sources: ['user', 'project', 'local'] },
        coverage: 'complete',
      },
    },
    warnings: [],
  };
}

function createCheckpoints(artifactRoot, scenarioId, host, runId, payloads) {
  let predecessorSha256 = null;
  return CHECKPOINT_FILES[scenarioId].map((fileName, index) => {
    const checkpoint = {
      schemaVersion: 1,
      scenarioId,
      host,
      runId,
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
  const contract = readJson(path.join(subject, 'controls', 'evidence-contract.json'));
  const runId = contract.runId;
  const firstInventory = path.join(artifactRoot, 'inventory-1.stdout.json');
  const secondInventory = path.join(artifactRoot, 'inventory-2.stdout.json');
  const inventoryValues = [options.firstInventory ||
    inventoryManifest(subject, '2030-01-01T00:00:00.000Z'), options.secondInventory ||
    inventoryManifest(subject, '2030-01-02T00:00:00.000Z')];
  for (const [index, filePath] of [firstInventory, secondInventory].entries()) {
    const stdout = `${JSON.stringify(inventoryValues[index], null, 2)}\n`;
    const invocation = contract.workerArtifacts.inventory.invocations[index];
    writeJson(filePath, {
      schemaVersion: 1,
      scenarioId,
      host,
      runId,
      invocationId: invocation.id,
      argv: invocation.argv,
      cwd: invocation.cwd,
      exitCode: 0,
      stdout,
      stdoutSha256: sha256(stdout),
    });
  }
  const report = completeReport(artifactRoot, scenarioId, subject, host, runId);
  const rawFinal = path.join(artifactRoot, 'worker-final.md');
  fs.writeFileSync(rawFinal, options.rawFinal || Buffer.from(renderRawFinal(report)));
  const checkpoints = createCheckpoints(artifactRoot, scenarioId, host, runId,
    options.checkpoints);
  const inventoryFiles = [firstInventory, secondInventory];
  let predecessorId = null;
  const invocations = [
    ...inventoryFiles.map((filePath, index) => ({
      schemaVersion: 1,
      scenarioId,
      host,
      runId,
      id: `inventory-${index + 1}`,
      ordinal: index + 1,
      predecessorId: index === 0 ? null : 'inventory-1',
      kind: 'inventory',
      argv: contract.workerArtifacts.inventory.invocations[index].argv,
      cwd: contract.workerArtifacts.inventory.invocations[index].cwd,
      exitCode: 0,
      outputPath: contract.workerArtifacts.inventory.paths[index],
      outputSha256: sha256(fs.readFileSync(filePath)),
    })),
    ...checkpoints.map((checkpoint, index) => ({
      schemaVersion: 1,
      scenarioId,
      host,
      runId,
      id: checkpoint.id,
      ordinal: index + 3,
      predecessorId: index === 0 ? 'inventory-2' : checkpoints[index - 1].id,
      kind: 'checkpoint',
      argv: [],
      cwd: contract.workerArtifacts.inventory.invocations[0].cwd,
      exitCode: 0,
      outputPath: `checkpoints/${checkpoint.fileName}`,
      outputSha256: checkpoint.sha256,
    })),
  ];
  predecessorId = invocations.at(-1)?.id || predecessorId;
  const facts = options.facts?.map((fact) => ({
    schemaVersion: 1,
    scenarioId,
    host,
    runId,
    id: fact.id,
    kind: fact.id === 'package-manager' ? 'file-json' : 'controller-command',
    path: fact.path || fact.source,
    value: fact.value,
    exitCode: fact.exitCode ?? 0,
  }));
  writeJson(path.join(artifactRoot, 'command-trace.json'), {
    schemaVersion: 1,
    scenarioId,
    host,
    runId,
    invocations,
    checkpoints: checkpoints.map(({ id, ordinal, fileName, sha256: digest }) => ({
      id,
      ordinal,
      path: `checkpoints/${fileName}`,
      sha256: digest,
    })),
    ...(facts ? { facts } : {}),
  });
  const relative = (filePath) => path.relative(runRoot, filePath).split(path.sep).join('/');
  const descriptor = {
    schemaVersion: 1,
    scenarioId,
    host,
    runId,
    rawFinalPath: relative(rawFinal),
    inventoryPaths: [relative(firstInventory), relative(secondInventory)],
  };
  const descriptorPath = path.join(artifactRoot, 'capture.json');
  writeJson(descriptorPath, descriptor);
  return { artifactRoot, descriptor, descriptorPath, firstInventory, secondInventory };
}

function renderRawFinal(report) {
  const values = [report.targetMatrix, report.effectiveChain, report.decisionLedger,
    report.changesAndRecovery, report.verificationMatrix, report.pendingQuestions];
  const sections = HUMAN_REPORT_SECTIONS.map((name, index) =>
    `## ${name}\n\n\`\`\`json\n${JSON.stringify(values[index], null, 2)}\n\`\`\``).join('\n\n');
  return `schemaVersion: 1\nscenarioId: ${report.scenarioId}\nhost: ${report.host}\n` +
    `runId: ${report.runId}\n\n${sections}\n`;
}

function captureWorker(runRoot, scenarioId, created, useCli = false) {
  if (!useCli) return forward.captureEvidence(scenarioId, runRoot, created.descriptorPath);
  const output = [];
  const status = forward.runCli(['capture', scenarioId, runRoot, created.descriptorPath], {
    stdout: { write: (text) => output.push(text) },
    stderr: { write: (text) => assert.fail(text) },
  });
  assert.equal(status, 0);
  return JSON.parse(output.join(''));
}

function completeReport(artifactRoot, scenarioId, subject, host, runId) {
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
  const report = { schemaVersion: 1, scenarioId, host, runId, ...reports[scenarioId] };
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

function permissionEvidence(filePath) {
  const stat = fs.statSync(filePath);
  const meaningful = process.platform !== 'win32';
  return {
    mode: { status: meaningful ? 'verified' : 'unverified',
      value: meaningful ? stat.mode & 0o777 : null },
    owner: { status: meaningful ? 'verified' : 'unverified',
      value: meaningful ? `${stat.uid}:${stat.gid}` : null },
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
      permissions: permissionEvidence(absoluteTarget),
    };
  });
  writeJson(path.join(backup, 'manifest.json'), {
    schemaVersion: 1,
    scenarioId,
    host: 'both',
    runId: readJson(path.join(subject, 'controls', 'evidence-contract.json')).runId,
    entries,
  });
  writeJson(path.join(backup, 'restoration.json'), {
    schemaVersion: 1,
    scenarioId,
    host: 'both',
    runId: readJson(path.join(subject, 'controls', 'evidence-contract.json')).runId,
    ...restoration,
  });
  return backup;
}

function recoveryCheckpointPayload(subject, targets) {
  const runRoot = path.dirname(subject);
  const backup = path.join(subject, 'home', '.skillquiver', 'backups',
    'improve-agent-instructions', RECOVERY_LEAF);
  const manifestPath = path.join(backup, 'manifest.json');
  const restorationPath = path.join(backup, 'restoration.json');
  const manifest = readJson(manifestPath);
  return {
    leaf: RECOVERY_LEAF,
    manifestPath: path.relative(runRoot, manifestPath).split(path.sep).join('/'),
    manifestSha256: sha256(fs.readFileSync(manifestPath)),
    restorationPath: path.relative(runRoot, restorationPath).split(path.sep).join('/'),
    restorationSha256: sha256(fs.readFileSync(restorationPath)),
    members: targets.map(({ targetPath }) => {
      const entry = manifest.entries.find((item) => item.targetPath === targetPath);
      const preimagePath = path.join(backup, entry.preimagePath);
      return {
        targetPath,
        existed: true,
        preimagePath: path.relative(runRoot, preimagePath).split(path.sep).join('/'),
        preimageSha256: sha256(fs.readFileSync(preimagePath)),
        originalSha256: entry.sha256,
        permissions: entry.permissions,
      };
    }),
  };
}

function prewriteTargets(subject, targets) {
  return targets.map(({ targetPath }) => {
    const filePath = path.join(subject, ...targetPath.split('/'));
    const original = readJson(path.join(subject, 'home', '.skillquiver', 'backups',
      'improve-agent-instructions', RECOVERY_LEAF, 'manifest.json')).entries
      .find((item) => item.targetPath === targetPath);
    return {
      targetPath,
      existed: true,
      originalSha256: original.sha256,
      currentSha256: sha256(fs.readFileSync(filePath)),
      permissions: permissionEvidence(filePath),
    };
  });
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
    sourceRecord(subject, 'source-0001', 'home/.claude/CLAUDE.md', 'claude', 'active'),
    sourceRecord(subject, 'source-0002', 'home/.codex/AGENTS.md', 'codex', 'shadowed'),
    sourceRecord(subject, 'source-0003', 'home/.codex/AGENTS.override.md', 'codex', 'active'),
    sourceRecord(subject, 'source-0004', 'repo/.claude/rules/source.md', 'claude',
      'conditional'),
    sourceRecord(subject, 'source-0005', 'repo/CLAUDE.md', 'claude', 'active'),
    sourceRecord(subject, 'source-0006', 'repo/TEAM.md', 'codex', 'shadowed'),
    sourceRecord(subject, 'source-0007', 'repo/packages/TEAM.md', 'codex', 'active'),
    sourceRecord(subject, 'source-0008', 'repo/packages/api/AGENTS.md', 'codex', 'truncated'),
  ];
  sources[3].conditions = ['src/**/*.js'];
  sources[3].inactiveReason = 'path-conditional';
  sources[7].byteContribution = 16;
  sources[7].inactiveReason = 'project-byte-budget';
  const firstInventory = inventoryManifest(subject, '2030-01-01T00:00:00.000Z');
  const secondInventory = inventoryManifest(subject, '2030-01-02T00:00:00.000Z');
  firstInventory.sources = sources;
  secondInventory.sources = structuredClone(sources);
  for (const manifest of [firstInventory, secondInventory]) {
    manifest.roots.cwd.logicalPath = path.join(subject, 'repo', 'packages', 'api');
    manifest.roots.cwd.resolvedPath = path.join(subject, 'repo', 'packages', 'api');
    manifest.chains.codex.sourceIds = ['source-0003', 'source-0007', 'source-0008'];
    manifest.chains.claude.sourceIds = ['source-0001', 'source-0005'];
    manifest.chains.claude.conditionalSourceIds = ['source-0004'];
  }
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
  const extraArtifact = path.join(malformed.artifactRoot, 'private-copy.txt');
  fs.writeFileSync(extraArtifact, 'AUDIT-INSTRUCTION-SENTINEL\n');
  assert.throws(() => captureWorker(runRoot, 'audit', malformed), /artifact set/i);
  fs.rmSync(extraArtifact);

  const invalidInventory = structuredClone(firstInventory);
  invalidInventory.sources[0].scope = 'invented-scope';
  const semanticNonsense = createWorkerArtifacts(runRoot, subject, 'audit', 'codex', {
    ...auditOptions,
    firstInventory: invalidInventory,
  });
  assert.throws(() => captureWorker(runRoot, 'audit', semanticNonsense),
    /inventory.*schema|source/i);

  const unsanctionedEvidence = createWorkerArtifacts(
    runRoot, subject, 'audit', 'codex', auditOptions);
  const unsanctionedReportPath = path.join(unsanctionedEvidence.artifactRoot,
    'machine-report.json');
  const unsanctionedReport = readJson(unsanctionedReportPath);
  unsanctionedReport.targetMatrix[0].evidence = {
    path: 'repo/CLAUDE.local.md',
    sha256: sha256(fs.readFileSync(path.join(subject, 'repo', 'CLAUDE.local.md'))),
  };
  writeJson(unsanctionedReportPath, unsanctionedReport);
  fs.writeFileSync(path.join(unsanctionedEvidence.artifactRoot, 'worker-final.md'),
    renderRawFinal(unsanctionedReport));
  assert.throws(() => captureWorker(runRoot, 'audit', unsanctionedEvidence), /sanctioned/i);

  const aliased = createWorkerArtifacts(runRoot, subject, 'audit', 'codex', auditOptions);
  fs.rmSync(aliased.secondInventory);
  fs.linkSync(aliased.firstInventory, aliased.secondInventory);
  assert.throws(() => captureWorker(runRoot, 'audit', aliased), /distinct|alias/i);
  fs.rmSync(aliased.artifactRoot, { recursive: true });
  const emptyAuditSnapshot = createWorkerArtifacts(runRoot, subject, 'audit', 'codex', {
    ...auditOptions,
    checkpoints: [{ targetSnapshot: {} }],
  });
  assert.throws(() => captureWorker(runRoot, 'audit', emptyAuditSnapshot),
    /audit checkpoint/i);
  const codexCapture = createWorkerArtifacts(runRoot, subject, 'audit', 'codex', auditOptions);
  assert.throws(() => forward.captureEvidence('audit', runRoot, codexCapture.descriptor),
    /descriptor file/i);
  captureWorker(runRoot, 'audit', codexCapture);
  const absentClaude = forward.gradeScenario('audit', runRoot);
  assert.equal(absentClaude.outcome, 'unverified');
  assert.equal(absentClaude.checks.find((check) => check.id === 'host_evidence').status,
    'unverified');
  const replayRoot = path.join(subject, 'evidence', 'claude');
  fs.cpSync(codexCapture.artifactRoot, replayRoot, { recursive: true });
  const replayDescriptorPath = path.join(replayRoot, 'capture.json');
  const replayDescriptor = readJson(replayDescriptorPath);
  replayDescriptor.host = 'claude';
  replayDescriptor.rawFinalPath = replayDescriptor.rawFinalPath.replace('/codex/', '/claude/');
  replayDescriptor.inventoryPaths = replayDescriptor.inventoryPaths.map((entry) =>
    entry.replace('/codex/', '/claude/'));
  writeJson(replayDescriptorPath, replayDescriptor);
  assert.throws(() => forward.captureEvidence('audit', runRoot, replayDescriptorPath),
    /identity|host/i);
  fs.rmSync(replayRoot, { recursive: true });
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

  const lateExtraArtifact = path.join(subject, 'evidence', 'codex', 'late-private-copy.txt');
  fs.writeFileSync(lateExtraArtifact, 'AUDIT-INSTRUCTION-SENTINEL\n');
  const unexpectedSourceArtifact = forward.gradeScenario('audit', runRoot);
  assert.equal(unexpectedSourceArtifact.outcome, 'fail');
  assert.equal(unexpectedSourceArtifact.checks.find(
    (check) => check.id === 'host_evidence').status, 'fail');
  assert.equal(unexpectedSourceArtifact.checks.find(
    (check) => check.id === 'secret_free_outputs').status, 'fail');
  fs.rmSync(lateExtraArtifact);

  const hostIndexPath = path.join(logs, 'host-evidence.json');
  const originalHostIndex = fs.readFileSync(hostIndexPath);
  const incompleteHostEvidence = readJson(path.join(logs, 'host-evidence.json'));
  incompleteHostEvidence.hosts = incompleteHostEvidence.hosts.filter(
    (item) => item.host === 'codex');
  writeJson(hostIndexPath, incompleteHostEvidence);
  const missingHostEntry = forward.gradeScenario('audit', runRoot);
  assert.equal(missingHostEntry.outcome, 'fail');
  assert.equal(missingHostEntry.checks.find((check) => check.id === 'host_evidence').status,
    'fail');
  fs.writeFileSync(hostIndexPath, originalHostIndex);

  const codexReport = path.join(logs, 'hosts', 'codex', 'machine-report.json');
  const codexReportBytes = fs.readFileSync(codexReport);
  fs.rmSync(codexReport);
  const missingPrimary = forward.gradeScenario('audit', runRoot);
  assert.equal(missingPrimary.outcome, 'fail');
  assert.equal(missingPrimary.checks.find((check) => check.id === 'host_evidence').status,
    'fail');
  fs.writeFileSync(codexReport, codexReportBytes);

  const codexWorkerFinal = path.join(logs, 'hosts', 'codex', 'worker-final.md');
  const codexWorkerFinalBytes = fs.readFileSync(codexWorkerFinal);
  fs.rmSync(codexWorkerFinal);
  const missingRawFinal = forward.gradeScenario('audit', runRoot);
  assert.equal(missingRawFinal.outcome, 'fail');
  assert.equal(missingRawFinal.checks.find((check) => check.id === 'host_evidence').status,
    'fail');
  fs.writeFileSync(codexWorkerFinal, codexWorkerFinalBytes);

  fs.appendFileSync(codexWorkerFinal, 'AUDIT-INSTRUCTION-SENTINEL\n');
  const tamperedRawFinal = forward.gradeScenario('audit', runRoot);
  assert.equal(tamperedRawFinal.outcome, 'fail');
  assert.equal(tamperedRawFinal.checks.find((check) => check.id === 'host_evidence').status,
    'fail');
  assert.equal(tamperedRawFinal.checks.find(
    (check) => check.id === 'secret_free_outputs').status, 'fail');
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

  const contradictoryReportPath = path.join(logs, 'hosts', 'codex', 'machine-report.json');
  const contradictoryReportBytes = fs.readFileSync(contradictoryReportPath);
  const contradictoryReport = structuredClone(auditReport);
  contradictoryReport.verificationMatrix[0].status = 'unverified';
  writeJson(contradictoryReportPath, contradictoryReport);
  const contradictory = forward.gradeScenario('audit', runRoot);
  assert.equal(contradictory.outcome, 'fail');
  assert.equal(contradictory.checks.find((check) => check.id === 'report_complete').status,
    'fail');
  fs.writeFileSync(contradictoryReportPath, contradictoryReportBytes);

  fs.appendFileSync(path.join(subject, 'repo', 'AGENTS.md'), 'changed\n');
  const corrupted = forward.gradeScenario('audit', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'targets_unchanged').status, 'fail');
});

test('apply fixture passes durable idempotent evidence and rejects a bad backup', (t) => {
  const { runRoot, subject, logs } = temporaryRun(t, 'apply');
  assertCommonRequest(runRoot, subject, 'apply', path.join(subject, 'repo'));
  const repositoryRecord = readJson(path.join(runRoot, 'evaluator', 'expected.json'))
    .controller.repository;
  assert.deepEqual(repositoryRecord.observations.map((item) => item.id),
    ['tracked-path', 'dirty-status', 'committed-bytes']);
  assert.equal(repositoryRecord.observations[0].status, 0);
  assert.equal(repositoryRecord.observations[0].stdout, 'AGENTS.md\n');
  assert.equal(repositoryRecord.observations[1].status, 0);
  assert.equal(repositoryRecord.observations[1].stdout, ' M AGENTS.md\n');
  assert.ok(repositoryRecord.observations.every((item) => item.argv.includes(
    `core.hooksPath=${path.join(runRoot, 'evaluator', 'empty-hooks')}`)));
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
  const recoverySnapshot = snapshotForEvidence(subject);
  const applyRecovery = recoveryCheckpointPayload(subject, targets);
  const applyPrewrite = prewriteTargets(subject, targets);
  fs.writeFileSync(path.join(subject, 'home', '.codex', 'AGENTS.md'),
    '# Codex global\n\nUse pnpm from the verified executable path.\n');
  fs.writeFileSync(path.join(subject, 'home', '.claude', 'CLAUDE.md'),
    '# Claude global\n\nUse pnpm from the verified executable path.\n');
  fs.writeFileSync(path.join(subject, 'repo', 'AGENTS.md'), APPLY_AGENTS_AFTER);
  fs.writeFileSync(path.join(subject, 'repo', 'CLAUDE.md'), APPLY_CLAUDE_AFTER);
  const finalSnapshot = snapshotForEvidence(subject);
  const applyOptions = {
    checkpoints: [
      { recovery: applyRecovery, prewriteTargets: applyPrewrite,
        targetSnapshot: recoverySnapshot },
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
  const duplicateFacts = createWorkerArtifacts(runRoot, subject, 'apply', 'codex', {
    ...applyOptions,
    facts: [...applyOptions.facts, { ...applyOptions.facts[0] }],
  });
  assert.throws(() => captureWorker(runRoot, 'apply', duplicateFacts), /fact/i);
  const skeletalInventory = inventoryManifest(subject, '2030-01-03T00:00:00.000Z');
  skeletalInventory.sources = [skeletalInventory.sources[0]];
  skeletalInventory.chains.codex.sourceIds = [];
  skeletalInventory.chains.claude.sourceIds = [];
  const skeletal = createWorkerArtifacts(runRoot, subject, 'apply', 'codex', {
    ...applyOptions,
    firstInventory: skeletalInventory,
  });
  assert.throws(() => captureWorker(runRoot, 'apply', skeletal), /scenario source|chain/i);
  const codexCapture = createWorkerArtifacts(runRoot, subject, 'apply', 'codex', applyOptions);
  captureWorker(runRoot, 'apply', codexCapture);
  captureWorker(runRoot, 'apply',
    createWorkerArtifacts(runRoot, subject, 'apply', 'claude', applyOptions));
  const applyReport = readJson(path.join(logs, 'report.json'));

  assert.equal(forward.gradeScenario('apply', runRoot).outcome, 'pass');

  const publicShim = path.join(subject, 'tools', 'pnpm.cjs');
  const publicShimBytes = fs.readFileSync(publicShim);
  const executionMarker = path.join(subject, 'controls', 'public-shim-executed');
  fs.writeFileSync(publicShim, `'use strict';\nrequire('node:fs').writeFileSync(` +
    `${JSON.stringify(executionMarker)}, 'executed');\nprocess.stdout.write('10.0.0\\n');\n`);
  const mutatedShim = forward.gradeScenario('apply', runRoot);
  assert.equal(mutatedShim.outcome, 'fail');
  assert.equal(mutatedShim.checks.find(
    (check) => check.id === 'verified_repository_facts').status, 'fail');
  assert.equal(fs.existsSync(executionMarker), false,
    'the grader must never execute the worker-mutable public shim');
  fs.writeFileSync(publicShim, publicShimBytes);

  const gitConfigPath = path.join(subject, 'repo', '.git', 'config');
  const gitConfigBytes = fs.readFileSync(gitConfigPath);
  const gitExecutionMarker = path.join(subject, 'controls', 'git-config-executed');
  fs.appendFileSync(gitConfigPath, `\n[core]\n\tfsmonitor = node ${gitExecutionMarker}\n`);
  assert.equal(forward.gradeScenario('apply', runRoot).outcome, 'pass');
  assert.equal(fs.existsSync(gitExecutionMarker), false,
    'the grader must not consult worker-mutable Git configuration');
  fs.writeFileSync(gitConfigPath, gitConfigBytes);

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
  assert.equal(missingSecondReceipt.outcome, 'fail');
  assert.equal(missingSecondReceipt.checks.find(
    (check) => check.id === 'second_run_idempotent').status, 'fail');
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

  const recoveryManifestPath = path.join(backup, 'manifest.json');
  const recoveryManifestBytes = fs.readFileSync(recoveryManifestPath);
  const permissionMismatch = readJson(recoveryManifestPath);
  permissionMismatch.entries[0].permissions.mode = process.platform === 'win32' ?
    { status: 'verified', value: 0o777 } :
    { status: 'verified', value: permissionMismatch.entries[0].permissions.mode.value ^ 0o111 };
  writeJson(recoveryManifestPath, permissionMismatch);
  const mismatchedPermission = forward.gradeScenario('apply', runRoot);
  assert.equal(mismatchedPermission.outcome, 'fail');
  assert.equal(mismatchedPermission.checks.find(
    (check) => check.id === 'backup_preimages').status, 'fail');
  fs.writeFileSync(recoveryManifestPath, recoveryManifestBytes);

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
  const partialRecovery = recoveryCheckpointPayload(subject, targets);
  const markerRun = childProcess.spawnSync(process.execPath,
    [path.join(subject, 'controls', 'append-concurrent.cjs')], {
      encoding: 'utf8', shell: false,
    });
  assert.equal(markerRun.status, 0, markerRun.stderr);
  const markerCheckpoint = snapshotForEvidence(subject);
  const prewriteCheckpoint = snapshotForEvidence(subject);
  const recheckedTargets = prewriteTargets(subject, targets);
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
      { targetSnapshot: recoveryCheckpoint, recovery: partialRecovery },
      { targetSnapshot: markerCheckpoint, controlPath: 'subject/controls/append-concurrent.cjs',
        controlSha256: sha256(fs.readFileSync(path.join(subject, 'controls',
          'append-concurrent.cjs'))), exitCode: markerRun.status },
      { targetSnapshot: prewriteCheckpoint, prewriteTargets: recheckedTargets },
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

  const recoveryEvidence = path.join(logs, 'hosts', 'codex', 'checkpoints',
    'partial-02-recovery-complete.json');
  const recoveryEvidenceBytes = fs.readFileSync(recoveryEvidence);
  const incompleteRecovery = readJson(recoveryEvidence);
  incompleteRecovery.recovery.members.pop();
  writeJson(recoveryEvidence, incompleteRecovery);
  const incomplete = forward.gradeScenario('partial', runRoot);
  assert.equal(incomplete.outcome, 'fail');
  assert.equal(incomplete.checks.find((check) => check.id === 'control_sequence').status,
    'fail');
  fs.writeFileSync(recoveryEvidence, recoveryEvidenceBytes);

  fs.appendFileSync(path.join(subject, 'repo', 'CLAUDE.md'), 'rollback incomplete\n');
  const corrupted = forward.gradeScenario('partial', runRoot);
  assert.equal(corrupted.outcome, 'fail');
  assert.equal(corrupted.checks.find((check) => check.id === 'project_pair_rolled_back').status,
    'fail');
});
