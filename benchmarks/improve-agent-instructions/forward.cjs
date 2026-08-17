'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SCENARIOS = new Set(['audit', 'apply', 'partial']);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const RECOVERY_LEAF_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/;
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
  'Target matrix',
  'Effective chain',
  'Decision ledger',
  'Changes and recovery',
  'Verification matrix',
  'Pending questions',
];
const PNPM_SHIM = Buffer.from("'use strict';\nprocess.stdout.write('10.0.0\\n');\n");

const APPLY_AGENTS_BEFORE = Buffer.concat([UTF8_BOM, Buffer.from(
  '# Project\r\n\r\nUse npm from the repository root.\r\nKeep dirty dependency guidance.\r\n')]);
const APPLY_AGENTS_AFTER = Buffer.concat([UTF8_BOM, Buffer.from(
  '# Project\r\n\r\nUse pnpm from the repository root.\r\nKeep dirty dependency guidance.\r\n')]);
const APPLY_AGENTS_COMMITTED = Buffer.concat([UTF8_BOM, Buffer.from(
  '# Project\r\n\r\nUse npm from the repository root.\r\nKeep tracked dependency guidance.\r\n')]);
const APPLY_CLAUDE_BEFORE = Buffer.from(
  '# Shared rules\n\nUse npm from the repository root.\n\nClaude-only: use /context.\n');
const APPLY_CLAUDE_AFTER = Buffer.from('@AGENTS.md\n\nClaude-only: use /context.\n');
const PARTIAL_CODEX_BEFORE = Buffer.from('# Codex global\n\nKeep the original host delta.\n');
const PARTIAL_CODEX_AFTER = Buffer.from(
  '# Codex global\n\nKeep commands read-only unless writes are authorized.\n');
const PARTIAL_CLAUDE_BEFORE = Buffer.from('# Claude global\n\nKeep the original host delta.\n');
const PARTIAL_MARKER = Buffer.from('\n<!-- evaluator-concurrent-marker -->\n');
const PARTIAL_PROJECT_AGENTS = Buffer.from(
  '# Shared project\n\nUse npm until the migration is verified.\n');
const PARTIAL_PROJECT_CLAUDE = Buffer.from(
  '# Claude project\n\nKeep the project-only delta.\n');
const PARTIAL_NESTED = Buffer.from(
  '# Nested scope\n\nChoose either fast checks or exhaustive checks.\n');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function ambientEntry(name) {
  return Object.entries(process.env).find(([key]) => key.toLowerCase() === name.toLowerCase());
}

