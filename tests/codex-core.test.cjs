const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const {
  CORE_CAPABILITIES,
  CORE_LONG_DESCRIPTION,
  buildCodexCore,
  readCoreConfig
} = require('../benchmarks/build-codex-core.cjs');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  });
}

test('Codex Core selects the six benchmark workflow skills', () => {
  const config = readCoreConfig(root);

  assert.deepEqual(config.skills, [
    'writing-plans',
    'diagnose-systematically',
    'test-driven-development',
    'requesting-code-review',
    'design-ui',
    'handle-host-boundaries'
  ]);
});

test('Codex Core build contains only selected skills and a consistent manifest', t => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-core-test-'));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));

  const result = buildCodexCore(root, outputRoot);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(outputRoot, '.codex-plugin', 'plugin.json'), 'utf8'
  ));
  const builtSkills = fs.readdirSync(path.join(outputRoot, 'skills')).sort();

  assert.deepEqual(builtSkills, [...result.skills].sort());
  assert.equal(manifest.name, 'skillquiver');
  assert.equal(manifest.version, '2.0.4');
  assert.equal(manifest.skills, './skills/');
  assert.match(manifest.description, /6 portable Agent Skills/);
  assert.equal(manifest.interface.displayName, 'Skillquiver Core');
  assert.equal(manifest.interface.shortDescription, 'Focused software workflows');
  assert.equal(manifest.interface.longDescription, CORE_LONG_DESCRIPTION);
  assert.deepEqual(manifest.interface.capabilities, CORE_CAPABILITIES);
  assert.ok(manifest.interface.displayName.length <= 30);
  assert.ok(manifest.interface.shortDescription.length <= 30);
  assert.ok(manifest.interface.longDescription.length <= 4_000);
  assert.equal(manifest.author.name, manifest.interface.developerName);
  assert.equal(manifest.author.name, 'Drizzy07x');
  assert.ok(manifest.interface.capabilities.length <= 20);
  assert.ok(manifest.interface.capabilities.every(value =>
    value.length <= 120 && !/[\r\n]/.test(value)
  ));
  assert.ok(manifest.interface.defaultPrompt.length <= 3);
  assert.ok(manifest.interface.defaultPrompt.every(prompt =>
    prompt.length <= 128 && !/[\r\n]/.test(prompt) && !prompt.includes('@')
  ));
  assert.ok(fs.existsSync(path.join(outputRoot, manifest.interface.logo)));
  assert.ok(fs.existsSync(path.join(outputRoot, manifest.interface.composerIcon)));

  const dossier = fs.readFileSync(
    path.join(root, 'submission', 'openai-directory.md'), 'utf8'
  );
  assert.match(dossier, /\| Plugin name \| Skillquiver Core \|/);
  assert.match(dossier, /\| Short description \| Focused software workflows \|/);
  assert.ok(dossier.includes(CORE_LONG_DESCRIPTION));
  for (const capability of CORE_CAPABILITIES) {
    assert.ok(dossier.includes(`- ${capability}`));
  }
});

test('Codex Core refuses output outside its artifact or temp roots', () => {
  assert.throws(
    () => buildCodexCore(root, path.dirname(root)),
    /must be inside the artifact root or system temp/
  );
});

test('Codex Core keeps active and deferred instructions compact', () => {
  const config = readCoreConfig(root);
  const files = config.skills.flatMap(skill =>
    filesUnder(path.join(root, 'skills', skill))
  );
  const activeBytes = files
    .filter(file => path.basename(file) === 'SKILL.md')
    .reduce((total, file) => total + fs.statSync(file).size, 0);
  const deferredBytes = files
    .filter(file => path.basename(file) !== 'SKILL.md')
    .reduce((total, file) => total + fs.statSync(file).size, 0);

  assert.ok(activeBytes <= 26_000, `active instructions use ${activeBytes} bytes`);
  assert.ok(deferredBytes <= 50_000, `deferred resources use ${deferredBytes} bytes`);
});
