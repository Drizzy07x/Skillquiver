'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCENARIOS = new Set(['audit', 'apply', 'partial']);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const APPLY_AGENTS_BEFORE = Buffer.concat([UTF8_BOM, Buffer.from(
  '# Project\r\n\r\nUse npm from the repository root.\r\nKeep dirty dependency guidance.\r\n')]);
const APPLY_AGENTS_AFTER = Buffer.concat([UTF8_BOM, Buffer.from(
  '# Project\r\n\r\nUse pnpm from the repository root.\r\nKeep dirty dependency guidance.\r\n')]);
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
    if (entry.isDirectory()) walkFiles(root, entryPath, visit);
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
  const environment = {
    HOME: inside(subject, 'home'),
    USERPROFILE: inside(subject, 'home'),
    CODEX_HOME: inside(subject, 'home', '.codex'),
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
    `Work only inside: ${subject}`,
    'Do not inspect any ambient user home, host installation, authentication file, evaluator directory, or logs directory.',
    'Use the following isolated environment exactly:',
    ...Object.entries(environment).map(([name, value]) => `${name}=${value}`),
    'Run the read-only inventory twice before reporting. Store only sanitized path, hash, and status evidence.',
  ];
  if (scenarioId === 'audit') {
    lines.push('Audit both hosts and all fixture scopes. Do not write targets or create backups.');
  } else if (scenarioId === 'apply') {
    lines.push('Apply the authorized dual-host global and project transformation, then verify an empty second transformation.');
  } else {
    lines.push('Apply independent safe work, run controls/append-concurrent.cjs after inventory, and roll back only the project pair when controls/verify-project.cjs fails.');
  }
  return `${lines.join('\n')}\n`;
}

