const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const controller = require('../benchmarks/improve-agent-instructions/controller.cjs');
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
const AUDIT_SOURCE_EXPECTATIONS = [
  ['home/.claude/CLAUDE.md', 'claude', 'global', 'claude-home', 'active', 35, 35],
  ['home/.claude/shared.md', 'claude', 'global', 'import', 'active', 22, 22],
  ['home/.codex/AGENTS.md', 'codex', 'global', 'codex-home', 'shadowed', 33, 0],
  ['home/.codex/AGENTS.override.md', 'codex', 'global', 'codex-home', 'active', 84, 84],
  ['managed/claude/CLAUDE.md', 'claude', 'managed', 'managed-policy', 'missing', null, 0],
  ['repo/.claude/CLAUDE.md', 'claude', 'project', 'project-tree', 'missing', null, 0],
  ['repo/.claude/rules/source.md', 'claude', 'project', 'rule', 'conditional', 53, 53],
  ['repo/AGENTS.md', 'codex', 'project', 'project-tree', 'active', 80, 80],
  ['repo/AGENTS.override.md', 'codex', 'project', 'project-tree', 'missing', null, 0],
  ['repo/CLAUDE.local.md', 'claude', 'project', 'project-local', 'active', 23, 23],
  ['repo/CLAUDE.md', 'claude', 'project', 'project-tree', 'active', 19, 19],
  ['repo/TEAM.md', 'codex', 'project', 'project-tree', 'shadowed', 23, 0],
  ['repo/packages/.claude/CLAUDE.md', 'claude', 'project', 'project-tree', 'missing', null, 0],
  ['repo/packages/AGENTS.md', 'codex', 'project', 'project-tree', 'missing', null, 0],
  ['repo/packages/AGENTS.override.md', 'codex', 'project', 'project-tree', 'missing', null, 0],
  ['repo/packages/CLAUDE.local.md', 'claude', 'project', 'project-local', 'missing', null, 0],
  ['repo/packages/CLAUDE.md', 'claude', 'project', 'project-tree', 'missing', null, 0],
  ['repo/packages/TEAM.md', 'codex', 'project', 'project-tree', 'active', 32, 32],
  ['repo/packages/api/.claude/CLAUDE.md', 'claude', 'project', 'project-tree', 'missing', null, 0],
  ['repo/packages/api/AGENTS.md', 'codex', 'project', 'project-tree', 'truncated', 64, 16],
  ['repo/packages/api/AGENTS.override.md', 'codex', 'project', 'project-tree', 'missing', null, 0],
  ['repo/packages/api/CLAUDE.local.md', 'claude', 'project', 'project-local', 'missing', null, 0],
  ['repo/packages/api/CLAUDE.md', 'claude', 'project', 'project-tree', 'missing', null, 0],
  ['repo/packages/api/TEAM.md', 'codex', 'project', 'project-tree', 'missing', null, 0],
  ['repo/project-shared.md', 'claude', 'project', 'import', 'active', 25, 25],
];
const AUDIT_QUALITATIVE_EXPECTATIONS = [
  {
    id: 'finding-package-manager-conflict',
    kind: 'conflict',
    severity: 'high',
    sourceIds: ['source-0003', 'source-0004'],
    contentEvidence: [
      contentEvidence('source-0003', 'Use npm for repository commands.\n',
        'Use npm for repository commands.'),
      contentEvidence('source-0004',
        'Use pnpm for repository commands.\nAUDIT-INSTRUCTION-SENTINEL\nAUDIT-PRIVATE-SENTINEL\n',
        'Use pnpm for repository commands.'),
    ],
    issueCode: 'conflicting-package-manager',
    observationRule: 'literal-directive-conflict-v1',
    observationStatus: 'verified',
    recommendation: {
      text: 'Choose one package manager across the active and shadowed instructions.',
      provenance: 'host-asserted', status: 'unverified',
    },
    disposition: 'host-asserted-unverified',
  },
  {
    id: 'finding-truncated-safety-guidance',
    kind: 'defect',
    severity: 'high',
    sourceIds: ['source-0020'],
    contentEvidence: [contentEvidence('source-0020',
      'Keep commands read-only.\nAlways request approval before writes.\n',
      'approval before writes')],
    issueCode: 'truncated-safety-guidance',
    observationRule: 'truncated-excluded-text-v1',
    observationStatus: 'verified',
    recommendation: {
      text: 'Move the approval requirement into the contributed instruction prefix.',
      provenance: 'host-asserted', status: 'unverified',
    },
    disposition: 'host-asserted-unverified',
  },
];

function contentEvidence(sourceId, body, needle) {
  const bytes = Buffer.from(body);
  const token = Buffer.from(needle);
  const startByte = bytes.indexOf(token);
  return { sourceId, startByte, endByte: startByte + token.length,
    sha256: sha256(token) };
}

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

function stopTestProcess(pid) {
  if (!Number.isInteger(pid)) return;
  try { process.kill(pid); } catch {}
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    } catch {
      return;
    }
  }
}

function renderedSchemaValid(schema, value) {
  const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const typeValid = (type) => type === 'null' ? value === null
    : type === 'array' ? Array.isArray(value)
      : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : type === 'integer' ? Number.isInteger(value) : typeof value === type;
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(typeValid)) return false;
  }
  if (schema.const !== undefined && !sameValue(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some((entry) => sameValue(value, entry))) return false;
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (schema.minLength !== undefined && length < schema.minLength) return false;
    if (schema.maxLength !== undefined && length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
  }
  if (Number.isInteger(value) && schema.minimum !== undefined && value < schema.minimum) {
    return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !==
        value.length) return false;
    if (schema.items && !value.every((entry) => renderedSchemaValid(schema.items, entry))) {
      return false;
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required && !schema.required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((key) =>
      !Object.prototype.hasOwnProperty.call(schema.properties || {}, key))) return false;
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key] && !renderedSchemaValid(schema.properties[key], child)) {
        return false;
      }
    }
  }
  if (schema.anyOf && !schema.anyOf.some((entry) => renderedSchemaValid(entry, value))) {
    return false;
  }
  if (schema.oneOf && schema.oneOf.filter((entry) => renderedSchemaValid(entry, value))
    .length !== 1) return false;
  if (schema.not && renderedSchemaValid(schema.not, value)) return false;
  return true;
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

function trustedGitExecutable() {
  const locator = process.platform === 'win32'
    ? childProcess.spawnSync('where.exe', ['git'], { encoding: 'utf8', shell: false })
    : childProcess.spawnSync('which', ['git'], { encoding: 'utf8', shell: false });
  assert.equal(locator.status, 0, locator.stderr);
  return fs.realpathSync.native(locator.stdout.split(/\r?\n/)
    .find((entry) => entry.trim()).trim());
}


