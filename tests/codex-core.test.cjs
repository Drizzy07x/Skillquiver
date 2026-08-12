const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const { buildCodexCore, readCoreConfig } = require('../benchmarks/build-codex-core.cjs');

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
  assert.equal(manifest.skills, './skills/');
  assert.match(manifest.description, /6 portable Agent Skills/);
  assert.ok(fs.existsSync(path.join(outputRoot, manifest.interface.logo)));
});

test('Codex Core refuses output outside its artifact or temp roots', () => {
  assert.throws(
    () => buildCodexCore(root, path.dirname(root)),
    /must be inside the artifact root or system temp/
  );
});