function baseFixture(root, scenarioId) {
  const directories = [
    'subject/home/.codex', 'subject/home/.claude', 'subject/repo', 'subject/controls',
    'subject/xdg/config', 'subject/xdg/state', 'subject/xdg/cache',
    'subject/appdata/roaming', 'subject/appdata/local', 'subject/tools',
    'evaluator/preimages', 'logs',
  ];
  for (const relative of directories) fs.mkdirSync(inside(root, relative), { recursive: true });
  writeFile(root, 'subject/controls/gitconfig', '[user]\n\tname = Fixture User\n');
  writeFile(root, 'subject/tools/pnpm', 'fixture pnpm executable\n');
  const subject = inside(root, 'subject');
  writeFile(root, 'logs/prompt.md', commonPrompt(scenarioId, subject));
  writeFile(root, 'logs/host-final.md', '');
  writeFile(root, 'logs/inspector-stdout.log', '');
  writeFile(root, 'logs/inspector-stderr.log', '');
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
  const expectedStates = [
    { id: 'claude-project', host: 'claude', loadState: 'active' },
    { id: 'claude-rule', host: 'claude', loadState: 'conditional' },
    { id: 'claude-user', host: 'claude', loadState: 'active' },
    { id: 'codex-deep', host: 'codex', loadState: 'truncated' },
    { id: 'codex-global', host: 'codex', loadState: 'active' },
    { id: 'codex-global-base', host: 'codex', loadState: 'shadowed' },
    { id: 'codex-nested', host: 'codex', loadState: 'active' },
    { id: 'codex-root-fallback', host: 'codex', loadState: 'shadowed' },
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
    'subject/repo/AGENTS.md': APPLY_AGENTS_BEFORE,
    'subject/repo/CLAUDE.md': APPLY_CLAUDE_BEFORE,
    'subject/repo/CLAUDE.local.md': Buffer.from('PRIVATE-LOCAL-APPLY-SENTINEL\r\n'),
    'subject/repo/package.json': Buffer.from('{"packageManager":"pnpm@10.0.0"}\n'),
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
  writeJson(root, 'evaluator/expected.json', { schemaVersion: 1, scenarioId, ...scenario });
  return { schemaVersion: 1, scenarioId, status: 'prepared', subjectRoot: inside(root, 'subject') };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
    return check(id, result.pass ? 'pass' : 'fail', relativePath, result.value);
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

function reportCheck(root, scenarioId) {
  return checked('report_complete', 'logs/report.json', () => {
    const report = readJson(root, 'logs/report.json');
    const fields = ['targetMatrix', 'effectiveChain', 'decisionLedger', 'changesAndRecovery',
      'verificationMatrix', 'pendingQuestions'];
    const pass = report.schemaVersion === 1 && report.scenarioId === scenarioId &&
      fields.every((field) => Object.hasOwn(report, field));
    return { pass, value: report };
  });
}

function hostEvidenceCheck(root) {
  return checked('host_evidence', 'logs/host-evidence.json', () => {
    const hostEvidence = readJson(root, 'logs/host-evidence.json');
    const hosts = new Map((hostEvidence.hosts || []).map((item) => [item.host, item.status]));
    return {
      pass: hostEvidence.schemaVersion === 1 && hosts.get('codex') === 'verified' &&
        hosts.get('claude') === 'verified',
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
    return { pass: same(manifest.sources, expected.expectedStates), value: manifest.sources };
  }));
  checks.push(checked('inspector_invocations', 'logs/command-trace.json', () => {
    const trace = readJson(root, 'logs/command-trace.json');
    const pass = Array.isArray(trace.invocations) && trace.invocations.length === 2 &&
      trace.invocations.every((entry) => entry.command === 'inventory' && entry.host === 'both' &&
        entry.status === 'verified');
    return { pass, value: trace };
  }));
  checks.push(noSentinelsCheck(root, expected.sentinels));
  checks.push(reportCheck(root, 'audit'));
  checks.push(checked('unavailable_probe_disclosed', 'logs/report.json', () => {
    const report = readJson(root, 'logs/report.json');
    const pass = (report.verificationMatrix || []).some(
      (entry) => entry.claim === 'unsafe-runtime-probe' && entry.status === 'unverified');
    return { pass, value: report.verificationMatrix };
  }));
  checks.push(hostEvidenceCheck(root));
  return checks;
}

function hashAt(root, relativePath) {
  return sha256(readFile(root, relativePath));
}

function gradeApply(root, expected) {
  const checks = [];
  const backupRoot = 'subject/home/.skillquiver/backups/improve-agent-instructions/apply-001';
  checks.push(checked('backup_outside_repository', backupRoot, () => {
    const repository = fs.realpathSync.native(inside(root, 'subject/repo'));
    const backup = fs.realpathSync.native(inside(root, backupRoot));
    return { pass: !isInside(repository, backup), value: backup };
  }, 'fail'));
  checks.push(checked('backup_preimages', `${backupRoot}/preimages`, () => {
    const backupFiles = {
      'home/.codex/AGENTS.md': 'codex-AGENTS.md',
      'home/.claude/CLAUDE.md': 'claude-CLAUDE.md',
      'repo/AGENTS.md': 'AGENTS.md',
      'repo/CLAUDE.md': 'CLAUDE.md',
    };
    const evaluatorFiles = {
      'codex-AGENTS.md': 'codex-AGENTS.md',
      'claude-CLAUDE.md': 'claude-CLAUDE.md',
      'AGENTS.md': 'repo-AGENTS.md',
      'CLAUDE.md': 'repo-CLAUDE.md',
    };
    const hashes = {};
    let pass = true;
    for (const [target, backupName] of Object.entries(backupFiles)) {
      const backupBytes = readFile(root, `${backupRoot}/preimages/${backupName}`);
      const evaluatorBytes = readFile(root,
        `evaluator/preimages/apply/${evaluatorFiles[backupName]}`);
      hashes[backupName] = sha256(backupBytes);
      if (!backupBytes.equals(evaluatorBytes)) pass = false;
    }
    const restoration = readJson(root, `${backupRoot}/restoration.json`);
    const metadata = Object.fromEntries((restoration.files || [])
      .map((item) => [item.path, { preimage: item.preimage, status: item.status }]));
    pass = pass && restoration.status === 'verified' &&
      same(metadata, Object.fromEntries(Object.entries(backupFiles).map(([target, backupName]) =>
        [target, { preimage: `preimages/${backupName}`, status: 'verified' }])));
    return { pass, value: hashes };
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
  checks.push(checked('verified_repository_facts', 'logs/facts.json', () => {
    const facts = readJson(root, 'logs/facts.json').facts || [];
    const packageManager = facts.find((fact) => fact.id === 'package-manager');
    const executable = facts.find((fact) => fact.id === 'pnpm-path');
    const packageJson = readJson(root, 'subject/repo/package.json');
    const executablePath = inside(root, 'subject/tools/pnpm');
    assertNoLinks(root, executablePath);
    const pass = packageManager?.value === 'pnpm' && packageManager.status === 'verified' &&
      executable?.path === 'subject/tools/pnpm' && executable.status === 'verified' &&
      packageJson.packageManager === 'pnpm@10.0.0' && fs.statSync(executablePath).isFile();
    return { pass, value: { facts, packageJson, executable: sha256(fs.readFileSync(executablePath)) } };
  }));
  checks.push(checked('second_run_idempotent',
    'logs/first-target-snapshot.json|logs/second-target-snapshot.json', () => {
      const first = readJson(root, 'logs/first-target-snapshot.json');
      const second = readJson(root, 'logs/second-target-snapshot.json');
      const actual = snapshotTargets(inside(root, 'subject'));
      return { pass: same(first, second) && same(second, actual), value: [first, second, actual] };
    }));
  checks.push(noSentinelsCheck(root, expected.sentinels));
  checks.push(reportCheck(root, 'apply'));
  checks.push(hostEvidenceCheck(root));
  return checks;
}

function gradePartial(root, expected) {
  const checks = [];
  const backupRoot = 'subject/home/.skillquiver/backups/improve-agent-instructions/partial-001';
  checks.push(checked('backup_outside_repository', backupRoot, () => {
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
    const backupAgents = hashAt(root, `${backupRoot}/preimages/AGENTS.md`);
    const backupClaude = hashAt(root, `${backupRoot}/preimages/CLAUDE.md`);
    const backupCodex = hashAt(root, `${backupRoot}/preimages/codex-AGENTS.md`);
    const backupConcurrentClaude = hashAt(root, `${backupRoot}/preimages/claude-CLAUDE.md`);
    const evaluatorAgents = hashAt(root, 'evaluator/preimages/partial/repo-AGENTS.md');
    const evaluatorClaude = hashAt(root, 'evaluator/preimages/partial/repo-CLAUDE.md');
    const evaluatorCodex = hashAt(root, 'evaluator/preimages/partial/codex-AGENTS.md');
    const evaluatorConcurrentClaude = hashAt(root,
      'evaluator/preimages/partial/claude-CLAUDE.md');
    const pass = agents === expected.hashes.projectAgents && claude === expected.hashes.projectClaude &&
      backupAgents === agents && backupClaude === claude && backupAgents === evaluatorAgents &&
      backupClaude === evaluatorClaude && backupCodex === evaluatorCodex &&
      backupConcurrentClaude === evaluatorConcurrentClaude;
    return { pass, value: { agents, claude, backupAgents, backupClaude,
      backupCodex, backupConcurrentClaude } };
  }, 'fail'));
  checks.push(checked('nested_ambiguity_untouched',
    'subject/repo/packages/ambiguous/AGENTS.md', () => {
      const bytes = readFile(root, 'subject/repo/packages/ambiguous/AGENTS.md');
      return { pass: sha256(bytes) === expected.hashes.nested, value: bytes };
    }, 'fail'));
  checks.push(checked('restoration_statuses', `${backupRoot}/restoration.json`, () => {
    const restoration = readJson(root, `${backupRoot}/restoration.json`);
    const statuses = Object.fromEntries((restoration.transactions || [])
      .map((transaction) => [transaction.id, transaction.status]));
    const pass = statuses['codex-global'] === 'applied' &&
      statuses['claude-global'] === 'concurrent-change' &&
      statuses['project-shared'] === 'rolled-back' && statuses['nested-scope'] === 'blocked';
    return { pass, value: restoration };
  }));
  checks.push(checked('rollback_verification', 'logs/verification-trace.json', () => {
    const trace = readJson(root, 'logs/verification-trace.json');
    const expectedTrace = [
      { phase: 'before-rollback', status: 'fail' },
      { phase: 'after-rollback', status: 'pass' },
    ];
    return { pass: same(trace.projectShared, expectedTrace), value: trace };
  }));
  checks.push(reportCheck(root, 'partial'));
  checks.push(checked('separate_claim_statuses', 'logs/report.json', () => {
    const claims = readJson(root, 'logs/report.json').verificationMatrix || [];
    const statuses = new Set(claims.map((claim) => claim.status));
    return { pass: ['verified', 'blocked', 'unverified'].every((status) => statuses.has(status)),
      value: claims };
  }));
  checks.push(hostEvidenceCheck(root));
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
  if (!Array.isArray(argv) || argv.length !== 3 || !['prepare', 'grade'].includes(argv[0]) ||
      !SCENARIOS.has(argv[1])) {
    errors.write('Usage: forward.cjs <prepare|grade> <audit|apply|partial> <run-root>\n');
    return 2;
  }
  try {
    if (argv[0] === 'prepare') {
      const prepared = prepareFixture(argv[1], argv[2]);
      output.write(`${JSON.stringify({ schemaVersion: 1, scenarioId: prepared.scenarioId,
        status: prepared.status, path: prepared.subjectRoot }, null, 2)}\n`);
    } else {
      output.write(`${JSON.stringify(gradeScenario(argv[1], argv[2]), null, 2)}\n`);
    }
    return 0;
  } catch {
    errors.write('Forward evaluation failed.\n');
    return 1;
  }
}

module.exports = { prepareFixture, snapshotTargets, gradeScenario, runCli };

if (require.main === module) process.exitCode = runCli(process.argv.slice(2), process);
