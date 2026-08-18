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
  listSharedSkills,
  normalizePortableText
} = require('../benchmarks/build-codex-package.cjs');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  });
}

test('Codex package selects the complete 24-skill catalog', () => {
  const skills = listSharedSkills(root);

  assert.equal(skills.length, 24);
  assert.ok(skills.includes('improve-agent-instructions'));
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
  assert.equal(builtSkills.length, 24);
  assert.equal(manifest.name, 'skillquiver');
  assert.equal(manifest.version, '2.2.0');
  assert.equal(manifest.skills, './skills/');
  assert.match(manifest.description, /Twenty-four reusable Agent Skills/);
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
    'Turn this feature idea into a decision-complete implementation plan.',
    'Diagnose this failing test systematically and verify the root cause.',
    'Review this code change and report only evidence-backed findings.'
  ]);
  assert.match(manifest.description, /ChatGPT and Codex/);
  assert.match(manifest.interface.longDescription, /skills-only package works in ChatGPT and Codex/);
  assert.match(manifest.interface.longDescription, /same source catalog also supports Claude Code/);
  assert.ok(manifest.keywords.includes('chatgpt'));
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
  const packagedInspector = path.join(
    outputRoot,
    'skills',
    'improve-agent-instructions',
    'scripts',
    'inventory.mjs'
  );
  assert.equal(fs.existsSync(packagedInspector), true);
  assert.doesNotMatch(fs.readFileSync(packagedInspector, 'utf8'), /\r/);

});

test('portable text normalization converts CRLF in .mjs files to LF', t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-mjs-test-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const modulePath = path.join(fixtureRoot, 'inventory.mjs');
  fs.writeFileSync(modulePath, 'const first = 1;\r\nconst second = 2;\r\n');

  normalizePortableText(fixtureRoot);

  assert.equal(
    fs.readFileSync(modulePath, 'utf8'),
    'const first = 1;\nconst second = 2;\n'
  );
});

test('historical submission evidence remains pinned to 2.1.0', () => {
  const dossier = fs.readFileSync(
    path.join(root, 'submission', 'openai-directory.md'), 'utf8'
  );

  assert.match(dossier, /\| Plugin name \| Skillquiver \|/);
  assert.match(dossier, /\| Version \| 2\.1\.0 \|/);
  assert.match(dossier, /\| Short description \| Practical software workflows \|/);
  assert.doesNotMatch(dossier, /\| Version \| 2\.2\.0 \|/);
});

test('Codex package refuses output outside its artifact or temp roots', () => {
  assert.throws(
    () => buildCodexPackage(root, path.dirname(root)),
    /must be inside the artifact root or system temp/
  );
});

test('Codex package refuses output through a link that escapes its allowed roots', t => {
  const artifactRoot = path.join(root, '.plugin-eval', 'codex-package');
  const outsideRoot = fs.mkdtempSync(path.join(root, '.skillquiver-output-target-'));
  const outsideOutput = path.join(outsideRoot, 'victim');
  const outputLink = path.join(
    artifactRoot,
    `output-link-${process.pid}-${Date.now()}`
  );
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.mkdirSync(outsideOutput);
  fs.writeFileSync(path.join(outsideOutput, 'sentinel.txt'), 'keep');
  fs.symlinkSync(
    outsideRoot,
    outputLink,
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  t.after(() => {
    if (fs.existsSync(outputLink)) {
      if (process.platform === 'win32') fs.rmdirSync(outputLink);
      else fs.unlinkSync(outputLink);
    }
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  assert.throws(
    () => buildCodexPackage(root, path.join(outputLink, 'victim')),
    /must be inside the artifact root or system temp/
  );
  assert.equal(fs.readFileSync(path.join(outsideOutput, 'sentinel.txt'), 'utf8'), 'keep');
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
