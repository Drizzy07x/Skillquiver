const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const skillRoot = path.join(root, 'skills', 'improve-agent-instructions');

function snapshotTree(directory) {
  const snapshot = new Map();
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(entryPath);
        snapshot.set(path.relative(directory, entryPath), {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: crypto.createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex'),
        });
      }
    }
  };
  visit(directory);
  return snapshot;
}

function runClaudeInventory({ home, managedDirectory, project, cwd = project,
  addDirectories = [], environment = {} }) {
  const inventoryPath = path.join(skillRoot, 'scripts', 'inventory.mjs');
  const args = [inventoryPath,
    '--home', home,
    '--claude-home', path.join(home, '.claude'),
    '--claude-managed-dir', managedDirectory,
    '--claude-setting-sources', 'user,project,local',
    '--project', project,
    '--cwd', cwd,
    '--host', 'claude'];
  for (const directory of addDirectories) args.push('--claude-add-dir', directory);
  const result = childProcess.spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('deterministic audit is read-only and secret-free', async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-inventory-'));
  const home = path.join(temporaryRoot, 'home');
  const project = path.join(temporaryRoot, 'project');
  const nested = path.join(project, 'packages');
  const cwd = path.join(nested, 'api');
  const codexHome = path.join(home, '.codex');
  const inventoryPath = path.join(skillRoot, 'scripts', 'inventory.mjs');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  childProcess.execFileSync('git', ['init', '--quiet', project]);

  const fixtures = new Map([
    [path.join(codexHome, 'AGENTS.override.md'),
      Buffer.from('INSTRUCTION-BODY-SENTINEL\nPRIVATE-SECRET-SENTINEL\n')],
    [path.join(codexHome, 'AGENTS.md'), Buffer.from('SHADOWED-GLOBAL-BASE\n')],
    [path.join(codexHome, 'config.toml'), Buffer.from(
      'project_doc_fallback_filenames = ["TEAM.md"]\n' +
      'project_doc_max_bytes = 128\n')],
    [path.join(project, 'AGENTS.md'), Buffer.alloc(80, 0x52)],
    [path.join(project, 'TEAM.md'), Buffer.from('SHADOWED-ROOT-FALLBACK\n')],
    [path.join(nested, 'TEAM.md'), Buffer.alloc(32, 0x4e)],
    [path.join(cwd, 'AGENTS.md'), Buffer.alloc(64, 0x44)],
  ]);

  for (const [filePath, contents] of fixtures) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  const hash = (filePath) => crypto.createHash('sha256')
    .update(fs.readFileSync(filePath)).digest('hex');
  const before = new Map([...fixtures.keys()].map((filePath) => [filePath, hash(filePath)]));
  const gitBefore = snapshotTree(path.join(project, '.git'));
  const args = [inventoryPath, '--home', home, '--project', project, '--cwd', cwd,
    '--host', 'codex'];
  const first = childProcess.spawnSync(process.execPath, args, { encoding: 'utf8' });
  const second = childProcess.spawnSync(process.execPath, args, { encoding: 'utf8' });

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stderr, '');
  assert.equal(second.stderr, '');
  const firstManifest = JSON.parse(first.stdout);
  const secondManifest = JSON.parse(second.stdout);
  assert.equal(firstManifest.schemaVersion, 1);

  const binarySort = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  assert.deepEqual(
    firstManifest.sources.map((source) => source.logicalPath),
    firstManifest.sources.map((source) => source.logicalPath).sort(binarySort));

  const sourceAt = (filePath) => firstManifest.sources.find(
    (source) => source.logicalPath === path.resolve(filePath));
  assert.equal(sourceAt(path.join(codexHome, 'AGENTS.override.md')).loadState, 'active');
  assert.equal(sourceAt(path.join(codexHome, 'AGENTS.md')).loadState, 'shadowed');
  assert.equal(sourceAt(path.join(project, 'TEAM.md')).loadState, 'shadowed');
  assert.equal(sourceAt(path.join(nested, 'TEAM.md')).loadState, 'active');
  assert.equal(sourceAt(path.join(nested, 'TEAM.md')).byteContribution, 32);
  assert.equal(sourceAt(path.join(cwd, 'AGENTS.md')).loadState, 'truncated');
  assert.equal(sourceAt(path.join(cwd, 'AGENTS.md')).byteContribution, 16);
  assert.equal(firstManifest.chains.codex.sourceIds.at(-1),
    sourceAt(path.join(cwd, 'AGENTS.md')).id);

  const { normalizeManifest } = await import(pathToFileURL(inventoryPath).href);
  assert.deepEqual(normalizeManifest(firstManifest), normalizeManifest(secondManifest));
  assert.deepEqual(
    new Map([...fixtures.keys()].map((filePath) => [filePath, hash(filePath)])), before);
  assert.deepEqual(snapshotTree(path.join(project, '.git')), gitBefore);

  for (const output of [first.stdout, first.stderr, second.stdout, second.stderr]) {
    assert.doesNotMatch(output, /PRIVATE-SECRET-SENTINEL/);
    assert.doesNotMatch(output, /INSTRUCTION-BODY-SENTINEL/);
  }
});