function sanitizedEnvironment(root, overrides = {}) {
  const environment = {};
  for (const name of ['PATH', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR']) {
    const entry = ambientEntry(name);
    if (entry && entry[1]) environment[entry[0]] = entry[1];
  }
  Object.assign(environment, {
    HOME: inside(root, 'evaluator', 'runtime', 'home'),
    USERPROFILE: inside(root, 'evaluator', 'runtime', 'home'),
    XDG_CONFIG_HOME: inside(root, 'evaluator', 'runtime', 'xdg', 'config'),
    XDG_STATE_HOME: inside(root, 'evaluator', 'runtime', 'xdg', 'state'),
    XDG_CACHE_HOME: inside(root, 'evaluator', 'runtime', 'xdg', 'cache'),
    APPDATA: inside(root, 'evaluator', 'runtime', 'appdata', 'roaming'),
    LOCALAPPDATA: inside(root, 'evaluator', 'runtime', 'appdata', 'local'),
    GIT_CONFIG_GLOBAL: inside(root, 'evaluator', 'runtime', 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_OPTIONAL_LOCKS: '0',
    NO_COLOR: '1',
  }, overrides);
  return environment;
}

function gitArguments(root, args) {
  return [
    '-c', `core.hooksPath=${inside(root, 'evaluator', 'empty-hooks')}`,
    '-c', 'core.fsmonitor=false',
    '-c', 'commit.gpgSign=false',
    '-c', `core.attributesFile=${inside(root, 'evaluator', 'empty-gitattributes')}`,
    ...args,
  ];
}

function portable(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`));
}

function resolvePhysicalRoot(runRoot, create) {
  if (typeof runRoot !== 'string' || runRoot.length === 0) {
    throw new Error('A disposable run root is required.');
  }
  const absolute = path.resolve(runRoot);
  if (create) fs.mkdirSync(absolute, { recursive: true });
  const physical = fs.realpathSync.native(absolute);
  if (!fs.statSync(physical).isDirectory()) throw new Error('Run root must be a directory.');
  return physical;
}

function inside(root, ...segments) {
  const candidate = path.resolve(root, ...segments);
  if (!isInside(root, candidate)) throw new Error('Path escapes the disposable run root.');

  let existing = candidate;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('Cannot resolve a safe fixture path.');
    existing = parent;
  }
  const physicalExisting = fs.realpathSync.native(existing);
  const physicalCandidate = path.resolve(physicalExisting, path.relative(existing, candidate));
  if (!isInside(root, physicalCandidate)) {
    throw new Error('Physical path escapes the disposable run root.');
  }
  if (fs.existsSync(candidate)) {
    const physical = fs.realpathSync.native(candidate);
    if (!isInside(root, physical)) throw new Error('Physical path escapes the disposable run root.');
  }
  return candidate;
}

function assertNoLinks(root, entryPath) {
  const relative = path.relative(root, entryPath);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = inside(root, current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Fixture paths may not use symbolic links.');
    }
  }
}

function writeFile(root, relativePath, contents) {
  const filePath = inside(root, relativePath);
  assertNoLinks(root, path.dirname(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  assertNoLinks(root, path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function writeJson(root, relativePath, value) {
  return writeFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readFile(root, relativePath) {
  const filePath = inside(root, relativePath);
  assertNoLinks(root, filePath);
  return fs.readFileSync(filePath);
}

function readJson(root, relativePath) {
  return JSON.parse(readFile(root, relativePath).toString('utf8'));
}

function walkFiles(root, directory, visit) {
  const resolved = inside(root, directory);
  if (!fs.existsSync(resolved)) return;
  assertNoLinks(root, resolved);
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const entryPath = inside(root, resolved, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Fixture paths may not use symbolic links.');
    if (entry.isDirectory() && entry.name !== '.git') walkFiles(root, entryPath, visit);
    else if (entry.isFile()) visit(entryPath);
  }
}

function snapshotTargets(subjectRoot) {
  const subject = resolvePhysicalRoot(subjectRoot, false);
  const entries = {};
  const roots = [
    inside(subject, 'home', '.codex', 'AGENTS.override.md'),
    inside(subject, 'home', '.codex', 'AGENTS.md'),
    inside(subject, 'repo'),
    inside(subject, 'home', '.skillquiver', 'backups'),
  ];
  const record = (filePath) => {
    const bytes = fs.readFileSync(filePath);
    entries[portable(path.relative(subject, filePath))] = {
      sha256: sha256(bytes),
      size: bytes.length,
    };
  };
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    assertNoLinks(subject, root);
    if (fs.statSync(root).isDirectory()) walkFiles(subject, root, record);
    else record(root);
  }
  const claudeRoot = inside(subject, 'home', '.claude');
  walkFiles(subject, claudeRoot, (filePath) => {
    if (path.extname(filePath) === '.md') record(filePath);
  });
  return entries;
}

function inventoryCommand(scenarioId, subject, ordinal) {
  const project = inside(subject, 'repo');
  const cwd = scenarioId === 'audit' ? inside(subject, 'repo', 'packages', 'api') : project;
  const home = inside(subject, 'home');
  const codexHome = inside(subject, 'home', '.codex');
  const claudeHome = inside(subject, 'home', '.claude');
  const managed = inside(subject, 'managed', 'claude');
  const skillRoot = path.resolve(__dirname, '..', '..', 'skills',
    'improve-agent-instructions');
  const inventory = path.join(skillRoot, 'scripts', 'inventory.mjs');
  return {
    id: `inventory-${ordinal}`,
    ordinal,
    argv: ['node', inventory, '--host', 'both', '--cwd', cwd, '--project', project,
      '--home', home, '--codex-home', codexHome, '--claude-home', claudeHome,
      '--claude-managed-dir', managed],
    cwd,
    outputPath: `inventory-${ordinal}.stdout.json`,
  };
}

function allowedTargetEvidencePaths(scenarioId) {
  if (scenarioId === 'audit') return [
    'home/.codex/AGENTS.override.md',
    'home/.codex/AGENTS.md',
    'home/.claude/CLAUDE.md',
    'repo/AGENTS.md',
    'repo/TEAM.md',
    'repo/packages/TEAM.md',
    'repo/packages/api/AGENTS.md',
    'repo/CLAUDE.md',
    'repo/.claude/rules/source.md',
  ];
  if (scenarioId === 'apply') return [
    'home/.codex/AGENTS.md',
    'home/.claude/CLAUDE.md',
    'repo/AGENTS.md',
    'repo/CLAUDE.md',
    'repo/CLAUDE.local.md',
  ];
  return [
    'home/.codex/AGENTS.md',
    'home/.claude/CLAUDE.md',
    'repo/AGENTS.md',
    'repo/CLAUDE.md',
    'repo/packages/ambiguous/AGENTS.md',
  ];
}

function scenarioInventorySources(scenarioId) {
  if (scenarioId === 'audit') return [
    { path: 'home/.codex/AGENTS.md', host: 'codex', loadState: 'shadowed', chain: null },
    { path: 'home/.codex/AGENTS.override.md', host: 'codex', loadState: 'active',
      chain: 'sourceIds' },
    { path: 'repo/TEAM.md', host: 'codex', loadState: 'shadowed', chain: null },
    { path: 'repo/packages/TEAM.md', host: 'codex', loadState: 'active',
      chain: 'sourceIds' },
    { path: 'repo/packages/api/AGENTS.md', host: 'codex', loadState: 'truncated',
      chain: 'sourceIds' },
    { path: 'home/.claude/CLAUDE.md', host: 'claude', loadState: 'active',
      chain: 'sourceIds' },
    { path: 'repo/CLAUDE.md', host: 'claude', loadState: 'active', chain: 'sourceIds' },
    { path: 'repo/.claude/rules/source.md', host: 'claude', loadState: 'conditional',
      chain: 'conditionalSourceIds' },
  ];
  return [
    { path: 'home/.codex/AGENTS.md', host: 'codex', loadState: 'active',
      chain: 'sourceIds' },
    { path: 'repo/AGENTS.md', host: 'codex', loadState: 'active', chain: 'sourceIds' },
    { path: 'home/.claude/CLAUDE.md', host: 'claude', loadState: 'active',
      chain: 'sourceIds' },
    { path: 'repo/CLAUDE.md', host: 'claude', loadState: 'active', chain: 'sourceIds' },
  ];
}

function commonPrompt(scenarioId, subject, runId) {
  const project = inside(subject, 'repo');
  const cwd = scenarioId === 'audit' ? inside(subject, 'repo', 'packages', 'api') : project;
  const home = inside(subject, 'home');
  const codexHome = inside(subject, 'home', '.codex');
  const claudeHome = inside(subject, 'home', '.claude');
  const managed = inside(subject, 'managed', 'claude');
  const evidenceRoot = inside(subject, 'evidence');
  const skillRoot = path.resolve(__dirname, '..', '..', 'skills',
    'improve-agent-instructions');
  const environment = {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: inside(subject, 'xdg', 'config'),
    XDG_STATE_HOME: inside(subject, 'xdg', 'state'),
    XDG_CACHE_HOME: inside(subject, 'xdg', 'cache'),
    APPDATA: inside(subject, 'appdata', 'roaming'),
    LOCALAPPDATA: inside(subject, 'appdata', 'local'),
    GIT_CONFIG_GLOBAL: inside(subject, 'controls', 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const lines = [
    `Scenario: ${scenarioId}`,
    `Public run ID: ${runId}`,
    `Sandbox boundary: ${subject}`,
    `Project root: ${project}`,
    `Working directory: ${cwd}`,
    'Requested hosts: Codex and Claude Code.',
    'Requested scopes: global and project.',
    `Skill bundle (read-only): ${skillRoot}`,
    'Read-only access to that caller-named Skill bundle is allowed; every write must remain inside the sandbox.',
    `Worker evidence directory: ${evidenceRoot}`,
    'The evidence directory is neither a target nor a backup directory.',
    'Do not inspect any ambient user home, host installation, authentication file, controller-private directory, or logs directory.',
    'Use the following isolated environment exactly:',
    ...Object.entries(environment).map(([name, value]) => `${name}=${value}`),
    'Run these read-only inventory argv arrays in order before reporting:',
    `Inventory argv 1: ${JSON.stringify(inventoryCommand(scenarioId, subject, 1).argv)}`,
    `Inventory argv 2: ${JSON.stringify(inventoryCommand(scenarioId, subject, 2).argv)}`,
    'Write only the schema-v1 artifacts disclosed in controls/evidence-contract.json beneath the worker evidence directory.',
    'Store only sanitized path, hash, and status evidence; never copy private instruction bodies.',
  ];
  if (scenarioId === 'audit') {
    lines.push('Audit both hosts and all fixture scopes. Do not write targets or create backups.');
  } else if (scenarioId === 'apply') {
    lines.push('After you verify package.json and execute the harmless pnpm shim, replace stale npm guidance with pnpm in the named global and project scopes.');
    lines.push('The transformation must preserve dirty guidance, make project AGENTS.md canonical, import it exactly once from Claude, and preserve the Claude-only delta and private local file.');
    lines.push('Record the changed first transformation and require an empty second transformation.');
  } else {
    lines.push('The request is to sharpen Codex global guidance and sharpen Claude global guidance, then canonicalize shared project guidance.');
    lines.push('The nested fast versus exhaustive choice is genuinely ambiguous and must remain blocked and untouched.');
    lines.push('Required order: inventory and full plan; complete recovery evidence; marker; prewrite hash recheck; independent writes; verifier failure; project-only rollback; verifier success.');
    lines.push(`Use the marker control at ${inside(subject, 'controls', 'append-concurrent.cjs')} and the verifier control at ${inside(subject, 'controls', 'verify-project.cjs')}.`);
  }
  return `${lines.join('\n')}\n`;
}

function publicEvidenceContract(scenarioId, subject, runId) {
  const machineReports = {};
  for (const scenarioId of SCENARIOS) {
    const report = reportContract(scenarioId);
    machineReports[scenarioId] = {
      semanticIds: {
        targetMatrix: report.targetMatrix.map((item) => item.id),
        effectiveChain: report.effectiveChain.map((item) => item.id),
        decisionLedger: report.decisionLedger.map((item) => item.id),
        transactions: report.changesAndRecovery.transactions.map((item) => item.id),
        verificationMatrix: report.verificationMatrix.map((item) => item.claim),
        pendingQuestions: report.pendingQuestions.map((item) => item.id),
      },
      requiredEntryFields: {
        targetMatrix: ['id', 'status'],
        effectiveChain: ['id', 'status'],
        decisionLedger: ['id', 'disposition', 'target', 'status'],
        transactions: ['id', 'status', 'targets'],
        verificationMatrix: ['claim', 'status'],
        pendingQuestions: ['id', 'status'],
      },
      entryFieldTypes: {
        targetMatrix: { id: 'string', status: 'string' },
        effectiveChain: { id: 'string', status: 'string' },
        decisionLedger: { id: 'string', disposition: 'string', target: 'string',
          status: 'string' },
        transactions: { id: 'string', status: 'string', targets: 'array[string]' },
        verificationMatrix: { claim: 'string', status: 'string' },
        pendingQuestions: { id: 'string', status: 'string' },
      },
    };
  }
  return {
    schemaVersion: 1,
    scenarioId,
    runId,
    evidenceRoot: 'subject/evidence',
    captureDescriptor: {
      path: 'capture.json',
      requiredFields: ['schemaVersion', 'scenarioId', 'host', 'runId', 'rawFinalPath',
        'inventoryPaths'],
      artifactPathBase: 'disposable-run-root',
      fieldTypes: {
        schemaVersion: 'integer', scenarioId: 'string', host: 'string', runId: 'string',
        rawFinalPath: 'run-root-relative-path under subject/evidence/<host>',
        inventoryPaths: 'array[run-root-relative-path under subject/evidence/<host>;2]',
      },
      hosts: ['codex', 'claude'],
      pathConvention: 'subject/evidence/<host>/capture.json',
    },
    workerArtifacts: {
      artifactSet: {
        allowedDirectories: ['checkpoints'],
        additionalFiles: false,
        aliasPolicy: 'distinct canonical path and nonzero device/inode identity',
      },
      rawFinal: {
        path: 'worker-final.md',
        encoding: 'utf8',
        identityFields: ['schemaVersion', 'scenarioId', 'host', 'runId'],
        requiredSections: HUMAN_REPORT_SECTIONS,
        sectionFormat: 'one fenced JSON value per section',
        ordering: 'identity header followed by the six sections in listed order',
      },
      inventory: {
        paths: ['inventory-1.stdout.json', 'inventory-2.stdout.json'],
        requiredFields: ['schemaVersion', 'scenarioId', 'host', 'runId', 'invocationId',
          'argv', 'cwd', 'exitCode', 'stdout', 'stdoutSha256'],
        fieldTypes: {
          schemaVersion: 'integer', scenarioId: 'string', host: 'string', runId: 'string',
          invocationId: 'string', argv: 'array[string]', cwd: 'absolute-path',
          exitCode: 'integer', stdout: 'string', stdoutSha256: 'sha256',
        },
        requiredManifestFields: ['schemaVersion', 'run', 'roots', 'sources', 'chains',
          'warnings'],
        manifestRunFields: ['generatedAt', 'host'],
        manifestRunFieldTypes: { generatedAt: 'iso-8601-utc', host: 'string' },
        rootFields: ['logicalPath', 'resolvedPath', 'exists'],
        rootFieldTypes: { logicalPath: 'absolute-path', resolvedPath: 'absolute-path',
          exists: 'boolean' },
        sourceFields: ['id', 'host', 'scope', 'origin', 'logicalPath', 'resolvedPath',
          'ownership', 'exists', 'loadState', 'loadPosition', 'byteCount',
          'byteContribution', 'sha256', 'encoding', 'lineEndings', 'gitState', 'import',
          'conditions', 'inactiveReason'],
        sourceFieldTypes: {
          id: 'string', host: 'string', scope: 'string', origin: 'string',
          logicalPath: 'absolute-path', resolvedPath: 'absolute-path', ownership: 'string',
          exists: 'boolean|null', loadState: 'string', loadPosition: 'integer|null',
          byteCount: 'integer|null', byteContribution: 'integer', sha256: 'sha256|null',
          encoding: 'string', lineEndings: 'string', gitState: 'string',
          import: 'object|null', approval: 'string|null', conditions: 'array[string]',
          inactiveReason: 'string|null',
        },
        importFields: ['parentSourceId', 'depth'],
        chainFields: {
          codex: ['sourceIds'],
          claude: ['sourceIds', 'conditionalSourceIds', 'maxImportDepth', 'excludes',
            'settingSources', 'coverage'],
        },
        settingSourceFields: ['state', 'sources'],
        chainFieldTypes: {
          sourceIds: 'array[source-id]', conditionalSourceIds: 'array[source-id]',
          maxImportDepth: 'integer[0..4]', excludes: 'array[absolute-path]',
          settingSources: 'object', coverage: 'string',
        },
        warningFields: ['code', 'host', 'logicalPath', 'field'],
        warningFieldTypes: { code: 'string', host: 'string', logicalPath: 'absolute-path',
          field: 'string|null' },
        scenarioSources: scenarioInventorySources(scenarioId),
        scenarioSourceFields: ['path', 'host', 'loadState', 'chain'],
        allowedValues: {
          host: ['both'],
          sourceHost: ['codex', 'claude'],
          sourceScope: ['global', 'project', 'managed'],
          sourceOrigin: ['codex-home', 'project-tree', 'managed-policy',
            'managed-settings', 'claude-home', 'user-settings', 'project-settings',
            'local-settings', 'rule', 'project-local', 'additional-directory', 'import'],
          sourceOwnership: ['user', 'project', 'managed', 'external'],
          sourceLoadState: ['active', 'shadowed', 'excluded', 'conditional',
            'approval-blocked', 'missing', 'empty', 'truncated', 'unreadable'],
          sourceEncoding: ['utf8', 'utf8-bom', 'utf16le', 'utf16be',
            'binary-or-unknown'],
          sourceLineEndings: ['none', 'lf', 'crlf', 'mixed', 'unknown'],
          sourceGitState: ['tracked-clean', 'modified', 'untracked', 'ignored',
            'outside-repository', 'unknown', 'not-applicable'],
          sourceApproval: ['unknown'],
          sourceInactiveReason: ['missing', 'unreadable', 'empty',
            'higher-precedence-source', 'claude-md-exclude',
            'external-import-approval-unknown', 'parent-conditional', 'path-conditional',
            'ambiguous-project-location', 'import-depth-exceeded',
            'project-byte-budget-exhausted', 'project-byte-budget'],
          settingState: ['explicit', 'unknown'],
          settingSources: ['user', 'project', 'local'],
          coverage: ['complete', 'partial'],
        },
        invocations: [inventoryCommand(scenarioId, subject, 1),
          inventoryCommand(scenarioId, subject, 2)],
        ordering: 'ordinal 1 then 2; distinct canonical output files',
      },
      machineReport: {
        path: 'machine-report.json',
        schemaVersion: 1,
        requiredFields: ['schemaVersion', 'scenarioId', 'host', 'runId', 'targetMatrix',
          'effectiveChain', 'decisionLedger', 'changesAndRecovery',
          'verificationMatrix', 'pendingQuestions'],
        scenarios: machineReports,
        fieldTypes: {
          schemaVersion: 'integer', scenarioId: 'string', host: 'string', runId: 'string',
          targetMatrix: 'array[object]', effectiveChain: 'array[object]',
          decisionLedger: 'array[object]', changesAndRecovery: 'object',
          verificationMatrix: 'array[object]', pendingQuestions: 'array[object]',
        },
        allowedValues: {
          status: ['verified', 'unverified', 'blocked'],
          disposition: ['keep', 'move', 'sharpen', 'disclose', 'remove',
            'enforce-elsewhere', 'blocked-decision'],
          transactionStatus: ['unchanged', 'applied', 'concurrent-change', 'rolled-back',
            'blocked'],
        },
        ordering: 'entries use the disclosed scenario semantic ID order',
        allowedTargetEvidencePaths: allowedTargetEvidencePaths(scenarioId),
        evidencePathConvention: 'listed target path or captured evidence/<host> artifact path',
        allowedEvidenceShapes: [
          { requiredFields: ['path', 'sha256'], additionalFields: false },
          { arrayItems: { requiredFields: ['path', 'sha256'], additionalFields: false } },
        ],
      },
      commandTrace: {
        path: 'command-trace.json',
        requiredFields: ['schemaVersion', 'scenarioId', 'host', 'runId', 'invocations',
          'checkpoints'],
        fieldTypes: {
          schemaVersion: 'integer', scenarioId: 'string', host: 'string', runId: 'string',
          invocations: 'array[invocation]', checkpoints: 'array[checkpoint-reference]',
          facts: 'array[fact]',
        },
        invocation: {
          requiredFields: ['schemaVersion', 'scenarioId', 'host', 'runId', 'id', 'ordinal',
            'predecessorId', 'kind', 'argv', 'cwd', 'exitCode', 'outputPath',
            'outputSha256'],
          allowedKinds: ['inventory', 'checkpoint'],
          ordering: 'strict ordinals with predecessorId naming the prior invocation',
          fieldTypes: {
            schemaVersion: 'integer', scenarioId: 'string', host: 'string', runId: 'string',
            id: 'string', ordinal: 'integer', predecessorId: 'string|null', kind: 'string',
            argv: 'array[string]', cwd: 'absolute-path', exitCode: 'integer',
            outputPath: 'host-evidence-relative-path', outputSha256: 'sha256',
          },
        },
        fact: {
          requiredFields: ['schemaVersion', 'scenarioId', 'host', 'runId', 'id', 'kind',
            'path', 'value', 'exitCode'],
          allowedKinds: ['file-json', 'controller-command'],
          fieldTypes: {
            schemaVersion: 'integer', scenarioId: 'string', host: 'string', runId: 'string',
            id: 'string', kind: 'string', path: 'subject-relative-path', value: 'scalar',
            exitCode: 'integer',
          },
        },
        factSets: {
          audit: [],
          apply: [
            { id: 'package-manager', kind: 'file-json', path: 'subject/repo/package.json' },
            { id: 'pnpm-version', kind: 'controller-command',
              path: 'subject/tools/pnpm.cjs' },
          ],
          partial: [],
        },
        checkpointEntryFields: ['id', 'ordinal', 'path', 'sha256'],
        checkpointEntryFieldTypes: { id: 'string', ordinal: 'integer',
          path: 'host-evidence-relative-path', sha256: 'sha256' },
      },
      checkpoints: CHECKPOINT_FILES,
      checkpointSchemas: {
        commonFields: ['schemaVersion', 'scenarioId', 'host', 'runId', 'id', 'ordinal',
          'predecessorSha256', 'targetSnapshot'],
        audit: { 'audit-complete': [] },
        apply: {
          'apply-01-recovery-complete': ['recovery', 'prewriteTargets'],
          'apply-02-pass-1': ['transformationStatus'],
          'apply-03-pass-2': ['transformationStatus'],
        },
        partial: {
          'partial-01-inventory-plan': ['planComplete'],
          'partial-02-recovery-complete': ['recovery'],
          'partial-03-marker': ['controlPath', 'controlSha256', 'exitCode'],
          'partial-04-prewrite-recheck': ['prewriteTargets'],
          'partial-05-independent-writes': ['independentWritesComplete'],
          'partial-06-verifier-failure': ['controlPath', 'controlSha256', 'exitCode',
            'stdout'],
          'partial-07-project-rollback': ['rolledBackTransaction'],
          'partial-08-verifier-success': ['controlPath', 'controlSha256', 'exitCode',
            'stdout'],
        },
        recoveryFields: ['leaf', 'manifestPath', 'manifestSha256', 'restorationPath',
          'restorationSha256', 'members'],
        recoveryMemberFields: ['targetPath', 'existed', 'preimagePath', 'preimageSha256',
          'originalSha256', 'permissions'],
        recoveryMemberVariants: {
          existing: {
            requiredFields: ['targetPath', 'existed', 'preimagePath', 'preimageSha256',
              'originalSha256', 'permissions'],
            constraints: { existed: true, preimagePath: 'relative-path',
              preimageSha256: 'sha256', originalSha256: 'sha256' },
          },
          absent: {
            requiredFields: ['targetPath', 'existed', 'preimagePath', 'preimageSha256',
              'originalSha256', 'permissions'],
            constraints: { existed: false, preimagePath: null, preimageSha256: null,
              originalSha256: null, permissions: 'unverified-null' },
          },
        },
        prewriteTargetFields: ['targetPath', 'existed', 'originalSha256', 'currentSha256',
          'permissions'],
        snapshotEntryFields: ['sha256', 'size'],
        snapshotEntryFieldTypes: { sha256: 'sha256', size: 'nonnegative-integer' },
        recoveryFieldTypes: {
          leaf: 'utc-leaf', manifestPath: 'relative-path', manifestSha256: 'sha256',
          restorationPath: 'relative-path', restorationSha256: 'sha256',
          members: 'array[recovery-member]',
        },
        recoveryMemberFieldTypes: {
          targetPath: 'subject-relative-path', existed: 'boolean',
          preimagePath: 'relative-path|null', preimageSha256: 'sha256|null',
          originalSha256: 'sha256|null', permissions: 'permission-object',
        },
        prewriteTargetFieldTypes: {
          targetPath: 'subject-relative-path', existed: 'boolean',
          originalSha256: 'sha256|null', currentSha256: 'sha256|null',
          permissions: 'permission-object',
        },
        fieldTypes: {
          schemaVersion: 'integer', scenarioId: 'string', host: 'string', runId: 'string',
          id: 'string', ordinal: 'integer', predecessorSha256: 'sha256|null',
          targetSnapshot: 'object[path=>{sha256,size}]', recovery: 'object',
          prewriteTargets: 'array[object]', transformationStatus: 'string',
          planComplete: 'boolean', controlPath: 'subject-relative-path',
          controlSha256: 'sha256', exitCode: 'integer', stdout: 'string',
          independentWritesComplete: 'boolean', rolledBackTransaction: 'string',
        },
        allowedValues: {
          transformationStatus: ['changed', 'no-change'],
          rolledBackTransaction: ['project-shared'],
          controlPath: ['subject/controls/append-concurrent.cjs',
            'subject/controls/verify-project.cjs'],
          stdout: ['status=fail\n', 'status=pass\n'],
        },
        ordering: 'listed checkpoint order with each predecessorSha256 binding prior bytes',
      },
    },
    recovery: {
      leafFormat: 'yyyyMMddTHHmmssSSSZ',
      manifest: {
        path: 'manifest.json',
        schemaVersion: 1,
        requiredFields: ['schemaVersion', 'scenarioId', 'host', 'runId', 'entries'],
        entryFields: ['targetPath', 'transaction', 'existed', 'preimagePath',
          'absent', 'sha256', 'encoding', 'bom', 'lineEndings', 'permissions'],
        entryFieldTypes: {
          targetPath: 'subject-relative-path', transaction: 'string', existed: 'boolean',
          preimagePath: 'recovery-leaf-relative-path|null', absent: 'boolean',
          sha256: 'sha256|null', encoding: 'string', bom: 'string', lineEndings: 'string',
          permissions: 'object',
        },
        entryVariants: {
          existing: { existed: true, absent: false, preimagePath: 'relative-path',
            sha256: 'sha256' },
          absent: { existed: false, absent: true, preimagePath: null, sha256: null },
        },
        permissionFields: ['mode', 'owner'],
        permissionPropertyFields: ['status', 'value'],
        permissionStatuses: ['verified', 'unverified'],
      },
      restoration: {
        path: 'restoration.json',
        schemaVersion: 1,
        requiredFields: ['schemaVersion', 'scenarioId', 'host', 'runId', 'transactions',
          'targets'],
        transactionEntryFields: ['id', 'status'],
        targetEntryFields: ['path', 'transaction', 'status'],
        transactionEntryFieldTypes: { id: 'string', status: 'string' },
        targetEntryFieldTypes: { path: 'subject-relative-path', transaction: 'string',
          status: 'string' },
        ordering: 'unique transaction IDs and unique target paths in declared order',
        allowedStatuses: ['unchanged', 'applied', 'concurrent-change', 'rolled-back',
          'blocked'],
      },
      pathConvention: 'subject/home/.skillquiver/backups/improve-agent-instructions/<UTC leaf>',
    },
  };
}

function baseFixture(root, scenarioId, runId) {
  const directories = [
    'subject/home/.codex', 'subject/home/.claude', 'subject/repo', 'subject/controls',
    'subject/xdg/config', 'subject/xdg/state', 'subject/xdg/cache',
    'subject/appdata/roaming', 'subject/appdata/local', 'subject/tools',
    'subject/managed/claude', 'subject/evidence',
    'evaluator/preimages', 'evaluator/tools', 'evaluator/empty-hooks',
    'evaluator/runtime/home', 'evaluator/runtime/xdg/config',
    'evaluator/runtime/xdg/state', 'evaluator/runtime/xdg/cache',
    'evaluator/runtime/appdata/roaming', 'evaluator/runtime/appdata/local', 'logs',
  ];
  for (const relative of directories) fs.mkdirSync(inside(root, relative), { recursive: true });
  writeFile(root, 'subject/controls/gitconfig', '[user]\n\tname = Fixture User\n');
  writeFile(root, 'subject/controls/empty-gitattributes', '');
  writeFile(root, 'evaluator/runtime/gitconfig', '');
  writeFile(root, 'evaluator/empty-gitattributes', '');
  writeFile(root, 'subject/tools/pnpm.cjs', PNPM_SHIM);
  writeFile(root, 'evaluator/tools/pnpm.cjs', PNPM_SHIM);
  const subject = inside(root, 'subject');
  writeJson(root, 'subject/controls/evidence-contract.json',
    publicEvidenceContract(scenarioId, subject, runId));
  writeFile(root, 'logs/prompt.md', commonPrompt(scenarioId, subject, runId));
}

function prepareAudit(root) {
  const fixtures = {
    'subject/home/.codex/AGENTS.override.md': 'AUDIT-INSTRUCTION-SENTINEL\nAUDIT-PRIVATE-SENTINEL\n',
    'subject/home/.codex/AGENTS.md': 'SHADOWED-GLOBAL-BASE\n',
    'subject/home/.codex/config.toml': 'project_doc_fallback_filenames = ["TEAM.md"]\nproject_doc_max_bytes = 128\n',
    'subject/home/.claude/CLAUDE.md': '@shared.md\nCLAUDE-PRIVATE-SENTINEL\n',
    'subject/home/.claude/shared.md': 'Shared user guidance.\n',
    'subject/repo/AGENTS.md': 'R'.repeat(80),
    'subject/repo/TEAM.md': 'SHADOWED-ROOT-FALLBACK\n',
    'subject/repo/packages/TEAM.md': 'N'.repeat(32),
    'subject/repo/packages/api/AGENTS.md': 'D'.repeat(64),
    'subject/repo/CLAUDE.md': '@project-shared.md\n',
    'subject/repo/project-shared.md': 'Shared project guidance.\n',
    'subject/repo/CLAUDE.local.md': 'PRIVATE-LOCAL-SENTINEL\n',
    'subject/repo/.claude/rules/source.md': '---\npaths: src/**/*.js\n---\nConditional guidance.\n',
  };
  for (const [relativePath, contents] of Object.entries(fixtures)) writeFile(root, relativePath, contents);
  for (const [relativePath, contents] of Object.entries(fixtures)) {
    writeFile(root, `evaluator/preimages/audit/${portable(relativePath.slice('subject/'.length))}`,
      contents);
  }
  const subject = inside(root, 'subject');
  const expectedStates = [
    { logicalPath: inside(subject, 'home', '.claude', 'CLAUDE.md'), host: 'claude',
      loadState: 'active' },
    { logicalPath: inside(subject, 'home', '.codex', 'AGENTS.md'), host: 'codex',
      loadState: 'shadowed' },
    { logicalPath: inside(subject, 'home', '.codex', 'AGENTS.override.md'), host: 'codex',
      loadState: 'active' },
    { logicalPath: inside(subject, 'repo', '.claude', 'rules', 'source.md'), host: 'claude',
      loadState: 'conditional' },
    { logicalPath: inside(subject, 'repo', 'CLAUDE.md'), host: 'claude',
      loadState: 'active' },
    { logicalPath: inside(subject, 'repo', 'TEAM.md'), host: 'codex',
      loadState: 'shadowed' },
    { logicalPath: inside(subject, 'repo', 'packages', 'TEAM.md'), host: 'codex',
      loadState: 'active' },
    { logicalPath: inside(subject, 'repo', 'packages', 'api', 'AGENTS.md'), host: 'codex',
      loadState: 'truncated' },
  ];
  return {
    sentinels: ['AUDIT-INSTRUCTION-SENTINEL', 'AUDIT-PRIVATE-SENTINEL',
      'CLAUDE-PRIVATE-SENTINEL', 'PRIVATE-LOCAL-SENTINEL'],
    expectedStates,
    initialSnapshot: snapshotTargets(inside(root, 'subject')),
  };
}

function prepareApply(root) {
  const files = {
    'subject/home/.codex/AGENTS.md': Buffer.from('# Codex global\n\nUse npm from PATH.\n'),
    'subject/home/.claude/CLAUDE.md': Buffer.from('# Claude global\n\nUse npm from PATH.\n'),
    'subject/repo/AGENTS.md': APPLY_AGENTS_COMMITTED,
    'subject/repo/CLAUDE.md': APPLY_CLAUDE_BEFORE,
    'subject/repo/CLAUDE.local.md': Buffer.from('PRIVATE-LOCAL-APPLY-SENTINEL\r\n'),
    'subject/repo/package.json': Buffer.from('{"packageManager":"pnpm@10.0.0"}\n'),
    'subject/repo/.gitignore': Buffer.from('CLAUDE.local.md\n'),
  };
  for (const [relativePath, contents] of Object.entries(files)) writeFile(root, relativePath, contents);
  writeFile(root, 'evaluator/preimages/apply/repo-AGENTS.md', APPLY_AGENTS_BEFORE);
  writeFile(root, 'evaluator/preimages/apply/repo-CLAUDE.md', APPLY_CLAUDE_BEFORE);
  writeFile(root, 'evaluator/preimages/apply/codex-AGENTS.md',
    files['subject/home/.codex/AGENTS.md']);
  writeFile(root, 'evaluator/preimages/apply/claude-CLAUDE.md',
    files['subject/home/.claude/CLAUDE.md']);
  writeFile(root, 'evaluator/preimages/apply/CLAUDE.local.md', files['subject/repo/CLAUDE.local.md']);
  return {
    sentinels: ['PRIVATE-LOCAL-APPLY-SENTINEL'],
    hashes: {
      codexGlobal: sha256('# Codex global\n\nUse pnpm from the verified executable path.\n'),
      claudeGlobal: sha256('# Claude global\n\nUse pnpm from the verified executable path.\n'),
      agentsAfter: sha256(APPLY_AGENTS_AFTER),
      claudeAfter: sha256(APPLY_CLAUDE_AFTER),
      privateLocal: sha256(files['subject/repo/CLAUDE.local.md']),
      agentsBefore: sha256(APPLY_AGENTS_BEFORE),
      claudeBefore: sha256(APPLY_CLAUDE_BEFORE),
      codexGlobalBefore: sha256(files['subject/home/.codex/AGENTS.md']),
      claudeGlobalBefore: sha256(files['subject/home/.claude/CLAUDE.md']),
    },
  };
}

function fixtureProcess(root, args) {
  const subject = inside(root, 'subject');
  const result = childProcess.spawnSync('git', gitArguments(root, args), {
    cwd: inside(subject, 'repo'),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: sanitizedEnvironment(root),
  });
  if (result.status !== 0) throw new Error('Isolated fixture Git command failed.');
  return result;
}

function initializeRepository(root, scenarioId) {
  fixtureProcess(root, ['init', '--quiet']);
  fixtureProcess(root, ['config', 'core.autocrlf', 'false']);
  fixtureProcess(root, ['add', '.']);
  fixtureProcess(root, ['-c', 'user.name=Fixture', '-c',
    'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
  if (scenarioId === 'apply') {
    writeFile(root, 'subject/repo/AGENTS.md', APPLY_AGENTS_BEFORE);
  }
}

function permissionEvidence(filePath) {
  const stat = fs.statSync(filePath);
  const meaningful = process.platform !== 'win32';
  return {
    mode: { status: meaningful ? 'verified' : 'unverified',
      value: meaningful ? stat.mode & 0o777 : null },
    owner: { status: meaningful && Number.isInteger(stat.uid) && Number.isInteger(stat.gid) ?
      'verified' : 'unverified', value: meaningful ? `${stat.uid}:${stat.gid}` : null },
  };
}

function recoveryTargetPaths(scenarioId) {
  if (scenarioId === 'apply') return [
    'home/.codex/AGENTS.md',
    'home/.claude/CLAUDE.md',
    'repo/AGENTS.md',
    'repo/CLAUDE.md',
  ];
  if (scenarioId === 'partial') return [
    'home/.codex/AGENTS.md',
    'home/.claude/CLAUDE.md',
    'repo/AGENTS.md',
    'repo/CLAUDE.md',
  ];
  return [];
}

function controllerState(root, scenarioId) {
  const subject = inside(root, 'subject');
  const targets = recoveryTargetPaths(scenarioId).map((targetPath) => {
    const absolute = inside(subject, ...targetPath.split('/'));
    return {
      targetPath,
      existed: true,
      sha256: sha256(fs.readFileSync(absolute)),
      permissions: permissionEvidence(absolute),
    };
  });
  const privateShim = inside(root, 'evaluator', 'tools', 'pnpm.cjs');
  const publicShim = inside(subject, 'tools', 'pnpm.cjs');
  let repository = null;
  if (scenarioId === 'apply') {
    const commands = [
      { id: 'tracked-path', args: ['ls-files', '--error-unmatch', '--', 'AGENTS.md'] },
      { id: 'dirty-status', args: ['status', '--porcelain=v1', '--', 'AGENTS.md'] },
      { id: 'committed-bytes', args: ['show', 'HEAD:AGENTS.md'] },
    ];
    const observations = commands.map(({ id, args }) => {
      const result = fixtureProcess(root, args);
      return { id, argv: gitArguments(root, args), status: result.status,
        stdout: result.stdout, stderr: result.stderr };
    });
    repository = {
      trackedPath: 'AGENTS.md',
      observations,
      tracked: observations[0].status === 0 && observations[0].stdout === 'AGENTS.md\n',
      dirtyStatus: observations[1].stdout,
      committedSha256: sha256(Buffer.from(observations[2].stdout, 'utf8')),
      workingSha256: hashAt(root, 'subject/repo/AGENTS.md'),
    };
  }
  return {
    targets,
    executable: {
      publicPath: 'subject/tools/pnpm.cjs',
      privatePath: 'evaluator/tools/pnpm.cjs',
      sha256: sha256(fs.readFileSync(privateShim)),
      publicSha256: sha256(fs.readFileSync(publicShim)),
    },
    repository,
  };
}

function privateBodyPaths(root, scenarioId) {
  const directory = inside(root, 'evaluator', 'preimages', scenarioId);
  const paths = [];
  walkFiles(root, directory, (filePath) => paths.push(portable(path.relative(root, filePath))));
  return paths;
}

function preparePartial(root) {
  const files = {
    'subject/home/.codex/AGENTS.md': PARTIAL_CODEX_BEFORE,
    'subject/home/.claude/CLAUDE.md': PARTIAL_CLAUDE_BEFORE,
    'subject/repo/AGENTS.md': PARTIAL_PROJECT_AGENTS,
    'subject/repo/CLAUDE.md': PARTIAL_PROJECT_CLAUDE,
    'subject/repo/packages/ambiguous/AGENTS.md': PARTIAL_NESTED,
  };
  for (const [relativePath, contents] of Object.entries(files)) writeFile(root, relativePath, contents);
  writeFile(root, 'evaluator/preimages/partial/codex-AGENTS.md', PARTIAL_CODEX_BEFORE);
  writeFile(root, 'evaluator/preimages/partial/claude-CLAUDE.md', PARTIAL_CLAUDE_BEFORE);
  writeFile(root, 'evaluator/preimages/partial/repo-AGENTS.md', PARTIAL_PROJECT_AGENTS);
  writeFile(root, 'evaluator/preimages/partial/repo-CLAUDE.md', PARTIAL_PROJECT_CLAUDE);
  writeFile(root, 'evaluator/preimages/partial/nested-AGENTS.md', PARTIAL_NESTED);

  const marker = PARTIAL_MARKER.toString('utf8');
  writeFile(root, 'subject/controls/append-concurrent.cjs', `'use strict';\n` +
    `const fs = require('node:fs');\nconst path = require('node:path');\n` +
    `const target = path.resolve(__dirname, '..', 'home', '.claude', 'CLAUDE.md');\n` +
    `const marker = ${JSON.stringify(marker)};\n` +
    `const current = fs.readFileSync(target, 'utf8');\n` +
    `if (!current.endsWith(marker)) fs.appendFileSync(target, marker);\n`);
  writeFile(root, 'subject/controls/verify-project.cjs', `'use strict';\n` +
    `const crypto = require('node:crypto');\nconst fs = require('node:fs');\n` +
    `const path = require('node:path');\nconst repo = path.resolve(__dirname, '..', 'repo');\n` +
    `const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');\n` +
    `const valid = hash(path.join(repo, 'AGENTS.md')) === '${sha256(PARTIAL_PROJECT_AGENTS)}' &&\n` +
    `  hash(path.join(repo, 'CLAUDE.md')) === '${sha256(PARTIAL_PROJECT_CLAUDE)}';\n` +
    `process.stdout.write(valid ? 'status=pass\\n' : 'status=fail\\n');\n` +
    `process.exitCode = valid ? 0 : 1;\n`);
  return {
    sentinels: [],
    initialSnapshot: snapshotTargets(inside(root, 'subject')),
    controlHashes: {
      marker: hashAt(root, 'subject/controls/append-concurrent.cjs'),
      verifier: hashAt(root, 'subject/controls/verify-project.cjs'),
    },
    hashes: {
      codexAfter: sha256(PARTIAL_CODEX_AFTER),
      claudeConcurrent: sha256(Buffer.concat([PARTIAL_CLAUDE_BEFORE, PARTIAL_MARKER])),
      projectAgents: sha256(PARTIAL_PROJECT_AGENTS),
      projectClaude: sha256(PARTIAL_PROJECT_CLAUDE),
      nested: sha256(PARTIAL_NESTED),
    },
  };
}

function prepareFixture(scenarioId, runRoot) {
  if (!SCENARIOS.has(scenarioId)) throw new Error('Unknown forward-evaluation scenario.');
  const root = resolvePhysicalRoot(runRoot, true);
  if (fs.readdirSync(root).length !== 0) throw new Error('Disposable run root must be empty.');
  const runId = crypto.randomUUID();
  baseFixture(root, scenarioId, runId);
  const scenario = scenarioId === 'audit' ? prepareAudit(root)
    : scenarioId === 'apply' ? prepareApply(root) : preparePartial(root);
  initializeRepository(root, scenarioId);
  writeJson(root, 'evaluator/expected.json', {
    schemaVersion: 1,
    scenarioId,
    runId,
    ...scenario,
    privateBodyPaths: privateBodyPaths(root, scenarioId),
    controller: controllerState(root, scenarioId),
  });
  const challenge = (receiptId, invocationId) => ({
    receiptId,
    invocationId,
    nonce: crypto.randomBytes(32).toString('hex'),
  });
  writeJson(root, 'evaluator/capture-challenges.json', {
    schemaVersion: 1,
    scenarioId,
    runId,
    requestSha256: hashAt(root, 'logs/prompt.md'),
    evidenceContractSha256: hashAt(root, 'subject/controls/evidence-contract.json'),
    hosts: [
      { host: 'codex', ...challenge(`${scenarioId}-host-codex`, `${scenarioId}-codex-1`) },
      { host: 'claude', ...challenge(`${scenarioId}-host-claude`, `${scenarioId}-claude-1`) },
    ],
    applyRuns: scenarioId === 'apply' ? ['codex', 'claude'].flatMap((host) => [
      { host, ordinal: 1, ...challenge(`apply-${host}-receipt-1`, `apply-${host}-run-1`) },
      { host, ordinal: 2, ...challenge(`apply-${host}-receipt-2`, `apply-${host}-run-2`) },
    ]) : [],
  });
  return { schemaVersion: 1, scenarioId, runId, status: 'prepared',
    subjectRoot: inside(root, 'subject') };
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    same(Object.keys(value).sort(), [...keys].sort());
}

function evidence(status, relativePath, value) {
  const result = { status };
  if (relativePath) result.path = portable(relativePath);
  if (value !== undefined) result.sha256 = sha256(Buffer.isBuffer(value) ? value :
    Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
  return result;
}

function check(id, status, relativePath, value) {
  return { id, status, evidence: evidence(status, relativePath, value) };
}

function checked(id, relativePath, operation, missingStatus = 'unverified') {
  try {
    const result = operation();
    return check(id, result.status || (result.pass ? 'pass' : 'fail'), relativePath, result.value);
  } catch (error) {
    const missing = error && error.code === 'ENOENT';
    return check(id, missing ? missingStatus : 'fail', relativePath);
  }
}

function normalizeManifest(manifest) {
  const normalized = JSON.parse(JSON.stringify(manifest));
  if (normalized.run) delete normalized.run.generatedAt;
  return canonicalize(normalized);
}

function parseJsonBytes(bytes, message) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(message);
  }
}

