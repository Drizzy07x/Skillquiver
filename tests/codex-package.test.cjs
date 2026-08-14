const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const {
  PACKAGE_CAPABILITIES,
  PACKAGE_LONG_DESCRIPTION,
  assertPortableTree,
  buildCodexPackage,
  listSharedSkills
} = require('../benchmarks/build-codex-package.cjs');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  });
}

test('Codex package selects the complete 23-skill catalog', () => {
  const skills = listSharedSkills(root);

  assert.equal(skills.length, 23);
  assert.ok(skills.includes('skillquiver-doctor'));
  assert.deepEqual(skills, [...skills].sort());
});

test('Codex package contains every skill and consistent public metadata', t => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-package-test-'));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));

  const result = buildCodexPackage(root, outputRoot);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(outputRoot, '.codex-plugin', 'plugin.json'), 'utf8'
  ));
  const builtSkills = fs.readdirSync(path.join(outputRoot, 'skills')).sort();

  assert.deepEqual(builtSkills, result.skills);
  assert.equal(builtSkills.length, 23);
  assert.equal(manifest.name, 'skillquiver');
  assert.equal(manifest.version, '2.1.0');
  assert.equal(manifest.skills, './skills/');
  assert.match(manifest.description, /Twenty-three reusable Agent Skills/);
  assert.equal(manifest.interface.displayName, 'Skillquiver');
  assert.equal(manifest.interface.shortDescription, 'Practical software workflows');
  assert.equal(manifest.interface.longDescription, PACKAGE_LONG_DESCRIPTION);
  assert.deepEqual(manifest.interface.capabilities, PACKAGE_CAPABILITIES);
  assert.ok(manifest.interface.displayName.length <= 30);
  assert.ok(manifest.interface.shortDescription.length <= 30);
  assert.ok(manifest.interface.longDescription.length <= 4_000);
  assert.equal(manifest.author.name, manifest.interface.developerName);
  assert.equal(manifest.author.name, 'Drizzy07x');
  assert.ok(manifest.interface.capabilities.length <= 20);
  assert.ok(manifest.interface.capabilities.every(value =>
    value.length <= 120 && !/[\r\n]/.test(value)
  ));
  assert.deepEqual(manifest.interface.defaultPrompt, [
    'Use $writing-plans to turn this feature idea into a decision-complete implementation plan.',
    'Use $diagnose-systematically to diagnose this failing test and verify the root cause.',
    'Use $skillquiver:skillquiver-doctor to audit this Codex setup; confirm each change.'
  ]);
  assert.ok(manifest.interface.defaultPrompt.every(prompt =>
    prompt.length <= 128 && !/[\r\n]/.test(prompt) && !prompt.includes('@')
  ));
  assert.ok(fs.existsSync(path.join(outputRoot, manifest.interface.logo)));
  assert.ok(fs.existsSync(path.join(outputRoot, manifest.interface.composerIcon)));
  assert.equal(
    fs.readFileSync(path.join(outputRoot, 'assets', 'plugin-logo.png')).compare(
      fs.readFileSync(path.join(root, 'assets', 'plugin-logo.png'))
    ),
    0
  );
  for (const file of filesUnder(outputRoot).filter(file => !file.endsWith('.png'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\r/);
  }

  const dossier = fs.readFileSync(
    path.join(root, 'submission', 'openai-directory.md'), 'utf8'
  );
  assert.match(dossier, /\| Plugin name \| Skillquiver \|/);
  assert.match(dossier, /\| Version \| 2\.1\.0 \|/);
  assert.match(dossier, /\| Short description \| Practical software workflows \|/);
  assert.ok(dossier.includes(PACKAGE_LONG_DESCRIPTION));
  for (const capability of PACKAGE_CAPABILITIES) {
    assert.ok(dossier.includes(`- ${capability}`));
  }
});

test('Codex package refuses output outside its artifact or temp roots', () => {
  assert.throws(
    () => buildCodexPackage(root, path.dirname(root)),
    /must be inside the artifact root or system temp/
  );
});

test('Codex package rejects links anywhere in the source tree', t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-link-test-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const tree = path.join(fixtureRoot, 'tree');
  const target = path.join(fixtureRoot, 'target');
  fs.mkdirSync(tree);
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(tree, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

  assert.throws(() => assertPortableTree(tree), /must not contain a symbolic link/);
});

test('Codex discovery metadata stays within the reserved budget', () => {
  const entries = listSharedSkills(root).filter(name => name !== 'skillquiver-doctor');
  const total = entries.reduce((sum, name) => {
    const content = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
    const skillName = frontmatter.match(/^name:\s*(.+)$/m)[1].trim();
    const description = frontmatter.match(/^description:\s*(.+)$/m)[1].trim();
    return sum + skillName.length + description.length;
  }, 0);

  assert.ok(total <= 5_500, `implicit discovery metadata uses ${total} characters`);
});
