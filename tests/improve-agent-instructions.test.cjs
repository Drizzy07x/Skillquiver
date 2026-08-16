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

  for (const output of [first.stdout, first.stderr, second.stdout, second.stderr]) {
    assert.doesNotMatch(output, /PRIVATE-SECRET-SENTINEL/);
    assert.doesNotMatch(output, /INSTRUCTION-BODY-SENTINEL/);
  }
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