test('deterministic audit disables optional Git locks', async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-git-locks-'));
  const home = path.join(temporaryRoot, 'home');
  const project = path.join(temporaryRoot, 'project');
  const codexHome = path.join(home, '.codex');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(project, { recursive: true });

  const gitOptions = [];
  const { buildInventory } = await import(pathToFileURL(
    path.join(skillRoot, 'scripts', 'inventory.mjs')).href);
  buildInventory({
    host: 'codex',
    cwd: project,
    project,
    home,
    codexHome,
  }, {
    execFileSync(command, args, options) {
      assert.equal(command, 'git');
      gitOptions.push(options);
      if (args.includes('status')) return '';
      throw new Error('Not tracked');
    },
  });

  assert.ok(gitOptions.length > 0);
  for (const options of gitOptions) {
    assert.equal(options.env?.GIT_OPTIONAL_LOCKS, '0');
  }
});

test('deterministic audit sanitizes unknown flags', () => {
  const inventoryPath = path.join(skillRoot, 'scripts', 'inventory.mjs');
  const result = childProcess.spawnSync(
    process.execPath, [inventoryPath, '--PRIVATE-SECRET-SENTINEL'], { encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Usage error: unknown flag.\n');
  assert.doesNotMatch(result.stderr, /PRIVATE-SECRET-SENTINEL/);
});

test('deterministic audit rejects Codex keys outside the top level', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-config-table-'));
  const home = path.join(temporaryRoot, 'home');
  const codexHome = path.join(home, '.codex');
  const project = path.join(temporaryRoot, 'project');
  const inventoryPath = path.join(skillRoot, 'scripts', 'inventory.mjs');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'),
    '[unrelated]\n' +
    'project_doc_fallback_filenames = ["TEAM.md"]\n' +
    'project_doc_max_bytes = 1\n');
  fs.writeFileSync(path.join(project, 'TEAM.md'), 'TEAM');

  const result = childProcess.spawnSync(process.execPath, [inventoryPath,
    '--home', home, '--project', project, '--cwd', project, '--host', 'codex'],
  { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const manifest = JSON.parse(result.stdout);
  assert.deepEqual(manifest.warnings.map((entry) => entry.field),
    ['project_doc_fallback_filenames', 'project_doc_max_bytes']);
  assert.equal(manifest.sources.some(
    (source) => source.logicalPath === path.join(project, 'TEAM.md')), false);
});

test('inventory resolves Claude sources, links, and Git state', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-claude-'));
  const home = path.join(temporaryRoot, 'home');
  const claudeHome = path.join(home, '.claude');
  const managedDirectory = path.join(temporaryRoot, 'managed');
  const project = path.join(temporaryRoot, 'project');
  const physicalModule = path.join(project, 'physical-module');
  const logicalModule = path.join(project, 'module-link');
  const cwd = path.join(logicalModule, 'app');
  const outsideDirectory = path.join(temporaryRoot, 'outside');
  const externalImport = path.join(outsideDirectory, 'external.md');
  const inventoryPath = path.join(skillRoot, 'scripts', 'inventory.mjs');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(claudeHome, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(managedDirectory), { recursive: true });
  fs.mkdirSync(path.join(project, '.claude', 'rules', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(project, 'imports'), { recursive: true });
  fs.mkdirSync(path.join(physicalModule, 'app'), { recursive: true });
  fs.mkdirSync(outsideDirectory, { recursive: true });
  fs.symlinkSync(physicalModule, logicalModule,
    process.platform === 'win32' ? 'junction' : 'dir');

  const externalPath = externalImport.replaceAll('\\', '/');
  const fixtures = new Map([
    [path.join(managedDirectory, 'CLAUDE.md'),
      Buffer.from('\ufeffMANAGED-INSTRUCTION-SENTINEL\r\n', 'utf16le')],
    [path.join(managedDirectory, 'managed-settings.json'), JSON.stringify({
      claudeMd: 'MANAGED-VIRTUAL-SENTINEL',
      claudeMdExcludes: [path.join(managedDirectory, 'CLAUDE.md')],
      apiKey: 'SECRET-SETTING-SENTINEL',
    })],
    [path.join(claudeHome, 'CLAUDE.md'), Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('USER-INSTRUCTION-SENTINEL\r\n@user-one.md\r\n' +
        '`@inline-hidden.md`\r\n```md\r\n@fenced-hidden.md\r\n```\r\n'),
    ])],
    [path.join(claudeHome, 'user-one.md'),
      '@user-two.md\nUSER-ONE-INSTRUCTION-SENTINEL\n'],
    [path.join(claudeHome, 'user-two.md'),
      '@user-one.md\n@user-three.md\nUSER-TWO-INSTRUCTION-SENTINEL\n'],
    [path.join(claudeHome, 'user-three.md'), '@user-four.md\n'],
    [path.join(claudeHome, 'user-four.md'), '@user-five.md\n'],
    [path.join(claudeHome, 'user-five.md'), 'DEPTH-LIMIT-SENTINEL\n'],
    [path.join(claudeHome, 'rules', 'always.md'), 'ALWAYS-RULE-SENTINEL\n'],
    [path.join(claudeHome, 'settings.json'), JSON.stringify({
      claudeMd: 'USER-VIRTUAL-SENTINEL',
      claudeMdExcludes: [path.join(project, 'unused-user-exclude.md')],
      token: 'SECRET-SETTING-SENTINEL',
    })],
    [path.join(project, 'CLAUDE.md'),
      `PROJECT-DIRTY-SENTINEL\n@imports/relative.md\n@${externalPath}\n`],
    [path.join(project, '.claude', 'CLAUDE.md'), 'PROJECT-UNTRACKED-SENTINEL\n'],
    [path.join(project, 'CLAUDE.local.md'),
      Buffer.from('\ufeffPROJECT-LOCAL-SENTINEL\r\n', 'utf16le')],
    [path.join(project, 'imports', 'relative.md'),
      '@../physical-module/imported.md\nRELATIVE-IMPORT-SENTINEL\n'],
    [path.join(physicalModule, 'imported.md'), 'MODULE-IMPORT-SENTINEL\n'],
    [path.join(physicalModule, 'CLAUDE.md'), 'LINKED-INSTRUCTION-SENTINEL\n'],
    [path.join(project, '.claude', 'rules', 'nested', 'conditional.md'),
      '---\npaths:\n  - "src/**/*.js"\n  - "tests/**"\n---\nCONDITIONAL-RULE-SENTINEL\n'],
    [path.join(project, '.claude', 'settings.json'), JSON.stringify({
      claudeMd: 'PROJECT-VIRTUAL-SENTINEL',
      claudeMdExcludes: [path.join(project, 'CLAUDE.local.md')],
      privateValue: 'SECRET-SETTING-SENTINEL',
    })],
    [path.join(project, '.claude', 'settings.local.json'), JSON.stringify({
      claudeMdExcludes: [path.join(project, 'unused-local-exclude.md')],
      password: 'SECRET-SETTING-SENTINEL',
    })],
    [externalImport, 'EXTERNAL-INSTRUCTION-SENTINEL\n'],
    [path.join(project, '.gitignore'), 'CLAUDE.local.md\n'],
  ]);
  for (const [filePath, contents] of fixtures) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  childProcess.execFileSync('git', ['init', '--quiet', project]);
  childProcess.execFileSync('git', ['-C', project, 'config', 'core.autocrlf', 'false']);
  childProcess.execFileSync('git', ['-C', project, 'add', '.gitignore', 'CLAUDE.md',
    'imports/relative.md', 'physical-module/CLAUDE.md',
    'physical-module/imported.md']);
  childProcess.execFileSync('git', ['-C', project, '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
  fs.appendFileSync(path.join(project, 'CLAUDE.md'), 'DIRTY-AFTER-COMMIT\n');

  const result = childProcess.spawnSync(process.execPath, [inventoryPath,
    '--home', home,
    '--claude-home', claudeHome,
    '--claude-managed-dir', managedDirectory,
    '--claude-setting-sources', 'user,project,local',
    '--project', project,
    '--cwd', cwd,
    '--host', 'claude'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: path.join(temporaryRoot, 'ambient-claude-home'),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const manifest = JSON.parse(result.stdout);
  const sourceAt = (logicalPath, origin) => manifest.sources.find((source) =>
    source.logicalPath === path.resolve(logicalPath) &&
    (origin === undefined || source.origin === origin));
  const warningCodes = manifest.warnings.map((entry) => entry.code);

  assert.equal(manifest.roots.claudeHome.logicalPath, path.resolve(claudeHome));
  assert.equal(manifest.roots.claudeManaged.logicalPath, path.resolve(managedDirectory));
  assert.deepEqual(manifest.chains.claude.settingSources, {
    state: 'explicit',
    sources: ['user', 'project', 'local'],
  });
  assert.deepEqual(manifest.chains.claude.excludes, [
    path.join(managedDirectory, 'CLAUDE.md'),
    path.join(project, 'CLAUDE.local.md'),
    path.join(project, 'unused-local-exclude.md'),
    path.join(project, 'unused-user-exclude.md'),
  ].map((entry) => path.resolve(entry)).sort());
  assert.equal(manifest.chains.claude.maxImportDepth, 4);
  assert.equal(manifest.chains.claude.coverage, 'partial');

  const managed = sourceAt(path.join(managedDirectory, 'CLAUDE.md'));
  const user = sourceAt(path.join(claudeHome, 'CLAUDE.md'));
  const userOne = sourceAt(path.join(claudeHome, 'user-one.md'), 'import');
  const userFour = sourceAt(path.join(claudeHome, 'user-four.md'), 'import');
  const userFive = sourceAt(path.join(claudeHome, 'user-five.md'), 'import');
  const projectRoot = sourceAt(path.join(project, 'CLAUDE.md'));
  const projectAlternative = sourceAt(path.join(project, '.claude', 'CLAUDE.md'));
  const projectLocal = sourceAt(path.join(project, 'CLAUDE.local.md'));
  const relativeImport = sourceAt(path.join(project, 'imports', 'relative.md'), 'import');
  const external = sourceAt(externalImport, 'import');
  const linked = sourceAt(path.join(logicalModule, 'CLAUDE.md'));
  const unconditionalRule = sourceAt(path.join(claudeHome, 'rules', 'always.md'), 'rule');
  const conditionalRule = sourceAt(
    path.join(project, '.claude', 'rules', 'nested', 'conditional.md'), 'rule');

  assert.equal(managed.loadState, 'active');
  assert.equal(managed.encoding, 'utf16le');
  assert.equal(managed.lineEndings, 'crlf');
  assert.equal(managed.ownership, 'managed');
  assert.equal(sourceAt(path.join(managedDirectory, 'managed-settings.json'),
    'managed-settings').loadState, 'active');
  assert.equal(user.encoding, 'utf8-bom');
  assert.equal(user.lineEndings, 'crlf');
  assert.equal(user.ownership, 'user');
  assert.equal(userOne.import.parentSourceId, user.id);
  assert.equal(userOne.import.depth, 1);
  assert.equal(userFour.import.depth, 4);
  assert.equal(userFive.loadState, 'approval-blocked');
  assert.equal(userFive.import.depth, 5);
  assert.equal(projectRoot.gitState, 'modified');
  assert.equal(projectAlternative.gitState, 'untracked');
  assert.equal(projectRoot.loadState, 'conditional');
  assert.equal(projectAlternative.loadState, 'conditional');
  assert.equal(projectLocal.gitState, 'ignored');
  assert.equal(projectLocal.loadState, 'excluded');
  assert.equal(relativeImport.import.parentSourceId, projectRoot.id);
  assert.equal(relativeImport.import.depth, 1);
  assert.equal(external.loadState, 'conditional');
  assert.equal(external.approval, 'unknown');
  assert.equal(external.ownership, 'external');
  assert.equal(external.gitState, 'outside-repository');
  assert.equal(linked.resolvedPath,
    path.join(fs.realpathSync.native(physicalModule), 'CLAUDE.md'));
  assert.notEqual(linked.logicalPath, linked.resolvedPath);
  assert.equal(linked.ownership, 'project');
  assert.equal(linked.gitState, 'tracked-clean');
  assert.deepEqual(unconditionalRule.conditions, []);
  assert.equal(unconditionalRule.loadState, 'active');
  assert.deepEqual(conditionalRule.conditions, ['src/**/*.js', 'tests/**']);
  assert.equal(conditionalRule.loadState, 'conditional');
  assert.ok(manifest.chains.claude.conditionalSourceIds.includes(conditionalRule.id));
  assert.ok(manifest.chains.claude.conditionalSourceIds.includes(external.id));
  assert.ok(warningCodes.includes('import-cycle'));
  assert.ok(warningCodes.includes('import-depth-exceeded'));
  assert.ok(warningCodes.includes('external-import-approval-unknown'));
  assert.ok(warningCodes.includes('claude-project-file-ambiguity'));
  assert.equal(sourceAt(path.join(claudeHome, 'inline-hidden.md')), undefined);
  assert.equal(sourceAt(path.join(claudeHome, 'fenced-hidden.md')), undefined);

  const binarySort = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  assert.deepEqual(manifest.sources.map((source) => source.logicalPath),
    manifest.sources.map((source) => source.logicalPath).sort(binarySort));
  assert.deepEqual(manifest.sources.map((source) => source.id),
    manifest.sources.map((_, index) => `source-${String(index + 1).padStart(4, '0')}`));
  assert.equal(result.stdout.trimStart().startsWith('{'), true);
  assert.equal(result.stdout.trimEnd().endsWith('}'), true);
  assert.doesNotMatch(result.stdout, /SECRET-SETTING-SENTINEL/);
  assert.doesNotMatch(result.stdout, /INSTRUCTION-SENTINEL/);
  assert.doesNotMatch(JSON.stringify(manifest.warnings), /SENTINEL/);
});

test('Claude report-only sources do not recurse imports', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-report-only-'));
  const home = path.join(temporaryRoot, 'home');
  const managedDirectory = path.join(temporaryRoot, 'managed');
  const project = path.join(temporaryRoot, 'project');
  const outside = path.join(temporaryRoot, 'outside');
  const externalDirectory = path.join(outside, 'external-project');
  const externalLink = path.join(project, 'external-link');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(managedDirectory, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(externalDirectory, { recursive: true });
  fs.writeFileSync(path.join(managedDirectory, 'CLAUDE.md'),
    '@../outside/managed-child.md\n');
  fs.writeFileSync(path.join(outside, 'managed-child.md'), 'MANAGED-CHILD-SENTINEL\n');
  fs.writeFileSync(path.join(externalDirectory, 'CLAUDE.md'), '@child.md\n');
  fs.writeFileSync(path.join(externalDirectory, 'child.md'), 'EXTERNAL-CHILD-SENTINEL\n');
  fs.symlinkSync(externalDirectory, externalLink,
    process.platform === 'win32' ? 'junction' : 'dir');

  const manifest = runClaudeInventory({
    home,
    managedDirectory,
    project,
    addDirectories: [externalLink],
    environment: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' },
  });
  const sourceAt = (logicalPath) => manifest.sources.find(
    (source) => source.logicalPath === path.resolve(logicalPath));

  assert.equal(sourceAt(path.join(managedDirectory, 'CLAUDE.md')).ownership, 'managed');
  assert.equal(sourceAt(path.join(externalLink, 'CLAUDE.md')).ownership, 'external');
  assert.equal(sourceAt(path.join(outside, 'managed-child.md')), undefined);
  assert.equal(sourceAt(path.join(externalLink, 'child.md')), undefined);
});

test('Claude import depth stops before reading hop five', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-depth-cap-'));
  const home = path.join(temporaryRoot, 'home');
  const claudeHome = path.join(home, '.claude');
  const managedDirectory = path.join(temporaryRoot, 'managed');
  const project = path.join(temporaryRoot, 'project');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(managedDirectory, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'CLAUDE.md'), '@one.md\n');
  fs.writeFileSync(path.join(claudeHome, 'one.md'), '@two.md\n');
  fs.writeFileSync(path.join(claudeHome, 'two.md'), '@three.md\n');
  fs.writeFileSync(path.join(claudeHome, 'three.md'), '@four.md\n');
  fs.writeFileSync(path.join(claudeHome, 'four.md'), '@five.md\n');
  fs.writeFileSync(path.join(claudeHome, 'five.md'), 'FIFTH-HOP-BODY-SENTINEL\n');

  const manifest = runClaudeInventory({ home, managedDirectory, project });
  const fifthHop = manifest.sources.find((source) =>
    source.logicalPath === path.join(claudeHome, 'five.md'));

  assert.equal(fifthHop.loadState, 'approval-blocked');
  assert.equal(fifthHop.import.depth, 5);
  assert.equal(fifthHop.exists, null);
  assert.equal(fifthHop.byteCount, null);
  assert.equal(fifthHop.sha256, null);
});

test('Claude broken imports warn and make coverage partial', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-broken-import-'));
  const home = path.join(temporaryRoot, 'home');
  const claudeHome = path.join(home, '.claude');
  const managedDirectory = path.join(temporaryRoot, 'managed');
  const project = path.join(temporaryRoot, 'project');
  const missingImport = path.join(claudeHome, 'missing.md');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(managedDirectory, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'CLAUDE.md'), '@missing.md\n');

  const manifest = runClaudeInventory({ home, managedDirectory, project });
  const missing = manifest.sources.find((source) =>
    source.logicalPath === missingImport && source.origin === 'import');
  const warning = manifest.warnings.find((entry) =>
    entry.code === 'source-unreadable' && entry.logicalPath === missingImport);

  assert.equal(missing.loadState, 'missing');
  assert.equal(warning.host, 'claude');
  assert.equal(warning.field, null);
  assert.equal(manifest.chains.claude.coverage, 'partial');
});

