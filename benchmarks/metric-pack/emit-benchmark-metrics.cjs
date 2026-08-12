const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_IDS = [
  'p1-decision-complete-planning',
  'p2-systematic-diagnosis',
  'p3-test-driven-implementation',
  'p4-evidence-backed-review',
  'p5-ui-improvement-verification',
  'n1-claude-only-doctor',
  'n2-unbounded-destructive-deletion',
  'n3-unavailable-claude-tool'
];

function latestRun(targetPath) {
  const runsPath = path.join(targetPath, '.plugin-eval', 'runs');
  if (!fs.existsSync(runsPath)) return null;

  for (const name of fs.readdirSync(runsPath).sort().reverse()) {
    const resultPath = path.join(runsPath, name, 'benchmark-run.json');
    if (fs.existsSync(resultPath)) {
      return { resultPath, result: JSON.parse(fs.readFileSync(resultPath, 'utf8')) };
    }
  }
  return null;
}

function outcomeScorecard(targetPath) {
  const scorecardPath = path.join(targetPath, 'benchmarks', 'results', 'latest.json');
  if (!fs.existsSync(scorecardPath)) return null;
  return { scorecardPath, scorecard: JSON.parse(fs.readFileSync(scorecardPath, 'utf8')) };
}

function check(id, status, message, evidence, remediation = []) {
  return {
    id,
    category: 'real-usage-benchmark',
    severity: status === 'fail' ? 'error' : 'info',
    status,
    message,
    evidence,
    remediation
  };
}

function metric(id, value, unit, band) {
  return { id, category: 'real-usage-benchmark', value, unit, band };
}

function evaluate(targetPath) {
  const configPath = path.join(targetPath, '.plugin-eval', 'benchmark.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const ids = config.scenarios.map(scenario => scenario.id);
  const missing = EXPECTED_IDS.filter(id => !ids.includes(id));
  const positiveCount = ids.filter(id => id.startsWith('p')).length;
  const negativeCount = ids.filter(id => id.startsWith('n')).length;
  const completeMatrix = missing.length === 0 && ids.length === EXPECTED_IDS.length;
  const scored = outcomeScorecard(targetPath);
  const latest = latestRun(targetPath);
  const runScenarios = scored?.scorecard.scenarios || latest?.result.scenarios || [];
  const completedCount = runScenarios.filter(scenario =>
    (scenario.processStatus || scenario.status) === 'completed'
  ).length;
  const usageCount = runScenarios.filter(scenario =>
    typeof scenario.inputTokens === 'number' || scenario.usageAvailability === 'present'
  ).length;
  const outcomePassCount = scored
    ? runScenarios.filter(scenario => scenario.outcome === 'pass').length
    : 0;
  const matchingRun = EXPECTED_IDS.every(id => runScenarios.some(scenario => scenario.id === id));

  const checks = [
    check(
      'skillquiver-benchmark-scenario-matrix',
      completeMatrix ? 'pass' : 'fail',
      completeMatrix ? 'The benchmark defines all eight submission scenarios.' : 'The benchmark scenario matrix is incomplete.',
      [`configured=${ids.length}`, `missing=${missing.join(',') || 'none'}`],
      completeMatrix ? [] : ['Restore the five positive and three negative scenario IDs.']
    ),
    check(
      'skillquiver-benchmark-positive-negative-mix',
      positiveCount === 5 && negativeCount === 3 ? 'pass' : 'fail',
      `The benchmark contains ${positiveCount} positive and ${negativeCount} negative scenarios.`,
      ['required_positive=5', 'required_negative=3'],
      positiveCount === 5 && negativeCount === 3 ? [] : ['Use the submission dossier scenario mix.']
    ),
    check(
      'skillquiver-benchmark-execution-coverage',
      matchingRun ? 'pass' : 'fail',
      matchingRun
        ? 'Execution evidence covers all eight required scenarios.'
        : 'Execution evidence does not cover all required scenarios.',
      [scored?.scorecardPath || latest?.resultPath || 'no execution evidence'],
      matchingRun
        ? []
        : ['Run every required scenario and record its outcome.']
    ),
    check(
      'skillquiver-benchmark-process-completion',
      matchingRun && completedCount === EXPECTED_IDS.length ? 'pass' : 'fail',
      `The benchmark completed ${completedCount} of ${EXPECTED_IDS.length} required scenarios.`,
      [`completed=${completedCount}`],
      matchingRun && completedCount === EXPECTED_IDS.length
        ? []
        : ['Run the complete benchmark and investigate every process or verifier failure.']
    ),
    check(
      'skillquiver-benchmark-usage-coverage',
      usageCount === EXPECTED_IDS.length ? 'pass' : 'fail',
      `Observed token usage is available for ${usageCount} of ${EXPECTED_IDS.length} scenarios.`,
      [`usage_samples=${usageCount}`],
      usageCount === EXPECTED_IDS.length ? [] : ['Collect telemetry for every required scenario.']
    ),
    check(
      'skillquiver-benchmark-outcome-scorecard',
      matchingRun && outcomePassCount === EXPECTED_IDS.length ? 'pass' : 'fail',
      scored
        ? `The benchmark passed ${outcomePassCount} of ${EXPECTED_IDS.length} scenario rubrics.`
        : 'Semantic outcome evidence is unavailable; no scenario rubric is confirmed passing.',
      [`scenario_passes=${outcomePassCount}`, `semantic_scorecard=${scored ? 'present' : 'absent'}`],
      outcomePassCount === EXPECTED_IDS.length ? [] : ['Fix failed behaviors and rerun the same scenario matrix.']
    )
  ];

  return {
    checks,
    metrics: [
      metric('skillquiver_benchmark_scenario_count', ids.length, 'scenarios', completeMatrix ? 'good' : 'poor'),
      metric('skillquiver_benchmark_positive_count', positiveCount, 'scenarios', positiveCount === 5 ? 'good' : 'poor'),
      metric('skillquiver_benchmark_negative_count', negativeCount, 'scenarios', negativeCount === 3 ? 'good' : 'poor'),
      metric('skillquiver_benchmark_process_completion_rate', runScenarios.length ? Math.round(completedCount / EXPECTED_IDS.length * 100) : 0, 'percent', completedCount === EXPECTED_IDS.length ? 'good' : 'poor'),
      metric('skillquiver_benchmark_usage_sample_count', usageCount, 'samples', usageCount === EXPECTED_IDS.length ? 'good' : 'poor'),
      metric('skillquiver_benchmark_scenario_pass_rate', runScenarios.length ? Math.round(outcomePassCount / EXPECTED_IDS.length * 100) : 0, 'percent', outcomePassCount === EXPECTED_IDS.length ? 'good' : 'poor')
    ],
    artifacts: scored ? [{
      id: 'skillquiver-outcome-scorecard',
      type: 'benchmark-scorecard',
      label: 'Skillquiver benchmark outcome scorecard',
      description: 'Checklist-level outcomes for the final representative scenario matrix.',
      path: scored.scorecardPath
    }] : latest ? [{
      id: 'skillquiver-latest-benchmark-run',
      type: 'benchmark-run',
      label: 'Latest Skillquiver benchmark run',
      description: 'Normalized process, workspace, and usage evidence for the latest run.',
      path: latest.resultPath
    }] : []
  };
}

if (require.main === module) {
  const targetPath = path.resolve(process.argv[2] || process.env.PLUGIN_EVAL_TARGET || '.');
  process.stdout.write(`${JSON.stringify(evaluate(targetPath))}\n`);
}

module.exports = { EXPECTED_IDS, evaluate };
