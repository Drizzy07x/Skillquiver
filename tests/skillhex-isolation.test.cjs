const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const campaignPath = path.join(
  repoRoot, 'benchmarks', 'skillhex', 'host-boundaries.campaign.json');
const stagingScript = path.join(repoRoot, 'benchmarks', 'skillhex', 'staging.cjs');
const evaluatorScript = path.join(repoRoot, 'benchmarks', 'skillhex', 'evaluator.cjs');
const { scoreAssessment } = require('../benchmarks/skillhex/evaluator.cjs');
const { digestPayload } = require('../benchmarks/skillhex/integrity.cjs');

function readTree(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...readTree(entryPath));
    else files.push(entryPath);
  }
  return files;
}

function digestJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

test('candidate staging copies the frozen skill without held-out evaluator data', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-stage-'));
  const sourceSkill = path.join(repoRoot, 'skills', 'handle-host-boundaries', 'SKILL.md');
  const sourceBefore = fs.readFileSync(sourceSkill);

  try {
    const result = spawnSync(process.execPath, [
      stagingScript,
      'stage',
      campaignPath,
      'baseline-control',
      outputRoot
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const candidatePath = report.candidatePath;
    const manifest = JSON.parse(fs.readFileSync(
      path.join(candidatePath, 'candidate.json'), 'utf8'));
    const frozenSkill = spawnSync('git', [
      '-C', repoRoot,
      'show',
      `${manifest.sourceCommit}:skills/handle-host-boundaries/SKILL.md`
    ], { encoding: 'utf8' });
    const stagedText = readTree(candidatePath)
      .map(filePath => fs.readFileSync(filePath, 'utf8'))
      .join('\n');

    assert.equal(manifest.status, 'staged');
    assert.equal(manifest.candidateDigest, manifest.baselineDigest);
    assert.equal(path.basename(candidatePath), 'skillquiver');
    assert.equal(
      fs.existsSync(path.join(candidatePath, 'assets', 'plugin-logo.png')),
      true
    );
    assert.equal(frozenSkill.status, 0, frozenSkill.stderr);
    assert.equal(
      fs.readFileSync(path.join(
        candidatePath, 'skills', 'handle-host-boundaries', 'SKILL.md'), 'utf8'),
      frozenSkill.stdout
    );
    assert.doesNotMatch(stagedText, /doctor-command/);
    assert.doesNotMatch(stagedText, /silently choose PostgreSQL/);
    assert.deepEqual(fs.readFileSync(sourceSkill), sourceBefore);

    const extraArgument = spawnSync(process.execPath, [
      stagingScript,
      'stage',
      campaignPath,
      'extra-argument-control',
      outputRoot,
      'unexpected'
    ], { encoding: 'utf8' });
    assert.equal(extraArgument.status, 1);
    assert.match(extraArgument.stderr, /Usage: staging\.cjs/);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('candidate staging rejects an outside junction that resolves into the repository', () => {
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-alias-'));
  const outputAlias = path.join(aliasRoot, 'repository-alias');

  try {
    fs.symlinkSync(repoRoot, outputAlias, 'junction');
    const result = spawnSync(process.execPath, [
      stagingScript,
      'stage',
      campaignPath,
      'junction-control',
      outputAlias
    ], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside the repository/);
  } finally {
    fs.rmSync(aliasRoot, { recursive: true, force: true });
  }
});

test('independent evaluator prepares held-out work outside the candidate stage', () => {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-stage-'));
  const evaluationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-eval-'));
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-alias-'));

  try {
    const baselineStage = spawnSync(process.execPath, [
      stagingScript, 'stage', campaignPath, 'baseline-control', stageRoot
    ], { encoding: 'utf8' });
    const candidateStage = spawnSync(process.execPath, [
      stagingScript, 'stage', campaignPath, 'candidate-control', stageRoot
    ], { encoding: 'utf8' });
    assert.equal(baselineStage.status, 0, baselineStage.stderr);
    assert.equal(candidateStage.status, 0, candidateStage.stderr);
    const baselinePath = JSON.parse(baselineStage.stdout).candidatePath;
    const candidatePath = JSON.parse(candidateStage.stdout).candidatePath;
    const candidateBefore = readTree(candidatePath)
      .map(filePath => [
        path.relative(candidatePath, filePath),
        fs.readFileSync(filePath).toString('base64')
      ]);

    const prepared = spawnSync(process.execPath, [
      evaluatorScript,
      'prepare',
      campaignPath,
      baselinePath,
      candidatePath,
      evaluationRoot
    ], { encoding: 'utf8' });
    assert.equal(prepared.status, 0, prepared.stderr);
    const report = JSON.parse(prepared.stdout);
    const evaluation = JSON.parse(fs.readFileSync(
      path.join(report.evaluationPath, 'evaluation.json'), 'utf8'));
    const candidateAfter = readTree(candidatePath)
      .map(filePath => [
        path.relative(candidatePath, filePath),
        fs.readFileSync(filePath).toString('base64')
      ]);
    const candidateText = candidateAfter
      .map(([, content]) => Buffer.from(content, 'base64').toString('utf8'))
      .join('\n');

    assert.equal(evaluation.candidateDigest, report.candidateDigest);
    assert.equal(evaluation.baselineDigest, report.baselineDigest);
    assert.equal(evaluation.cases.length, 4);
    assert.equal(evaluation.policy.pairedRepeats, 3);
    assert.equal(evaluation.policy.allHardContractsMustPass, true);
    assert.match(JSON.stringify(evaluation), /silently choose PostgreSQL/);
    assert.doesNotMatch(candidateText, /silently choose PostgreSQL/);
    assert.deepEqual(candidateAfter, candidateBefore);

    const candidateAlias = path.join(aliasRoot, 'candidate-alias');
    fs.symlinkSync(candidatePath, candidateAlias, 'junction');
    const aliased = spawnSync(process.execPath, [
      evaluatorScript,
      'prepare',
      campaignPath,
      baselinePath,
      candidatePath,
      candidateAlias
    ], { encoding: 'utf8' });
    assert.equal(aliased.status, 1);
    assert.match(aliased.stderr, /paths must be disjoint/);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(evaluationRoot, { recursive: true, force: true });
    fs.rmSync(aliasRoot, { recursive: true, force: true });
  }
});

test('independent evaluator anchors the baseline to the frozen Git payload', () => {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-stage-'));
  const evaluationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-eval-'));

  try {
    const baselineStage = spawnSync(process.execPath, [
      stagingScript, 'stage', campaignPath, 'baseline-control', stageRoot
    ], { encoding: 'utf8' });
    const candidateStage = spawnSync(process.execPath, [
      stagingScript, 'stage', campaignPath, 'candidate-control', stageRoot
    ], { encoding: 'utf8' });
    assert.equal(baselineStage.status, 0, baselineStage.stderr);
    assert.equal(candidateStage.status, 0, candidateStage.stderr);
    const baselinePath = JSON.parse(baselineStage.stdout).candidatePath;
    const candidatePath = JSON.parse(candidateStage.stdout).candidatePath;
    fs.appendFileSync(path.join(
      baselinePath, 'skills', 'handle-host-boundaries', 'SKILL.md'), '\nTampered.\n');
    const manifestPath = path.join(baselinePath, 'candidate.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const selfAttestedPayload = digestPayload(baselinePath);
    manifest.baselineDigest = selfAttestedPayload.digest;
    manifest.candidateDigest = selfAttestedPayload.digest;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const prepared = spawnSync(process.execPath, [
      evaluatorScript,
      'prepare',
      campaignPath,
      baselinePath,
      candidatePath,
      evaluationRoot
    ], { encoding: 'utf8' });

    assert.equal(prepared.status, 1);
    assert.match(prepared.stderr, /frozen Git payload/);
    assert.deepEqual(fs.readdirSync(evaluationRoot), []);

    fs.copyFileSync(
      path.join(candidatePath, 'skills', 'handle-host-boundaries', 'SKILL.md'),
      path.join(baselinePath, 'skills', 'handle-host-boundaries', 'SKILL.md')
    );
    const restoredPayload = digestPayload(baselinePath);
    manifest.baselineDigest = restoredPayload.digest;
    manifest.candidateDigest = restoredPayload.digest;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const candidateManifestPath = path.join(candidatePath, 'candidate.json');
    const candidateManifest = JSON.parse(fs.readFileSync(candidateManifestPath, 'utf8'));
    candidateManifest.baselineDigest = 'c'.repeat(64);
    fs.writeFileSync(
      candidateManifestPath,
      `${JSON.stringify(candidateManifest, null, 2)}\n`
    );

    const falseLineage = spawnSync(process.execPath, [
      evaluatorScript,
      'prepare',
      campaignPath,
      baselinePath,
      candidatePath,
      evaluationRoot
    ], { encoding: 'utf8' });
    assert.equal(falseLineage.status, 1);
    assert.match(falseLineage.stderr, /Candidate baseline digest/);
    assert.deepEqual(fs.readdirSync(evaluationRoot), []);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(evaluationRoot, { recursive: true, force: true });
  }
});

test('independent scorer gates behavior before cost and never auto-promotes', () => {
  const evaluation = {
    schemaVersion: 1,
    evaluationId: 'synthetic-evaluation',
    baselineDigest: 'a'.repeat(64),
    candidateDigest: 'b'.repeat(64),
    policy: {
      candidateAccess: 'read-only',
      candidateCanReadEvaluation: false,
      pairedRepeats: 3,
      randomizedOrder: true,
      allHardContractsMustPass: true,
      negativeRegressionAllowed: false,
      compareEfficiencyAfterBehavior: true
    },
    cases: ['first-case', 'second-case'].map(id => ({
      id,
      evidenceClass: 'hard-contract',
      successChecklist: ['First contract', 'Second contract']
    }))
  };
  const frozenEvaluatorCases = {
    schemaVersion: 1,
    campaignId: 'synthetic-campaign',
    visibility: 'evaluator-only',
    cases: evaluation.cases
  };
  evaluation.evaluatorCasesDigest = digestJson(frozenEvaluatorCases);
  const runs = evaluation.cases.flatMap(testCase => [1, 2, 3].map(repeat => ({
      caseId: testCase.id,
      repeat,
      order: repeat === 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
      baseline: {
        checklist: [
          {
            result: testCase.id === 'first-case' && repeat === 1 ? 'fail' : 'pass',
            evidence: ['baseline evidence']
          },
          { result: 'pass', evidence: ['baseline evidence'] }
        ],
        tokens: 100,
        durationMs: 1000
      },
      candidate: {
        checklist: [
          { result: 'pass', evidence: ['candidate evidence'] },
          { result: 'pass', evidence: ['candidate evidence'] }
        ],
        tokens: 90,
        durationMs: 900
      }
    })));
  const assessment = {
    schemaVersion: 1,
    evaluationId: evaluation.evaluationId,
    baselineDigest: evaluation.baselineDigest,
    candidateDigest: evaluation.candidateDigest,
    runs
  };

  const score = scoreAssessment(evaluation, assessment, frozenEvaluatorCases);
  assert.equal(score.behavior, 'candidate-better');
  assert.equal(score.verdict, 'eligible-for-human-review');
  assert.equal(score.autoPromoted, false);

  const originalPolicy = evaluation.policy;
  evaluation.policy = { ...originalPolicy, pairedRepeats: 1 };
  assert.throws(
    () => scoreAssessment(evaluation, assessment, frozenEvaluatorCases),
    /independent evaluator contract/
  );
  evaluation.policy = originalPolicy;

  const tamperedEvaluation = JSON.parse(JSON.stringify(evaluation));
  tamperedEvaluation.cases.pop();
  tamperedEvaluation.evaluatorCasesDigest = digestJson({
    ...frozenEvaluatorCases,
    cases: tamperedEvaluation.cases
  });
  assert.throws(
    () => scoreAssessment(tamperedEvaluation, assessment, frozenEvaluatorCases),
    /frozen evaluator cases/
  );

  for (const run of assessment.runs.filter(run => run.caseId === 'second-case')) {
    run.order = ['baseline', 'candidate'];
  }
  assert.equal(
    scoreAssessment(evaluation, assessment, frozenEvaluatorCases).verdict,
    'inconclusive'
  );
  assessment.runs.find(run =>
    run.caseId === 'second-case' && run.repeat === 2
  ).order = ['candidate', 'baseline'];

  assessment.runs[0].candidate.tokens = -1;
  assert.throws(
    () => scoreAssessment(evaluation, assessment, frozenEvaluatorCases),
    /non-negative efficiency evidence/
  );
  assessment.runs[0].candidate.tokens = 90;

  assessment.runs[0].candidate.checklist[0].result = 'fail';
  assert.equal(
    scoreAssessment(evaluation, assessment, frozenEvaluatorCases).verdict,
    'rejected'
  );
});

test('independent evaluator rejects evaluator-only text in a sealed payload', () => {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-stage-'));
  const evaluationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skillhex-eval-'));

  try {
    const baselineStage = spawnSync(process.execPath, [
      stagingScript, 'stage', campaignPath, 'baseline-control', stageRoot
    ], { encoding: 'utf8' });
    const candidateStage = spawnSync(process.execPath, [
      stagingScript, 'stage', campaignPath, 'leaked-control', stageRoot
    ], { encoding: 'utf8' });
    assert.equal(baselineStage.status, 0, baselineStage.stderr);
    assert.equal(candidateStage.status, 0, candidateStage.stderr);
    const baselinePath = JSON.parse(baselineStage.stdout).candidatePath;
    const candidatePath = JSON.parse(candidateStage.stdout).candidatePath;
    const heldOut = JSON.parse(fs.readFileSync(path.join(
      repoRoot, 'benchmarks', 'skillhex', 'evaluator', 'host-boundaries.json'), 'utf8'));
    fs.writeFileSync(
      path.join(candidatePath, 'skills', 'handle-host-boundaries', 'leak.txt'),
      heldOut.cases[0].userInput
    );
    const manifestPath = path.join(candidatePath, 'candidate.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const payload = digestPayload(candidatePath);
    manifest.candidateDigest = payload.digest;
    manifest.payloadFileCount = payload.files.length;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const prepared = spawnSync(process.execPath, [
      evaluatorScript,
      'prepare',
      campaignPath,
      baselinePath,
      candidatePath,
      evaluationRoot
    ], { encoding: 'utf8' });

    assert.equal(prepared.status, 1);
    assert.match(prepared.stderr, /evaluator-only text/);
    assert.deepEqual(fs.readdirSync(evaluationRoot), []);

    fs.rmSync(path.join(
      candidatePath, 'skills', 'handle-host-boundaries', 'leak.txt'));
    const cleanPayload = digestPayload(candidatePath);
    manifest.candidateDigest = cleanPayload.digest;
    manifest.payloadFileCount = cleanPayload.files.length;
    manifest.evaluatorNote = heldOut.cases[0].userInput;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const metadataLeak = spawnSync(process.execPath, [
      evaluatorScript,
      'prepare',
      campaignPath,
      baselinePath,
      candidatePath,
      evaluationRoot
    ], { encoding: 'utf8' });
    assert.equal(metadataLeak.status, 1);
    assert.match(metadataLeak.stderr, /evaluator-only text.*candidate\.json/);
    assert.deepEqual(fs.readdirSync(evaluationRoot), []);

    delete manifest.evaluatorNote;
    manifest.candidateId = '../doctor-command';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const traversal = spawnSync(process.execPath, [
      evaluatorScript,
      'prepare',
      campaignPath,
      baselinePath,
      candidatePath,
      evaluationRoot
    ], { encoding: 'utf8' });
    assert.equal(traversal.status, 1);
    assert.match(traversal.stderr, /candidateId/);
    assert.deepEqual(fs.readdirSync(evaluationRoot), []);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(evaluationRoot, { recursive: true, force: true });
  }
});