test('Claude discovery deduplicates repeated additional sources', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-deduplicate-'));
  const home = path.join(temporaryRoot, 'home');
  const managedDirectory = path.join(temporaryRoot, 'managed');
  const project = path.join(temporaryRoot, 'project');
  const additionalDirectory = path.join(project, 'additional');
  const additionalFile = path.join(additionalDirectory, 'CLAUDE.md');
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(managedDirectory, { recursive: true });
  fs.mkdirSync(additionalDirectory, { recursive: true });
  fs.writeFileSync(additionalFile, 'ADDITIONAL-SOURCE-SENTINEL\n');

  const manifest = runClaudeInventory({
    home,
    managedDirectory,
    project,
    addDirectories: [additionalDirectory, additionalDirectory],
    environment: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' },
  });
  const matches = manifest.sources.filter((source) =>
    source.logicalPath === additionalFile && source.origin === 'additional-directory');
  const chainIds = [
    ...manifest.chains.claude.sourceIds,
    ...manifest.chains.claude.conditionalSourceIds,
  ];

  assert.equal(matches.length, 1);
  assert.equal(chainIds.includes(null), false);
  assert.equal(new Set(chainIds).size, chainIds.length);
});

function compact(text) {
  return text.replace(/\s+/g, ' ');
}

function section(markdown, heading) {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `Missing section: ${heading}`);
  const end = markdown.indexOf('\n## ', start + heading.length);
  return markdown.slice(start + heading.length, end === -1 ? undefined : end);
}

