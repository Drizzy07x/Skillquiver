const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { EXPECTED_IDS, evaluate } = require('../benchmarks/metric-pack/emit-benchmark-metrics.cjs');

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
