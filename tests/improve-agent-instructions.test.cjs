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

test('dual-host projects keep shared guidance canonical', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');

  assert.match(skill, /Make `AGENTS\.md` the canonical shared project contract/);
  assert.match(skill, /`@AGENTS\.md`/);
  assert.match(skill, /`@\.\.\/AGENTS\.md`/);
  assert.match(skill, /Never copy shared rules into `CLAUDE\.md`/);
  assert.match(skill, /Never assume that Codex expands `@` imports/);
});

test('general routing delegates persistent instruction work to the new skill', () => {
  const routing = fs.readFileSync(
    path.join(root, 'skills', 'solve-efficiently', 'SKILL.md'), 'utf8');

  assert.match(routing, /improve-agent-instructions/);
  assert.doesNotMatch(routing, /When `CLAUDE\.md` is the target/);
  assert.doesNotMatch(routing, /Root: 40–120 lines/);
});
