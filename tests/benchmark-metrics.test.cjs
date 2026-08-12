const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { EXPECTED_IDS, evaluate } = require('../benchmarks/metric-pack/emit-benchmark-metrics.cjs');
const repoRoot = path.resolve(__dirname, '..');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function makeTarget({ scenarioIds = EXPECTED_IDS, runScenarios = null } = {}) {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-benchmark-'));
  writeJson(path.join(targetPath, '.plugin-eval', 'benchmark.json'), {
    scenarios: scenarioIds.map(id => ({ id }))
  });
  if (runScenarios) {
    writeJson(path.join(targetPath, '.plugin-eval', 'runs', '2026-01-01', 'benchmark-run.json'), {
      scenarios: runScenarios
    });
  }
  return targetPath;
}

test('metric pack accepts the complete measured scenario matrix', () => {
  const targetPath = makeTarget({
    runScenarios: EXPECTED_IDS.map(id => ({
      id,
      status: 'completed',
      usageAvailability: 'present'
    }))
  });

  try {
    const result = evaluate(targetPath);
    assert.ok(result.checks.every(check => check.status === 'pass'));
    assert.equal(
      result.metrics.find(metric => metric.id === 'skillquiver_benchmark_process_completion_rate').value,
      100
    );
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

test('metric pack fails missing scenarios and absent usage', () => {
  const targetPath = makeTarget({ scenarioIds: EXPECTED_IDS.slice(0, 7) });

  try {
    const result = evaluate(targetPath);
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-scenario-matrix').status,
      'fail'
    );
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-usage-coverage').status,
      'fail'
    );
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

test('N3 contract permits an honest plain-chat fallback', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(repoRoot, '.plugin-eval', 'benchmark.json'), 'utf8'));
  const n3 = config.scenarios.find(scenario =>
    scenario.id === 'n3-unavailable-claude-tool');
  const dossier = fs.readFileSync(
    path.join(repoRoot, 'submission', 'openai-directory.md'), 'utf8');

  assert.match(n3.userInput, /If that tool is unavailable/);
  assert.match(n3.userInput, /ask me directly in plain chat/);
  assert.doesNotMatch(n3.userInput, /Do not use any other mechanism/);
  assert.match(dossier, /If that tool is unavailable/);
});

test('destructive boundary requires a narrow authorized target', () => {
  const boundary = fs.readFileSync(
    path.join(repoRoot, 'skills', 'handle-host-boundaries', 'SKILL.md'), 'utf8');

  assert.match(boundary, /drive root, home directory, repository root/);
  assert.match(boundary, /exact narrow target and explicit authorization/);
  assert.match(boundary, /Refuse before running any command/);
});
