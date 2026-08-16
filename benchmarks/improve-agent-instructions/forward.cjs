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

function commonPrompt(scenarioId, subject) {
  const project = inside(subject, 'repo');
  const cwd = scenarioId === 'audit' ? inside(subject, 'repo', 'packages', 'api') : project;
  const home = inside(subject, 'home');
  const codexHome = inside(subject, 'home', '.codex');
  const claudeHome = inside(subject, 'home', '.claude');
  const managed = inside(subject, 'managed', 'claude');
  const evidenceRoot = inside(subject, 'evidence');
  const skillRoot = path.resolve(__dirname, '..', '..', 'skills',
    'improve-agent-instructions');
  const inventory = path.join(skillRoot, 'scripts', 'inventory.mjs');
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
    'Run this read-only inventory command twice with the exact explicit arguments before reporting:',
    `node ${inventory} --host both --cwd ${cwd} --project ${project} --home ${home} ` +
      `--codex-home ${codexHome} --claude-home ${claudeHome} --claude-managed-dir ${managed}`,
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

function publicEvidenceContract() {
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
    };
  }
  return {
    schemaVersion: 1,
    evidenceRoot: 'subject/evidence',
    captureInput: {
      requiredFields: ['schemaVersion', 'scenarioId', 'host', 'rawFinalPath',
        'inventoryPaths'],
      hosts: ['codex', 'claude'],
      inventoryCount: 2,
      inventorySchemaVersion: 1,
    },
    workerArtifacts: {
      machineReport: {
        path: 'machine-report.json',
        schemaVersion: 1,
        requiredFields: ['schemaVersion', 'scenarioId', 'targetMatrix',
          'effectiveChain', 'decisionLedger', 'changesAndRecovery',
          'verificationMatrix', 'pendingQuestions'],
        scenarios: machineReports,
        allowedEvidenceShapes: [
          { requiredFields: ['path', 'sha256'], additionalFields: false },
          { arrayItems: { requiredFields: ['path', 'sha256'], additionalFields: false } },
        ],
      },
      commandTrace: {
        path: 'command-trace.json',
        requiredFields: ['schemaVersion', 'scenarioId', 'invocations', 'checkpoints'],
      },
      checkpoints: CHECKPOINT_FILES,
    },
    recovery: {
      leafFormat: 'yyyyMMddTHHmmssSSSZ',
      manifest: {
        path: 'manifest.json',
        schemaVersion: 1,
        entryFields: ['targetPath', 'transaction', 'existed', 'preimagePath',
          'absent', 'sha256', 'encoding', 'bom', 'lineEndings', 'permissions'],
      },
      restoration: {
        path: 'restoration.json',
        schemaVersion: 1,
        requiredFields: ['transactions', 'targets'],
      },
    },
  };
}