function assertInOrder(text, first, second) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert.notEqual(firstIndex, -1, `Missing: ${first}`);
  assert.notEqual(secondIndex, -1, `Missing: ${second}`);
  assert.ok(firstIndex < secondIndex, `${first} must precede ${second}`);
}

function codexProbeLines(markdown) {
  return [...markdown.matchAll(/```text\r?\n([\s\S]*?)```/g)]
    .flatMap(([, block]) => block.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line.startsWith('codex '));
}

// Defect: VERIFY guidance can claim to be read-only while offering a writable probe.
test('audit-first verification probes enforce a read-only sandbox', () => {
  const codex = fs.readFileSync(path.join(skillRoot, 'references', 'codex.md'), 'utf8');
  const probes = codexProbeLines(codex);

  assert.ok(probes.length > 0, 'Expected at least one executable Codex probe.');
  for (const probe of probes) {
    assert.match(probe, /--sandbox read-only/);
    assert.match(probe, /--ask-for-approval never/);
    assert.doesNotMatch(probe, /--sandbox (?!read-only\b)/);
  }
});

// Defect: dual-host project guidance can be correct while global guidance diverges or imports cross-host rules.
test('audit-first global guidance stays independent and semantically aligned', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const resolve = compact(section(skill, '## 1. Resolve mode, hosts, scopes, and authorization'));
  const inventory = compact(section(skill, '## 2. Build the inventory'));
  const classify = compact(section(skill, '## 3. Classify meanings and decisions'));
  const verify = compact(section(skill, '## 6. Verify the transformed chains'));

  assert.match(resolve, /keep Codex and Claude global files independent/);
  assert.match(resolve, /Do not create cross-host global imports/);
  assert.match(inventory, /inventory each host separately and label shared meanings and host-specific deltas/);
  assert.match(classify, /compare shared global meanings for semantic parity/);
  assert.match(verify, /verify semantic parity for shared global meanings/);
  assertInOrder(compact(skill), '## 2. Build the inventory', '## 3. Classify meanings and decisions');
});