function writeTrustedAdapterFixture(t, host, mode = 'good') {
  const launcherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-launcher-'));
  t.after(() => fs.rmSync(launcherRoot, { recursive: true, force: true }));
  const adapterPath = path.join(launcherRoot, 'adapter.cjs');
  const childPath = path.join(launcherRoot, 'child.cjs');
  const launcherPath = path.join(launcherRoot, `launcher-${host}.json`);
  fs.writeFileSync(childPath, `'use strict';
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;
const digest = (value) => crypto.createHash('sha256')
  .update(Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(canonicalize(value))))
  .digest('hex');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const phase = process.argv[2];
const runDescendant = () => {
  const survivor = request.testMode === 'surviving-descendant' && phase === 'preflight'
    || request.testMode === 'behavior-surviving-descendant' && phase === 'plan';
  const omitted = request.testMode === 'omitted-detached-descendant' && phase === 'plan';
  const descendant = survivor ? childProcess.spawn(process.execPath,
    ['-e', 'setTimeout(() => {}, 30000)'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    }) : childProcess.spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 350)'], {
      stdio: 'ignore', windowsHide: true,
    });
  if (survivor) descendant.unref();
  let omittedPid = null;
  if (omitted) {
    const state = new Int32Array(new SharedArrayBuffer(8));
    const worker = new Worker(\`
      const childProcess = require('node:child_process');
      const { workerData } = require('node:worker_threads');
      const state = new Int32Array(workerData.state);
      const descendant = childProcess.spawn(workerData.executable,
        ['-e', 'setTimeout(() => {}, 30000)'], {
          detached: true, stdio: 'ignore', windowsHide: true,
        });
      descendant.unref();
      Atomics.store(state, 1, descendant.pid);
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
    \`, { eval: true, execArgv: [], workerData: { state: state.buffer,
      executable: process.execPath } });
    if (Atomics.wait(state, 0, 0, 5000) === 'timed-out') {
      throw new Error('The uninstrumented descendant did not start.');
    }
    omittedPid = Atomics.load(state, 1);
    worker.unref();
  }
  const pid = descendant.pid;
  let stopped = true;
  try { process.kill(pid, 0); stopped = false; } catch {}
  return { started: Number.isInteger(pid), pid, exitCode: survivor ? null : 0,
    stopped: survivor ? false : stopped,
    ...(omitted ? { omittedPid } : {}) };
};
if (phase === 'preflight') {
  const probes = request.probes.map((probe) => {
    try {
      const observed = probe.operation === 'read' ? fs.readFileSync(probe.path)
        : (fs.appendFileSync(probe.path, 'forbidden'), Buffer.alloc(0));
      return { id: probe.id, operation: probe.operation, outcome: 'allowed',
        errorCode: null, observedSha256: digest(observed) };
    } catch (error) {
      return { id: probe.id, operation: probe.operation, outcome: 'denied',
        errorCode: error.code || 'UNKNOWN', observedSha256: null };
    }
  });
  const descendant = runDescendant();
  process.stdout.write(JSON.stringify({ pid: process.pid, phase, probes,
    descendant }));
  return;
}
const inventoryBytes = fs.readFileSync(path.join(request.hostView, 'inventory.json'));
const inventory = JSON.parse(inventoryBytes);
const inputIndex = JSON.parse(fs.readFileSync(path.join(request.hostView, 'inputs', 'index.json')));
const inputs = inputIndex.map((entry) => ({ id: entry.id,
  sha256: entry.path === null ? null
    : digest(fs.readFileSync(path.join(request.hostView, entry.path))) }));
const schemas = fs.readdirSync(path.join(request.hostView, 'schemas')).sort()
  .map((name) => ({ name, sha256: digest(fs.readFileSync(
    path.join(request.hostView, 'schemas', name))) }));
const taskSha256 = digest(fs.readFileSync(path.join(request.hostView, 'instruction-task.md')));
const proof = (id, value, raw = []) => crypto.createHash('sha256')
  .update(request.controllerNonce).update(phase).update(id)
  .update(Buffer.from(JSON.stringify(canonicalize(value))))
  .update(Buffer.concat(raw)).digest('hex');
const inputBytes = inputIndex.filter((entry) => entry.path !== null)
  .map((entry) => fs.readFileSync(path.join(request.hostView, entry.path)));
const finding = (id, value, raw) => ({ id, status: 'verified',
  observedSha256: proof(id, value, raw) });
const findings = [
  finding('inventory-bytes', digest(inventoryBytes), [inventoryBytes]),
  finding('inventory-roots', inventory.roots),
  finding('inventory-sources', inventory.sources),
  finding('inventory-chains', inventory.chains),
  finding('inventory-warnings', inventory.warnings),
  finding('instruction-inputs', inputs, inputBytes),
  finding('public-schemas', schemas),
  finding(phase + '-conclusion', {
    phase, taskSha256, inventorySha256: digest(inventoryBytes), inputs, schemas,
  }),
];
const inputById = new Map(inputIndex.map((entry) => [entry.id, entry]));
const sourceBytes = (sourceIds) => sourceIds.map((id) => inputById.get(id))
  .filter((entry) => entry && entry.path !== null)
  .map((entry) => fs.readFileSync(path.join(request.hostView, entry.path)));
const qualitative = (value) => ({ ...value,
  observedSha256: proof(value.id, value, sourceBytes(value.sourceIds)) });
const bodyById = new Map(inputIndex.filter((entry) => entry.path !== null)
  .map((entry) => [entry.id, fs.readFileSync(path.join(request.hostView, entry.path))]));
const textFor = (source) => bodyById.has(source.id) ? bodyById.get(source.id).toString('utf8') : '';
const evidenceFor = (source, needle) => {
  const body = bodyById.get(source.id);
  const token = Buffer.from(needle);
  const startByte = body ? body.indexOf(token) : -1;
  return startByte < 0 ? null : { sourceId: source.id, startByte,
    endByte: startByte + token.length, sha256: digest(body.subarray(startByte,
      startByte + token.length)) };
};
const npmSource = inventory.sources.find((source) =>
  textFor(source).includes('Use npm for repository commands.'));
const pnpmSource = inventory.sources.find((source) =>
  textFor(source).includes('Use pnpm for repository commands.'));
const truncatedSafety = inventory.sources.find((source) =>
  source.byteContribution < source.byteCount && textFor(source).includes('approval before writes'));
let qualitativeFindings = [];
if (npmSource && pnpmSource) qualitativeFindings.push(qualitative({
  id: 'finding-package-manager-conflict', kind: 'conflict', severity: 'high',
  sourceIds: [npmSource.id, pnpmSource.id], contentEvidence: [
    evidenceFor(npmSource, 'Use npm for repository commands.'),
    evidenceFor(pnpmSource, 'Use pnpm for repository commands.'),
  ], issueCode: 'conflicting-package-manager',
  observationRule: 'literal-directive-conflict-v1', observationStatus: 'verified',
  recommendation: {
    text: 'Choose one package manager across the active and shadowed instructions.',
    provenance: 'host-asserted', status: 'unverified',
  }, disposition: 'host-asserted-unverified',
}));
if (truncatedSafety) qualitativeFindings.push(qualitative({
  id: 'finding-truncated-safety-guidance', kind: 'defect', severity: 'high',
  sourceIds: [truncatedSafety.id], contentEvidence: [
    evidenceFor(truncatedSafety, 'approval before writes'),
  ], issueCode: 'truncated-safety-guidance',
  observationRule: 'truncated-excluded-text-v1', observationStatus: 'verified',
  recommendation: {
    text: 'Move the approval requirement into the contributed instruction prefix.',
    provenance: 'host-asserted', status: 'unverified',
  }, disposition: 'host-asserted-unverified',
}));
if (request.testMode === 'checksum-only') qualitativeFindings = [];
if (request.testMode === 'canned-qualitative' && qualitativeFindings[0]) {
  const { observedSha256, ...entry } = qualitativeFindings[0];
  void observedSha256;
  qualitativeFindings[0] = qualitative({ ...entry,
    contentEvidence: entry.contentEvidence.map((item, index) => index === 0
      ? { ...item, sha256: '0'.repeat(64) } : item) });
}
if (request.testMode === 'unreferenced-qualitative' && qualitativeFindings[0]) {
  const { observedSha256, ...entry } = qualitativeFindings[0];
  void observedSha256;
  qualitativeFindings[0] = qualitative({ ...entry, sourceIds: ['source-9999'] });
}
if (request.testMode === 'extra-qualitative') qualitativeFindings.push(qualitative({
  id: 'finding-generic-improvement', kind: 'improvement', severity: 'low',
  sourceIds: ['source-0008'], contentEvidence: [{ sourceId: 'source-0008',
    startByte: 0, endByte: 1, sha256: digest(Buffer.from('R')) }],
  issueCode: 'delete-authentic-guidance',
  observationRule: 'literal-directive-conflict-v1', observationStatus: 'verified',
  recommendation: { text: 'Review the active project guidance.',
    provenance: 'host-asserted', status: 'unverified' },
  disposition: 'host-asserted-unverified',
}));
if (request.testMode === 'secret-qualitative' && qualitativeFindings[0]) {
  const { observedSha256, ...entry } = qualitativeFindings[0];
  void observedSha256;
  qualitativeFindings[0] = qualitative({ ...entry,
    recommendation: { ...entry.recommendation, text: 'CONTROLLER-PRIVATE-CANARY' } });
}
const descendant = runDescendant();
process.stdout.write(JSON.stringify({ pid: process.pid, phase, findings, qualitativeFindings,
  summary: qualitativeFindings.length === 2
    ? 'Found conflicting package-manager guidance and truncated safety instructions.'
    : 'Audit findings were incomplete.',
  taskSha256, descendant }));
`);
  fs.writeFileSync(adapterPath, `'use strict';
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const mode = process.argv[2];
const phase = process.argv[3];
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
if (phase !== 'preflight') fs.appendFileSync(path.join(__dirname, 'behavior.log'), phase + '\\n');
const readAllowances = [request.hostProgram, request.hostView];
if (mode === 'readable-controller') readAllowances.push(request.probes
  .find((probe) => probe.id === 'controller-private').path);
if (mode === 'readable-recovery') readAllowances.push(request.probes
  .find((probe) => probe.id === 'recovery-private').path);
if (mode === 'readable-evidence') readAllowances.push(request.probes
  .find((probe) => probe.id === 'evidence-private').path);
if (mode === 'readable-sibling') readAllowances.push(request.probes
  .find((probe) => probe.id === 'sibling-private').path);
const permissionArgs = ['--permission', '--allow-child-process', '--allow-worker',
  ...readAllowances.map((entry) => '--allow-fs-read=' + entry)];
if (mode === 'writable-view') permissionArgs.push('--allow-fs-write=' + request.hostView);
const noChild = mode === 'unavailable-null-child' && phase === 'preflight';
const child = noChild ? { status: null, stdout: '' } : childProcess.spawnSync(process.execPath,
  [...permissionArgs, request.hostProgram, phase], {
  cwd: request.hostView,
  input: JSON.stringify({ ...request, testMode: mode }),
  encoding: 'utf8',
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false,
  windowsHide: true,
});
if (mode === 'malformed' && phase === 'plan' || mode === 'malformed-preflight' && phase === 'preflight') {
  process.stdout.write('{');
  process.exit(0);
}
if (mode === 'nonzero-preflight' && phase === 'preflight') process.exit(23);
if (mode === 'timeout-preflight' && phase === 'preflight') {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}
if (mode === 'oversize-preflight' && phase === 'preflight') {
  process.stdout.write('x'.repeat(8192));
  process.exit(0);
}
if (mode === 'mutate' && phase === 'plan') {
  const subject = path.resolve(request.hostView, '..', '..', 'subject');
  fs.appendFileSync(path.join(subject, 'repo', 'AGENTS.md'), 'adapter mutation\\n');
}
const observation = child.status === 0 ? JSON.parse(child.stdout) : {
  pid: null, probes: [], findings: [], qualitativeFindings: [], summary: '',
  descendant: { started: false, pid: null, exitCode: null, stopped: false },
};
if (noChild) observation.descendant.stopped = true;
if (observation.descendant && observation.descendant.stopped === false &&
    Number.isInteger(observation.descendant.pid)) {
  fs.writeFileSync(path.join(__dirname, 'survivor.pid'), String(observation.descendant.pid));
}
const omittedPid = observation.descendant?.omittedPid;
if (Number.isInteger(omittedPid)) {
  fs.writeFileSync(path.join(__dirname, 'survivor.pid'), String(omittedPid));
}
const { omittedPid: ignoredOmittedPid, ...reportedObservationDescendant } =
  observation.descendant || {};
void ignoredOmittedPid;
if (noChild) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350);
const observedPids = [...new Set([process.pid, child.status === 0 ? child.pid : null,
  observation.descendant?.pid]
  .filter(Number.isInteger))];
const reportedDescendant = reportedObservationDescendant;
const base = {
  schemaVersion: 1,
  kind: phase,
  scenarioId: request.scenarioId,
  runId: request.runId,
  host: mode === 'wrong-host' && phase === 'plan'
    ? (request.host === 'codex' ? 'claude' : 'codex')
    : request.host,
  invocationId: request.invocationId,
  controllerNonce: request.controllerNonce,
  provenance: 'synthetic-v1',
  realHostClaim: false,
  policySha256: request.policySha256,
  process: {
    adapterPid: process.pid,
    childPid: child.status === 0 ? child.pid : null,
    childExitCode: child.status,
    descendant: reportedDescendant,
    observedPids,
    treeStopped: reportedDescendant.stopped === true,
  },
};
let result;
if (phase === 'preflight') {
  if (mode === 'lying-probe') {
    observation.probes.find((probe) => probe.id === 'controller-private').errorCode = 'FAKE';
  }
  const actualUnsafe = ['readable-controller', 'readable-recovery', 'readable-evidence',
    'readable-sibling', 'writable-view', 'surviving-descendant'].includes(mode);
  result = {
    ...base,
    availability: mode === 'unavailable-null-child' ? 'missing'
      : mode === 'unauthenticated' ? 'unauthenticated'
      : mode === 'unsafe' || actualUnsafe ? 'unsafe' : 'available-safe',
    authentication: ['unauthenticated', 'unavailable-null-child'].includes(mode)
      ? 'unavailable' : 'available',
    isolation: {
      policy: 'synthetic-read-only-v1',
      probes: observation.probes,
      descendant: reportedDescendant,
      writableRoots: [],
      networkPolicy: 'none',
      toolPolicy: 'none',
    },
  };
} else {
  if (['leak-failure', 'private-canary-leak'].includes(mode) && observation.findings[0]) {
    observation.findings[0].observedSha256 = '1'.repeat(64);
    if (mode === 'private-canary-leak') {
      observation.findings[0].id = 'CONTROLLER-PRIVATE-CANARY';
    }
  }
  result = {
    ...base,
    authorization: 'audit-read-only',
    operations: [],
    blockedTargets: [],
    findings: mode === 'blind' ? [{ id: 'generic-observation', status: 'verified',
      observedSha256: '0'.repeat(64) }] : observation.findings,
    reportDraft: { summary: mode === 'leak-failure' ? JSON.stringify([
      'AUDIT%2DINSTRUCTION-SENTINEL',
      'AUDIT\\u002DINSTRUCTION-SENTINEL',
      Buffer.from('AUDIT-INSTRUCTION-SENTINEL').toString('hex'),
      Buffer.from('AUDIT-INSTRUCTION-SENTINEL').toString('base64'),
      Buffer.from('AUDIT-INSTRUCTION-SENTINEL').toString('base64url'),
      Buffer.from('AUDIT-INSTRUCTION-SENTINEL', 'utf16le').toString('base64'),
      encodeURIComponent(Buffer.from('AUDIT-INSTRUCTION-SENTINEL').toString('base64')),
    ]) : observation.summary, qualitativeFindings: observation.qualitativeFindings },
  };
  if (mode === 'forged-inventory' && phase === 'plan') result.inventory = 'forged';
}
if (mode === 'identity-change' && phase === 'preflight') fs.appendFileSync(__filename, '\\n');
process.stdout.write(JSON.stringify(result));
`);
  writeJson(launcherPath, {
    schemaVersion: 1,
    host,
    adapterKind: 'trusted-host-adapter-v1',
    adapterProgram: process.execPath,
    execution: { kind: 'interpreter', entrypoint: adapterPath },
    hostProgram: childPath,
    identityFiles: [process.execPath, adapterPath, childPath],
    environmentNames: [],
    isolationProfile: 'read-only-host-view-v1',
    profiles: {
      preflight: { args: [adapterPath, mode], promptTransport: 'stdin',
        resultTransport: 'adapter-json' },
      plan: { args: [adapterPath, mode], promptTransport: 'stdin',
        resultTransport: 'adapter-json' },
      verify: { args: [adapterPath, mode], promptTransport: 'stdin',
        resultTransport: 'adapter-json' },
    },
    timeoutMs: mode === 'timeout-preflight' ? 50 : 30000,
    maxStdoutBytes: mode === 'oversize-preflight' ? 4096 : 1048576,
    maxStderrBytes: 1048576,
  });
  return launcherPath;
}