function captureInputPath(root, evidenceRoot, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Capture input paths are required.');
  }
  const candidate = inside(root, value);
  assertNoLinks(root, candidate);
  if (!isInside(evidenceRoot, candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error('Capture inputs must be files beneath the disposable evidence root.');
  }
  return candidate;
}

function nonnegativeIntegerOrNull(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function scalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function validateInventoryManifest(manifest, subject, scenarioId, contract) {
  const requiredTop = contract.workerArtifacts.inventory.requiredManifestFields;
  if (!exactKeys(manifest, requiredTop)) {
    throw new Error('Inventory stdout must use the complete schema version 1 structure.');
  }
  const roots = manifest.roots;
  const expectedCwd = scenarioId === 'audit' ? inside(subject, 'repo', 'packages', 'api') :
    inside(subject, 'repo');
  const expectedRoots = {
    home: inside(subject, 'home'),
    project: inside(subject, 'repo'),
    cwd: expectedCwd,
    codexHome: inside(subject, 'home', '.codex'),
    claudeHome: inside(subject, 'home', '.claude'),
    claudeManaged: inside(subject, 'managed', 'claude'),
  };
  const rootMatches = exactKeys(roots, Object.keys(expectedRoots)) &&
    Object.entries(expectedRoots).every(([id, expected]) =>
      exactKeys(roots[id], contract.workerArtifacts.inventory.rootFields) &&
      roots[id].logicalPath === expected && roots[id].resolvedPath === expected &&
      roots[id].exists === true);
  const generatedAt = new Date(manifest.run?.generatedAt);
  const runMatches = exactKeys(manifest.run,
    contract.workerArtifacts.inventory.manifestRunFields) && manifest.run.host === 'both' &&
    Number.isFinite(generatedAt.getTime()) && generatedAt.toISOString() === manifest.run.generatedAt;
  const sourceIds = new Set();
  const allowedValues = contract.workerArtifacts.inventory.allowedValues;
  const sourcesMatch = Array.isArray(manifest.sources) && manifest.sources.length > 0 &&
    manifest.sources.every((source) => {
      const required = contract.workerArtifacts.inventory.sourceFields;
      const keys = Object.keys(source);
      const allowed = new Set([...required, 'approval']);
      const shape = required.every((key) => keys.includes(key)) &&
        keys.every((key) => allowed.has(key));
      const valid = shape && typeof source.id === 'string' && source.id.length > 0 &&
        allowedValues.sourceHost.includes(source.host) &&
        allowedValues.sourceScope.includes(source.scope) &&
        allowedValues.sourceOrigin.includes(source.origin) &&
        allowedValues.sourceOwnership.includes(source.ownership) &&
        path.isAbsolute(source.logicalPath) && path.isAbsolute(source.resolvedPath) &&
        isInside(subject, source.logicalPath) && isInside(subject, source.resolvedPath) &&
        (typeof source.exists === 'boolean' || source.exists === null) &&
        allowedValues.sourceLoadState.includes(source.loadState) &&
        nonnegativeIntegerOrNull(source.loadPosition) &&
        nonnegativeIntegerOrNull(source.byteCount) && Number.isInteger(source.byteContribution) &&
        source.byteContribution >= 0 &&
        (source.byteCount === null || source.byteContribution <= source.byteCount) &&
        (source.sha256 === null || /^[0-9a-f]{64}$/.test(source.sha256)) &&
        allowedValues.sourceEncoding.includes(source.encoding) &&
        allowedValues.sourceLineEndings.includes(source.lineEndings) &&
        allowedValues.sourceGitState.includes(source.gitState) &&
        (source.import === null || (exactKeys(source.import,
          contract.workerArtifacts.inventory.importFields) &&
          typeof source.import.parentSourceId === 'string' &&
          Number.isInteger(source.import.depth) && source.import.depth > 0)) &&
        stringArray(source.conditions) &&
        (source.inactiveReason === null ||
          allowedValues.sourceInactiveReason.includes(source.inactiveReason)) &&
        (source.approval === undefined || source.approval === null ||
          allowedValues.sourceApproval.includes(source.approval));
      if (sourceIds.has(source.id)) return false;
      sourceIds.add(source.id);
      return valid;
    });
  const codexChain = manifest.chains?.codex;
  const claudeChain = manifest.chains?.claude;
  const uniqueStrings = (value) => stringArray(value) && new Set(value).size === value.length;
  const sourceById = new Map((manifest.sources || []).map((source) => [source.id, source]));
  const settings = claudeChain?.settingSources;
  const chainsMatch = exactKeys(manifest.chains, ['codex', 'claude']) &&
    exactKeys(codexChain, contract.workerArtifacts.inventory.chainFields.codex) &&
    exactKeys(claudeChain, contract.workerArtifacts.inventory.chainFields.claude) &&
    uniqueStrings(codexChain.sourceIds) && uniqueStrings(claudeChain.sourceIds) &&
    uniqueStrings(claudeChain.conditionalSourceIds) && uniqueStrings(claudeChain.excludes) &&
    Number.isInteger(claudeChain.maxImportDepth) && claudeChain.maxImportDepth >= 0 &&
    claudeChain.maxImportDepth <= 4 &&
    exactKeys(settings, contract.workerArtifacts.inventory.settingSourceFields) &&
    allowedValues.settingState.includes(settings.state) && uniqueStrings(settings.sources) &&
    settings.sources.every((source) => allowedValues.settingSources.includes(source)) &&
    allowedValues.coverage.includes(claudeChain.coverage) &&
    codexChain.sourceIds.every((id) => sourceById.get(id)?.host === 'codex') &&
    claudeChain.sourceIds.every((id) => sourceById.get(id)?.host === 'claude') &&
    claudeChain.conditionalSourceIds.every((id) =>
      sourceById.get(id)?.host === 'claude' && sourceById.get(id)?.loadState === 'conditional') &&
    !claudeChain.sourceIds.some((id) => claudeChain.conditionalSourceIds.includes(id)) &&
    [...codexChain.sourceIds, ...claudeChain.sourceIds, ...claudeChain.conditionalSourceIds]
      .every((id) => sourceIds.has(id)) &&
    (manifest.sources || []).every((source) => source.import === null ||
      sourceById.get(source.import.parentSourceId)?.host === 'claude');
  const warningsMatch = Array.isArray(manifest.warnings) && manifest.warnings.every((warning) =>
    exactKeys(warning, contract.workerArtifacts.inventory.warningFields) &&
    typeof warning.code === 'string' && warning.code.length > 0 &&
    allowedValues.sourceHost.includes(warning.host) && path.isAbsolute(warning.logicalPath) &&
    isInside(subject, warning.logicalPath) &&
    (warning.field === null || typeof warning.field === 'string'));
  const scenarioSourcesMatch = contract.workerArtifacts.inventory.scenarioSources.every(
    (requirement) => {
      const logicalPath = inside(subject, ...requirement.path.split('/'));
      const source = (manifest.sources || []).find((item) =>
        item.logicalPath === logicalPath && item.host === requirement.host);
      if (!source || source.loadState !== requirement.loadState || source.exists !== true ||
          source.resolvedPath !== fs.realpathSync.native(logicalPath)) return false;
      const bytes = fs.readFileSync(logicalPath);
      if (source.byteCount !== bytes.length || source.sha256 !== sha256(bytes)) return false;
      if (source.loadState === 'shadowed' && source.byteContribution !== 0) return false;
      if (['active', 'conditional'].includes(source.loadState) &&
          source.byteContribution !== bytes.length) return false;
      if (source.loadState === 'truncated' &&
          !(source.byteContribution > 0 && source.byteContribution < bytes.length)) return false;
      const hostChain = requirement.host === 'codex' ? codexChain : claudeChain;
      const allHostChainIds = requirement.host === 'codex' ? codexChain.sourceIds :
        [...claudeChain.sourceIds, ...claudeChain.conditionalSourceIds];
      return requirement.chain === null ? !allHostChainIds.includes(source.id) :
        hostChain[requirement.chain].includes(source.id);
    });
  if (manifest.schemaVersion !== 1 || !runMatches || !rootMatches || !sourcesMatch ||
      !chainsMatch || !warningsMatch || !scenarioSourcesMatch) {
    throw new Error('Inventory stdout must use schema version 1, isolated roots, and the required scenario source chains.');
  }
  return manifest;
}

function boundIdentity(value, scenarioId, host, runId) {
  return value?.schemaVersion === 1 && value.scenarioId === scenarioId &&
    value.host === host && value.runId === runId;
}

function validateInventoryArtifact(bytes, subject, scenarioId, host, runId, contract, ordinal) {
  const artifact = parseJsonBytes(bytes, 'Inventory artifact must be valid UTF-8 JSON.');
  const schema = contract.workerArtifacts.inventory;
  const command = schema.invocations[ordinal - 1];
  if (!exactKeys(artifact, schema.requiredFields) ||
      !boundIdentity(artifact, scenarioId, host, runId) ||
      artifact.invocationId !== command.id || !same(artifact.argv, command.argv) ||
      artifact.cwd !== command.cwd || artifact.exitCode !== 0 ||
      typeof artifact.stdout !== 'string' || artifact.stdout.length === 0) {
    throw new Error('Inventory artifact identity or invocation is invalid.');
  }
  const stdoutBytes = Buffer.from(artifact.stdout, 'utf8');
  if (artifact.stdoutSha256 !== sha256(stdoutBytes)) {
    throw new Error('Inventory artifact stdout hash is invalid.');
  }
  const manifest = validateInventoryManifest(parseJsonBytes(stdoutBytes,
    'Inventory stdout must be valid UTF-8 JSON.'), subject, scenarioId, contract);
  return { artifact, manifest, stdoutBytes };
}

function validEvidenceShape(value) {
  const validItem = (item) => exactKeys(item, ['path', 'sha256']) &&
    typeof item.path === 'string' && item.path.length > 0 && !path.isAbsolute(item.path) &&
    !item.path.split(/[\\/]/).includes('..') && /^[0-9a-f]{64}$/.test(item.sha256);
  return Array.isArray(value) ? value.length > 0 && value.every(validItem) : validItem(value);
}

function validateMachineReport(report, scenarioId, host, runId, contract) {
  const requiredTop = contract.workerArtifacts.machineReport.requiredFields;
  if (!exactKeys(report, requiredTop) || report.schemaVersion !== 1 ||
      !boundIdentity(report, scenarioId, host, runId)) {
    throw new Error('Machine report schema is invalid.');
  }
  const schema = contract.workerArtifacts.machineReport.scenarios[scenarioId];
  const collections = {
    targetMatrix: report.targetMatrix,
    effectiveChain: report.effectiveChain,
    decisionLedger: report.decisionLedger,
    transactions: report.changesAndRecovery?.transactions,
    verificationMatrix: report.verificationMatrix,
    pendingQuestions: report.pendingQuestions,
  };
  for (const [name, entries] of Object.entries(collections)) {
    const idField = name === 'verificationMatrix' ? 'claim' : 'id';
    const required = schema.requiredEntryFields[name];
    if (!Array.isArray(entries) || entries.length !== schema.semanticIds[name].length ||
        new Set(entries.map((entry) => entry?.[idField])).size !== entries.length ||
        !same(entries.map((entry) => entry[idField]), schema.semanticIds[name])) {
      throw new Error('Machine report semantic IDs are invalid.');
    }
    for (const entry of entries) {
      const allowedKeys = entry.evidence === undefined ? required : [...required, 'evidence'];
      if (!exactKeys(entry, allowedKeys) ||
          (entry.evidence !== undefined && !validEvidenceShape(entry.evidence))) {
        throw new Error('Machine report evidence shape is invalid.');
      }
      const allowed = contract.workerArtifacts.machineReport.allowedValues;
      const validStatus = name === 'transactions' ?
        allowed.transactionStatus.includes(entry.status) : allowed.status.includes(entry.status);
      if (!validStatus ||
          (name === 'decisionLedger' && !allowed.disposition.includes(entry.disposition)) ||
          (name === 'transactions' && (!stringArray(entry.targets) ||
            entry.targets.length === 0))) {
        throw new Error('Machine report values are invalid.');
      }
    }
  }
  return report;
}

function parseRawFinal(bytes, scenarioId, host, runId, machineReport) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const header = `schemaVersion: 1\nscenarioId: ${scenarioId}\nhost: ${host}\nrunId: ${runId}\n`;
  if (!text.startsWith(header) || text.includes('\0')) {
    throw new Error('Worker final identity is missing or malformed.');
  }
  const values = [];
  let cursor = header.length;
  for (const sectionName of HUMAN_REPORT_SECTIONS) {
    const marker = `\n## ${sectionName}\n\n\`\`\`json\n`;
    if (!text.startsWith(marker, cursor)) throw new Error('Worker final sections are incomplete.');
    cursor += marker.length;
    const end = text.indexOf('\n\`\`\`\n', cursor);
    if (end === -1) throw new Error('Worker final section JSON is incomplete.');
    values.push(JSON.parse(text.slice(cursor, end)));
    cursor = end + 5;
  }
  if (text.slice(cursor).trim() !== '') throw new Error('Worker final has extra sections.');
  const expected = [machineReport.targetMatrix, machineReport.effectiveChain,
    machineReport.decisionLedger, machineReport.changesAndRecovery,
    machineReport.verificationMatrix, machineReport.pendingQuestions];
  if (!same(values, expected)) {
    throw new Error('Worker final dispositions disagree with the machine report.');
  }
  return { text, values };
}

