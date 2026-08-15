const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { EXPECTED_IDS, evaluate } = require('../benchmarks/metric-pack/emit-benchmark-metrics.cjs');
const FIXTURE_TREE_SHA256 = 'F5C6739C1D96173BD281F44F351EC2A02A133DDDEE05EF95A63F396C87D37B58';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function makeTarget({ scenarioIds = EXPECTED_IDS, runScenarios = null, scorecardScenarios = null } = {}) {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-benchmark-'));
  writeJson(path.join(targetPath, '.codex-plugin', 'plugin.json'), { name: 'fixture' });
  writeJson(path.join(targetPath, '.plugin-eval', 'benchmark.json'), {
    scenarios: scenarioIds.map(id => ({ id }))
  });
  if (runScenarios) {
    writeJson(path.join(targetPath, '.plugin-eval', 'runs', '2026-01-01', 'benchmark-run.json'), {
      scenarios: runScenarios
    });
  }
  if (scorecardScenarios) {
    writeJson(path.join(targetPath, 'benchmarks', 'results', 'latest.json'), {
      artifactTreeSha256: FIXTURE_TREE_SHA256,
      scenarios: scorecardScenarios
    });
  }
  return targetPath;
}

test('metric pack accepts the complete measured scenario matrix', () => {
  const targetPath = makeTarget({
    scorecardScenarios: EXPECTED_IDS.map(id => ({
      id,
      processStatus: 'completed',
      outcome: 'pass',
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

test('metric pack does not treat process completion as semantic success', () => {
  const targetPath = makeTarget({
    runScenarios: EXPECTED_IDS.map(id => ({
      id,
      status: 'completed',
      usageAvailability: 'present'
    }))
  });

  try {
    const result = evaluate(targetPath);
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-process-completion').status,
      'pass'
    );
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-outcome-scorecard').status,
      'fail'
    );
    assert.equal(
      result.metrics.find(metric => metric.id === 'skillquiver_benchmark_scenario_pass_rate').value,
      0
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

test('metric pack does not reuse repository evidence for an unrelated target', () => {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'unrelated-plugin-'));

  try {
    const result = evaluate(targetPath);
    assert.ok(result.checks.every(check => check.status === 'fail'));
    assert.equal(
      result.metrics.find(metric => metric.id === 'skillquiver_benchmark_usage_sample_count').value,
      0
    );
    assert.deepEqual(result.artifacts, []);
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

test('metric pack rejects a scorecard for different artifact contents', () => {
  const targetPath = makeTarget({
    scorecardScenarios: EXPECTED_IDS.map(id => ({
      id,
      processStatus: 'completed',
      outcome: 'pass',
      usageAvailability: 'present'
    }))
  });
  writeJson(path.join(targetPath, '.codex-plugin', 'plugin.json'), { name: 'changed' });

  try {
    const result = evaluate(targetPath);
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-execution-coverage').status,
      'fail'
    );
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-usage-coverage').status,
      'fail'
    );
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-outcome-scorecard').status,
      'fail'
    );
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

test('metric pack rejects unexpected package-root entries', () => {
  const targetPath = makeTarget({
    scorecardScenarios: EXPECTED_IDS.map(id => ({
      id,
      processStatus: 'completed',
      outcome: 'pass',
      usageAvailability: 'present'
    }))
  });
  fs.writeFileSync(path.join(targetPath, 'unexpected.txt'), 'not in the release package');

  try {
    const result = evaluate(targetPath);
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-outcome-scorecard').status,
      'fail'
    );
    assert.deepEqual(result.artifacts, []);
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

test('official scorecards require an archive hash', () => {
  const targetPath = makeTarget({
    scorecardScenarios: EXPECTED_IDS.map(id => ({
      id,
      processStatus: 'completed',
      outcome: 'pass',
      usageAvailability: 'present'
    }))
  });

  try {
    const result = evaluate(targetPath, { requireArchiveHash: true });
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-outcome-scorecard').status,
      'fail'
    );
    assert.deepEqual(result.artifacts, []);
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

test('metric pack rejects a scorecard whose release archive is unavailable', () => {
  const targetPath = makeTarget({
    scorecardScenarios: EXPECTED_IDS.map(id => ({
      id,
      processStatus: 'completed',
      outcome: 'pass',
      usageAvailability: 'present'
    }))
  });
  const scorecardPath = path.join(targetPath, 'benchmarks', 'results', 'latest.json');
  const scorecard = JSON.parse(fs.readFileSync(scorecardPath, 'utf8'));
  scorecard.artifactSha256 = '0'.repeat(64);
  writeJson(scorecardPath, scorecard);

  try {
    const result = evaluate(targetPath);
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-outcome-scorecard').status,
      'fail'
    );
    assert.deepEqual(result.artifacts, []);
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

test('metric pack does not let duplicate rows replace per-scenario evidence', () => {
  const scenarios = EXPECTED_IDS.map((id, index) => ({
    id,
    processStatus: 'completed',
    outcome: index === EXPECTED_IDS.length - 1 ? 'fail' : 'pass',
    usageAvailability: index === EXPECTED_IDS.length - 1 ? 'absent' : 'present'
  }));
  scenarios.push({
    id: EXPECTED_IDS[0],
    outcome: 'pass',
    usageAvailability: 'present'
  });
  const targetPath = makeTarget({ scorecardScenarios: scenarios });

  try {
    const result = evaluate(targetPath);
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-process-completion').status,
      'pass'
    );
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-usage-coverage').status,
      'fail'
    );
    assert.equal(
      result.checks.find(check => check.id === 'skillquiver-benchmark-outcome-scorecard').status,
      'fail'
    );
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

test('metric pack fails closed on malformed benchmark evidence', () => {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-benchmark-'));
  writeJson(path.join(targetPath, '.codex-plugin', 'plugin.json'), { name: 'fixture' });
  writeJson(path.join(targetPath, '.plugin-eval', 'benchmark.json'), { scenarios: 'invalid' });
  writeJson(path.join(targetPath, 'benchmarks', 'results', 'latest.json'), {
    artifactTreeSha256: FIXTURE_TREE_SHA256,
    scenarios: { invalid: true }
  });

  try {
    const result = evaluate(targetPath);
    assert.ok(result.checks.every(check => check.status === 'fail'));
    assert.deepEqual(result.artifacts, []);
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});

test('metric pack accepts external config and scorecard paths', () => {
  const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-benchmark-'));
  const configPath = path.join(targetPath, '.plugin-eval', 'external', 'benchmark.json');
  const scorecardPath = path.join(targetPath, 'benchmarks', 'results', 'external.json');
  writeJson(path.join(targetPath, '.codex-plugin', 'plugin.json'), { name: 'fixture' });
  writeJson(configPath, { scenarios: EXPECTED_IDS.map(id => ({ id })) });
  writeJson(scorecardPath, {
    artifactTreeSha256: FIXTURE_TREE_SHA256,
    scenarios: EXPECTED_IDS.map(id => ({
      id,
      processStatus: 'completed',
      outcome: 'pass',
      usageAvailability: 'present'
    }))
  });

  try {
    const result = evaluate(targetPath, { configPath, scorecardPath });
    assert.ok(result.checks.every(check => check.status === 'pass'));
  } finally {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
});