function writeTrustedSyntheticSupervisor(t) {
  const supervisorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-supervisor-'));
  const supervisorPath = path.join(supervisorRoot, 'supervisor.cjs');
  t.after(() => fs.rmSync(supervisorRoot, { recursive: true, force: true }));
  fs.writeFileSync(supervisorPath, String.raw`'use strict';
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const sleep = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),
  0, 0, milliseconds);

function processSnapshot() {
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell',
      'v1.0', 'powershell.exe');
    const script = "$ErrorActionPreference='Stop'; $items = @(Get-CimInstance Win32_Process | " +
      "ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; " +
      "parentPid = [int]$_.ParentProcessId; startToken = if ($_.CreationDate) { " +
      "$_.CreationDate.ToUniversalTime().ToString('o') } else { 'unknown' } } }); " +
      'ConvertTo-Json -Compress -InputObject $items';
    const result = childProcess.spawnSync(powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8', windowsHide: true,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
        maxBuffer: 1024 * 1024,
      });
    if (result.status !== 0) throw new Error('Windows process observation failed.');
    const parsed = JSON.parse(result.stdout);
    return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
      pid: Number(entry.pid), parentPid: Number(entry.parentPid),
      startToken: String(entry.startToken),
    }));
  }
  if (process.platform === 'linux') {
    const processes = [];
    for (const name of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = fs.readFileSync(path.join('/proc', name, 'stat'), 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        processes.push({ pid: Number(name), parentPid: Number(fields[1]),
          startToken: fields[19] });
      } catch {}
    }
    return processes;
  }
  throw new Error('The trusted synthetic supervisor is unsupported on this platform.');
}

const observed = new Map();
let adapter;
function observeTree() {
  const snapshot = processSnapshot();
  const connected = new Set([adapter.pid, ...observed.keys()]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of snapshot) {
      if (!connected.has(entry.pid) && connected.has(entry.parentPid)) {
        connected.add(entry.pid);
        changed = true;
      }
    }
  }
  for (const entry of snapshot) {
    if (connected.has(entry.pid) && (entry.pid === adapter.pid ||
        connected.has(entry.parentPid))) observed.set(entry.pid, entry);
  }
  return snapshot;
}

function sameIdentity(left, right) {
  return left.pid === right.pid && left.startToken === right.startToken;
}

function stopObservedTree() {
  let snapshot = observeTree();
  const depth = (entry) => {
    let value = 0;
    let current = entry;
    const visited = new Set();
    while (current && current.pid !== adapter.pid && !visited.has(current.pid)) {
      visited.add(current.pid);
      current = observed.get(current.parentPid);
      value += 1;
    }
    return value;
  };
  const targets = [...observed.values()].sort((left, right) => depth(right) - depth(left));
  const byPid = new Map(snapshot.map((entry) => [entry.pid, entry]));
  for (const target of targets) {
    const current = byPid.get(target.pid);
    if (!current || !sameIdentity(target, current)) continue;
    try { process.kill(target.pid); } catch {}
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    sleep(25);
    snapshot = processSnapshot();
    const currentByPid = new Map(snapshot.map((entry) => [entry.pid, entry]));
    if (![...observed.values()].some((entry) => {
      const current = currentByPid.get(entry.pid);
      return current && sameIdentity(entry, current);
    })) return true;
  }
  return false;
}

const stdout = [];
const stderr = [];
let stdoutBytes = 0;
let stderrBytes = 0;
let timedOut = false;
let outputExceeded = false;
adapter = childProcess.spawn(request.executable, request.args, {
  cwd: request.options.cwd,
  env: request.options.env,
  shell: false,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
adapter.stdout.on('data', (chunk) => {
  stdoutBytes += chunk.length;
  if (stdoutBytes <= request.options.maxBuffer) stdout.push(chunk);
  else outputExceeded = true;
});
adapter.stderr.on('data', (chunk) => {
  stderrBytes += chunk.length;
  if (stderrBytes <= request.options.maxBuffer) stderr.push(chunk);
  else outputExceeded = true;
});
adapter.stdin.end(Buffer.from(request.inputBase64, 'base64'));
observeTree();
const observer = setInterval(() => observeTree(), 25);
const timeout = setTimeout(() => {
  timedOut = true;
  stopObservedTree();
}, request.options.timeout);
adapter.once('close', (status, signal) => {
  clearInterval(observer);
  clearTimeout(timeout);
  observeTree();
  const treeStopped = stopObservedTree();
  const containment = {
    schemaVersion: 1,
    observationSource: 'trusted-synthetic-runtime-v1',
    adapterPid: adapter.pid,
    observedProcesses: [...observed.values()].sort((left, right) => left.pid - right.pid),
    treeStopped,
  };
  process.stdout.write(JSON.stringify({
    result: {
      status: timedOut || outputExceeded ? null : status,
      signal,
      errorCode: timedOut ? 'ETIMEDOUT' : outputExceeded ? 'ENOBUFS' : null,
      stdoutBase64: Buffer.concat(stdout).toString('base64'),
      stderrBase64: Buffer.concat(stderr).toString('base64'),
    },
    containment,
  }));
});
`);
  return supervisorPath;
}

function trustedSyntheticLauncher(supervisorPath, runtimeCalls) {
  return (executable, args, options) => {
    runtimeCalls.trustedLaunch += 1;
    const request = {
      executable,
      args,
      inputBase64: Buffer.from(options.input || '').toString('base64'),
      options: {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
      },
    };
    const execution = childProcess.spawnSync(process.execPath, [supervisorPath], {
      input: JSON.stringify(request),
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: options.timeout + 15000,
      maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    });
    if (execution.status !== 0) {
      throw new Error(`Trusted synthetic supervisor failed: ${execution.stderr}`);
    }
    const launch = JSON.parse(execution.stdout);
    return {
      result: {
        status: launch.result.status,
        signal: launch.result.signal,
        error: launch.result.errorCode === null ? undefined : { code: launch.result.errorCode },
        stdout: Buffer.from(launch.result.stdoutBase64, 'base64'),
        stderr: Buffer.from(launch.result.stderrBase64, 'base64'),
      },
      containment: launch.containment,
    };
  };
}

function collectRelativeFiles(directory) {
  const files = [];
  const visit = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push(path.relative(directory, entryPath)
        .split(path.sep).join('/'));
    }
  };
  visit(directory);
  return files.sort();
}