function validateCommandTrace(trace, scenarioId, host, runId, checkpoints, inventories,
  contract) {
  const required = contract.workerArtifacts.commandTrace.requiredFields;
  if (!exactKeys(trace, trace.facts === undefined ? required : [...required, 'facts']) ||
      !boundIdentity(trace, scenarioId, host, runId) ||
      !Array.isArray(trace.invocations) || trace.invocations.length === 0 ||
      !Array.isArray(trace.checkpoints) || !same(trace.checkpoints,
        checkpoints.map((item) => ({
          id: item.value.id,
          ordinal: item.value.ordinal,
          path: `checkpoints/${item.fileName}`,
          sha256: sha256(item.bytes),
        })))) throw new Error('Worker command trace is malformed or hash-mismatched.');
  const invocationSchema = contract.workerArtifacts.commandTrace.invocation;
  const outputs = [
    ...inventories.map((item, index) => ({
      id: `inventory-${index + 1}`,
      kind: 'inventory',
      path: contract.workerArtifacts.inventory.paths[index],
      sha256: sha256(item.bytes),
      argv: contract.workerArtifacts.inventory.invocations[index].argv,
      cwd: contract.workerArtifacts.inventory.invocations[index].cwd,
      exitCode: 0,
    })),
    ...checkpoints.map((item) => ({
      id: item.value.id,
      kind: 'checkpoint',
      path: `checkpoints/${item.fileName}`,
      sha256: sha256(item.bytes),
      argv: [],
      cwd: contract.workerArtifacts.inventory.invocations[0].cwd,
      exitCode: 0,
    })),
  ];
  let predecessorId = null;
  const invocationsPass = trace.invocations.length === outputs.length &&
    trace.invocations.every((invocation, index) => {
      const output = outputs[index];
      const pass = exactKeys(invocation, invocationSchema.requiredFields) &&
        boundIdentity(invocation, scenarioId, host, runId) &&
        invocation.id === output.id && invocation.ordinal === index + 1 &&
        invocation.predecessorId === predecessorId && invocation.kind === output.kind &&
        same(invocation.argv, output.argv) && invocation.cwd === output.cwd &&
        invocation.exitCode === output.exitCode && invocation.outputPath === output.path &&
        invocation.outputSha256 === output.sha256;
      predecessorId = invocation.id;
      return pass;
    });
  const expectedFacts = contract.workerArtifacts.commandTrace.factSets[scenarioId];
  const facts = trace.facts === undefined ? [] : trace.facts;
  const factsPass = Array.isArray(facts) && facts.length === expectedFacts.length &&
    new Set(facts.map((fact) => fact?.id)).size === facts.length &&
    facts.every((fact, index) => exactKeys(fact,
      contract.workerArtifacts.commandTrace.fact.requiredFields) &&
      boundIdentity(fact, scenarioId, host, runId) &&
      contract.workerArtifacts.commandTrace.fact.allowedKinds.includes(fact.kind) &&
      fact.id === expectedFacts[index].id && fact.kind === expectedFacts[index].kind &&
      fact.path === expectedFacts[index].path && scalar(fact.value) &&
      Number.isInteger(fact.exitCode));
  if (!invocationsPass ||
      new Set(trace.invocations.map((item) => item.id)).size !== trace.invocations.length) {
    throw new Error('Worker command trace is replayed or reordered.');
  }
  if (!factsPass) throw new Error('Worker command trace facts are invalid or replayed.');
  return trace;
}