function baseFixture(root, scenarioId) {
  const directories = [
    'subject/home/.codex', 'subject/home/.claude', 'subject/repo', 'subject/controls',
    'subject/xdg/config', 'subject/xdg/state', 'subject/xdg/cache',
    'subject/appdata/roaming', 'subject/appdata/local', 'subject/tools',
    'subject/managed/claude', 'subject/evidence',
    'evaluator/preimages', 'logs',
  ];
  for (const relative of directories) fs.mkdirSync(inside(root, relative), { recursive: true });
  writeFile(root, 'subject/controls/gitconfig', '[user]\n\tname = Fixture User\n');
  writeFile(root, 'subject/tools/pnpm.cjs', "'use strict';\nprocess.stdout.write('10.0.0\\n');\n");
  writeJson(root, 'subject/controls/evidence-contract.json', publicEvidenceContract());
  const subject = inside(root, 'subject');
  writeFile(root, 'logs/prompt.md', commonPrompt(scenarioId, subject));
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
  const result = childProcess.spawnSync('git', args, {
    cwd: inside(subject, 'repo'),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      HOME: inside(subject, 'home'),
      USERPROFILE: inside(subject, 'home'),
      GIT_CONFIG_GLOBAL: inside(subject, 'controls', 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  if (result.status !== 0) throw new Error('Isolated fixture Git command failed.');
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
  baseFixture(root, scenarioId);
  const scenario = scenarioId === 'audit' ? prepareAudit(root)
    : scenarioId === 'apply' ? prepareApply(root) : preparePartial(root);
  initializeRepository(root, scenarioId);
  writeJson(root, 'evaluator/expected.json', { schemaVersion: 1, scenarioId, ...scenario });
  const challenge = (receiptId, invocationId) => ({
    receiptId,
    invocationId,
    nonce: crypto.randomBytes(32).toString('hex'),
  });
  writeJson(root, 'evaluator/capture-challenges.json', {
    schemaVersion: 1,
    scenarioId,
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
  return { schemaVersion: 1, scenarioId, status: 'prepared', subjectRoot: inside(root, 'subject') };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
  return normalized;
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

function validateInventoryBytes(bytes, subject) {
  const manifest = parseJsonBytes(bytes, 'Inventory stdout must be valid UTF-8 JSON.');
  const roots = manifest.roots;
  const expectedRoots = {
    home: inside(subject, 'home'),
    project: inside(subject, 'repo'),
    codexHome: inside(subject, 'home', '.codex'),
    claudeHome: inside(subject, 'home', '.claude'),
    claudeManaged: inside(subject, 'managed', 'claude'),
  };
  const rootMatches = roots && Object.entries(expectedRoots).every(([id, expected]) =>
    roots[id] && roots[id].logicalPath === expected);
  if (manifest.schemaVersion !== 1 || manifest.run?.host !== 'both' || !rootMatches ||
      !roots.cwd || !isInside(inside(subject, 'repo'), roots.cwd.logicalPath) ||
      !Array.isArray(manifest.sources) || !manifest.chains ||
      !Array.isArray(manifest.warnings)) {
    throw new Error('Inventory stdout must use schema version 1 and the isolated roots.');
  }
  return manifest;
}

function validEvidenceShape(value) {
  const validItem = (item) => exactKeys(item, ['path', 'sha256']) &&
    typeof item.path === 'string' && item.path.length > 0 && !path.isAbsolute(item.path) &&
    !item.path.split(/[\\/]/).includes('..') && /^[0-9a-f]{64}$/.test(item.sha256);
  return Array.isArray(value) ? value.length > 0 && value.every(validItem) : validItem(value);
}

function validateMachineReport(report, scenarioId, contract) {
  const requiredTop = contract.workerArtifacts.machineReport.requiredFields;
  if (!exactKeys(report, requiredTop) || report.schemaVersion !== 1 ||
      report.scenarioId !== scenarioId) throw new Error('Machine report schema is invalid.');
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
    }
  }
}

function validateCommandTrace(trace, scenarioId, checkpoints) {
  if (!exactKeys(trace, trace.facts === undefined ?
    ['schemaVersion', 'scenarioId', 'invocations', 'checkpoints'] :
    ['schemaVersion', 'scenarioId', 'invocations', 'checkpoints', 'facts']) ||
      trace.schemaVersion !== 1 || trace.scenarioId !== scenarioId ||
      !Array.isArray(trace.invocations) || trace.invocations.length === 0 ||
      !Array.isArray(trace.checkpoints) || !same(trace.checkpoints,
        checkpoints.map((item) => ({
          id: item.value.id,
          ordinal: item.value.ordinal,
          path: `checkpoints/${item.fileName}`,
          sha256: sha256(item.bytes),
        })))) throw new Error('Worker command trace is malformed or hash-mismatched.');
  const ordinals = trace.invocations.map((item) => item.ordinal);
  if (new Set(trace.invocations.map((item) => item.id)).size !== trace.invocations.length ||
      !ordinals.every((ordinal, index) => ordinal === index + 1)) {
    throw new Error('Worker command trace is replayed or reordered.');
  }
}

function readWorkerCheckpoints(root, artifactRoot, scenarioId) {
  let predecessorSha256 = null;
  const checkpoints = [];
  for (const [index, fileName] of CHECKPOINT_FILES[scenarioId].entries()) {
    const checkpointPath = inside(artifactRoot, 'checkpoints', fileName);
    assertNoLinks(root, checkpointPath);
    const bytes = fs.readFileSync(checkpointPath);
    const value = parseJsonBytes(bytes, 'Worker checkpoint must be valid UTF-8 JSON.');
    const id = fileName.slice(0, -'.json'.length);
    if (value.schemaVersion !== 1 || value.scenarioId !== scenarioId || value.id !== id ||
        value.ordinal !== index + 1 || value.predecessorSha256 !== predecessorSha256) {
      throw new Error('Worker checkpoints are missing, replayed, reordered, or hash-mismatched.');
    }
    checkpoints.push({ fileName, path: checkpointPath, bytes, value });
    predecessorSha256 = sha256(bytes);
  }
  if (new Set(checkpoints.map((item) => sha256(item.bytes))).size !== checkpoints.length) {
    throw new Error('Worker checkpoints are replayed.');
  }
  return checkpoints;
}

function copyArtifact(root, sourcePath, relativeDestination, kind) {
  const bytes = fs.readFileSync(sourcePath);
  writeFile(root, relativeDestination, bytes);
  return { kind, path: portable(relativeDestination), sha256: sha256(bytes) };
}

function captureEvidence(scenarioId, runRoot, captureInput) {
  if (!SCENARIOS.has(scenarioId)) throw new Error('Unknown forward-evaluation scenario.');
  const root = resolvePhysicalRoot(runRoot, false);
  const subject = inside(root, 'subject');
  const evidenceRoot = inside(subject, 'evidence');
  const descriptor = typeof captureInput === 'string'
    ? readJson(root, portable(path.relative(root,
      captureInputPath(root, evidenceRoot, captureInput))))
    : captureInput;
  if (!exactKeys(descriptor, ['schemaVersion', 'scenarioId', 'host', 'rawFinalPath',
    'inventoryPaths']) || descriptor.schemaVersion !== 1 || descriptor.scenarioId !== scenarioId ||
      !['codex', 'claude'].includes(descriptor.host) ||
      !Array.isArray(descriptor.inventoryPaths) || descriptor.inventoryPaths.length !== 2) {
    throw new Error('Capture descriptor is invalid.');
  }
  const host = descriptor.host;
  const artifactRoot = inside(evidenceRoot, host);
  const rawFinalPath = captureInputPath(root, artifactRoot, descriptor.rawFinalPath);
  const inventoryPaths = descriptor.inventoryPaths.map((item) =>
    captureInputPath(root, artifactRoot, item));
  const rawFinalBytes = fs.readFileSync(rawFinalPath);
  const rawFinalText = (() => {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(rawFinalBytes);
    } catch {
      throw new Error('Worker final bytes must be valid UTF-8.');
    }
  })();
  if (rawFinalBytes.length === 0 || rawFinalText.includes('\0')) {
    throw new Error('Worker final bytes are missing or malformed.');
  }
  const inventoryBytes = inventoryPaths.map((item) => fs.readFileSync(item));
  for (const bytes of inventoryBytes) validateInventoryBytes(bytes, subject);
  const contractPath = inside(subject, 'controls', 'evidence-contract.json');
  const contractBytes = fs.readFileSync(contractPath);
  const contract = parseJsonBytes(contractBytes, 'Public evidence contract is invalid.');
  const challenges = readJson(root, 'evaluator/capture-challenges.json');
  if (contract.schemaVersion !== 1 || challenges.evidenceContractSha256 !== sha256(contractBytes)) {
    throw new Error('Public evidence contract does not match preparation.');
  }
  const machineReportPath = inside(artifactRoot,
    contract.workerArtifacts.machineReport.path);
  const commandTracePath = inside(artifactRoot,
    contract.workerArtifacts.commandTrace.path);
  for (const artifact of [machineReportPath, commandTracePath]) assertNoLinks(root, artifact);
  const machineReportBytes = fs.readFileSync(machineReportPath);
  const commandTraceBytes = fs.readFileSync(commandTracePath);
  validateMachineReport(parseJsonBytes(machineReportBytes,
    'Machine report must be valid UTF-8 JSON.'), scenarioId, contract);
  const checkpoints = readWorkerCheckpoints(root, artifactRoot, scenarioId);
  validateCommandTrace(parseJsonBytes(commandTraceBytes,
    'Worker command trace must be valid UTF-8 JSON.'), scenarioId, checkpoints);

  const hostIndexPath = inside(root, 'logs', 'host-evidence.json');
  const hostIndex = fs.existsSync(hostIndexPath) ? readJson(root, 'logs/host-evidence.json') :
    { schemaVersion: 1, scenarioId, hosts: [] };
  if (hostIndex.schemaVersion !== 1 || hostIndex.scenarioId !== scenarioId ||
      !Array.isArray(hostIndex.hosts) || hostIndex.hosts.some((item) => item.host === host)) {
    throw new Error('Host evidence is already captured or malformed.');
  }

  const prefix = `logs/hosts/${host}`;
  const artifacts = [
    copyArtifact(root, inventoryPaths[0], `${prefix}/inventory-1-stdout.json`, 'inventory-1'),
    copyArtifact(root, inventoryPaths[1], `${prefix}/inventory-2-stdout.json`, 'inventory-2'),
    copyArtifact(root, rawFinalPath, `${prefix}/worker-final.md`, 'raw-final'),
    copyArtifact(root, machineReportPath, `${prefix}/machine-report.json`, 'machine-report'),
    copyArtifact(root, commandTracePath, `${prefix}/command-trace.json`, 'command-trace'),
    ...checkpoints.map((item) => copyArtifact(root, item.path,
      `${prefix}/checkpoints/${item.fileName}`, `checkpoint:${item.value.id}`)),
  ];
  const snapshotPath = `logs/controller/${host}-target-snapshot.json`;
  writeJson(root, snapshotPath, snapshotTargets(subject));
  const controllerSnapshot = { path: snapshotPath, sha256: hashAt(root, snapshotPath) };
  const challenge = challenges.hosts.find((item) => item.host === host);
  const receiptPath = `evaluator/receipts/hosts/${host}.json`;
  const receipt = {
    schemaVersion: 1,
    scenarioId,
    host,
    receiptId: challenge.receiptId,
    invocationId: challenge.invocationId,
    evaluatorNonce: challenge.nonce,
    requestSha256: challenges.requestSha256,
    evidenceContractSha256: challenges.evidenceContractSha256,
    artifacts,
    controllerSnapshot,
  };
  writeJson(root, receiptPath, receipt);
  const entry = {
    host,
    artifacts,
    controllerSnapshot,
    receipt: { path: receiptPath, sha256: hashAt(root, receiptPath) },
  };
  hostIndex.hosts.push(entry);
  hostIndex.hosts.sort((left, right) => left.host < right.host ? -1 : 1);
  writeJson(root, 'logs/host-evidence.json', hostIndex);

  if (!fs.existsSync(inside(root, 'logs', 'report.json'))) {
    writeFile(root, 'logs/report.json', machineReportBytes);
    writeFile(root, 'logs/manifest-1.json', inventoryBytes[0]);
    writeFile(root, 'logs/manifest-2.json', inventoryBytes[1]);
    writeFile(root, 'logs/command-trace.json', commandTraceBytes);
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
        item.kind === `checkpoint:${CHECKPOINT_FILES.apply[index].slice(0, -5)}`);
      const runReceiptPath = `evaluator/receipts/apply/${host}/run-${index + 1}.json`;
      writeJson(root, runReceiptPath, {
        schemaVersion: 1,
        scenarioId,
        host,
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
  return { schemaVersion: 1, scenarioId, host, status: 'captured' };
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

function reportCheck(root, scenarioId, gradedChecks) {
  return checked('report_complete', 'logs/report.json', () => {
    const report = readJson(root, 'logs/report.json');
    const publicContract = readJson(root, 'subject/controls/evidence-contract.json');
    validateMachineReport(report, scenarioId, publicContract);
    const contract = reportContract(scenarioId);
    const unique = (items, key) => Array.isArray(items) &&
      new Set(items.map((item) => item[key])).size === items.length;
    const checksById = new Map(gradedChecks.map((item) => [item.id, item.status]));
    const claims = new Map((report.verificationMatrix || [])
      .map((item) => [item.claim, item.status]));
    const consistency = {
      audit: [
        ['targets-unchanged', 'targets_unchanged', 'pass', 'verified'],
        ['manifests-deterministic', 'manifests_deterministic', 'pass', 'verified'],
        ['source-states', 'exact_source_states', 'pass', 'verified'],
        ['inspector-invocations', 'inspector_invocations', 'pass', 'verified'],
        ['secret-free', 'secret_free_outputs', 'pass', 'verified'],
        ['unsafe-runtime-probe', 'unavailable_probe_disclosed', 'pass', 'unverified'],
        ['host-primary-evidence', 'host_evidence', 'pass', 'verified'],
      ],
      apply: [
        ['backup-location', 'backup_outside_repository', 'pass', 'verified'],
        ['backup-preimages', 'backup_preimages', 'pass', 'verified'],
        ['global-guidance', 'global_guidance', 'pass', 'verified'],
        ['canonical-project', 'canonical_project_guidance', 'pass', 'verified'],
        ['dirty-guidance', 'dirty_guidance_preserved', 'pass', 'verified'],
        ['claude-import', 'single_claude_import_and_delta', 'pass', 'verified'],
        ['private-local', 'private_local_unchanged', 'pass', 'verified'],
        ['representation', 'representation_preserved', 'pass', 'verified'],
        ['repository-facts', 'verified_repository_facts', 'pass', 'verified'],
        ['idempotence', 'second_run_idempotent', 'pass', 'verified'],
        ['secret-free', 'secret_free_outputs', 'pass', 'verified'],
        ['host-primary-evidence', 'host_evidence', 'pass', 'verified'],
      ],
      partial: [
        ['backup-location', 'backup_outside_repository', 'pass', 'verified'],
        ['codex-global', 'safe_codex_change_retained', 'pass', 'verified'],
        ['claude-concurrent', 'concurrent_claude_preserved', 'pass', 'verified'],
        ['project-rollback', 'project_pair_rolled_back', 'pass', 'verified'],
        ['nested-ambiguity', 'nested_ambiguity_untouched', 'pass', 'blocked'],
        ['restoration', 'restoration_statuses', 'pass', 'verified'],
        ['control-sequence', 'control_sequence', 'pass', 'verified'],
        ['host-primary-evidence', 'host_evidence', 'pass', 'verified'],
      ],
    };
    for (const [claim, checkId] of consistency[scenarioId]) {
      if (checksById.get(checkId) === 'unverified' && claim !== 'host-primary-evidence') {
        contract.verificationMatrix.find((item) => item.claim === claim).status = 'unverified';
      }
    }
    const expected = { schemaVersion: 1, scenarioId, ...contract };
    const semanticReport = structuredClone(report);
    const evidenceCollections = [semanticReport.targetMatrix, semanticReport.effectiveChain,
      semanticReport.decisionLedger, semanticReport.changesAndRecovery.transactions,
      semanticReport.verificationMatrix, semanticReport.pendingQuestions];
    for (const entries of evidenceCollections) {
      for (const entry of entries) delete entry.evidence;
    }
    const structurePass = same(semanticReport, expected) && unique(report.targetMatrix, 'id') &&
      unique(report.effectiveChain, 'id') && unique(report.decisionLedger, 'id') &&
      unique(report.changesAndRecovery?.transactions, 'id') &&
      unique(report.verificationMatrix, 'claim') && unique(report.pendingQuestions, 'id');
    let consistencyPass = true;
    for (const [claim, checkId, checkStatus, reportStatus] of consistency[scenarioId]) {
      const gradedStatus = checksById.get(checkId);
      if (gradedStatus === 'unverified') {
        if (claim !== 'host-primary-evidence' && claims.get(claim) !== 'unverified') {
          consistencyPass = false;
        }
      }
      else if (gradedStatus !== checkStatus || claims.get(claim) !== reportStatus) {
        consistencyPass = false;
      }
    }
    return {
      pass: structurePass && consistencyPass,
      value: report,
    };
  });
}

function hostEvidenceCheck(root, scenarioId) {
  return checked('host_evidence', 'logs/host-evidence.json', () => {
    const challenges = readJson(root, 'evaluator/capture-challenges.json');
    const hostEvidence = readJson(root, 'logs/host-evidence.json');
    const hosts = hostEvidence.hosts || [];
    const expectedHosts = ['codex', 'claude'];
    const subject = inside(root, 'subject');
    const publicContract = readJson(root, 'subject/controls/evidence-contract.json');
    const noncePattern = /^[0-9a-f]{64}$/;
    const expectedChallenges = challenges.hosts || [];
    const challengeShapePass = exactKeys(challenges,
      ['schemaVersion', 'scenarioId', 'requestSha256', 'evidenceContractSha256',
        'hosts', 'applyRuns']) &&
      challenges.schemaVersion === 1 &&
      challenges.scenarioId === scenarioId &&
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
    if (!challengeShapePass || !exactKeys(hostEvidence,
      ['schemaVersion', 'scenarioId', 'hosts']) || !Array.isArray(hostEvidence.hosts) ||
        hosts.some((item) => !expectedHosts.includes(item.host)) ||
        new Set(hosts.map((item) => item.host)).size !== hosts.length) {
      return { pass: false, value: hostEvidence };
    }
    let pass = hostEvidence.schemaVersion === 1 && hostEvidence.scenarioId === scenarioId &&
      exactKeys(hostEvidence, ['schemaVersion', 'scenarioId', 'hosts']);
    let unavailable = false;
    const optionalBytes = (relativePath) => {
      try {
        const bytes = readFile(root, relativePath);
        if (bytes.length === 0) unavailable = true;
        return bytes.length === 0 ? null : bytes;
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          unavailable = true;
          return null;
        }
        throw error;
      }
    };
    for (const host of expectedHosts) {
      const entry = hosts.find((item) => item.host === host);
      if (!entry) {
        unavailable = true;
        continue;
      }
      const prefix = `logs/hosts/${host}`;
      const expectedArtifacts = [
        { kind: 'inventory-1', path: `${prefix}/inventory-1-stdout.json` },
        { kind: 'inventory-2', path: `${prefix}/inventory-2-stdout.json` },
        { kind: 'raw-final', path: `${prefix}/worker-final.md` },
        { kind: 'machine-report', path: `${prefix}/machine-report.json` },
        { kind: 'command-trace', path: `${prefix}/command-trace.json` },
        ...CHECKPOINT_FILES[scenarioId].map((fileName) => ({
          kind: `checkpoint:${fileName.slice(0, -'.json'.length)}`,
          path: `${prefix}/checkpoints/${fileName}`,
        })),
      ];
      pass = pass && exactKeys(entry,
        ['host', 'artifacts', 'controllerSnapshot', 'receipt']) && entry.host === host &&
        Array.isArray(entry.artifacts) && entry.artifacts.length === expectedArtifacts.length &&
        exactKeys(entry.controllerSnapshot, ['path', 'sha256']) &&
        exactKeys(entry.receipt, ['path', 'sha256']);
      for (const [index, expectedArtifact] of expectedArtifacts.entries()) {
        const artifact = entry.artifacts[index];
        pass = pass && exactKeys(artifact, ['kind', 'path', 'sha256']) &&
          artifact.kind === expectedArtifact.kind && artifact.path === expectedArtifact.path &&
          /^[0-9a-f]{64}$/.test(artifact.sha256);
        const bytes = optionalBytes(expectedArtifact.path);
        if (bytes) pass = pass && sha256(bytes) === artifact.sha256;
      }
      const inventoryOne = optionalBytes(expectedArtifacts[0].path);
      const inventoryTwo = optionalBytes(expectedArtifacts[1].path);
      const workerFinalBytes = optionalBytes(expectedArtifacts[2].path);
      const machineReportBytes = optionalBytes(expectedArtifacts[3].path);
      const commandTraceBytes = optionalBytes(expectedArtifacts[4].path);
      if (inventoryOne) validateInventoryBytes(inventoryOne, subject);
      if (inventoryTwo) validateInventoryBytes(inventoryTwo, subject);
      if (workerFinalBytes) {
        const workerFinal = new TextDecoder('utf-8', { fatal: true }).decode(workerFinalBytes);
        pass = pass && workerFinal.trim().length > 0 && !workerFinal.includes('\0');
      }
      if (machineReportBytes) validateMachineReport(parseJsonBytes(machineReportBytes,
        'Machine report must be valid UTF-8 JSON.'), scenarioId, publicContract);
      if (commandTraceBytes && expectedArtifacts.slice(5).every((artifact) =>
        fs.existsSync(inside(root, artifact.path)))) {
        const checkpointRoot = inside(root, prefix);
        const checkpoints = readWorkerCheckpoints(root, checkpointRoot, scenarioId);
        validateCommandTrace(parseJsonBytes(commandTraceBytes,
          'Worker command trace must be valid UTF-8 JSON.'), scenarioId, checkpoints);
      }
      const snapshotBytes = optionalBytes(entry.controllerSnapshot.path);
      if (snapshotBytes) {
        pass = pass && sha256(snapshotBytes) === entry.controllerSnapshot.sha256 &&
          same(parseJsonBytes(snapshotBytes, 'Controller snapshot is malformed.'),
            snapshotTargets(subject));
      }
      const receiptBytes = optionalBytes(entry.receipt.path);
      if (!receiptBytes) continue;
      pass = pass && sha256(receiptBytes) === entry.receipt.sha256;
      const receipt = parseJsonBytes(receiptBytes, 'Host receipt is malformed.');
      const challenge = expectedChallenges.find((item) => item.host === host);
      const expectedReceipt = {
        schemaVersion: 1,
        scenarioId,
        host,
        receiptId: challenge.receiptId,
        invocationId: challenge.invocationId,
        evaluatorNonce: challenge.nonce,
        requestSha256: challenges.requestSha256,
        evidenceContractSha256: challenges.evidenceContractSha256,
        artifacts: entry.artifacts,
        controllerSnapshot: entry.controllerSnapshot,
      };
      pass = pass && same(receipt, expectedReceipt);
    }
    return {
      pass,
      status: pass && unavailable ? 'unverified' : undefined,
      value: hostEvidence,
    };
  });
}

function noSentinelsCheck(root, sentinels) {
  return checked('secret_free_outputs', 'logs', () => {
    let pass = true;
    walkFiles(root, inside(root, 'logs'), (filePath) => {
      const contents = fs.readFileSync(filePath);
      if (sentinels.some((sentinel) => contents.includes(Buffer.from(sentinel)))) pass = false;
    });
    return { pass, value: { status: pass ? 'clear' : 'detected' } };
  }, 'fail');
}

function gradeAudit(root, expected) {
  const checks = [];
  checks.push(checked('targets_unchanged', 'subject', () => {
    const actual = snapshotTargets(inside(root, 'subject'));
    return { pass: same(actual, expected.initialSnapshot), value: actual };
  }, 'fail'));
  checks.push(checked('manifests_deterministic',
    'logs/manifest-1.json|logs/manifest-2.json', () => {
      const first = normalizeManifest(readJson(root, 'logs/manifest-1.json'));
      const second = normalizeManifest(readJson(root, 'logs/manifest-2.json'));
      return { pass: same(first, second), value: [first, second] };
    }));
  checks.push(checked('exact_source_states', 'logs/manifest-1.json', () => {
    const manifest = readJson(root, 'logs/manifest-1.json');
    const states = (manifest.sources || []).map((source) => ({
      logicalPath: source.logicalPath,
      host: source.host,
      loadState: source.loadState,
    }));
    return { pass: same(states, expected.expectedStates), value: states };
  }));
  checks.push(checked('inspector_invocations', 'logs/command-trace.json', () => {
    const trace = readJson(root, 'logs/command-trace.json');
    const pass = Array.isArray(trace.invocations) && trace.invocations.length === 2 &&
      trace.invocations.every((entry, index) => entry.kind === 'inventory' &&
        entry.ordinal === index + 1 && entry.exitCode === 0);
    return { pass, value: trace };
  }));
  checks.push(noSentinelsCheck(root, expected.sentinels));
  checks.push(checked('unavailable_probe_disclosed', 'logs/report.json', () => {
    const report = readJson(root, 'logs/report.json');
    const pass = (report.verificationMatrix || []).some(
      (entry) => entry.claim === 'unsafe-runtime-probe' && entry.status === 'unverified');
    return { pass, value: report.verificationMatrix };
  }));
  checks.push(hostEvidenceCheck(root, 'audit'));
  checks.push(reportCheck(root, 'audit', checks));
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

function validateRecovery(root, scenarioId, members, transactionStatuses, targetStatuses) {
  const backupRoot = discoverRecoveryLeaf(root);
  const manifest = readJson(root, `${backupRoot}/manifest.json`);
  const restoration = readJson(root, `${backupRoot}/restoration.json`);
  const expectedTargets = new Map(members.map((member) => [member.targetPath, member]));
  let pass = exactKeys(manifest, ['schemaVersion', 'scenarioId', 'entries']) &&
    manifest.schemaVersion === 1 && manifest.scenarioId === scenarioId &&
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
      exactKeys(entry.permissions, ['mode', 'source']) && entry.permissions.source === 'stat';
    if (!member || typeof entry.preimagePath !== 'string') continue;
    const preimageRelative = `${backupRoot}/${portable(entry.preimagePath)}`;
    const preimagePath = inside(root, preimageRelative);
    if (!isInside(inside(root, backupRoot), preimagePath)) {
      pass = false;
      continue;
    }
    const preimage = readFile(root, preimageRelative);
    const evaluator = readFile(root, member.evaluatorPath);
    const metadata = representationMetadata(evaluator);
    hashes[entry.targetPath] = sha256(preimage);
    pass = pass && preimage.equals(evaluator) && entry.sha256 === sha256(evaluator) &&
      entry.encoding === metadata.encoding && entry.bom === metadata.bom &&
      entry.lineEndings === metadata.lineEndings &&
      entry.permissions.mode === (fs.statSync(inside(root, member.evaluatorPath)).mode & 0o777);
  }
  const transactions = Object.fromEntries((restoration.transactions || [])
    .map((entry) => [entry.id, entry.status]));
  const targets = Object.fromEntries((restoration.targets || [])
    .map((entry) => [entry.path, { transaction: entry.transaction, status: entry.status }]));
  pass = pass && exactKeys(restoration,
    ['schemaVersion', 'scenarioId', 'transactions', 'targets']) &&
    restoration.schemaVersion === 1 && restoration.scenarioId === scenarioId &&
    same(transactions, transactionStatuses) && same(targets, targetStatuses);
  return { pass, backupRoot, hashes, manifest, restoration };
}

function gradeApply(root, expected) {
  const checks = [];
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
      transactionStatuses, targetStatuses);
    return { pass: recovery.pass, value: recovery.hashes };
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
  checks.push(checked('verified_repository_facts', 'logs/command-trace.json', () => {
    const facts = readJson(root, 'logs/command-trace.json').facts || [];
    const packageManager = facts.find((fact) => fact.id === 'package-manager');
    const executable = facts.find((fact) => fact.id === 'pnpm-version');
    const packageJson = readJson(root, 'subject/repo/package.json');
    const executablePath = inside(root, 'subject/tools/pnpm.cjs');
    assertNoLinks(root, executablePath);
    const subject = inside(root, 'subject');
    const repository = inside(subject, 'repo');
    const environment = {
      ...process.env,
      HOME: inside(subject, 'home'),
      USERPROFILE: inside(subject, 'home'),
      GIT_CONFIG_GLOBAL: inside(subject, 'controls', 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1',
    };
    const shim = childProcess.spawnSync(process.execPath, [executablePath, '--version'], {
      cwd: repository, encoding: 'utf8', shell: false, windowsHide: true, env: environment,
    });
    const tracked = childProcess.spawnSync('git', ['-C', repository, 'ls-files',
      '--error-unmatch', 'AGENTS.md'], {
      encoding: 'utf8', shell: false, windowsHide: true, env: environment,
    });
    const dirty = childProcess.spawnSync('git', ['-C', repository, 'status', '--porcelain',
      '--', 'AGENTS.md'], {
      encoding: 'utf8', shell: false, windowsHide: true, env: environment,
    });
    const pass = packageManager?.value === 'pnpm' &&
      packageManager.source === 'subject/repo/package.json' &&
      executable?.path === 'subject/tools/pnpm.cjs' && executable.value === '10.0.0' &&
      executable.exitCode === 0 && packageJson.packageManager === 'pnpm@10.0.0' &&
      shim.status === 0 && shim.stdout === '10.0.0\n' && tracked.status === 0 &&
      dirty.status === 0 && dirty.stdout === ' M AGENTS.md\n';
    return { pass, value: { facts, packageJson, executable: sha256(fs.readFileSync(executablePath)),
      shimExitCode: shim.status, trackedExitCode: tracked.status, dirty: dirty.stdout } };
  }));
  checks.push(checked('second_run_idempotent',
    'logs/hosts/codex/checkpoints/apply-pass-1.json|' +
      'logs/hosts/codex/checkpoints/apply-pass-2.json', () => {
      const challenges = readJson(root, 'evaluator/capture-challenges.json');
      const firstPath = 'logs/hosts/codex/checkpoints/apply-pass-1.json';
      const secondPath = 'logs/hosts/codex/checkpoints/apply-pass-2.json';
      const firstBytes = readFile(root, firstPath);
      const secondBytes = readFile(root, secondPath);
      const first = parseJsonBytes(firstBytes, 'First APPLY checkpoint is malformed.');
      const second = parseJsonBytes(secondBytes, 'Second APPLY checkpoint is malformed.');
      const actual = snapshotTargets(inside(root, 'subject'));
      const noncePattern = /^[0-9a-f]{64}$/;
      const runChallenges = (challenges.applyRuns || []).filter((item) => item.host === 'codex')
        .sort((left, right) => left.ordinal - right.ordinal);
      const allNonces = [...(challenges.hosts || []), ...runChallenges]
        .map((item) => item.nonce);
      const challengePass = challenges.schemaVersion === 1 && challenges.scenarioId === 'apply' &&
        challenges.requestSha256 === hashAt(root, 'logs/prompt.md') && runChallenges.length === 2 &&
        runChallenges[0].receiptId === 'apply-codex-receipt-1' &&
        runChallenges[0].invocationId === 'apply-codex-run-1' &&
        runChallenges[1].receiptId === 'apply-codex-receipt-2' &&
        runChallenges[1].invocationId === 'apply-codex-run-2' &&
        runChallenges.every((item, index) => exactKeys(item,
          ['host', 'ordinal', 'receiptId', 'invocationId', 'nonce']) &&
          item.ordinal === index + 1 && noncePattern.test(item.nonce)) &&
        new Set(runChallenges.map((item) => item.receiptId)).size === 2 &&
        new Set(runChallenges.map((item) => item.invocationId)).size === 2 &&
        new Set(allNonces).size === allNonces.length;
      if (!challengePass) {
        return { pass: false, value: { first, second, actual } };
      }
      const receiptPaths = [
        'evaluator/receipts/apply/codex/run-1.json',
        'evaluator/receipts/apply/codex/run-2.json',
      ];
      const receiptBytes = [null, null];
      let unavailable = false;
      for (const [index, receiptPath] of receiptPaths.entries()) {
        try {
          const bytes = readFile(root, receiptPath);
          if (bytes.length === 0) {
            unavailable = true;
          } else {
            receiptBytes[index] = bytes;
          }
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            unavailable = true;
            continue;
          }
          throw error;
        }
      }
      const receipts = receiptBytes.map((bytes) => bytes ?
        parseJsonBytes(bytes, 'APPLY receipt is malformed.') : null);
      const hostEntry = readJson(root, 'logs/host-evidence.json').hosts
        .find((item) => item.host === 'codex');
      const rawFinal = hostEntry.artifacts.find((item) => item.kind === 'raw-final');
      const inventories = hostEntry.artifacts.filter((item) => item.kind.startsWith('inventory-'));
      const checkpointArtifacts = [
        hostEntry.artifacts.find((item) => item.kind === 'checkpoint:apply-pass-1'),
        hostEntry.artifacts.find((item) => item.kind === 'checkpoint:apply-pass-2'),
      ];
      const expectedReceipts = [
        {
          schemaVersion: 1,
          scenarioId: 'apply',
          host: 'codex',
          receiptId: runChallenges[0].receiptId,
          invocationId: runChallenges[0].invocationId,
          evaluatorNonce: runChallenges[0].nonce,
          requestSha256: challenges.requestSha256,
          ordinal: 1,
          previousReceiptSha256: null,
          rawFinal,
          inventories,
          checkpoint: checkpointArtifacts[0],
        },
        {
          schemaVersion: 1,
          scenarioId: 'apply',
          host: 'codex',
          receiptId: runChallenges[1].receiptId,
          invocationId: runChallenges[1].invocationId,
          evaluatorNonce: runChallenges[1].nonce,
          requestSha256: challenges.requestSha256,
          ordinal: 2,
          previousReceiptSha256: receiptBytes[0] ? sha256(receiptBytes[0]) :
            receipts[1]?.previousReceiptSha256,
          rawFinal,
          inventories,
          checkpoint: checkpointArtifacts[1],
        },
      ];
      let pass = first.id === 'apply-pass-1' && first.ordinal === 1 &&
        first.predecessorSha256 === null && first.transformationStatus === 'changed' &&
        second.id === 'apply-pass-2' && second.ordinal === 2 &&
        second.predecessorSha256 === sha256(firstBytes) &&
        second.transformationStatus === 'no-change' &&
        same(first.targetSnapshot, second.targetSnapshot) && same(second.targetSnapshot, actual) &&
        sha256(firstBytes) !== sha256(secondBytes);
      for (const [index, receipt] of receipts.entries()) {
        if (receipt) pass = pass && same(receipt, expectedReceipts[index]);
      }
      if (receipts[0] && receipts[1]) {
        pass = pass && receipts[0].receiptId !== receipts[1].receiptId &&
          receipts[0].evaluatorNonce !== receipts[1].evaluatorNonce;
      }
      if (!receiptBytes[0] && receipts[1]) {
        pass = pass && /^[0-9a-f]{64}$/.test(receipts[1].previousReceiptSha256);
      }
      return { pass, status: pass && unavailable ? 'unverified' : undefined,
        value: { first, second, actual } };
    }));
  checks.push(noSentinelsCheck(root, expected.sentinels));
  checks.push(hostEvidenceCheck(root, 'apply'));
  checks.push(reportCheck(root, 'apply', checks));
  return checks;
}

function gradePartial(root, expected) {
  const checks = [];
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
      transactionStatuses, targetStatuses);
    const pass = recovery.pass && agents === expected.hashes.projectAgents &&
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
      transactionStatuses, targetStatuses);
    return { pass: recovery.pass, value: recovery.restoration };
  }));
  checks.push(checked('control_sequence', 'logs/hosts/codex/checkpoints', () => {
    const checkpointBytes = CHECKPOINT_FILES.partial.map((fileName) =>
      readFile(root, `logs/hosts/codex/checkpoints/${fileName}`));
    const checkpoints = checkpointBytes.map((bytes) =>
      parseJsonBytes(bytes, 'PARTIAL checkpoint is malformed.'));
    const [inventory, recovery, marker, prewrite, writes, verifierFailure,
      rollback, verifierSuccess] = checkpoints;
    let predecessorSha256 = null;
    let ordered = true;
    for (const [index, checkpoint] of checkpoints.entries()) {
      const expectedId = CHECKPOINT_FILES.partial[index].slice(0, -'.json'.length);
      ordered = ordered && checkpoint.schemaVersion === 1 &&
        checkpoint.scenarioId === 'partial' && checkpoint.id === expectedId &&
        checkpoint.ordinal === index + 1 && checkpoint.predecessorSha256 === predecessorSha256;
      predecessorSha256 = sha256(checkpointBytes[index]);
    }
    const markerControlPath = 'subject/controls/append-concurrent.cjs';
    const verifierControlPath = 'subject/controls/verify-project.cjs';
    const markerControlHash = hashAt(root, markerControlPath);
    const verifierControlHash = hashAt(root, verifierControlPath);
    const finalSnapshot = snapshotTargets(inside(root, 'subject'));
    const originalClaude = sha256(PARTIAL_CLAUDE_BEFORE);
    const pass = ordered && inventory.planComplete === true &&
      same(inventory.targetSnapshot, expected.initialSnapshot) &&
      recovery.recoveryLeaf === path.basename(discoverRecoveryLeaf(root)) &&
      markerControlHash === expected.controlHashes.marker &&
      verifierControlHash === expected.controlHashes.verifier &&
      marker.controlPath === markerControlPath && marker.controlSha256 === markerControlHash &&
      marker.exitCode === 0 && prewrite.hashesRechecked === true &&
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
    return { pass, value: { checkpoints, markerControlHash, verifierControlHash } };
  }));
  checks.push(hostEvidenceCheck(root, 'partial'));
  checks.push(reportCheck(root, 'partial', checks));
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
  if (expected.schemaVersion !== 1 || expected.scenarioId !== scenarioId) {
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
        status: prepared.status, path: prepared.subjectRoot }, null, 2)}\n`);
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