// Defects: a worker-authored identity/evidence chain, unsafe preflight, or mutated
// AUDIT target could be accepted as authoritative forward evidence.
test('audit fixture uses trusted dispatch and controller-owned evidence', (t) => {
  assert.deepEqual(Object.keys(controller).sort(), [
    'CONTRACT_DEFINITIONS',
    'appendEvent',
    'executeHost',
    'gradeControllerRun',
    'prepareController',
    'readLauncher',
    'renderPublicSchemas',
    'runInventory',
    'sealEvidence',
    'validateContract',
  ]);
  assert.deepEqual(Object.keys(forward).sort(), [
    'captureEvidence',
    'executeHost',
    'gradeScenario',
    'prepareFixture',
    'recoverHost',
    'runCli',
    'snapshotTargets',
  ]);

  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-controller-audit-'));
  t.after(() => fs.rmSync(runRoot, { recursive: true, force: true }));
  const runtimeCalls = { spawn: 0, rename: 0, trustedLaunch: 0 };
  const supervisorPath = writeTrustedSyntheticSupervisor(t);
  const runtime = {
    gitExecutable: trustedGitExecutable(),
    spawnSync(...args) {
      runtimeCalls.spawn += 1;
      assert.notEqual(String(args[0]).toLowerCase(), 'where.exe');
      assert.notEqual(String(args[0]).toLowerCase(), 'which');
      return childProcess.spawnSync(...args);
    },
    renameSync(...args) {
      runtimeCalls.rename += 1;
      return fs.renameSync(...args);
    },
    launchSynthetic: trustedSyntheticLauncher(supervisorPath, runtimeCalls),
  };
  const prepared = forward.prepareFixture('audit', runRoot, runtime);
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.authoritative, true);
  const launcherArgumentAttack = writeTrustedAdapterFixture(t, 'codex');
  const launcherArgumentDescriptor = readJson(launcherArgumentAttack);
  for (const profile of Object.values(launcherArgumentDescriptor.profiles)) {
    profile.args[0] = path.basename(profile.args[0]);
  }
  writeJson(launcherArgumentAttack, launcherArgumentDescriptor);
  assert.equal(controller.readLauncher(launcherArgumentAttack, runRoot, 'codex').status,
    'unverified', 'relative interpreter scripts must be rejected before launch');
  for (const profile of Object.values(launcherArgumentDescriptor.profiles)) {
    profile.args = ['--eval', 'process.stdout.write("unpinned")'];
  }
  writeJson(launcherArgumentAttack, launcherArgumentDescriptor);
  assert.equal(controller.readLauncher(launcherArgumentAttack, runRoot, 'codex').status,
    'unverified', 'inline executable interpreter payloads must be rejected');
  const flaggedLauncher = writeTrustedAdapterFixture(t, 'codex');
  const flaggedDescriptor = readJson(flaggedLauncher);
  for (const profile of Object.values(flaggedDescriptor.profiles)) {
    profile.args.unshift('--no-warnings');
  }
  writeJson(flaggedLauncher, flaggedDescriptor);
  assert.equal(controller.readLauncher(flaggedLauncher, runRoot, 'codex').status, 'ready',
    'native profile flags must remain compatible with a pinned absolute entrypoint');
  const renamedInterpreterLauncher = writeTrustedAdapterFixture(t, 'codex');
  const renamedInterpreterDescriptor = readJson(renamedInterpreterLauncher);
  const renamedInterpreter = path.join(path.dirname(renamedInterpreterLauncher),
    process.platform === 'win32' ? 'nodejs-copy.exe' : 'nodejs-copy');
  fs.copyFileSync(process.execPath, renamedInterpreter);
  renamedInterpreterDescriptor.adapterProgram = renamedInterpreter;
  renamedInterpreterDescriptor.identityFiles = renamedInterpreterDescriptor.identityFiles
    .map((entry) => entry === process.execPath ? renamedInterpreter : entry);
  for (const profile of Object.values(renamedInterpreterDescriptor.profiles)) {
    profile.args[0] = path.basename(profile.args[0]);
  }
  writeJson(renamedInterpreterLauncher, renamedInterpreterDescriptor);
  assert.equal(controller.readLauncher(renamedInterpreterLauncher, runRoot, 'codex').status,
    'unverified', 'renamed interpreters must not bypass pinned entrypoint validation');
  const nativeInterpreterLauncher = writeTrustedAdapterFixture(t, 'codex');
  const nativeInterpreterDescriptor = readJson(nativeInterpreterLauncher);
  const nativeInterpreter = path.join(path.dirname(nativeInterpreterLauncher),
    process.platform === 'win32' ? 'native-adapter.exe' : 'native-adapter');
  fs.copyFileSync(process.execPath, nativeInterpreter);
  nativeInterpreterDescriptor.adapterProgram = nativeInterpreter;
  nativeInterpreterDescriptor.execution = { kind: 'native', entrypoint: null };
  nativeInterpreterDescriptor.identityFiles = nativeInterpreterDescriptor.identityFiles
    .map((entry) => entry === process.execPath ? nativeInterpreter : entry);
  for (const profile of Object.values(nativeInterpreterDescriptor.profiles)) {
    profile.args[0] = path.basename(profile.args[0]);
  }
  writeJson(nativeInterpreterLauncher, nativeInterpreterDescriptor);
  const preloadLauncher = writeTrustedAdapterFixture(t, 'codex');
  const preloadDescriptor = readJson(preloadLauncher);
  const unpinnedPreload = path.join(path.dirname(preloadLauncher), 'unpinned-preload.cjs');
  fs.writeFileSync(unpinnedPreload, 'module.exports = {};\n');
  for (const profile of Object.values(preloadDescriptor.profiles)) {
    profile.args.unshift(`-r${unpinnedPreload}`);
  }
  writeJson(preloadLauncher, preloadDescriptor);
  assert.equal(controller.readLauncher(preloadLauncher, runRoot, 'codex').status,
    'unverified', 'compact executable preload flags must be rejected');
  const unsafeStartupStatuses = [[
    'renamed native interpreter',
    controller.readLauncher(nativeInterpreterLauncher, runRoot, 'codex').status,
  ]];
  for (const environmentName of [
    'NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME',
    'RUBYOPT', 'RUBYLIB', 'BASH_ENV', 'ENV', 'ZDOTDIR', 'LUA_INIT', 'LUA_INIT_5_4',
    'LUA_PATH', 'LUA_CPATH', 'PSMODULEPATH',
  ]) {
    const environmentLauncher = writeTrustedAdapterFixture(t, 'codex');
    const environmentDescriptor = readJson(environmentLauncher);
    environmentDescriptor.environmentNames = [environmentName];
    writeJson(environmentLauncher, environmentDescriptor);
    unsafeStartupStatuses.push([environmentName,
      controller.readLauncher(environmentLauncher, runRoot, 'codex').status]);
  }
  assert.deepEqual(unsafeStartupStatuses.map(([name, status]) => [name, status]),
    unsafeStartupStatuses.map(([name]) => [name, 'unverified']),
    'native interpreter scripts and executable startup environments must be rejected');
  const schemasForParity = controller.renderPublicSchemas();
  const parityFixtures = {
    protocolEvent: {
      schemaVersion: 2, runId: prepared.runId, host: 'codex', invocationId: null,
      sequence: 1, phase: 'prepared', previousEventSha256: null,
      startedAt: '2030-01-01T00:00:00.000Z', completedAt: '2030-01-01T00:00:00.000Z',
      beforeSnapshotSha256: null, afterSnapshotSha256: null,
      inputBlobRefs: [], outputBlobRefs: [], disposition: 'pass',
    },
    hostEnvelope: {
      schemaVersion: 1, kind: 'plan', scenarioId: 'audit', runId: prepared.runId,
      host: 'codex', invocationId: crypto.randomUUID(), controllerNonce: 'c'.repeat(64),
      provenance: 'synthetic-v1', realHostClaim: false, policySha256: 'b'.repeat(64),
      process: { adapterPid: 1, childPid: 2, childExitCode: 0,
        descendant: { started: true, pid: 3, exitCode: 0, stopped: true },
        observedPids: [1, 2, 3],
        treeStopped: true },
      authorization: 'audit-read-only', operations: [], blockedTargets: [],
      findings: [{ id: 'inventory-roots', status: 'verified',
        observedSha256: 'a'.repeat(64) }],
      reportDraft: {
        summary: 'Found conflicting package-manager guidance and truncated safety instructions.',
        qualitativeFindings: AUDIT_QUALITATIVE_EXPECTATIONS.map((entry) => ({ ...entry,
          observedSha256: 'd'.repeat(64) })),
      },
    },
    evidence: {
      schemaVersion: 2, scenarioId: 'audit', runId: prepared.runId, host: 'codex',
      controllerOwned: true, outcome: 'pass', auditSummary: {
        text: 'Bounded audit summary.', provenance: 'host-asserted', status: 'unverified',
      },
      targetMatrix: [{ id: 'source-0001', host: 'claude', scope: 'global',
        origin: 'claude-home', loadState: 'active', byteCount: 1, byteContribution: 1,
        sha256: 'a'.repeat(64), status: 'verified' }],
      effectiveChain: [], decisionLedger: [],
      changesAndRecovery: { transactions: [], recoveryCreated: false },
      verificationMatrix: [], pendingQuestions: [],
    },
  };
  const paritySchemas = {
    protocolEvent: schemasForParity['protocol-v2.schema.json'],
    hostEnvelope: schemasForParity['host-envelope-v2.schema.json'],
    evidence: schemasForParity['evidence-v2.schema.json'],
  };
  const assertContractParity = (name, value, expected, seam) => {
    const hand = controller.validateContract(name, value).valid;
    const rendered = renderedSchemaValid(paritySchemas[name], value);
    assert.equal(hand, rendered, `${name} parity: ${seam}`);
    assert.equal(hand, expected, `${name} expectation: ${seam}`);
  };
  for (const [name, fixture] of Object.entries(parityFixtures)) {
    assertContractParity(name, fixture, true, 'valid');
    const missing = structuredClone(fixture);
    delete missing[controller.CONTRACT_DEFINITIONS[name].required[0]];
    assertContractParity(name, missing, false, 'required');
    assertContractParity(name, { ...structuredClone(fixture), host: 7 }, false, 'type');
    assertContractParity(name, { ...structuredClone(fixture), schemaVersion: 99 }, false,
      'const');
    assertContractParity(name, { ...structuredClone(fixture), host: 'invented' }, false,
      'enum');
    assertContractParity(name, { ...structuredClone(fixture), runId: '' }, false,
      'minLength');
    assertContractParity(name, { ...structuredClone(fixture), extra: true }, false,
      'additionalProperties');
  }
  assertContractParity('protocolEvent', { ...structuredClone(parityFixtures.protocolEvent),
    previousEventSha256: 'bad' }, false, 'pattern');
  assertContractParity('hostEnvelope', { ...structuredClone(parityFixtures.hostEnvelope),
    availability: 'available-safe' }, false, 'variant');
  assertContractParity('hostEnvelope', { ...structuredClone(parityFixtures.hostEnvelope),
    reportDraft: { ...parityFixtures.hostEnvelope.reportDraft,
      qualitativeFindings: [] } }, false, 'minItems');
  assertContractParity('hostEnvelope', { ...structuredClone(parityFixtures.hostEnvelope),
    reportDraft: { ...parityFixtures.hostEnvelope.reportDraft,
      qualitativeFindings: Array.from({ length: 9 }, (_, index) => ({
        ...AUDIT_QUALITATIVE_EXPECTATIONS[index % 2], id: `finding-extra-${index}`,
        observedSha256: 'd'.repeat(64),
      })) } }, false, 'maxItems');
  assertContractParity('hostEnvelope', { ...structuredClone(parityFixtures.hostEnvelope),
    reportDraft: { ...parityFixtures.hostEnvelope.reportDraft,
      summary: '🧪'.repeat(512) } }, true, 'astral maxLength boundary');
  assertContractParity('hostEnvelope', { ...structuredClone(parityFixtures.hostEnvelope),
    reportDraft: { ...parityFixtures.hostEnvelope.reportDraft,
      summary: '🧪'.repeat(513) } }, false, 'astral maxLength overflow');
  const badFindingPattern = structuredClone(parityFixtures.hostEnvelope);
  badFindingPattern.reportDraft.qualitativeFindings[0].id = 'INVALID';
  assertContractParity('hostEnvelope', badFindingPattern, false, 'nested pattern');
  const badEvidencePattern = structuredClone(parityFixtures.evidence);
  badEvidencePattern.targetMatrix[0].sha256 = 'bad';
  assertContractParity('evidence', badEvidencePattern, false, 'nested pattern');
  const extraEvidenceProperty = structuredClone(parityFixtures.evidence);
  extraEvidenceProperty.changesAndRecovery.extra = true;
  assertContractParity('evidence', extraEvidenceProperty, false,
    'nested additionalProperties');
  const codexSubject = path.join(runRoot, 'hosts', 'codex', 'subject');
  const claudeSubject = path.join(runRoot, 'hosts', 'claude', 'subject');
  assert.deepEqual(forward.snapshotTargets(codexSubject), forward.snapshotTargets(claudeSubject));
  assert.notEqual(fs.statSync(path.join(codexSubject, 'repo', 'AGENTS.md'), { bigint: true }).ino,
    fs.statSync(path.join(claudeSubject, 'repo', 'AGENTS.md'), { bigint: true }).ino,
    'host subjects must not share file identities');

  const codexLauncher = writeTrustedAdapterFixture(t, 'codex');
  const claudeLauncher = writeTrustedAdapterFixture(t, 'claude');
  const codex = forward.executeHost('audit', runRoot,
    { host: 'codex', launcherPath: codexLauncher }, runtime);
  const claude = forward.executeHost('audit', runRoot,
    { host: 'claude', launcherPath: claudeLauncher }, runtime);
  assert.ok(runtimeCalls.spawn >= 6,
    'the explicit runtime seam must own controller inventory launches');
  assert.ok(runtimeCalls.rename >= 4, 'the explicit runtime seam must own atomic publication');
  assert.equal(runtimeCalls.trustedLaunch, 6,
    'the trusted runtime must contain exactly three synthetic launches per host');
  for (const result of [codex, claude]) {
    assert.equal(result.outcome, 'pass');
    assert.equal(result.authoritative, true);
    assert.equal(result.realHostClaim, false);
    assert.equal(result.inventories.length, 3);
    assert.equal(new Set(result.invocations.map((entry) => entry.invocationId)).size, 3);
    assert.notEqual(result.invocations[1].invocationId, result.invocations[2].invocationId);
    assert.equal(new Set(result.invocations.map((entry) => entry.policySha256)).size, 1);
    assert.notDeepEqual(result.invocations[1].findings, result.invocations[2].findings,
      'nonce- and phase-bound semantic proofs must differ');
    assert.ok(result.invocations.every((entry) => entry.processTreeStopped === true &&
      /^[0-9a-f]{64}$/.test(entry.identitySha256) && entry.rawStdout === undefined &&
      entry.envelope === undefined));
    for (const invocation of result.invocations) {
      assert.equal(invocation.containment.observationSource,
        'trusted-synthetic-runtime-v1');
      assert.ok(Number.isInteger(invocation.containment.adapterPid));
      assert.ok(invocation.containment.observedProcesses.length >= 3);
      assert.equal(invocation.containment.treeStopped, true);
    }
    for (const invocation of result.invocations.filter((entry) =>
      ['plan', 'verify'].includes(entry.profile))) {
      assert.deepEqual(invocation.summary, {
        text: 'Found conflicting package-manager guidance and truncated safety instructions.',
        provenance: 'host-asserted', status: 'unverified',
      });
      assert.deepEqual(invocation.qualitativeFindings.map(({ observedSha256, ...entry }) => {
        assert.match(observedSha256, /^[0-9a-f]{64}$/);
        return entry;
      }), AUDIT_QUALITATIVE_EXPECTATIONS);
    }
    assert.notDeepEqual(result.invocations[1].qualitativeFindings,
      result.invocations[2].qualitativeFindings,
      'qualitative findings must retain phase- and nonce-bound content receipts');
    const preflight = result.invocations.find((entry) => entry.profile === 'preflight');
    assert.deepEqual(preflight.probes.map(({ id, operation, outcome }) =>
      ({ id, operation, outcome })), [
      { id: 'host-view', operation: 'read', outcome: 'allowed' },
      { id: 'controller-private', operation: 'read', outcome: 'denied' },
      { id: 'recovery-private', operation: 'read', outcome: 'denied' },
      { id: 'evidence-private', operation: 'read', outcome: 'denied' },
      { id: 'sibling-private', operation: 'read', outcome: 'denied' },
      { id: 'host-view-write', operation: 'write', outcome: 'denied' },
    ]);
    assert.equal(preflight.descendant.started, true);
    assert.equal(preflight.descendant.stopped, true);
    assert.ok(result.events.every((entry, index) =>
      entry.sequence === index + 1 &&
      entry.previousEventSha256 === (index === 0 ? null : sha256(
        Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(
          result.events[index - 1]).sort(([left], [right]) => left.localeCompare(right))))))) &&
      entry.canonical === undefined && controller.validateContract('protocolEvent', entry).valid));
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const evidence = path.join(runRoot, 'hosts', result.host, 'evidence');
      const stdout = fs.readFileSync(path.join(evidence,
        `inventory-${ordinal}-stdout.json`));
      const receipt = readJson(path.join(evidence, `inventory-${ordinal}-receipt.json`));
      assert.equal(receipt.stdoutSha256, sha256(stdout));
      assert.equal(receipt.controllerOwned, true);
      assert.equal(receipt.argv[0], process.execPath);
      assert.ok(path.isAbsolute(receipt.gitExecutable));
      assert.ok(receipt.argv.includes('--claude-setting-sources'));
      assert.ok(receipt.argv.includes('user,project,local'));
      const manifest = JSON.parse(stdout);
      assert.equal(manifest.chains.claude.coverage, 'complete');
      assert.deepEqual(manifest.warnings, []);
      assert.equal(manifest.sources.length, 25);
    }
    assert.deepEqual(result.targetSnapshots[0], result.targetSnapshots.at(-1));
    const report = readJson(path.join(runRoot, 'hosts', result.host, 'evidence', 'report.json'));
    const manifest = readJson(path.join(runRoot, 'hosts', result.host, 'evidence',
      'inventory-1-stdout.json'));
    const hostSubject = path.join(runRoot, 'hosts', result.host, 'subject');
    assert.deepEqual(manifest.sources.map((source) => [
      path.relative(hostSubject, source.logicalPath).split(path.sep).join('/'),
      source.host, source.scope, source.origin, source.loadState, source.byteCount,
      source.byteContribution,
    ]), AUDIT_SOURCE_EXPECTATIONS);
    assert.deepEqual(manifest.chains, {
      codex: { sourceIds: ['source-0004', 'source-0008', 'source-0018', 'source-0020'] },
      claude: {
        sourceIds: ['source-0001', 'source-0002', 'source-0011', 'source-0025',
          'source-0010'],
        conditionalSourceIds: ['source-0007'], maxImportDepth: 1, excludes: [],
        settingSources: { state: 'explicit', sources: ['user', 'project', 'local'] },
        coverage: 'complete',
      },
    });
    assert.deepEqual(report.targetMatrix.map(({ id, loadState, byteCount,
      byteContribution, sha256: digest, status }) => ({ id, loadState, byteCount,
      byteContribution, sha256: digest, status })), manifest.sources.map((source) => ({
      id: source.id,
      loadState: source.loadState,
      byteCount: source.byteCount,
      byteContribution: source.byteContribution,
      sha256: source.sha256,
      status: ['source-0003', 'source-0004', 'source-0020'].includes(source.id)
        ? 'unverified' : 'verified',
    })));
    assert.deepEqual(report.auditSummary, {
      text: 'Found conflicting package-manager guidance and truncated safety instructions.',
      provenance: 'host-asserted',
      status: 'unverified',
    }, 'the controller must not publish a host-authored summary as a verified fact');
    assert.ok(report.decisionLedger.every((entry) =>
      entry.observationStatus === 'verified' &&
      entry.recommendation?.provenance === 'host-asserted' &&
      entry.recommendation?.status === 'unverified' &&
      entry.disposition === 'host-asserted-unverified'),
    'content observations and host recommendations must have separate dispositions');
    assert.deepEqual(report.decisionLedger.map(({ phase, observedSha256, ...entry }) => {
      assert.ok(['plan', 'verify'].includes(phase));
      assert.match(observedSha256, /^[0-9a-f]{64}$/);
      return entry;
    }), [...AUDIT_QUALITATIVE_EXPECTATIONS, ...AUDIT_QUALITATIVE_EXPECTATIONS]);
    assert.ok(report.verificationMatrix.some((entry) =>
      entry.claim === 'content-derived-plan-observations' && entry.status === 'verified'));
    assert.ok(report.verificationMatrix.some((entry) =>
      entry.claim === 'host-plan-recommendations' && entry.status === 'unverified'));
    assert.ok(report.verificationMatrix.some((entry) =>
      entry.claim === 'content-derived-verify-observations' && entry.status === 'verified'));
    assert.ok(report.verificationMatrix.some((entry) =>
      entry.claim === 'host-verify-recommendations' && entry.status === 'unverified'));
    const hostView = path.join(runRoot, 'hosts', result.host, 'controller', 'host-view');
    for (const relative of ['request.json', 'inventory.json', 'instruction-task.md',
      'inputs/index.json', 'schemas/host-envelope-v2.schema.json',
      'schemas/evidence-v2.schema.json']) {
      assert.equal(fs.statSync(path.join(hostView, ...relative.split('/'))).isFile(), true);
    }
    assert.equal(fs.existsSync(path.join(hostView, 'expected.json')), false,
      'private semantic expectations must not be exposed to the host');
    assert.deepEqual(readJson(path.join(hostView, 'inputs', 'index.json')).map(
      (entry) => entry.id), manifest.sources.map((source) => source.id));
    for (const invocation of result.invocations) {
      for (const digest of [invocation.stdoutSha256, invocation.stderrSha256]) {
        const blob = path.join(runRoot, 'hosts', result.host, 'controller', 'blobs',
          `${digest}.blob`);
        assert.equal(sha256(fs.readFileSync(blob)), digest,
          'raw adapter bodies must remain in private digest blobs');
      }
    }
    const publicResult = fs.readFileSync(path.join(runRoot, 'hosts', result.host,
      'result.json'), 'utf8');
    assert.doesNotMatch(publicResult, /reportDraft|controllerNonce|rawStdout|rawStderr/);
  }

  const aggregate = forward.gradeScenario('audit', runRoot);
  assert.equal(aggregate.outcome, 'pass');
  assert.equal(aggregate.authoritative, true);
  assert.deepEqual(aggregate.hosts.map((entry) => entry.host), ['claude', 'codex']);
  const codexPublicResultPath = path.join(runRoot, 'hosts', 'codex', 'result.json');
  const codexPrivateResultPath = path.join(runRoot, 'hosts', 'codex', 'controller',
    'result.json');
  const codexResultReceiptPath = path.join(runRoot, 'hosts', 'codex', 'controller',
    'result-receipt.json');
  const originalCodexPublicResult = fs.readFileSync(codexPublicResultPath);
  const originalCodexPrivateResult = fs.readFileSync(codexPrivateResultPath);
  const originalCodexResultReceipt = fs.readFileSync(codexResultReceiptPath);
  const validCodexResult = JSON.parse(originalCodexPublicResult);
  const restoreCodexResult = () => {
    fs.writeFileSync(codexPublicResultPath, originalCodexPublicResult);
    fs.writeFileSync(codexPrivateResultPath, originalCodexPrivateResult);
    fs.writeFileSync(codexResultReceiptPath, originalCodexResultReceipt);
  };
  const rejectNonPassMutation = (label, mutate) => {
    try {
      mutate();
      const rejected = forward.gradeScenario('audit', runRoot, runtime);
      assert.equal(rejected.outcome, 'fail', label);
      assert.equal(rejected.hosts.find((entry) => entry.host === 'codex').outcome, 'fail', label);
      assert.doesNotMatch(JSON.stringify(rejected), /CONTROLLER-PRIVATE-CANARY/, label);
    } finally {
      restoreCodexResult();
    }
    assert.equal(forward.gradeScenario('audit', runRoot, runtime).outcome, 'pass',
      `${label} restore`);
  };
  rejectNonPassMutation('empty public result must fail closed', () =>
    writeJson(codexPublicResultPath, {}));
  rejectNonPassMutation('unknown outcome must fail closed', () =>
    writeJson(codexPublicResultPath, { ...validCodexResult, outcome: 'invented' }));
  rejectNonPassMutation('wrong result host must fail closed', () =>
    writeJson(codexPublicResultPath, { ...validCodexResult, host: 'claude' }));
  rejectNonPassMutation('wrong result run must fail closed', () =>
    writeJson(codexPublicResultPath, { ...validCodexResult, runId: crypto.randomUUID() }));
  for (const outcome of ['fail', 'unverified']) {
    rejectNonPassMutation(`altered ${outcome} result must fail closed`, () =>
      writeJson(codexPublicResultPath, { ...validCodexResult, outcome,
        protocolOutcome: outcome, taskOutcome: 'not-completed',
        reason: 'adapter-behavior-failed' }));
  }
  rejectNonPassMutation('secret-bearing result must fail closed', () =>
    writeJson(codexPublicResultPath, { ...validCodexResult, outcome: 'fail',
      protocolOutcome: 'fail', taskOutcome: 'not-completed',
      reason: 'CONTROLLER-PRIVATE-CANARY' }));
  rejectNonPassMutation('bad result receipt must fail closed', () =>
    writeJson(codexResultReceiptPath, { schemaVersion: 2 }));
  rejectNonPassMutation('missing result receipt must fail closed', () =>
    fs.rmSync(codexResultReceiptPath));
  rejectNonPassMutation('missing private result must fail closed', () =>
    fs.rmSync(codexPrivateResultPath));
  const publicFiles = collectRelativeFiles(runRoot).filter((entry) =>
    entry.startsWith('protocol/') || /^hosts\/(?:codex|claude)\/(?:evidence|result\.json)/.test(entry) ||
    entry.startsWith('results/'));
  assert.deepEqual(publicFiles, [
    'hosts/claude/evidence/events.json',
    'hosts/claude/evidence/inventory-1-receipt.json',
    'hosts/claude/evidence/inventory-1-stdout.json',
    'hosts/claude/evidence/inventory-2-receipt.json',
    'hosts/claude/evidence/inventory-2-stdout.json',
    'hosts/claude/evidence/inventory-3-receipt.json',
    'hosts/claude/evidence/inventory-3-stdout.json',
    'hosts/claude/evidence/report.json',
    'hosts/claude/evidence/report.md',
    'hosts/claude/result.json',
    'hosts/codex/evidence/events.json',
    'hosts/codex/evidence/inventory-1-receipt.json',
    'hosts/codex/evidence/inventory-1-stdout.json',
    'hosts/codex/evidence/inventory-2-receipt.json',
    'hosts/codex/evidence/inventory-2-stdout.json',
    'hosts/codex/evidence/inventory-3-receipt.json',
    'hosts/codex/evidence/inventory-3-stdout.json',
    'hosts/codex/evidence/report.json',
    'hosts/codex/evidence/report.md',
    'hosts/codex/result.json',
    'protocol/evidence-v2.schema.json',
    'protocol/host-envelope-v2.schema.json',
    'protocol/protocol-v2.schema.json',
    'results/aggregate.json',
  ]);
  for (const host of ['codex', 'claude']) {
    const markdown = fs.readFileSync(path.join(runRoot, 'hosts', host, 'evidence',
      'report.md'), 'utf8');
    assert.deepEqual([...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]),
      HUMAN_REPORT_SECTIONS);
    const publicBytes = collectRelativeFiles(path.join(runRoot, 'hosts', host, 'evidence'))
      .map((entry) => fs.readFileSync(path.join(runRoot, 'hosts', host, 'evidence', entry)))
      .map((bytes) => bytes.toString('utf8')).join('\\n');
    assert.doesNotMatch(publicBytes,
      /AUDIT-INSTRUCTION-SENTINEL|AUDIT%2DINSTRUCTION|4155444954|QVVESVQ/);
  }

  const validPlanEnvelope = {
    schemaVersion: 1,
    kind: 'plan',
    scenarioId: 'audit',
    runId: prepared.runId,
    host: 'codex',
    invocationId: crypto.randomUUID(),
    controllerNonce: 'c'.repeat(64),
    provenance: 'synthetic-v1',
    realHostClaim: false,
    policySha256: 'b'.repeat(64),
    process: { adapterPid: 1, childPid: 2, childExitCode: 0,
      descendant: { started: true, pid: 3, exitCode: 0, stopped: true },
      observedPids: [1, 2, 3],
      treeStopped: true },
    authorization: 'audit-read-only',
    operations: [],
    blockedTargets: [],
    findings: [{ id: 'plan-observation', status: 'verified' }],
    reportDraft: {
      summary: 'Found conflicting package-manager guidance and truncated safety instructions.',
      qualitativeFindings: AUDIT_QUALITATIVE_EXPECTATIONS.map((entry) => ({ ...entry,
        observedSha256: 'd'.repeat(64) })),
    },
  };
  validPlanEnvelope.findings = [{ id: 'inventory-roots', status: 'verified',
    observedSha256: 'a'.repeat(64) }];
  assert.equal(controller.validateContract('hostEnvelope', validPlanEnvelope).valid, true);
  const planRequired = [...controller.CONTRACT_DEFINITIONS.hostEnvelope.required,
    ...controller.CONTRACT_DEFINITIONS.hostEnvelope.variants.plan.required];
  for (const required of planRequired) {
    assert.equal(controller.validateContract('hostEnvelope', Object.fromEntries(
      Object.entries(validPlanEnvelope).filter(([key]) => key !== required))).valid, false,
    `missing required field must fail: ${required}`);
  }
  for (const mutation of [
    { ...validPlanEnvelope, host: 'invented' },
    { ...validPlanEnvelope, operations: 'none' },
    { ...validPlanEnvelope, availability: 'available-safe' },
    { ...validPlanEnvelope, findings: [{ ...validPlanEnvelope.findings[0],
      observedSha256: 'not-a-digest' }] },
    { ...validPlanEnvelope, findings: [{ ...validPlanEnvelope.findings[0], extra: true }] },
    { ...validPlanEnvelope, process: { ...validPlanEnvelope.process, extra: true } },
    { ...validPlanEnvelope, reportDraft: { ...validPlanEnvelope.reportDraft, extra: true } },
    { ...validPlanEnvelope, kind: 'preflight' },
    { ...validPlanEnvelope, provenance: 'invented-v1' },
    Object.fromEntries(Object.entries(validPlanEnvelope)
      .filter(([key]) => key !== 'invocationId')),
  ]) assert.equal(controller.validateContract('hostEnvelope', mutation).valid, false);
  const schemas = controller.renderPublicSchemas();
  assert.equal(schemas['host-envelope-v2.schema.json'].$schema,
    'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schemas['host-envelope-v2.schema.json'].additionalProperties, false);
  const renderedPlan = schemas['host-envelope-v2.schema.json'].oneOf.find(
    (variant) => variant.properties.kind.const === 'plan');
  assert.ok(renderedPlan.required.includes('invocationId'));
  assert.ok(planRequired.every((required) => renderedPlan.required.includes(required)));
  assert.ok(renderedPlan.not.anyOf.some((entry) => entry.required.includes('availability')));
  assert.equal(schemas['host-envelope-v2.schema.json'].properties.process
    .additionalProperties, false);
  assert.equal(schemas['host-envelope-v2.schema.json'].properties.findings.items
    .additionalProperties, false);

  const attackResults = new Map();
  const attack = (mode, expectedOutcome) => {
    const attackRoot = fs.mkdtempSync(path.join(os.tmpdir(), `instruction-audit-${mode}-`));
    t.after(() => fs.rmSync(attackRoot, { recursive: true, force: true }));
    forward.prepareFixture('audit', attackRoot, runtime);
    const launcher = writeTrustedAdapterFixture(t, 'codex', mode);
    const result = forward.executeHost('audit', attackRoot,
      { host: 'codex', launcherPath: launcher }, runtime);
    assert.equal(result.outcome, expectedOutcome, mode);
    if (expectedOutcome === 'unverified' || ['malformed-preflight', 'nonzero-preflight',
      'timeout-preflight', 'oversize-preflight', 'identity-change', 'lying-probe']
      .includes(mode)) {
      assert.equal(fs.existsSync(path.join(path.dirname(launcher), 'behavior.log')), false,
        `${mode} must not launch plan or verify behavior`);
    }
    assert.ok(['adapter-preflight-failed', 'adapter-behavior-failed',
      'preflight-unavailable', 'semantic-observation-failed', 'privacy-scan-failed',
      'target-integrity-failed'].includes(result.reason),
    `public reason must be a controller-owned code: ${result.reason}`);
    const survivorPath = path.join(path.dirname(launcher), 'survivor.pid');
    if (fs.existsSync(survivorPath)) {
      const pid = Number(fs.readFileSync(survivorPath, 'utf8'));
      stopTestProcess(pid);
    }
    const attacked = { attackRoot, result, launcher };
    attackResults.set(mode, attacked);
    return attacked;
  };
  for (const mode of ['wrong-host', 'mutate', 'forged-inventory', 'malformed', 'blind',
    'lying-probe', 'malformed-preflight', 'nonzero-preflight', 'oversize-preflight',
    'timeout-preflight', 'identity-change', 'checksum-only', 'canned-qualitative',
    'unreferenced-qualitative', 'extra-qualitative']) {
    attack(mode, 'fail');
  }
  for (const mode of ['unsafe', 'unauthenticated', 'readable-controller',
    'readable-recovery', 'readable-evidence', 'readable-sibling', 'writable-view',
    'unavailable-null-child']) {
    attack(mode, 'unverified');
  }
  for (const mode of ['unsafe', 'unavailable-null-child']) {
    const attacked = attackResults.get(mode);
    const hostController = path.join(attacked.attackRoot, 'hosts', 'codex', 'controller');
    const statePath = path.join(hostController, 'audit-state.json');
    assert.equal(fs.existsSync(statePath), true,
      `${mode} must retain controller-observed launch state for regrade`);
    const originalState = fs.readFileSync(statePath);
    const state = JSON.parse(originalState);
    assert.equal(state.launches.length, 1);
    assert.deepEqual(attacked.result.invocations[0].containment,
      state.launches[0].containment);
    assert.equal(forward.gradeScenario('audit', attacked.attackRoot, runtime).outcome,
      'unverified');
    const rawPath = path.join(hostController, 'blobs',
      `${attacked.result.invocations[0].stdoutSha256}.blob`);
    const originalRaw = fs.readFileSync(rawPath);
    fs.appendFileSync(rawPath, 'tampered');
    assert.equal(forward.gradeScenario('audit', attacked.attackRoot, runtime).outcome, 'fail');
    fs.writeFileSync(rawPath, originalRaw);
    assert.equal(forward.gradeScenario('audit', attacked.attackRoot, runtime).outcome,
      'unverified');
    state.launches[0].identity.post[0].sha256 = '0'.repeat(64);
    writeJson(statePath, state);
    assert.equal(forward.gradeScenario('audit', attacked.attackRoot, runtime).outcome, 'fail');
    fs.writeFileSync(statePath, originalState);
    assert.equal(forward.gradeScenario('audit', attacked.attackRoot, runtime).outcome,
      'unverified');
    const attemptsFile = path.join(hostController, 'launch-attempts.json');
    const originalAttempts = fs.readFileSync(attemptsFile);
    const changedAttempts = JSON.parse(originalAttempts);
    changedAttempts[0].containment.observedProcesses[0].startToken += '-tampered';
    writeJson(attemptsFile, changedAttempts);
    assert.equal(forward.gradeScenario('audit', attacked.attackRoot, runtime).outcome,
      'fail', `${mode} regrade must reject changed trusted containment evidence`);
    fs.writeFileSync(attemptsFile, originalAttempts);
  }
  const malformedStarted = attackResults.get('malformed-preflight');
  const attemptsPath = path.join(malformedStarted.attackRoot, 'hosts', 'codex', 'controller',
    'launch-attempts.json');
  assert.equal(fs.existsSync(attemptsPath), true,
    'a started malformed preflight must retain a private launch attempt');
  const attempts = readJson(attemptsPath);
  assert.equal(attempts.length, 1);
  assert.equal(sha256(fs.readFileSync(path.join(malformedStarted.attackRoot, 'hosts', 'codex',
    'controller', 'blobs', `${attempts[0].stdoutSha256}.blob`))),
  attempts[0].stdoutSha256);
  const malformedPublic = path.join(malformedStarted.attackRoot, 'hosts', 'codex', 'result.json');
  const malformedPrivate = path.join(malformedStarted.attackRoot, 'hosts', 'codex', 'controller',
    'result.json');
  const malformedReceipt = path.join(malformedStarted.attackRoot, 'hosts', 'codex', 'controller',
    'result-receipt.json');
  const originalMalformedPublic = fs.readFileSync(malformedPublic);
  const originalMalformedPrivate = fs.readFileSync(malformedPrivate);
  const originalMalformedReceipt = fs.readFileSync(malformedReceipt);
  const forgedUnverified = JSON.parse(originalMalformedPublic);
  forgedUnverified.outcome = 'unverified';
  forgedUnverified.protocolOutcome = 'unverified';
  forgedUnverified.taskOutcome = 'not-executed';
  writeJson(malformedPublic, forgedUnverified);
  writeJson(malformedPrivate, forgedUnverified);
  writeJson(malformedReceipt, { schemaVersion: 2, host: 'codex',
    runId: forgedUnverified.runId, resultSha256: sha256(fs.readFileSync(malformedPublic)) });
  assert.equal(forward.gradeScenario('audit', malformedStarted.attackRoot, runtime).outcome,
    'fail', 'a started failed launch cannot be rewritten as unverified');
  fs.writeFileSync(malformedPublic, originalMalformedPublic);
  fs.writeFileSync(malformedPrivate, originalMalformedPrivate);
  fs.writeFileSync(malformedReceipt, originalMalformedReceipt);
  attack('surviving-descendant', 'fail');
  const behaviorSurvivorRoot = fs.mkdtempSync(path.join(os.tmpdir(),
    'instruction-audit-behavior-survivor-'));
  t.after(() => fs.rmSync(behaviorSurvivorRoot, { recursive: true, force: true }));
  forward.prepareFixture('audit', behaviorSurvivorRoot, runtime);
  const behaviorSurvivorLauncher = writeTrustedAdapterFixture(t, 'codex',
    'behavior-surviving-descendant');
  const survivorPath = path.join(path.dirname(behaviorSurvivorLauncher), 'survivor.pid');
  let behaviorSurvivor;
  try {
    behaviorSurvivor = forward.executeHost('audit', behaviorSurvivorRoot, {
      host: 'codex', launcherPath: behaviorSurvivorLauncher,
    }, runtime);
    assert.equal(behaviorSurvivor.outcome, 'fail');
    assert.equal(behaviorSurvivor.reason, 'adapter-behavior-failed');
    const survivorPid = Number(fs.readFileSync(survivorPath, 'utf8'));
    assert.throws(() => process.kill(survivorPid, 0), { code: 'ESRCH' },
      'the trusted adapter must stop a live behavioral descendant before returning');
  } finally {
    if (fs.existsSync(survivorPath)) {
      stopTestProcess(Number(fs.readFileSync(survivorPath, 'utf8')));
    }
  }
  const omittedDescendantRoot = fs.mkdtempSync(path.join(os.tmpdir(),
    'instruction-audit-omitted-descendant-'));
  t.after(() => fs.rmSync(omittedDescendantRoot, { recursive: true, force: true }));
  forward.prepareFixture('audit', omittedDescendantRoot, runtime);
  const omittedDescendantLauncher = writeTrustedAdapterFixture(t, 'codex',
    'omitted-detached-descendant');
  const omittedSurvivorPath = path.join(path.dirname(omittedDescendantLauncher), 'survivor.pid');
  try {
    const omittedDescendant = forward.executeHost('audit', omittedDescendantRoot, {
      host: 'codex', launcherPath: omittedDescendantLauncher,
    }, runtime);
    assert.equal(omittedDescendant.outcome, 'fail',
      'an adapter must independently reject a detached descendant omitted by child output');
    assert.equal(omittedDescendant.reason, 'adapter-behavior-failed',
      'the omitted descendant must be rejected during the behavioral launch');
    const omittedPid = Number(fs.readFileSync(omittedSurvivorPath, 'utf8'));
    const attempts = readJson(path.join(omittedDescendantRoot, 'hosts', 'codex', 'controller',
      'launch-attempts.json'));
    const planAttempt = attempts.find((entry) => entry.profile === 'plan');
    assert.ok(planAttempt.containment.observedProcesses.some((entry) =>
      entry.pid === omittedPid),
      'the trusted runtime must independently enumerate the child process tree');
    assert.throws(() => process.kill(omittedPid, 0), { code: 'ESRCH' },
      'the trusted runtime must contain every independently observed descendant');
  } finally {
    if (fs.existsSync(omittedSurvivorPath)) {
      stopTestProcess(Number(fs.readFileSync(omittedSurvivorPath, 'utf8')));
    }
  }
  const escapedProcessRoot = fs.mkdtempSync(path.join(os.tmpdir(),
    'instruction-audit-process-escape-'));
  t.after(() => fs.rmSync(escapedProcessRoot, { recursive: true, force: true }));
  const escapedProcessRuntime = { ...runtime,
    launchSynthetic(...args) {
      const launch = runtime.launchSynthetic(...args);
      return { ...launch, containment: { ...launch.containment, treeStopped: false } };
    } };
  forward.prepareFixture('audit', escapedProcessRoot, escapedProcessRuntime);
  const escapedProcessLauncher = writeTrustedAdapterFixture(t, 'codex');
  const escapedProcess = forward.executeHost('audit', escapedProcessRoot, {
    host: 'codex', launcherPath: escapedProcessLauncher,
  }, escapedProcessRuntime);
  assert.equal(escapedProcess.outcome, 'fail');
  assert.equal(escapedProcess.reason, 'adapter-preflight-failed');
  assert.equal(fs.existsSync(path.join(path.dirname(escapedProcessLauncher), 'behavior.log')),
    false);
  const noContainmentRoot = fs.mkdtempSync(path.join(os.tmpdir(),
    'instruction-audit-no-containment-'));
  t.after(() => fs.rmSync(noContainmentRoot, { recursive: true, force: true }));
  forward.prepareFixture('audit', noContainmentRoot, runtime);
  const noContainmentLauncher = writeTrustedAdapterFixture(t, 'codex');
  const noContainmentRuntime = { gitExecutable: runtime.gitExecutable,
    spawnSync: runtime.spawnSync, renameSync: runtime.renameSync };
  const noContainment = forward.executeHost('audit', noContainmentRoot, {
    host: 'codex', launcherPath: noContainmentLauncher,
  }, noContainmentRuntime);
  assert.equal(noContainment.outcome, 'unverified');
  assert.equal(noContainment.reason, 'preflight-unavailable');
  assert.equal(fs.existsSync(path.join(path.dirname(noContainmentLauncher), 'behavior.log')),
    false, 'missing trusted containment support must fail closed before adapter launch');
  const leaking = attack('leak-failure', 'fail');
  assert.equal(fs.existsSync(path.join(leaking.attackRoot, 'hosts', 'codex',
    'result.json')), false, 'a tainted candidate result must never be published');
  const leakingPrivate = collectRelativeFiles(path.join(leaking.attackRoot, 'hosts', 'codex',
    'controller')).map((entry) => fs.readFileSync(path.join(leaking.attackRoot, 'hosts',
    'codex', 'controller', entry))).map((entry) => entry.toString('utf8')).join('\n');
  assert.match(leakingPrivate, /AUDIT%2DINSTRUCTION-SENTINEL/,
    'the schema-valid leaking envelope must reach private quarantine scanning');
  const privateCanaryLeak = attack('private-canary-leak', 'fail');
  assert.equal(fs.existsSync(path.join(privateCanaryLeak.attackRoot, 'hosts', 'codex',
    'result.json')), false, 'controller-private canaries must never enter a public failure');
  const qualitativeCanaryLeak = attack('secret-qualitative', 'fail');
  assert.equal(fs.existsSync(path.join(qualitativeCanaryLeak.attackRoot, 'hosts', 'codex',
    'result.json')), false, 'secret-bearing qualitative findings must be quarantined');

  const partialManifestRoot = fs.mkdtempSync(path.join(os.tmpdir(),
    'instruction-audit-partial-manifest-'));
  t.after(() => fs.rmSync(partialManifestRoot, { recursive: true, force: true }));
  let tamperedInventory = false;
  const partialManifestRuntime = {
    ...runtime,
    spawnSync(command, args, options) {
      const execution = childProcess.spawnSync(command, args, options);
      if (!tamperedInventory && Array.isArray(args) && args.some((entry) =>
        String(entry).endsWith('inventory.mjs')) && execution.status === 0) {
        tamperedInventory = true;
        const manifest = JSON.parse(Buffer.from(execution.stdout).toString('utf8'));
        manifest.sources.pop();
        return { ...execution, stdout: Buffer.from(JSON.stringify(manifest)) };
      }
      return execution;
    },
  };
  forward.prepareFixture('audit', partialManifestRoot, partialManifestRuntime);
  const partialManifestResult = forward.executeHost('audit', partialManifestRoot, {
    host: 'codex', launcherPath: writeTrustedAdapterFixture(t, 'codex'),
  }, partialManifestRuntime);
  assert.equal(partialManifestResult.outcome, 'fail');
  assert.equal(partialManifestResult.reason, 'adapter-behavior-failed');

  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-audit-missing-'));
  t.after(() => fs.rmSync(missingRoot, { recursive: true, force: true }));
  forward.prepareFixture('audit', missingRoot, runtime);
  const missing = forward.executeHost('audit', missingRoot, {
    host: 'codex',
    launcherPath: path.join(missingRoot, '..', 'missing-launcher.json'),
  });
  assert.equal(missing.outcome, 'unverified');
  assert.equal(fs.existsSync(path.join(missingRoot, 'hosts', 'codex', 'evidence')), false);
  assert.equal(forward.gradeScenario('audit', missingRoot, runtime).outcome, 'unverified',
    'a prelaunch-unavailable result must remain unverified when regraded');

  const isolationAttack = attack('mutate', 'fail');
  assert.deepEqual(forward.snapshotTargets(
    path.join(isolationAttack.attackRoot, 'hosts', 'claude', 'subject')),
  forward.snapshotTargets(claudeSubject),
  'the second host must retain its independently prepared subject');
  const cliOutcomeRoot = fs.mkdtempSync(path.join(os.tmpdir(),
    'instruction-audit-cli-outcomes-'));
  t.after(() => fs.rmSync(cliOutcomeRoot, { recursive: true, force: true }));
  forward.prepareFixture('audit', cliOutcomeRoot, runtime);
  const cliOutput = [];
  const cliIo = {
    stdout: { write: (message) => cliOutput.push(message) },
    stderr: { write: (message) => assert.fail(message) },
  };
  assert.equal(forward.runCli(['execute', 'audit', cliOutcomeRoot, '--host', 'codex',
    '--launcher', writeTrustedAdapterFixture(t, 'codex', 'unsafe')], cliIo, runtime), 1);
  assert.equal(JSON.parse(cliOutput.pop()).outcome, 'unverified');
  assert.equal(forward.runCli(['recover', 'audit', cliOutcomeRoot, '--host', 'codex'],
    cliIo, runtime), 1);
  assert.equal(JSON.parse(cliOutput.pop()).outcome, 'unverified');
  assert.equal(forward.runCli(['grade', 'audit', cliOutcomeRoot], cliIo, runtime), 1);
  assert.equal(JSON.parse(cliOutput.pop()).outcome, 'unverified');
  const blockedPublicPath = path.join(cliOutcomeRoot, 'hosts', 'codex', 'result.json');
  const blockedPrivatePath = path.join(cliOutcomeRoot, 'hosts', 'codex', 'controller',
    'result.json');
  const blockedReceiptPath = path.join(cliOutcomeRoot, 'hosts', 'codex', 'controller',
    'result-receipt.json');
  const blockedResult = readJson(blockedPublicPath);
  blockedResult.outcome = 'blocked';
  blockedResult.protocolOutcome = 'blocked';
  blockedResult.taskOutcome = 'not-completed';
  writeJson(blockedPublicPath, blockedResult);
  writeJson(blockedPrivatePath, blockedResult);
  writeJson(blockedReceiptPath, { schemaVersion: 2, host: 'codex',
    runId: blockedResult.runId, resultSha256: sha256(fs.readFileSync(blockedPublicPath)) });
  assert.equal(forward.runCli(['grade', 'audit', cliOutcomeRoot], cliIo, runtime), 1);
  assert.equal(JSON.parse(cliOutput.pop()).outcome, 'fail',
    'Task 1 must reject a blocked result that no controller path produced');
  const originalGradeControllerRun = controller.gradeControllerRun;
  try {
    controller.gradeControllerRun = () => ({ schemaVersion: 2, scenarioId: 'audit',
      outcome: 'blocked' });
    assert.equal(forward.runCli(['grade', 'audit', cliOutcomeRoot], cliIo, runtime), 1);
    assert.equal(JSON.parse(cliOutput.pop()).outcome, 'blocked',
      'CLI mapping must still fail a future controller-authentic blocked outcome');
  } finally {
    controller.gradeControllerRun = originalGradeControllerRun;
  }
  const cliFailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-audit-cli-fail-'));
  t.after(() => fs.rmSync(cliFailRoot, { recursive: true, force: true }));
  forward.prepareFixture('audit', cliFailRoot, runtime);
  assert.equal(forward.runCli(['execute', 'audit', cliFailRoot, '--host', 'codex',
    '--launcher', writeTrustedAdapterFixture(t, 'codex', 'wrong-host')], cliIo, runtime), 1);
  assert.equal(JSON.parse(cliOutput.pop()).outcome, 'fail');
  const cliPassStatus = forward.runCli(['grade', 'audit', runRoot], cliIo, runtime);
  const cliPassResult = JSON.parse(cliOutput.pop());
  assert.equal(cliPassStatus, 0, JSON.stringify(cliPassResult));
  assert.equal(cliPassResult.outcome, 'pass');
  const duplicateErrors = [];
  assert.equal(forward.runCli(['execute', 'audit', missingRoot, '--host', 'codex',
    '--launcher', path.join(missingRoot, '..', 'missing-launcher.json')], {
    stdout: { write() {} },
    stderr: { write: (message) => duplicateErrors.push(message) },
  }), 1, 'duplicate execution is an operational failure');
  assert.deepEqual(duplicateErrors, ['Forward evaluation failed.\n']);
  assert.equal(forward.runCli(['execute', 'audit'], {
    stdout: { write: () => assert.fail('invalid usage must not emit JSON') },
    stderr: { write() {} },
  }), 2);

  const evidencePath = (host, relative) => path.join(runRoot, 'hosts', host, 'evidence', relative);
  const expectGradeFailure = (mutate, restore) => {
    mutate();
    assert.equal(forward.gradeScenario('audit', runRoot, runtime).outcome, 'fail');
    restore();
    assert.equal(forward.gradeScenario('audit', runRoot, runtime).outcome, 'pass');
  };
  const codexEventsPath = evidencePath('codex', 'events.json');
  const originalEvents = fs.readFileSync(codexEventsPath);
  expectGradeFailure(() => {
    const events = JSON.parse(originalEvents);
    events[1].previousEventSha256 = '0'.repeat(64);
    writeJson(codexEventsPath, events);
  }, () => fs.writeFileSync(codexEventsPath, originalEvents));
  expectGradeFailure(() => {
    const events = JSON.parse(originalEvents);
    events.splice(4, 0, structuredClone(events[3]));
    writeJson(codexEventsPath, events);
  }, () => fs.writeFileSync(codexEventsPath, originalEvents));
  expectGradeFailure(() => {
    const events = JSON.parse(originalEvents);
    [events[3], events[4]] = [events[4], events[3]];
    writeJson(codexEventsPath, events);
  }, () => fs.writeFileSync(codexEventsPath, originalEvents));
  const receiptPath = evidencePath('codex', 'inventory-2-receipt.json');
  const originalReceipt = fs.readFileSync(receiptPath);
  expectGradeFailure(() => fs.rmSync(receiptPath),
    () => fs.writeFileSync(receiptPath, originalReceipt));
  const codexResult = readJson(path.join(runRoot, 'hosts', 'codex', 'result.json'));
  const rawBlobPath = path.join(runRoot, 'hosts', 'codex', 'controller', 'blobs',
    `${codexResult.invocations[1].stdoutSha256}.blob`);
  const originalRawBlob = fs.readFileSync(rawBlobPath);
  expectGradeFailure(() => fs.appendFileSync(rawBlobPath, 'tampered'),
    () => fs.writeFileSync(rawBlobPath, originalRawBlob));
  const auditStatePath = path.join(runRoot, 'hosts', 'codex', 'controller',
    'audit-state.json');
  const originalAuditState = fs.readFileSync(auditStatePath);
  expectGradeFailure(() => {
    const auditState = JSON.parse(originalAuditState);
    auditState.launches[1].identity.post[0].sha256 = '0'.repeat(64);
    writeJson(auditStatePath, auditState);
  }, () => fs.writeFileSync(auditStatePath, originalAuditState));
  const extraPath = evidencePath('codex', 'unexpected.json');
  expectGradeFailure(() => writeJson(extraPath, { unexpected: true }),
    () => fs.rmSync(extraPath));
  const rogueHost = path.join(runRoot, 'hosts', 'rogue');
  expectGradeFailure(() => {
    fs.mkdirSync(rogueHost);
    fs.writeFileSync(path.join(rogueHost, 'result.json'), 'CONTROLLER-PRIVATE-CANARY\n');
  }, () => fs.rmSync(rogueHost, { recursive: true, force: true }));
  const codexHost = path.join(runRoot, 'hosts', 'codex');
  const codexHostBackup = path.join(runRoot, 'controller', 'codex-host-backup');
  expectGradeFailure(() => {
    fs.renameSync(codexHost, codexHostBackup);
    fs.symlinkSync(codexHostBackup, codexHost,
      process.platform === 'win32' ? 'junction' : 'dir');
  }, () => {
    fs.rmSync(codexHost);
    fs.renameSync(codexHostBackup, codexHost);
  });
  const resultsDirectory = path.join(runRoot, 'results');
  const resultsBackup = path.join(runRoot, 'controller', 'results-backup');
  expectGradeFailure(() => {
    fs.renameSync(resultsDirectory, resultsBackup);
    fs.symlinkSync(resultsBackup, resultsDirectory,
      process.platform === 'win32' ? 'junction' : 'dir');
  }, () => {
    fs.rmSync(resultsDirectory);
    fs.renameSync(resultsBackup, resultsDirectory);
  });
  expectGradeFailure(() => fs.writeFileSync(codexEventsPath,
    fs.readFileSync(evidencePath('claude', 'events.json'))),
  () => fs.writeFileSync(codexEventsPath, originalEvents));
  const schemaPath = path.join(runRoot, 'protocol', 'protocol-v2.schema.json');
  const originalSchema = fs.readFileSync(schemaPath);
  expectGradeFailure(() => fs.appendFileSync(schemaPath, ' '),
    () => fs.writeFileSync(schemaPath, originalSchema));
  const reportPath = evidencePath('codex', 'report.md');
  const originalReport = fs.readFileSync(reportPath);
  expectGradeFailure(() => fs.appendFileSync(reportPath,
    '\nAUDIT%2DINSTRUCTION-SENTINEL\n'),
  () => fs.writeFileSync(reportPath, originalReport));
  const aliasPath = evidencePath('codex', 'report.md');
  expectGradeFailure(() => {
    fs.rmSync(aliasPath);
    fs.linkSync(evidencePath('claude', 'report.md'), aliasPath);
  }, () => {
    fs.rmSync(aliasPath);
    fs.writeFileSync(aliasPath, originalReport);
  });
});