function validateSnapshot(snapshot) {
  return snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot) &&
    Object.entries(snapshot).every(([relativePath, entry]) =>
      typeof relativePath === 'string' && !path.isAbsolute(relativePath) &&
      !relativePath.split(/[\\/]/).includes('..') && exactKeys(entry, ['sha256', 'size']) &&
      /^[0-9a-f]{64}$/.test(entry.sha256) && Number.isInteger(entry.size) && entry.size >= 0);
}

function validateRecoveryPayload(value, contract) {
  const schema = contract.workerArtifacts.checkpointSchemas;
  return exactKeys(value, schema.recoveryFields) && validRecoveryLeaf(value.leaf) &&
    typeof value.manifestPath === 'string' && /^[0-9a-f]{64}$/.test(value.manifestSha256) &&
    typeof value.restorationPath === 'string' &&
    /^[0-9a-f]{64}$/.test(value.restorationSha256) && Array.isArray(value.members) &&
    value.members.length > 0 && new Set(value.members.map((item) => item.targetPath)).size ===
      value.members.length && value.members.every((item) =>
      exactKeys(item, schema.recoveryMemberFields) && typeof item.targetPath === 'string' &&
      typeof item.existed === 'boolean' && validPermissionEvidence(item.permissions) &&
      (item.existed ? (typeof item.preimagePath === 'string' &&
        !path.isAbsolute(item.preimagePath) &&
        !item.preimagePath.split(/[\\/]/).includes('..') &&
        /^[0-9a-f]{64}$/.test(item.preimageSha256) &&
        /^[0-9a-f]{64}$/.test(item.originalSha256)) :
        (item.preimagePath === null && item.preimageSha256 === null &&
          item.originalSha256 === null &&
          ['mode', 'owner'].every((property) =>
            item.permissions[property].status === 'unverified' &&
            item.permissions[property].value === null))));
}

function validateCheckpointPayload(value, scenarioId, id, contract) {
  const schema = contract.workerArtifacts.checkpointSchemas;
  if (scenarioId === 'apply' && id !== 'apply-01-recovery-complete') {
    return schema.allowedValues.transformationStatus.includes(value.transformationStatus);
  }
  if (id === 'partial-01-inventory-plan') return typeof value.planComplete === 'boolean';
  if (id === 'partial-03-marker') {
    return value.controlPath === schema.allowedValues.controlPath[0] &&
      /^[0-9a-f]{64}$/.test(value.controlSha256) && Number.isInteger(value.exitCode);
  }
  if (id === 'partial-05-independent-writes') {
    return typeof value.independentWritesComplete === 'boolean';
  }
  if (id === 'partial-06-verifier-failure' || id === 'partial-08-verifier-success') {
    return value.controlPath === schema.allowedValues.controlPath[1] &&
      /^[0-9a-f]{64}$/.test(value.controlSha256) && Number.isInteger(value.exitCode) &&
      typeof value.stdout === 'string' && schema.allowedValues.stdout.includes(value.stdout);
  }
  if (id === 'partial-07-project-rollback') {
    return schema.allowedValues.rolledBackTransaction.includes(value.rolledBackTransaction);
  }
  return true;
}

function readWorkerCheckpoints(artifactBuffers, scenarioId, host, runId, contract) {
  let predecessorSha256 = null;
  const checkpoints = [];
  for (const [index, fileName] of CHECKPOINT_FILES[scenarioId].entries()) {
    const bytes = artifactBuffers.get(`checkpoint:${fileName}`);
    const value = parseJsonBytes(bytes, 'Worker checkpoint must be valid UTF-8 JSON.');
    const id = fileName.slice(0, -'.json'.length);
    const payloadFields = contract.workerArtifacts.checkpointSchemas[scenarioId][id];
    const requiredFields = [...contract.workerArtifacts.checkpointSchemas.commonFields,
      ...payloadFields];
    if (!exactKeys(value, requiredFields) || !boundIdentity(value, scenarioId, host, runId) ||
        value.id !== id ||
        value.ordinal !== index + 1 || value.predecessorSha256 !== predecessorSha256) {
      throw new Error('Worker checkpoints are missing, replayed, reordered, or hash-mismatched.');
    }
    if (!validateSnapshot(value.targetSnapshot) ||
        (payloadFields.includes('recovery') && !validateRecoveryPayload(value.recovery, contract)) ||
        (payloadFields.includes('prewriteTargets') && (!Array.isArray(value.prewriteTargets) ||
          value.prewriteTargets.length === 0 || value.prewriteTargets.some((item) =>
            !exactKeys(item, contract.workerArtifacts.checkpointSchemas.prewriteTargetFields) ||
            typeof item.existed !== 'boolean' ||
            (item.existed ? (!/^[0-9a-f]{64}$/.test(item.originalSha256) ||
              !/^[0-9a-f]{64}$/.test(item.currentSha256)) :
              (item.originalSha256 !== null || item.currentSha256 !== null)) ||
            !validPermissionEvidence(item.permissions)))) ||
        !validateCheckpointPayload(value, scenarioId, id, contract)) {
      throw new Error('Worker checkpoint payload is malformed.');
    }
    checkpoints.push({ fileName, bytes, value });
    predecessorSha256 = sha256(bytes);
  }
  if (new Set(checkpoints.map((item) => sha256(item.bytes))).size !== checkpoints.length) {
    throw new Error('Worker checkpoints are replayed.');
  }
  return checkpoints;
}

function copyArtifact(root, bytes, relativeDestination, kind) {
  writeFile(root, relativeDestination, bytes);
  return { kind, path: portable(relativeDestination), sha256: sha256(bytes) };
}

function artifactIdentities(filePath) {
  const stat = fs.statSync(filePath, { bigint: true });
  const physical = fs.realpathSync.native(filePath);
  const normalized = process.platform === 'win32' ? physical.toLowerCase() : physical;
  return {
    path: normalized,
    fileId: stat.ino !== 0n ?
      `${stat.dev}\0${stat.ino}` : null,
  };
}

function rememberArtifact(filePath, seen) {
  const identity = artifactIdentities(filePath);
  if (seen.paths.has(identity.path) ||
      (identity.fileId !== null && seen.fileIds.has(identity.fileId))) {
    throw new Error('Worker artifact paths must be distinct and unaliased.');
  }
  seen.paths.add(identity.path);
  if (identity.fileId !== null) seen.fileIds.add(identity.fileId);
}

function expectedWorkerFiles(scenarioId, contract) {
  return [
    contract.captureDescriptor.path,
    ...contract.workerArtifacts.inventory.paths,
    contract.workerArtifacts.rawFinal.path,
    contract.workerArtifacts.machineReport.path,
    contract.workerArtifacts.commandTrace.path,
    ...CHECKPOINT_FILES[scenarioId].map((fileName) => `checkpoints/${fileName}`),
  ].sort();
}