// Defect: byte recovery alone can corrupt an edited file's representation or permissions.
test('audit-first recovery preserves file representation and permissions', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const recovery = compact(section(skill, '## 5. Create recovery evidence and apply'));

  assert.match(recovery, /Record original encoding, BOM, line endings, and permission metadata/);
  assert.match(recovery, /Use byte-preserving transformations/);
  assert.match(recovery, /preserve the original encoding, BOM, line endings, and permissions/);
  assert.match(recovery, /Recheck every preimage and permission before the group writes/);
  assert.match(recovery, /After a successful write, recheck the original encoding, BOM, line endings, and permission metadata/);
  assert.match(recovery, /rollback restores the original bytes and permissions/);
  assertInOrder(recovery, 'Record original encoding, BOM, line endings, and permission metadata',
    'Recheck every preimage and permission before the group writes');
  assertInOrder(recovery, 'Recheck every preimage and permission before the group writes',
    'rollback restores the original bytes and permissions');
});

// Defect: routing persistent instructions can accidentally remove durable-context safeguards.
test('audit-first routing retains durable-context safeguards', () => {
  const routing = fs.readFileSync(
    path.join(root, 'skills', 'solve-efficiently', 'SKILL.md'), 'utf8');
  const mapping = compact(section(routing, '## 7. Map the project (on request or first orientation)'));

  assert.match(mapping, /Route persistent instruction work to improve-agent-instructions; adjacent or implicit routing is audit-only/);
  assert.match(mapping, /Resolve the filename the host loads/);
  assert.match(mapping, /Choose locations conservatively/);
  assert.match(mapping, /Root: 40–120 lines/);
  assert.match(mapping, /Child: 20–60 lines/);
  assert.match(mapping, /No files for generated output, dependencies, or caches/);
  assert.match(mapping, /Verify the hierarchy/);
});