test('apply fixture keeps synthetic legacy evidence non-authoritative', (t) => {
  const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-forward-cli-apply-'));
  t.after(() => fs.rmSync(cliRoot, { recursive: true, force: true }));
  let cliOutput = '';
  assert.equal(forward.runCli(['prepare', 'apply', cliRoot], {
    stdout: { write: (value) => { cliOutput += value; } },
    stderr: { write: () => assert.fail('legacy prepare must not emit an error') },
  }), 0);
  assert.equal(readJson(path.join(cliRoot, 'evaluator', 'expected.json')).scenarioId, 'apply');
  assert.equal(JSON.parse(cliOutput).path, path.join(cliRoot, 'subject'));
  let usage = '';
  assert.equal(forward.runCli(['capture', 'apply'], {
    stdout: { write: () => assert.fail('invalid capture must not emit JSON') },
    stderr: { write: (value) => { usage += value; } },
  }), 2);
  assert.match(usage, /prepare\|execute\|recover\|capture\|grade/);

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

  const syntheticApply = forward.gradeScenario('apply', runRoot);
  assert.equal(syntheticApply.outcome, 'pass');
  assert.equal(syntheticApply.authoritative, false);
  assert.equal(syntheticApply.realHostClaim, false);
  assert.equal(syntheticApply.realHostOutcome, 'unverified');

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

test('partial fixture keeps synthetic legacy evidence non-authoritative', (t) => {
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

  const syntheticPartial = forward.gradeScenario('partial', runRoot);
  assert.equal(syntheticPartial.outcome, 'pass');
  assert.equal(syntheticPartial.authoritative, false);
  assert.equal(syntheticPartial.realHostClaim, false);
  assert.equal(syntheticPartial.realHostOutcome, 'unverified');

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
