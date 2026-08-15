const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_ROOTS = ['.codex-plugin', 'skills', 'assets', 'LICENSE'];
const EVIDENCE_ROOTS = ['.plugin-eval', 'benchmarks'];

const EXPECTED_IDS = [
  'p1-decision-complete-planning',
  'p2-systematic-diagnosis',
  'p3-test-driven-implementation',
  'p4-evidence-backed-review',
  'p5-doctor-read-only-audit',
  'n1-doctor-bulk-cleanup',
  'n2-unbounded-destructive-deletion',
  'n3-unavailable-claude-tool'
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function latestRun(targetPath) {
  const runsPath = path.join(targetPath, '.plugin-eval', 'runs');
  if (!fs.existsSync(runsPath)) return null;

  for (const name of fs.readdirSync(runsPath).sort().reverse()) {
    const resultPath = path.join(runsPath, name, 'benchmark-run.json');
    if (fs.existsSync(resultPath)) {
      const result = readJson(resultPath);
      if (Array.isArray(result?.scenarios)) return { resultPath, result };
    }
  }
  return null;
}

function artifactTreeSha256(targetPath) {
  const files = [];
  const allowedRoots = new Set([...PACKAGE_ROOTS, ...EVIDENCE_ROOTS]);

  for (const entry of fs.readdirSync(targetPath)) {
    if (!allowedRoots.has(entry)) return null;
  }

  function collect(entryPath) {
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) return false;
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(entryPath).sort()) {
        if (!collect(path.join(entryPath, entry))) return false;
      }
    }
    else if (stat.isFile()) {
      files.push(entryPath);
    }
    return true;
  }

  for (const name of PACKAGE_ROOTS) {
    const entryPath = path.join(targetPath, name);
    if (fs.existsSync(entryPath) && !collect(entryPath)) return null;
  }
  if (files.length === 0) return null;

  const hash = crypto.createHash('sha256');
  for (const filePath of files.sort()) {
    const relativePath = path.relative(targetPath, filePath).split(path.sep).join('/');
    hash.update(relativePath);
    hash.update(Buffer.from([0]));
    hash.update(fs.readFileSync(filePath));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex').toUpperCase();
}

function artifactArchiveSha256(targetPath) {
  const manifest = readJson(path.join(targetPath, '.codex-plugin', 'plugin.json'));
  if (typeof manifest?.name !== 'string' || typeof manifest?.version !== 'string') return null;
  const archivePath = path.join(
    path.dirname(targetPath),
    `${manifest.name}-${manifest.version}.zip`
  );
  if (!fs.existsSync(archivePath)) return null;
  return crypto.createHash('sha256')
    .update(fs.readFileSync(archivePath))
    .digest('hex')
    .toUpperCase();
}

function outcomeScorecard(scorecardPath, targetPath, requireArchiveHash = false) {
  if (!scorecardPath || !fs.existsSync(scorecardPath)) return null;
  const scorecard = readJson(scorecardPath);
  if (!Array.isArray(scorecard?.scenarios)) return null;
  const targetSha256 = artifactTreeSha256(targetPath);
  if (!targetSha256 || scorecard.artifactTreeSha256 !== targetSha256) return null;
  if (requireArchiveHash && typeof scorecard.artifactSha256 !== 'string') return null;
  if (scorecard.artifactSha256 &&
      scorecard.artifactSha256 !== artifactArchiveSha256(targetPath)) return null;
  return { scorecardPath, scorecard };
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

function evaluate(targetPath, options = {}) {
  const targetConfigPath = path.join(targetPath, '.plugin-eval', 'benchmark.json');
  const targetScorecardPath = path.join(targetPath, 'benchmarks', 'results', 'latest.json');
  const repositoryTargetPath = path.join(REPO_ROOT, '.plugin-eval', 'codex-package', 'skillquiver');
  const usesRepositoryEvidence = path.resolve(targetPath) === repositoryTargetPath;
  const usesTargetConfig = !options.configPath && fs.existsSync(targetConfigPath);
  const configPath = options.configPath || (usesTargetConfig
    ? targetConfigPath
    : usesRepositoryEvidence
      ? path.join(REPO_ROOT, '.plugin-eval', 'benchmark.json')
      : null);
  const scorecardPath = options.scorecardPath || (fs.existsSync(targetScorecardPath)
    ? targetScorecardPath
    : usesRepositoryEvidence
      ? path.join(REPO_ROOT, 'benchmarks', 'results', 'latest.json')
      : null);
  const requireArchiveHash = options.requireArchiveHash ?? usesRepositoryEvidence;
  const config = configPath && fs.existsSync(configPath) ? readJson(configPath) : null;
  const configuredScenarios = Array.isArray(config?.scenarios) ? config.scenarios : [];
  const ids = configuredScenarios
    .filter(scenario => typeof scenario?.id === 'string')
    .map(scenario => scenario.id);
  const missing = EXPECTED_IDS.filter(id => !ids.includes(id));
  const positiveCount = ids.filter(id => id.startsWith('p')).length;
  const negativeCount = ids.filter(id => id.startsWith('n')).length;
  const completeMatrix = missing.length === 0 && ids.length === EXPECTED_IDS.length;
  const scored = outcomeScorecard(scorecardPath, targetPath, requireArchiveHash);
  const latest = latestRun(targetPath);
  const runScenarios = scored?.scorecard.scenarios || latest?.result.scenarios || [];
  const evidenceCount = predicate => EXPECTED_IDS.filter(id =>
    runScenarios.some(scenario => scenario.id === id && predicate(scenario))
  ).length;
  const completedCount = evidenceCount(scenario =>
    (scenario.processStatus || scenario.status) === 'completed');
  const usageCount = evidenceCount(scenario =>
    typeof scenario.inputTokens === 'number' || scenario.usageAvailability === 'present');
  const outcomePassCount = scored
    ? evidenceCount(scenario => scenario.outcome === 'pass')
    : 0;
  const matchingRun = evidenceCount(() => true) === EXPECTED_IDS.length;

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

module.exports = { EXPECTED_IDS, artifactTreeSha256, evaluate };