// Defect: an authorization phrase can be published without transaction and report relationships.
test('audit-first authorization remains transaction-safe', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const metadata = fs.readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
  const boundaries = compact(fs.readFileSync(
    path.join(root, 'skills', 'handle-host-boundaries', 'SKILL.md'), 'utf8'));
  const modes = compact(section(skill, '## 1. Resolve mode, hosts, scopes, and authorization'));
  const transactions = compact(section(skill, '## 4. Form transactions'));
  const verification = compact(section(skill, '## 6. Verify the transformed chains'));
  const report = compact(section(skill, '## 7. Render the report'));

  assert.match(modes, /`AUDIT`, `PLAN`, `APPLY`, and `VERIFY`/);
  assert.match(modes, /Unknown or implicit intent resolves to `AUDIT`/);
  assert.match(modes, /`AUDIT`, `PLAN`, and standalone `VERIFY` do not write or create backups/);
  assert.match(modes, /Explicit change intent with named scopes authorizes `APPLY` without another confirmation/);
  assert.match(modes, /Project-only and global-only requests never expand scope/);
  assert.match(modes, /Managed and resolved-external targets remain report-only/);
  assert.match(transactions, /Every target belongs to one logical transaction/);
  assert.match(transactions, /Codex global, Claude global, shared project pair, and one group per nested scope/);
  assertInOrder(transactions, 'Managed, external, and blocked-decision targets are report-only',
    'never enter a write group');
  assertInOrder(verification, 'Run only enforceably safe, read-only fresh-session host probes',
    'second dry-run transformation is empty');
  assert.match(report, /Target matrix, Effective chain, Decision ledger, Changes and recovery, Verification matrix, and Pending questions/);
  assert.match(report, /`verified`, `unverified`, or `blocked`/);
  assert.match(metadata, /allow_implicit_invocation: true/);
  assert.match(metadata, /default_prompt: "Audit the active AGENTS\.md and CLAUDE\.md chain; write only when this request explicitly authorizes named scopes\."/);
  assert.match(boundaries, /Explicitly authorized AGENTS\.md or CLAUDE\.md file maintenance through improve-agent-instructions is allowed/);
  assert.match(boundaries, /unavailable runtime loading remains unverified/);
});