function physicalEvidenceTree(root, artifactRoot) {
  const files = [];
  const directories = [];
  const visit = (directory) => {
    assertNoLinks(root, directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = inside(artifactRoot, directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Worker artifact paths may not use links.');
      if (entry.isDirectory()) {
        directories.push(portable(path.relative(artifactRoot, entryPath)));
        visit(entryPath);
      }
      else if (entry.isFile()) files.push(portable(path.relative(artifactRoot, entryPath)));
      else throw new Error('Worker evidence contains an unsupported artifact type.');
    }
  };
  visit(artifactRoot);
  return { files: files.sort(), directories: directories.sort() };
}

function requireExactWorkerFiles(root, artifactRoot, scenarioId, contract) {
  const tree = physicalEvidenceTree(root, artifactRoot);
  if (!same(tree.files, expectedWorkerFiles(scenarioId, contract)) ||
      contract.workerArtifacts.artifactSet.additionalFiles !== false ||
      !same(tree.directories, contract.workerArtifacts.artifactSet.allowedDirectories)) {
    throw new Error('Worker evidence artifact set must exactly match the public contract.');
  }
}

function loadArtifactOnce(root, artifactRoot, relativePath, seen) {
  const filePath = inside(artifactRoot, ...relativePath.split('/'));
  assertNoLinks(root, filePath);
  if (!fs.statSync(filePath).isFile()) throw new Error('Worker artifact must be a file.');
  rememberArtifact(filePath, seen);
  return { filePath, bytes: fs.readFileSync(filePath) };
}

function validatePermissionProperty(value) {
  return exactKeys(value, ['status', 'value']) &&
    ['verified', 'unverified'].includes(value.status) &&
    (value.status === 'verified' ? value.value !== null : value.value === null);
}

function validPermissionEvidence(value) {
  return exactKeys(value, ['mode', 'owner']) && validatePermissionProperty(value.mode) &&
    validatePermissionProperty(value.owner);
}

function validateReportEvidence(root, subject, artifactRoot, report, artifactBuffers, contract) {
  const collections = [report.targetMatrix, report.effectiveChain, report.decisionLedger,
    report.changesAndRecovery.transactions, report.verificationMatrix, report.pendingQuestions];
  const allowedTargets = new Set(
    contract.workerArtifacts.machineReport.allowedTargetEvidencePaths);
  for (const entries of collections) {
    for (const entry of entries) {
      if (entry.evidence === undefined) continue;
      const evidenceItems = Array.isArray(entry.evidence) ? entry.evidence : [entry.evidence];
      for (const item of evidenceItems) {
        const relativePath = portable(item.path);
        if (!allowedTargets.has(relativePath) &&
            !relativePath.startsWith(`evidence/${report.host}/`)) {
          throw new Error('Machine report evidence path is not sanctioned.');
        }
        let bytes;
        if (relativePath.startsWith(`evidence/${report.host}/`)) {
          const artifactRelative = relativePath.slice(`evidence/${report.host}/`.length);
          bytes = artifactBuffers.get(artifactRelative);
        } else {
          const target = inside(subject, ...relativePath.split('/'));
          assertNoLinks(root, target);
          bytes = fs.readFileSync(target);
        }
        if (!bytes || sha256(bytes) !== item.sha256) {
          throw new Error('Machine report evidence hash is invalid.');
        }
      }
    }
  }
}

function captureEvidence(scenarioId, runRoot, captureInput) {
  if (!SCENARIOS.has(scenarioId)) throw new Error('Unknown forward-evaluation scenario.');
  if (typeof captureInput !== 'string') {
    throw new Error('Capture requires a descriptor file beneath the host evidence directory.');
  }
  const root = resolvePhysicalRoot(runRoot, false);
  const subject = inside(root, 'subject');
  const evidenceRoot = inside(subject, 'evidence');
  const descriptorPath = captureInputPath(root, evidenceRoot, captureInput);
  const descriptorBytes = fs.readFileSync(descriptorPath);
  const descriptor = parseJsonBytes(descriptorBytes, 'Capture descriptor is invalid.');
  const contractPath = inside(subject, 'controls', 'evidence-contract.json');
  const contractBytes = fs.readFileSync(contractPath);
  const contract = parseJsonBytes(contractBytes, 'Public evidence contract is invalid.');
  const runId = contract.runId;
  if (!exactKeys(descriptor, contract.captureDescriptor.requiredFields) ||
      !boundIdentity(descriptor, scenarioId, descriptor.host, runId) ||
      !['codex', 'claude'].includes(descriptor.host) ||
      !Array.isArray(descriptor.inventoryPaths) || descriptor.inventoryPaths.length !== 2) {
    throw new Error('Capture descriptor is invalid.');
  }
  const host = descriptor.host;
  const artifactRoot = inside(evidenceRoot, host);
  if (fs.realpathSync.native(descriptorPath) !==
      fs.realpathSync.native(inside(artifactRoot, contract.captureDescriptor.path))) {
    throw new Error('Capture descriptor file must use the published host path.');
  }
  requireExactWorkerFiles(root, artifactRoot, scenarioId, contract);
  const expectedRelative = (name) => portable(path.relative(root, inside(artifactRoot, name)));
  if (descriptor.rawFinalPath !== expectedRelative(contract.workerArtifacts.rawFinal.path) ||
      !same(descriptor.inventoryPaths, contract.workerArtifacts.inventory.paths
        .map(expectedRelative))) {
    throw new Error('Capture descriptor artifact paths are invalid.');
  }
  const seen = { paths: new Set(), fileIds: new Set() };
  rememberArtifact(descriptorPath, seen);
  const loaded = new Map();
  const load = (key, relativePath) => {
    const artifact = loadArtifactOnce(root, artifactRoot, relativePath, seen);
    loaded.set(key, artifact.bytes);
    loaded.set(relativePath, artifact.bytes);
    return artifact;
  };
  const inventoryFiles = contract.workerArtifacts.inventory.paths.map((relativePath, index) => {
    const loadedArtifact = load(`inventory-${index + 1}`, relativePath);
    return { ...loadedArtifact, ...validateInventoryArtifact(loadedArtifact.bytes, subject,
      scenarioId, host, runId, contract, index + 1) };
  });
  const rawFinal = load('raw-final', contract.workerArtifacts.rawFinal.path);
  const machineReport = load('machine-report', contract.workerArtifacts.machineReport.path);
  const commandTrace = load('command-trace', contract.workerArtifacts.commandTrace.path);
  const checkpointBuffers = new Map();
  for (const fileName of CHECKPOINT_FILES[scenarioId]) {
    const item = load(`checkpoint:${fileName}`, `checkpoints/${fileName}`);
    checkpointBuffers.set(`checkpoint:${fileName}`, item.bytes);
  }
  const report = validateMachineReport(parseJsonBytes(machineReport.bytes,
    'Machine report must be valid UTF-8 JSON.'), scenarioId, host, runId, contract);
  parseRawFinal(rawFinal.bytes, scenarioId, host, runId, report);
  const checkpoints = readWorkerCheckpoints(checkpointBuffers, scenarioId, host, runId, contract);
  if (scenarioId === 'audit' &&
      !same(checkpoints[0].value.targetSnapshot, snapshotTargets(subject))) {
    throw new Error('Audit checkpoint must match the complete current target snapshot.');
  }
  const trace = validateCommandTrace(parseJsonBytes(commandTrace.bytes,
    'Worker command trace must be valid UTF-8 JSON.'), scenarioId, host, runId, checkpoints,
  inventoryFiles.map((item) => ({ bytes: item.bytes })), contract);
  validateReportEvidence(root, subject, artifactRoot, report, loaded, contract);
  const challenges = readJson(root, 'evaluator/capture-challenges.json');
  if (contract.schemaVersion !== 1 || contract.scenarioId !== scenarioId ||
      challenges.runId !== runId || challenges.evidenceContractSha256 !== sha256(contractBytes)) {
    throw new Error('Public evidence contract does not match preparation.');
  }

  const hostIndexPath = inside(root, 'logs', 'host-evidence.json');
  const hostIndex = fs.existsSync(hostIndexPath) ? readJson(root, 'logs/host-evidence.json') :
    { schemaVersion: 1, scenarioId, runId, hosts: [] };
  if (hostIndex.schemaVersion !== 1 || hostIndex.scenarioId !== scenarioId ||
      hostIndex.runId !== runId ||
      !Array.isArray(hostIndex.hosts) || hostIndex.hosts.some((item) => item.host === host)) {
    throw new Error('Host evidence is already captured or malformed.');
  }

  const prefix = `logs/hosts/${host}`;
  const artifacts = [
    copyArtifact(root, descriptorBytes, `${prefix}/capture.json`, 'capture-descriptor'),
    copyArtifact(root, inventoryFiles[0].bytes, `${prefix}/inventory-1-stdout.json`, 'inventory-1'),
    copyArtifact(root, inventoryFiles[1].bytes, `${prefix}/inventory-2-stdout.json`, 'inventory-2'),
    copyArtifact(root, rawFinal.bytes, `${prefix}/worker-final.md`, 'raw-final'),
    copyArtifact(root, machineReport.bytes, `${prefix}/machine-report.json`, 'machine-report'),
    copyArtifact(root, commandTrace.bytes, `${prefix}/command-trace.json`, 'command-trace'),
    ...checkpoints.map((item) => copyArtifact(root, item.bytes,
      `${prefix}/checkpoints/${item.fileName}`, `checkpoint:${item.value.id}`)),
  ];
  const bundleSha256 = sha256(Buffer.from(JSON.stringify(artifacts
    .map(({ kind, sha256: digest }) => ({ kind, sha256: digest }))))) ;
  if (hostIndex.hosts.some((item) => item.bundleSha256 === bundleSha256 ||
      item.artifacts.some((artifact) => artifacts.some((candidate) =>
        artifact.sha256 === candidate.sha256)))) {
    throw new Error('Cross-host artifact replay is not allowed.');
  }
  const snapshotPath = `logs/controller/${host}-target-snapshot.json`;
  writeJson(root, snapshotPath, snapshotTargets(subject));
  const controllerSnapshot = { path: snapshotPath, sha256: hashAt(root, snapshotPath) };
  const challenge = challenges.hosts.find((item) => item.host === host);
  const receiptPath = `evaluator/receipts/hosts/${host}.json`;
  const receipt = {
    schemaVersion: 1,
    scenarioId,
    host,
    runId,
    receiptId: challenge.receiptId,
    invocationId: challenge.invocationId,
    evaluatorNonce: challenge.nonce,
    requestSha256: challenges.requestSha256,
    evidenceContractSha256: challenges.evidenceContractSha256,
    artifacts,
    bundleSha256,
    controllerSnapshot,
  };
  writeJson(root, receiptPath, receipt);
  const entry = {
    host,
    artifacts,
    bundleSha256,
    controllerSnapshot,
    receipt: { path: receiptPath, sha256: hashAt(root, receiptPath) },
  };
  hostIndex.hosts.push(entry);
  hostIndex.hosts.sort((left, right) => left.host < right.host ? -1 : 1);
  writeJson(root, 'logs/host-evidence.json', hostIndex);

  if (!fs.existsSync(inside(root, 'logs', 'report.json'))) {
    writeFile(root, 'logs/report.json', machineReport.bytes);
    writeFile(root, 'logs/manifest-1.json', inventoryFiles[0].stdoutBytes);
    writeFile(root, 'logs/manifest-2.json', inventoryFiles[1].stdoutBytes);
    writeFile(root, 'logs/command-trace.json', commandTrace.bytes);
    for (const checkpoint of checkpoints) {
      writeFile(root, `logs/checkpoints/${checkpoint.fileName}`, checkpoint.bytes);
    }
  }

  if (scenarioId === 'apply') {
    const runChallenges = challenges.applyRuns.filter((item) => item.host === host)
      .sort((left, right) => left.ordinal - right.ordinal);
    let previousReceiptSha256 = null;
    for (const [index, runChallenge] of runChallenges.entries()) {
      const checkpoint = artifacts.find((item) =>
        item.kind === `checkpoint:${CHECKPOINT_FILES.apply[index + 1].slice(0, -5)}`);
      const runReceiptPath = `evaluator/receipts/apply/${host}/run-${index + 1}.json`;
      writeJson(root, runReceiptPath, {
        schemaVersion: 1,
        scenarioId,
        host,
        runId,
        receiptId: runChallenge.receiptId,
        invocationId: runChallenge.invocationId,
        evaluatorNonce: runChallenge.nonce,
        requestSha256: challenges.requestSha256,
        ordinal: index + 1,
        previousReceiptSha256,
        rawFinal: artifacts.find((item) => item.kind === 'raw-final'),
        inventories: artifacts.filter((item) => item.kind.startsWith('inventory-')),
        checkpoint,
      });
      previousReceiptSha256 = hashAt(root, runReceiptPath);
    }
  }
  return { schemaVersion: 1, scenarioId, host, runId, status: 'captured' };
}

function reportContract(scenarioId) {
  const contracts = {
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
  return contracts[scenarioId];
}

function reportCheck(root, scenarioId, gradedChecks, collected) {
  const contract = reportContract(scenarioId);
  const expected = readJson(root, 'evaluator/expected.json');
  const evidenceState = collected || collectHostEvidence(root, scenarioId);
  const present = [...evidenceState.states.values()].filter((state) => state.status === 'pass');
  if ([...evidenceState.states.values()].some((state) => state.status === 'fail')) {
    return check('report_complete', 'fail', 'logs/hosts');
  }
  if (present.length === 0) return check('report_complete', 'unverified', 'logs/hosts');
  const checksById = new Map(gradedChecks.map((item) => [item.id, item.status]));
  const consistency = {
    audit: [
      ['targets-unchanged', 'targets_unchanged'],
      ['targets-unchanged', 'audit_checkpoint_semantics'],
      ['manifests-deterministic', 'manifests_deterministic'],
      ['source-states', 'exact_source_states'],
      ['inspector-invocations', 'inspector_invocations'],
      ['secret-free', 'secret_free_outputs'],
    ],
    apply: [
      ['backup-location', 'backup_outside_repository'],
      ['backup-preimages', 'backup_preimages'],
      ['global-guidance', 'global_guidance'],
      ['canonical-project', 'canonical_project_guidance'],
      ['dirty-guidance', 'dirty_guidance_preserved'],
      ['claude-import', 'single_claude_import_and_delta'],
      ['private-local', 'private_local_unchanged'],
      ['representation', 'representation_preserved'],
      ['repository-facts', 'verified_repository_facts'],
      ['idempotence', 'second_run_idempotent'],
      ['secret-free', 'secret_free_outputs'],
    ],
    partial: [
      ['backup-location', 'backup_outside_repository'],
      ['codex-global', 'safe_codex_change_retained'],
      ['claude-concurrent', 'concurrent_claude_preserved'],
      ['project-rollback', 'project_pair_rolled_back'],
      ['restoration', 'restoration_statuses'],
      ['control-sequence', 'control_sequence'],
    ],
  };
  let pass = true;
  for (const state of present) {
    const semanticReport = structuredClone(state.report);
    const evidenceCollections = [semanticReport.targetMatrix, semanticReport.effectiveChain,
      semanticReport.decisionLedger, semanticReport.changesAndRecovery.transactions,
      semanticReport.verificationMatrix, semanticReport.pendingQuestions];
    for (const entries of evidenceCollections) {
      for (const entry of entries) delete entry.evidence;
    }
    pass = pass && same(semanticReport, { schemaVersion: 1, scenarioId, host: state.host,
      runId: expected.runId, ...contract });
    const claims = new Map(state.report.verificationMatrix
      .map((entry) => [entry.claim, entry.status]));
    pass = pass && claims.get('host-primary-evidence') === 'verified';
    for (const [claim, checkId] of consistency[scenarioId]) {
      if (checksById.get(checkId) === 'fail' && claims.get(claim) === 'verified') pass = false;
    }
  }
  return check('report_complete', pass ? 'pass' : 'fail', 'logs/hosts',
    present.map((state) => state.report));
}

function collectHostEvidence(root, scenarioId) {
  const expectedHosts = ['codex', 'claude'];
  const subject = inside(root, 'subject');
  const contract = readJson(root, 'subject/controls/evidence-contract.json');
  const challenges = readJson(root, 'evaluator/capture-challenges.json');
  const noncePattern = /^[0-9a-f]{64}$/;
  const expectedChallenges = challenges.hosts || [];
  const challengeShapePass = exactKeys(challenges,
    ['schemaVersion', 'scenarioId', 'runId', 'requestSha256', 'evidenceContractSha256',
      'hosts', 'applyRuns']) && challenges.schemaVersion === 1 &&
    challenges.scenarioId === scenarioId && challenges.runId === contract.runId &&
    challenges.requestSha256 === hashAt(root, 'logs/prompt.md') &&
    challenges.evidenceContractSha256 ===
      hashAt(root, 'subject/controls/evidence-contract.json') &&
    expectedChallenges.length === expectedHosts.length &&
    new Set(expectedChallenges.map((item) => item.host)).size === expectedHosts.length &&
    expectedChallenges.every((item) => exactKeys(item,
      ['host', 'receiptId', 'invocationId', 'nonce']) && expectedHosts.includes(item.host) &&
      item.receiptId === `${scenarioId}-host-${item.host}` &&
      item.invocationId === `${scenarioId}-${item.host}-1` && noncePattern.test(item.nonce)) &&
    new Set(expectedChallenges.map((item) => item.nonce)).size === expectedHosts.length &&
    Array.isArray(challenges.applyRuns) &&
    (scenarioId === 'apply' ? challenges.applyRuns.length === 4 :
      challenges.applyRuns.length === 0);
  let hostEvidence = null;
  try {
    hostEvidence = readJson(root, 'logs/host-evidence.json');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  const indexPass = hostEvidence === null || (exactKeys(hostEvidence,
    ['schemaVersion', 'scenarioId', 'runId', 'hosts']) && hostEvidence.schemaVersion === 1 &&
    hostEvidence.scenarioId === scenarioId && hostEvidence.runId === contract.runId &&
    Array.isArray(hostEvidence.hosts) &&
    new Set(hostEvidence.hosts.map((item) => item.host)).size === hostEvidence.hosts.length &&
    hostEvidence.hosts.every((item) => expectedHosts.includes(item.host)));
  if (!challengeShapePass || !indexPass) {
    return { status: 'fail', states: new Map(), value: hostEvidence };
  }
  const states = new Map();
  for (const host of expectedHosts) {
    const entry = hostEvidence?.hosts.find((item) => item.host === host);
    const sourceDirectory = inside(subject, 'evidence', host);
    const sourceDescriptor = inside(subject, 'evidence', host, 'capture.json');
    const logDirectory = inside(root, 'logs', 'hosts', host);
    const receiptPath = inside(root, 'evaluator', 'receipts', 'hosts', `${host}.json`);
    const sourceArtifactsPresent = fs.existsSync(sourceDirectory) &&
      fs.readdirSync(sourceDirectory).length > 0;
    const present = Boolean(entry) || sourceArtifactsPresent || fs.existsSync(sourceDescriptor) ||
      fs.existsSync(logDirectory) || fs.existsSync(receiptPath);
    if (!entry) {
      states.set(host, { host, status: present ? 'fail' : 'unverified' });
      continue;
    }
    try {
      requireExactWorkerFiles(root, sourceDirectory, scenarioId, contract);
      const prefix = `logs/hosts/${host}`;
      const expectedArtifacts = [
        { kind: 'capture-descriptor', path: `${prefix}/capture.json`, relative: 'capture.json' },
        { kind: 'inventory-1', path: `${prefix}/inventory-1-stdout.json`,
          relative: 'inventory-1.stdout.json' },
        { kind: 'inventory-2', path: `${prefix}/inventory-2-stdout.json`,
          relative: 'inventory-2.stdout.json' },
        { kind: 'raw-final', path: `${prefix}/worker-final.md`, relative: 'worker-final.md' },
        { kind: 'machine-report', path: `${prefix}/machine-report.json`,
          relative: 'machine-report.json' },
        { kind: 'command-trace', path: `${prefix}/command-trace.json`,
          relative: 'command-trace.json' },
        ...CHECKPOINT_FILES[scenarioId].map((fileName) => ({
          kind: `checkpoint:${fileName.slice(0, -'.json'.length)}`,
          path: `${prefix}/checkpoints/${fileName}`,
          relative: `checkpoints/${fileName}`,
        })),
      ];
      if (!exactKeys(entry,
        ['host', 'artifacts', 'bundleSha256', 'controllerSnapshot', 'receipt']) ||
          entry.host !== host || !Array.isArray(entry.artifacts) ||
          entry.artifacts.length !== expectedArtifacts.length ||
          !/^[0-9a-f]{64}$/.test(entry.bundleSha256) ||
          !exactKeys(entry.controllerSnapshot, ['path', 'sha256']) ||
          !exactKeys(entry.receipt, ['path', 'sha256'])) {
        throw new Error('Captured host entry is malformed.');
      }
      const buffers = new Map();
      for (const [index, expectedArtifact] of expectedArtifacts.entries()) {
        const artifact = entry.artifacts[index];
        if (!exactKeys(artifact, ['kind', 'path', 'sha256']) ||
            artifact.kind !== expectedArtifact.kind || artifact.path !== expectedArtifact.path ||
            !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
          throw new Error('Captured host artifact index is malformed.');
        }
        const bytes = readFile(root, artifact.path);
        if (bytes.length === 0 || sha256(bytes) !== artifact.sha256) {
          throw new Error('Captured host artifact is missing or hash-mismatched.');
        }
        buffers.set(expectedArtifact.relative, bytes);
      }
      const bundleSha256 = sha256(Buffer.from(JSON.stringify(entry.artifacts
        .map(({ kind, sha256: digest }) => ({ kind, sha256: digest })))));
      if (bundleSha256 !== entry.bundleSha256) throw new Error('Host bundle hash is invalid.');
      const descriptor = parseJsonBytes(buffers.get('capture.json'),
        'Captured descriptor is malformed.');
      if (!exactKeys(descriptor, contract.captureDescriptor.requiredFields) ||
          !boundIdentity(descriptor, scenarioId, host, contract.runId)) {
        throw new Error('Captured descriptor identity is invalid.');
      }
      const inventories = [1, 2].map((ordinal) => ({
        bytes: buffers.get(`inventory-${ordinal}.stdout.json`),
        ...validateInventoryArtifact(buffers.get(`inventory-${ordinal}.stdout.json`), subject,
          scenarioId, host, contract.runId, contract, ordinal),
      }));
      const report = validateMachineReport(parseJsonBytes(buffers.get('machine-report.json'),
        'Machine report must be valid UTF-8 JSON.'), scenarioId, host, contract.runId, contract);
      parseRawFinal(buffers.get('worker-final.md'), scenarioId, host, contract.runId, report);
      validateReportEvidence(root, subject, inside(subject, 'evidence', host), report, buffers,
        contract);
      const checkpointBuffers = new Map(CHECKPOINT_FILES[scenarioId].map((fileName) =>
        [`checkpoint:${fileName}`, buffers.get(`checkpoints/${fileName}`)]));
      const checkpoints = readWorkerCheckpoints(checkpointBuffers, scenarioId, host,
        contract.runId, contract);
      const trace = validateCommandTrace(parseJsonBytes(buffers.get('command-trace.json'),
        'Worker command trace must be valid UTF-8 JSON.'), scenarioId, host, contract.runId,
      checkpoints, inventories, contract);
      const snapshotBytes = readFile(root, entry.controllerSnapshot.path);
      if (snapshotBytes.length === 0 || sha256(snapshotBytes) !== entry.controllerSnapshot.sha256 ||
          !same(parseJsonBytes(snapshotBytes, 'Controller snapshot is malformed.'),
            snapshotTargets(subject))) {
        throw new Error('Controller snapshot is invalid.');
      }
      const receiptBytes = readFile(root, entry.receipt.path);
      if (receiptBytes.length === 0 || sha256(receiptBytes) !== entry.receipt.sha256) {
        throw new Error('Host receipt is invalid.');
      }
      const challenge = expectedChallenges.find((item) => item.host === host);
      const expectedReceipt = {
        schemaVersion: 1,
        scenarioId,
        host,
        runId: contract.runId,
        receiptId: challenge.receiptId,
        invocationId: challenge.invocationId,
        evaluatorNonce: challenge.nonce,
        requestSha256: challenges.requestSha256,
        evidenceContractSha256: challenges.evidenceContractSha256,
        artifacts: entry.artifacts,
        bundleSha256: entry.bundleSha256,
        controllerSnapshot: entry.controllerSnapshot,
      };
      if (!same(parseJsonBytes(receiptBytes, 'Host receipt is malformed.'), expectedReceipt)) {
        throw new Error('Host receipt is not controller-bound.');
      }
      const applyReceipts = [];
      if (scenarioId === 'apply') {
        const runChallenges = challenges.applyRuns.filter((item) => item.host === host)
          .sort((left, right) => left.ordinal - right.ordinal);
        let previousReceiptSha256 = null;
        for (const [index, runChallenge] of runChallenges.entries()) {
          const relativePath = `evaluator/receipts/apply/${host}/run-${index + 1}.json`;
          const bytes = readFile(root, relativePath);
          if (bytes.length === 0) throw new Error('APPLY receipt is missing.');
          const checkpoint = entry.artifacts.find((item) =>
            item.kind === `checkpoint:${CHECKPOINT_FILES.apply[index + 1].slice(0, -5)}`);
          const expectedRunReceipt = {
            schemaVersion: 1,
            scenarioId,
            host,
            runId: contract.runId,
            receiptId: runChallenge.receiptId,
            invocationId: runChallenge.invocationId,
            evaluatorNonce: runChallenge.nonce,
            requestSha256: challenges.requestSha256,
            ordinal: index + 1,
            previousReceiptSha256,
            rawFinal: entry.artifacts.find((item) => item.kind === 'raw-final'),
            inventories: entry.artifacts.filter((item) => item.kind.startsWith('inventory-')),
            checkpoint,
          };
          const receipt = parseJsonBytes(bytes, 'APPLY receipt is malformed.');
          if (!same(receipt, expectedRunReceipt)) throw new Error('APPLY receipt chain is invalid.');
          applyReceipts.push({ receipt, bytes });
          previousReceiptSha256 = sha256(bytes);
        }
      }
      states.set(host, { host, status: 'pass', entry, buffers, inventories, report, trace,
        checkpoints, applyReceipts });
    } catch {
      states.set(host, { host, status: 'fail' });
    }
  }
  const passing = [...states.values()].filter((state) => state.status === 'pass');
  if (passing.length > 1) {
    const digestSets = passing.map((state) => new Set(state.entry.artifacts
      .map((artifact) => artifact.sha256)));
    if (passing[0].entry.bundleSha256 === passing[1].entry.bundleSha256 ||
        [...digestSets[0]].some((digest) => digestSets[1].has(digest))) {
      for (const state of passing) state.status = 'fail';
    }
  }
  const status = [...states.values()].some((state) => state.status === 'fail') ? 'fail' :
    [...states.values()].some((state) => state.status === 'unverified') ? 'unverified' : 'pass';
  return { status, states, value: hostEvidence };
}

function hostEvidenceCheck(root, scenarioId, collected) {
  const evidenceState = collected || collectHostEvidence(root, scenarioId);
  return check('host_evidence', evidenceState.status, 'logs/host-evidence.json',
    evidenceState.value || { hosts: [] });
}

function noSentinelsCheck(root, expected) {
  return checked('secret_free_outputs', 'logs', () => {
    let pass = true;
    const forbidden = [...(expected.sentinels || []).map((sentinel) => Buffer.from(sentinel))];
    for (const privatePath of expected.privateBodyPaths || []) {
      const body = readFile(root, privatePath);
      const trimmed = Buffer.from(body.toString('utf8').trim());
      if (trimmed.length >= 8) forbidden.push(trimmed);
    }
    for (const directory of [inside(root, 'logs'), inside(root, 'subject', 'evidence')]) {
      walkFiles(root, directory, (filePath) => {
        const contents = fs.readFileSync(filePath);
        if (forbidden.some((sentinel) => contents.includes(sentinel))) pass = false;
      });
    }
    return { pass, value: { status: pass ? 'clear' : 'detected' } };
  }, 'fail');
}

function perHostCheck(id, relativePath, collected, operation) {
  const statuses = {};
  for (const [host, state] of collected.states) {
    if (state.status !== 'pass') {
      statuses[host] = state.status;
      continue;
    }
    try {
      statuses[host] = operation(state) ? 'pass' : 'fail';
    } catch {
      statuses[host] = 'fail';
    }
  }
  const status = Object.values(statuses).includes('fail') ? 'fail' :
    Object.values(statuses).includes('unverified') ? 'unverified' : 'pass';
  return check(id, status, relativePath, statuses);
}

function gradeAudit(root, expected) {
  const checks = [];
  const collected = collectHostEvidence(root, 'audit');
  checks.push(checked('targets_unchanged', 'subject', () => {
    const actual = snapshotTargets(inside(root, 'subject'));
    return { pass: same(actual, expected.initialSnapshot), value: actual };
  }, 'fail'));
  checks.push(perHostCheck('audit_checkpoint_semantics', 'logs/hosts', collected, (state) => {
    const snapshot = state.checkpoints[0].value.targetSnapshot;
    return state.checkpoints[0].value.id === 'audit-complete' &&
      same(snapshot, expected.initialSnapshot) &&
      same(snapshot, snapshotTargets(inside(root, 'subject')));
  }));
  checks.push(perHostCheck('manifests_deterministic', 'logs/hosts', collected, (state) =>
    same(normalizeManifest(state.inventories[0].manifest),
      normalizeManifest(state.inventories[1].manifest))));
  checks.push(perHostCheck('exact_source_states', 'logs/hosts', collected, (state) => {
    const states = state.inventories[0].manifest.sources.map((source) => ({
      logicalPath: source.logicalPath, host: source.host, loadState: source.loadState,
    }));
    return same(states, expected.expectedStates);
  }));
  checks.push(perHostCheck('inspector_invocations', 'logs/hosts', collected, (state) =>
    state.trace.invocations.slice(0, 2).every((entry, index) =>
      entry.kind === 'inventory' && entry.ordinal === index + 1 && entry.exitCode === 0)));
  checks.push(noSentinelsCheck(root, expected));
  checks.push(perHostCheck('unavailable_probe_disclosed', 'logs/hosts', collected, (state) =>
    state.report.verificationMatrix.some((entry) =>
      entry.claim === 'unsafe-runtime-probe' && entry.status === 'unverified')));
  checks.push(hostEvidenceCheck(root, 'audit', collected));
  checks.push(reportCheck(root, 'audit', checks, collected));
  return checks;
}

function hashAt(root, relativePath) {
  return sha256(readFile(root, relativePath));
}

function validRecoveryLeaf(name) {
  const match = RECOVERY_LEAF_PATTERN.exec(name);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`;
  const instant = new Date(iso);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === iso;
}

function discoverRecoveryLeaf(root) {
  const relativeRoot = 'subject/home/.skillquiver/backups/improve-agent-instructions';
  const backupDirectory = inside(root, relativeRoot);
  assertNoLinks(root, backupDirectory);
  const entries = fs.readdirSync(backupDirectory, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory() ||
      entries[0].isSymbolicLink() || !validRecoveryLeaf(entries[0].name)) {
    throw new Error('Changed runs require exactly one valid UTC recovery leaf.');
  }
  return `${relativeRoot}/${entries[0].name}`;
}

function representationMetadata(bytes) {
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

function validateRecovery(root, scenarioId, members, transactionStatuses, targetStatuses,
  expected) {
  const backupRoot = discoverRecoveryLeaf(root);
  const manifest = readJson(root, `${backupRoot}/manifest.json`);
  const restoration = readJson(root, `${backupRoot}/restoration.json`);
  const expectedTargets = new Map(members.map((member) => [member.targetPath, member]));
  const preparedTargets = new Map((expected.controller?.targets || [])
    .map((entry) => [entry.targetPath, entry]));
  let pass = exactKeys(manifest, ['schemaVersion', 'scenarioId', 'host', 'runId', 'entries']) &&
    manifest.schemaVersion === 1 && manifest.scenarioId === scenarioId &&
    manifest.host === 'both' && manifest.runId === expected.runId &&
    Array.isArray(manifest.entries) && manifest.entries.length === members.length &&
    new Set(manifest.entries.map((entry) => entry.targetPath)).size === members.length;
  const hashes = {};
  for (const entry of manifest.entries || []) {
    const member = expectedTargets.get(entry.targetPath);
    const requiredKeys = ['targetPath', 'transaction', 'existed', 'preimagePath', 'absent',
      'sha256', 'encoding', 'bom', 'lineEndings', 'permissions'];
    pass = pass && Boolean(member) && exactKeys(entry, requiredKeys) &&
      entry.transaction === member?.transaction && entry.existed === true &&
      entry.absent === false && typeof entry.preimagePath === 'string' &&
      !path.isAbsolute(entry.preimagePath) &&
      !entry.preimagePath.split(/[\\/]/).includes('..') &&
      validPermissionEvidence(entry.permissions);
    if (!member || typeof entry.preimagePath !== 'string') continue;
    const preimageRelative = `${backupRoot}/${portable(entry.preimagePath)}`;
    const preimagePath = inside(root, preimageRelative);
    if (!isInside(inside(root, backupRoot), preimagePath)) {
      pass = false;
      continue;
    }
    const preimage = readFile(root, preimageRelative);
    const evaluator = readFile(root, member.evaluatorPath);
    const prepared = preparedTargets.get(entry.targetPath);
    const metadata = representationMetadata(evaluator);
    hashes[entry.targetPath] = sha256(preimage);
    pass = pass && preimage.equals(evaluator) && entry.sha256 === sha256(evaluator) &&
      prepared && entry.sha256 === prepared.sha256 &&
      entry.encoding === metadata.encoding && entry.bom === metadata.bom &&
      entry.lineEndings === metadata.lineEndings &&
      same(entry.permissions, prepared.permissions);
    const finalTarget = inside(root, 'subject', ...entry.targetPath.split('/'));
    const finalPermissions = permissionEvidence(finalTarget);
    for (const property of ['mode', 'owner']) {
      if (prepared?.permissions[property].status === 'verified') {
        pass = pass && same(finalPermissions[property], prepared.permissions[property]);
      }
    }
  }
  const transactionEntries = Object.entries(transactionStatuses)
    .map(([id, status]) => ({ id, status }));
  const targetEntries = Object.entries(targetStatuses)
    .map(([targetPath, value]) => ({ path: targetPath, ...value }));
  pass = pass && exactKeys(restoration,
    ['schemaVersion', 'scenarioId', 'host', 'runId', 'transactions', 'targets']) &&
    restoration.schemaVersion === 1 && restoration.scenarioId === scenarioId &&
    restoration.host === 'both' && restoration.runId === expected.runId &&
    Array.isArray(restoration.transactions) &&
    Array.isArray(restoration.targets) &&
    restoration.transactions.every((entry) => exactKeys(entry, ['id', 'status'])) &&
    restoration.targets.every((entry) => exactKeys(entry, ['path', 'transaction', 'status'])) &&
    new Set(restoration.transactions.map((entry) => entry.id)).size ===
      restoration.transactions.length &&
    new Set(restoration.targets.map((entry) => entry.path)).size === restoration.targets.length &&
    same(restoration.transactions, transactionEntries) && same(restoration.targets, targetEntries);
  return { pass, backupRoot, hashes, manifest, restoration };
}

function recoveryCheckpointMatches(root, scenarioId, state, expected, members) {
  const index = scenarioId === 'apply' ? 0 : 1;
  const checkpoint = state.checkpoints[index].value;
  const recovery = checkpoint.recovery;
  const backupRoot = discoverRecoveryLeaf(root);
  if (recovery.leaf !== path.basename(backupRoot) ||
      recovery.manifestPath !== `${backupRoot}/manifest.json` ||
      recovery.restorationPath !== `${backupRoot}/restoration.json` ||
      recovery.manifestSha256 !== hashAt(root, recovery.manifestPath) ||
      recovery.restorationSha256 !== hashAt(root, recovery.restorationPath)) return false;
  const manifest = readJson(root, recovery.manifestPath);
  const prepared = new Map(expected.controller.targets.map((item) => [item.targetPath, item]));
  if (recovery.members.length !== members.length ||
      !same(recovery.members.map((item) => item.targetPath),
        members.map((item) => item.targetPath))) return false;
  for (const member of recovery.members) {
    const original = prepared.get(member.targetPath);
    const entry = manifest.entries.find((item) => item.targetPath === member.targetPath);
    if (!original || !entry || member.existed !== original.existed ||
        member.originalSha256 !== original.sha256 ||
        !same(member.permissions, original.permissions) ||
        member.preimagePath !== `${backupRoot}/${portable(entry.preimagePath)}` ||
        member.preimageSha256 !== hashAt(root, member.preimagePath) ||
        member.preimageSha256 !== original.sha256 ||
        checkpoint.targetSnapshot[member.targetPath]?.sha256 !== original.sha256) return false;
  }
  const prewriteCheckpoint = checkpoint.prewriteTargets ? checkpoint :
    state.checkpoints.find((item) => item.value.prewriteTargets)?.value;
  const prewriteTargets = prewriteCheckpoint?.prewriteTargets;
  if (!Array.isArray(prewriteTargets) || prewriteTargets.length !== members.length ||
      new Set(prewriteTargets.map((item) => item.targetPath)).size !== members.length) return false;
  for (const target of prewriteTargets) {
    const original = prepared.get(target.targetPath);
    if (!original || target.existed !== original.existed ||
        target.originalSha256 !== original.sha256 ||
        !same(target.permissions, original.permissions) ||
        prewriteCheckpoint.targetSnapshot[target.targetPath]?.sha256 !== target.currentSha256) {
      return false;
    }
    if (scenarioId === 'apply' && target.currentSha256 !== original.sha256) return false;
    if (scenarioId === 'partial') {
      const expectedCurrent = target.targetPath === 'home/.claude/CLAUDE.md' ?
        expected.hashes.claudeConcurrent : original.sha256;
      if (target.currentSha256 !== expectedCurrent) return false;
    }
  }
  return true;
}

function gradeApply(root, expected) {
  const checks = [];
  const collected = collectHostEvidence(root, 'apply');
  const recoveryMembers = [
    { targetPath: 'home/.codex/AGENTS.md', transaction: 'codex-global',
      evaluatorPath: 'evaluator/preimages/apply/codex-AGENTS.md' },
    { targetPath: 'home/.claude/CLAUDE.md', transaction: 'claude-global',
      evaluatorPath: 'evaluator/preimages/apply/claude-CLAUDE.md' },
    { targetPath: 'repo/AGENTS.md', transaction: 'project-shared',
      evaluatorPath: 'evaluator/preimages/apply/repo-AGENTS.md' },
    { targetPath: 'repo/CLAUDE.md', transaction: 'project-shared',
      evaluatorPath: 'evaluator/preimages/apply/repo-CLAUDE.md' },
  ];
  const transactionStatuses = {
    'codex-global': 'applied',
    'claude-global': 'applied',
    'project-shared': 'applied',
  };
  const targetStatuses = Object.fromEntries(recoveryMembers.map((member) =>
    [member.targetPath, { transaction: member.transaction, status: 'applied' }]));
  checks.push(checked('backup_outside_repository',
    'subject/home/.skillquiver/backups/improve-agent-instructions', () => {
    const backupRoot = discoverRecoveryLeaf(root);
    const repository = fs.realpathSync.native(inside(root, 'subject/repo'));
    const backup = fs.realpathSync.native(inside(root, backupRoot));
    return { pass: !isInside(repository, backup), value: backup };
  }, 'fail'));
  checks.push(checked('backup_preimages',
    'subject/home/.skillquiver/backups/improve-agent-instructions', () => {
    const recovery = validateRecovery(root, 'apply', recoveryMembers,
      transactionStatuses, targetStatuses, expected);
    const hostRecovery = [...collected.states.values()]
      .filter((state) => state.status !== 'unverified')
      .every((state) => state.status === 'pass' &&
        recoveryCheckpointMatches(root, 'apply', state, expected, recoveryMembers));
    return { pass: recovery.pass && hostRecovery, value: recovery.hashes };
  }, 'fail'));
  checks.push(checked('global_guidance', 'subject/home', () => {
    const codex = hashAt(root, 'subject/home/.codex/AGENTS.md');
    const claude = hashAt(root, 'subject/home/.claude/CLAUDE.md');
    return { pass: codex === expected.hashes.codexGlobal && claude === expected.hashes.claudeGlobal,
      value: { codex, claude } };
  }, 'fail'));
  checks.push(checked('canonical_project_guidance', 'subject/repo/AGENTS.md', () => {
    const agents = readFile(root, 'subject/repo/AGENTS.md');
    return { pass: sha256(agents) === expected.hashes.agentsAfter, value: agents };
  }, 'fail'));
  checks.push(checked('dirty_guidance_preserved', 'subject/repo/AGENTS.md', () => {
    const agents = readFile(root, 'subject/repo/AGENTS.md');
    return { pass: agents.includes(Buffer.from('Keep dirty dependency guidance.')), value: agents };
  }, 'fail'));
  checks.push(checked('single_claude_import_and_delta', 'subject/repo/CLAUDE.md', () => {
    const claude = readFile(root, 'subject/repo/CLAUDE.md');
    const text = claude.toString('utf8');
    const importCount = text.split('@AGENTS.md').length - 1;
    const pass = sha256(claude) === expected.hashes.claudeAfter && importCount === 1 &&
      text.includes('Claude-only: use /context.');
    return { pass, value: claude };
  }, 'fail'));
  checks.push(checked('private_local_unchanged', 'subject/repo/CLAUDE.local.md', () => {
    const bytes = readFile(root, 'subject/repo/CLAUDE.local.md');
    return { pass: sha256(bytes) === expected.hashes.privateLocal, value: bytes };
  }, 'fail'));
  checks.push(checked('representation_preserved', 'subject/repo/AGENTS.md', () => {
    const bytes = readFile(root, 'subject/repo/AGENTS.md');
    const text = bytes.subarray(UTF8_BOM.length).toString('utf8');
    const pass = bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM) &&
      !text.replaceAll('\r\n', '').includes('\n');
    return { pass, value: bytes };
  }, 'fail'));
  checks.push(perHostCheck('verified_repository_facts', 'logs/hosts', collected, (state) => {
    const facts = state.trace.facts || [];
    const packageManager = facts.find((fact) => fact.id === 'package-manager');
    const executable = facts.find((fact) => fact.id === 'pnpm-version');
    const packageJson = readJson(root, 'subject/repo/package.json');
    const controller = expected.controller;
    const publicPath = inside(root, controller.executable.publicPath);
    const privatePath = inside(root, controller.executable.privatePath);
    const publicBytes = fs.readFileSync(publicPath);
    const privateBytes = fs.readFileSync(privatePath);
    if (sha256(publicBytes) !== controller.executable.publicSha256 ||
        sha256(privateBytes) !== controller.executable.sha256 ||
        controller.executable.publicSha256 !== controller.executable.sha256) return false;
    const subject = inside(root, 'subject');
    const shim = childProcess.spawnSync(process.execPath, [privatePath, '--version'], {
      cwd: inside(subject, 'repo'), encoding: 'utf8', shell: false, windowsHide: true,
      env: sanitizedEnvironment(root),
    });
    const repositoryCommands = [
      { id: 'tracked-path', args: ['ls-files', '--error-unmatch', '--', 'AGENTS.md'],
        stdout: 'AGENTS.md\n' },
      { id: 'dirty-status', args: ['status', '--porcelain=v1', '--', 'AGENTS.md'],
        stdout: ' M AGENTS.md\n' },
      { id: 'committed-bytes', args: ['show', 'HEAD:AGENTS.md'],
        stdout: APPLY_AGENTS_COMMITTED.toString('utf8') },
    ];
    const repositoryObserved = Array.isArray(controller.repository.observations) &&
      controller.repository.observations.length === repositoryCommands.length &&
      controller.repository.observations.every((observation, index) =>
        same(observation, {
          id: repositoryCommands[index].id,
          argv: gitArguments(root, repositoryCommands[index].args),
          status: 0,
          stdout: repositoryCommands[index].stdout,
          stderr: '',
        }));
    return packageManager?.value === 'pnpm' &&
      packageManager.path === 'subject/repo/package.json' &&
      executable?.path === 'subject/tools/pnpm.cjs' && executable.value === '10.0.0' &&
      executable.exitCode === 0 && packageJson.packageManager === 'pnpm@10.0.0' &&
      shim.status === 0 && shim.stdout === '10.0.0\n' &&
      repositoryObserved &&
      controller.repository.trackedPath === 'AGENTS.md' &&
      controller.repository.tracked === true &&
      controller.repository.dirtyStatus === ' M AGENTS.md\n' &&
      controller.repository.committedSha256 === sha256(APPLY_AGENTS_COMMITTED) &&
      controller.repository.workingSha256 === expected.hashes.agentsBefore;
  }));
  checks.push(perHostCheck('second_run_idempotent', 'logs/hosts', collected, (state) => {
    const [recovery, first, second] = state.checkpoints.map((item) => item.value);
    const actual = snapshotTargets(inside(root, 'subject'));
    return recoveryCheckpointMatches(root, 'apply', state, expected, recoveryMembers) &&
      first.id === 'apply-02-pass-1' && first.ordinal === 2 &&
      first.transformationStatus === 'changed' &&
      second.id === 'apply-03-pass-2' && second.ordinal === 3 &&
      second.predecessorSha256 === sha256(state.checkpoints[1].bytes) &&
      second.transformationStatus === 'no-change' &&
      same(first.targetSnapshot, second.targetSnapshot) && same(second.targetSnapshot, actual) &&
      sha256(state.checkpoints[0].bytes) !== sha256(state.checkpoints[1].bytes) &&
      recovery.id === 'apply-01-recovery-complete' && state.applyReceipts.length === 2 &&
      state.applyReceipts[0].receipt.receiptId !== state.applyReceipts[1].receipt.receiptId &&
      state.applyReceipts[0].receipt.evaluatorNonce !==
        state.applyReceipts[1].receipt.evaluatorNonce;
  }));
  checks.push(noSentinelsCheck(root, expected));
  checks.push(hostEvidenceCheck(root, 'apply', collected));
  checks.push(reportCheck(root, 'apply', checks, collected));
  return checks;
}

function gradePartial(root, expected) {
  const checks = [];
  const collected = collectHostEvidence(root, 'partial');
  const recoveryMembers = [
    { targetPath: 'home/.codex/AGENTS.md', transaction: 'codex-global',
      evaluatorPath: 'evaluator/preimages/partial/codex-AGENTS.md' },
    { targetPath: 'home/.claude/CLAUDE.md', transaction: 'claude-global',
      evaluatorPath: 'evaluator/preimages/partial/claude-CLAUDE.md' },
    { targetPath: 'repo/AGENTS.md', transaction: 'project-shared',
      evaluatorPath: 'evaluator/preimages/partial/repo-AGENTS.md' },
    { targetPath: 'repo/CLAUDE.md', transaction: 'project-shared',
      evaluatorPath: 'evaluator/preimages/partial/repo-CLAUDE.md' },
  ];
  const transactionStatuses = {
    'codex-global': 'applied',
    'claude-global': 'concurrent-change',
    'project-shared': 'rolled-back',
    'nested-scope': 'blocked',
  };
  const targetStatuses = {
    'home/.codex/AGENTS.md': { transaction: 'codex-global', status: 'applied' },
    'home/.claude/CLAUDE.md': { transaction: 'claude-global', status: 'concurrent-change' },
    'repo/AGENTS.md': { transaction: 'project-shared', status: 'rolled-back' },
    'repo/CLAUDE.md': { transaction: 'project-shared', status: 'rolled-back' },
    'repo/packages/ambiguous/AGENTS.md': { transaction: 'nested-scope', status: 'blocked' },
  };
  checks.push(checked('backup_outside_repository',
    'subject/home/.skillquiver/backups/improve-agent-instructions', () => {
    const backupRoot = discoverRecoveryLeaf(root);
    const repository = fs.realpathSync.native(inside(root, 'subject/repo'));
    const backup = fs.realpathSync.native(inside(root, backupRoot));
    return { pass: !isInside(repository, backup), value: backup };
  }, 'fail'));
  checks.push(checked('safe_codex_change_retained', 'subject/home/.codex/AGENTS.md', () => {
    const bytes = readFile(root, 'subject/home/.codex/AGENTS.md');
    return { pass: sha256(bytes) === expected.hashes.codexAfter, value: bytes };
  }, 'fail'));
  checks.push(checked('concurrent_claude_preserved', 'subject/home/.claude/CLAUDE.md', () => {
    const bytes = readFile(root, 'subject/home/.claude/CLAUDE.md');
    return { pass: sha256(bytes) === expected.hashes.claudeConcurrent, value: bytes };
  }, 'fail'));
  checks.push(checked('project_pair_rolled_back', 'subject/repo', () => {
    const agents = hashAt(root, 'subject/repo/AGENTS.md');
    const claude = hashAt(root, 'subject/repo/CLAUDE.md');
    const recovery = validateRecovery(root, 'partial', recoveryMembers,
      transactionStatuses, targetStatuses, expected);
    const hostRecovery = [...collected.states.values()]
      .filter((state) => state.status !== 'unverified')
      .every((state) => state.status === 'pass' &&
        recoveryCheckpointMatches(root, 'partial', state, expected, recoveryMembers));
    const pass = recovery.pass && hostRecovery && agents === expected.hashes.projectAgents &&
      claude === expected.hashes.projectClaude;
    return { pass, value: { agents, claude, backupRoot: recovery.backupRoot,
      hashes: recovery.hashes } };
  }, 'fail'));
  checks.push(checked('nested_ambiguity_untouched',
    'subject/repo/packages/ambiguous/AGENTS.md', () => {
      const bytes = readFile(root, 'subject/repo/packages/ambiguous/AGENTS.md');
      return { pass: sha256(bytes) === expected.hashes.nested, value: bytes };
    }, 'fail'));
  checks.push(checked('restoration_statuses',
    'subject/home/.skillquiver/backups/improve-agent-instructions', () => {
    const recovery = validateRecovery(root, 'partial', recoveryMembers,
      transactionStatuses, targetStatuses, expected);
    return { pass: recovery.pass, value: recovery.restoration };
  }));
  checks.push(perHostCheck('control_sequence', 'logs/hosts', collected, (state) => {
    const checkpointBytes = state.checkpoints.map((item) => item.bytes);
    const checkpoints = state.checkpoints.map((item) => item.value);
    const [inventory, recovery, marker, prewrite, writes, verifierFailure,
      rollback, verifierSuccess] = checkpoints;
    let predecessorSha256 = null;
    let ordered = true;
    for (const [index, checkpoint] of checkpoints.entries()) {
      const expectedId = CHECKPOINT_FILES.partial[index].slice(0, -'.json'.length);
      ordered = ordered && boundIdentity(checkpoint, 'partial', state.host, expected.runId) &&
        checkpoint.id === expectedId &&
        checkpoint.ordinal === index + 1 && checkpoint.predecessorSha256 === predecessorSha256;
      predecessorSha256 = sha256(checkpointBytes[index]);
    }
    const markerControlPath = 'subject/controls/append-concurrent.cjs';
    const verifierControlPath = 'subject/controls/verify-project.cjs';
    const markerControlHash = hashAt(root, markerControlPath);
    const verifierControlHash = hashAt(root, verifierControlPath);
    const finalSnapshot = snapshotTargets(inside(root, 'subject'));
    const originalClaude = sha256(PARTIAL_CLAUDE_BEFORE);
    return ordered && inventory.planComplete === true &&
      same(inventory.targetSnapshot, expected.initialSnapshot) &&
      recoveryCheckpointMatches(root, 'partial', state, expected, recoveryMembers) &&
      markerControlHash === expected.controlHashes.marker &&
      verifierControlHash === expected.controlHashes.verifier &&
      marker.controlPath === markerControlPath && marker.controlSha256 === markerControlHash &&
      marker.exitCode === 0 && Array.isArray(prewrite.prewriteTargets) &&
      same(marker.targetSnapshot, prewrite.targetSnapshot) &&
      marker.targetSnapshot['home/.claude/CLAUDE.md']?.sha256 === expected.hashes.claudeConcurrent &&
      marker.targetSnapshot['home/.codex/AGENTS.md']?.sha256 === sha256(PARTIAL_CODEX_BEFORE) &&
      marker.targetSnapshot['repo/AGENTS.md']?.sha256 === expected.hashes.projectAgents &&
      marker.targetSnapshot['repo/CLAUDE.md']?.sha256 === expected.hashes.projectClaude &&
      writes.independentWritesComplete === true &&
      writes.targetSnapshot['home/.codex/AGENTS.md']?.sha256 === expected.hashes.codexAfter &&
      writes.targetSnapshot['home/.claude/CLAUDE.md']?.sha256 === expected.hashes.claudeConcurrent &&
      writes.targetSnapshot['repo/AGENTS.md']?.sha256 !== expected.hashes.projectAgents &&
      writes.targetSnapshot['repo/CLAUDE.md']?.sha256 !== expected.hashes.projectClaude &&
      writes.targetSnapshot['repo/packages/ambiguous/AGENTS.md']?.sha256 === expected.hashes.nested &&
      same(verifierFailure.targetSnapshot, writes.targetSnapshot) &&
      verifierFailure.controlPath === verifierControlPath &&
      verifierFailure.controlSha256 === verifierControlHash &&
      verifierFailure.exitCode === 1 && verifierFailure.stdout === 'status=fail\n' &&
      rollback.rolledBackTransaction === 'project-shared' &&
      rollback.targetSnapshot['repo/AGENTS.md']?.sha256 === expected.hashes.projectAgents &&
      rollback.targetSnapshot['repo/CLAUDE.md']?.sha256 === expected.hashes.projectClaude &&
      rollback.targetSnapshot['repo/packages/ambiguous/AGENTS.md']?.sha256 === expected.hashes.nested &&
      verifierSuccess.controlPath === verifierControlPath &&
      verifierSuccess.controlSha256 === verifierControlHash && verifierSuccess.exitCode === 0 &&
      verifierSuccess.stdout === 'status=pass\n' &&
      same(verifierSuccess.targetSnapshot, rollback.targetSnapshot) &&
      same(verifierSuccess.targetSnapshot, finalSnapshot) &&
      inventory.targetSnapshot['home/.claude/CLAUDE.md']?.sha256 === originalClaude;
  }));
  checks.push(noSentinelsCheck(root, expected));
  checks.push(hostEvidenceCheck(root, 'partial', collected));
  checks.push(reportCheck(root, 'partial', checks, collected));
  return checks;
}

function gradeScenario(scenarioId, runRoot) {
  if (!SCENARIOS.has(scenarioId)) throw new Error('Unknown forward-evaluation scenario.');
  const root = resolvePhysicalRoot(runRoot, false);
  const subject = inside(root, 'subject');
  const evaluator = inside(root, 'evaluator');
  const logs = inside(root, 'logs');
  for (const required of [subject, evaluator, logs]) {
    assertNoLinks(root, required);
    if (!fs.statSync(required).isDirectory()) throw new Error('Fixture layout is incomplete.');
  }
  const expected = readJson(root, 'evaluator/expected.json');
  const contract = readJson(root, 'subject/controls/evidence-contract.json');
  if (expected.schemaVersion !== 1 || expected.scenarioId !== scenarioId ||
      expected.runId !== contract.runId) {
    throw new Error('Fixture expectation does not match the scenario.');
  }
  const checks = scenarioId === 'audit' ? gradeAudit(root, expected)
    : scenarioId === 'apply' ? gradeApply(root, expected) : gradePartial(root, expected);
  const outcome = checks.some((item) => item.status === 'fail') ? 'fail'
    : checks.some((item) => item.status === 'unverified') ? 'unverified' : 'pass';
  return { schemaVersion: 1, scenarioId, outcome, checks };
}

function runCli(argv, io = process) {
  const output = io.stdout || process.stdout;
  const errors = io.stderr || process.stderr;
  const command = Array.isArray(argv) ? argv[0] : null;
  const validLength = command === 'capture' ? argv.length === 4 : argv.length === 3;
  if (!Array.isArray(argv) || !validLength || !['prepare', 'capture', 'grade'].includes(command) ||
      !SCENARIOS.has(argv[1])) {
    errors.write('Usage: forward.cjs <prepare|grade> <audit|apply|partial> <run-root>\n' +
      '   or: forward.cjs capture <audit|apply|partial> <run-root> <capture.json>\n');
    return 2;
  }
  try {
    if (argv[0] === 'prepare') {
      const prepared = prepareFixture(argv[1], argv[2]);
      output.write(`${JSON.stringify({ schemaVersion: 1, scenarioId: prepared.scenarioId,
        runId: prepared.runId, status: prepared.status, path: prepared.subjectRoot }, null, 2)}\n`);
    } else if (argv[0] === 'capture') {
      output.write(`${JSON.stringify(captureEvidence(argv[1], argv[2], argv[3]), null, 2)}\n`);
    } else {
      output.write(`${JSON.stringify(gradeScenario(argv[1], argv[2]), null, 2)}\n`);
    }
    return 0;
  } catch {
    errors.write('Forward evaluation failed.\n');
    return 1;
  }
}

module.exports = { captureEvidence, prepareFixture, snapshotTargets, gradeScenario, runCli };

if (require.main === module) process.exitCode = runCli(process.argv.slice(2), process);
