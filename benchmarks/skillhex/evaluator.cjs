const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  assertSafeId,
  canonicalPath,
  isWithin,
  pathsOverlap
} = require('./boundaries.cjs');
const { validateCampaign } = require('./campaign.cjs');
const { digestGitPayload, digestPayload } = require('./integrity.cjs');

const USAGE = 'Usage: evaluator.cjs prepare <campaign.json> <baseline-path> <candidate-path> <output-root> | score <campaign.json> <evaluation.json> <assessment.json>';
const EVIDENCE_RESULTS = new Set(['pass', 'fail', 'inconclusive']);
const EVALUATION_POLICY = Object.freeze({
  candidateAccess: 'read-only',
  candidateCanReadEvaluation: false,
  pairedRepeats: 3,
  randomizedOrder: true,
  allHardContractsMustPass: true,
  negativeRegressionAllowed: false,
  compareEfficiencyAfterBehavior: true
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function digestJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function repositoryRoot(campaignPath) {
  return execFileSync('git', [
    '-C', path.dirname(campaignPath), 'rev-parse', '--show-toplevel'
  ], { encoding: 'utf8' }).trim();
}

function readCampaignBundle(campaignPath) {
  const resolvedCampaign = canonicalPath(campaignPath);
  const root = canonicalPath(repositoryRoot(resolvedCampaign));
  const campaign = readJson(resolvedCampaign);
  const evaluatorCases = JSON.parse(execFileSync('git', [
    '-C', root,
    'show', `${campaign.evaluatorSourceCommit}:${campaign.evaluatorCases}`
  ], { encoding: 'utf8' }));
  validateCampaign(campaign, evaluatorCases);
  assertSafeId(campaign.id, 'campaign id');
  return { campaign, evaluatorCases, root };
}

function assertNoEvaluatorLeakage(candidatePath, files, manifest, evaluatorCases) {
  const protectedText = evaluatorCases.cases.flatMap(item => [
    item.id,
    item.userInput,
    ...item.successChecklist
  ]);
  if (protectedText.some(value => value && JSON.stringify(manifest).includes(value))) {
    throw new Error('Candidate payload contains evaluator-only text: candidate.json');
  }
  for (const relativePath of files) {
    const content = fs.readFileSync(path.join(candidatePath, relativePath));
    if (content.includes(0)) continue;
    const text = content.toString('utf8');
    if (protectedText.some(value => value && text.includes(value))) {
      throw new Error(`Candidate payload contains evaluator-only text: ${relativePath}`);
    }
  }
}

function prepareEvaluation({ campaignPath, baselinePath, candidatePath, outputRoot }) {
  const requestedBaseline = path.resolve(baselinePath);
  const requestedCandidate = path.resolve(candidatePath);
  const requestedOutput = path.resolve(outputRoot);
  if (!fs.existsSync(requestedBaseline) || !fs.statSync(requestedBaseline).isDirectory()) {
    throw new Error('baseline-path must be an existing directory');
  }
  if (!fs.existsSync(requestedCandidate) || !fs.statSync(requestedCandidate).isDirectory()) {
    throw new Error('candidate-path must be an existing directory');
  }
  if (!fs.existsSync(requestedOutput) || !fs.statSync(requestedOutput).isDirectory()) {
    throw new Error('output-root must be an existing directory');
  }
  const resolvedBaseline = canonicalPath(requestedBaseline);
  const resolvedCandidate = canonicalPath(requestedCandidate);
  const resolvedOutput = canonicalPath(requestedOutput);
  if (pathsOverlap(resolvedBaseline, resolvedCandidate) ||
      pathsOverlap(resolvedBaseline, resolvedOutput) ||
      pathsOverlap(resolvedCandidate, resolvedOutput)) {
    throw new Error('baseline, candidate, and evaluator output paths must be disjoint');
  }

  const { campaign, evaluatorCases, root } = readCampaignBundle(campaignPath);
  if (isWithin(root, resolvedBaseline) ||
      isWithin(root, resolvedCandidate) ||
      isWithin(root, resolvedOutput)) {
    throw new Error('baseline, candidate, and evaluator output paths must be outside the repository');
  }
  const baseline = readJson(path.join(resolvedBaseline, 'candidate.json'));
  const candidate = readJson(path.join(resolvedCandidate, 'candidate.json'));
  assertSafeId(candidate.candidateId, 'candidateId');
  for (const [role, manifest] of [['Baseline', baseline], ['Candidate', candidate]]) {
    if (manifest.campaignId !== campaign.id ||
        manifest.sourceCommit !== campaign.baseline.sourceCommit ||
        manifest.targetSkill !== campaign.targetSkill) {
      throw new Error(`${role} identity does not match the frozen campaign`);
    }
  }
  const baselinePayload = digestPayload(resolvedBaseline);
  const candidatePayload = digestPayload(resolvedCandidate);
  const frozenPayload = digestGitPayload(
    root,
    campaign.baseline.sourceCommit,
    [
      '.codex-plugin/plugin.json',
      'assets/plugin-logo.png',
      `skills/${campaign.targetSkill}`
    ]
  );
  if (baselinePayload.digest !== frozenPayload.digest) {
    throw new Error('Baseline payload does not match the frozen Git payload');
  }
  if (candidate.baselineDigest !== frozenPayload.digest) {
    throw new Error('Candidate baseline digest does not match the frozen Git payload');
  }
  if (candidatePayload.digest !== candidate.candidateDigest) {
    throw new Error('Candidate payload digest does not match candidate.json');
  }
  assertNoEvaluatorLeakage(
    resolvedCandidate, candidatePayload.files, candidate, evaluatorCases);

  const evaluationPath = path.resolve(
    resolvedOutput, `${campaign.id}--${candidate.candidateId}`);
  if (!isWithin(resolvedOutput, evaluationPath)) {
    throw new Error('Evaluator destination must remain inside output-root');
  }
  if (fs.existsSync(evaluationPath)) {
    throw new Error(`Evaluator destination already exists: ${evaluationPath}`);
  }

  const evaluation = {
    schemaVersion: 1,
    evaluationId: `${campaign.id}--${candidate.candidateId}`,
    campaignId: campaign.id,
    baselineId: baseline.candidateId,
    baselinePath: resolvedBaseline,
    baselineDigest: baselinePayload.digest,
    candidateId: candidate.candidateId,
    candidatePath: resolvedCandidate,
    candidateDigest: candidatePayload.digest,
    sourceCommit: candidate.sourceCommit,
    targetSkill: candidate.targetSkill,
    status: 'prepared',
    executed: false,
    policy: { ...EVALUATION_POLICY },
    evaluatorCasesDigest: digestJson(evaluatorCases),
    cases: evaluatorCases.cases
  };

  fs.mkdirSync(evaluationPath);
  try {
    fs.writeFileSync(
      path.join(evaluationPath, 'evaluation.json'),
      `${JSON.stringify(evaluation, null, 2)}\n`
    );
    return {
      evaluationPath,
      evaluationId: evaluation.evaluationId,
      baselineDigest: evaluation.baselineDigest,
      candidateDigest: evaluation.candidateDigest,
      caseCount: evaluation.cases.length,
      executed: false
    };
  } catch (error) {
    fs.rmSync(evaluationPath, { recursive: true, force: true });
    throw error;
  }
}

function scoreAssessment(evaluation, assessment, evaluatorCases) {
  if (Object.entries(EVALUATION_POLICY).some(
    ([key, value]) => evaluation?.policy?.[key] !== value
  )) {
    throw new Error('Prepared evaluation policy does not match the independent evaluator contract');
  }
  if (!evaluatorCases ||
      !Array.isArray(evaluation?.cases) ||
      !Array.isArray(evaluatorCases.cases) ||
      evaluation.evaluatorCasesDigest !== digestJson(evaluatorCases) ||
      digestJson(evaluation?.cases) !== digestJson(evaluatorCases?.cases)) {
    throw new Error('Prepared evaluation does not match the frozen evaluator cases');
  }
  if (assessment?.schemaVersion !== 1 ||
      assessment?.evaluationId !== evaluation?.evaluationId ||
      assessment?.baselineDigest !== evaluation?.baselineDigest ||
      assessment?.candidateDigest !== evaluation?.candidateDigest) {
    throw new Error('Assessment identity does not match the prepared evaluation');
  }

  const repeats = evaluation.policy?.pairedRepeats;
  const cases = Array.isArray(evaluation?.cases) ? evaluation.cases : [];
  const runs = Array.isArray(assessment?.runs) ? assessment.runs : [];
  const expectedKeys = cases.flatMap(item =>
    Array.from({ length: repeats }, (_, index) => `${item.id}:${index + 1}`));
  const actualKeys = runs.map(run => `${run.caseId}:${run.repeat}`);
  const uniqueKeys = new Set(actualKeys);
  const complete = expectedKeys.length === actualKeys.length &&
    uniqueKeys.size === actualKeys.length &&
    expectedKeys.every(key => uniqueKeys.has(key));
  const orderBalanced = cases.every(item => {
    const orders = new Set(runs
      .filter(run => run.caseId === item.id)
      .map(run => JSON.stringify(run.order)));
    return orders.has('["baseline","candidate"]') &&
      orders.has('["candidate","baseline"]');
  });

  if (!complete || !orderBalanced) {
    return {
      evaluationId: evaluation.evaluationId,
      verdict: 'inconclusive',
      behavior: 'inconclusive',
      reason: complete
        ? 'Paired order was not varied across the assessment.'
        : 'Assessment does not contain every required case and repeat exactly once.',
      autoPromoted: false
    };
  }

  const totals = {
    baselinePass: 0,
    baselineFail: 0,
    baselineInconclusive: 0,
    candidatePass: 0,
    candidateFail: 0,
    candidateInconclusive: 0,
    baselineTokens: 0,
    candidateTokens: 0,
    baselineDurationMs: 0,
    candidateDurationMs: 0
  };

  for (const run of runs) {
    const testCase = cases.find(item => item.id === run.caseId);
    if (!testCase ||
        !Array.isArray(run.order) ||
        !['baseline,candidate', 'candidate,baseline'].includes(run.order.join(','))) {
      throw new Error('Assessment run has an invalid case or paired order');
    }
    for (const role of ['baseline', 'candidate']) {
      const outcome = run[role];
      if (!Array.isArray(outcome?.checklist) ||
          outcome.checklist.length !== testCase.successChecklist.length) {
        throw new Error(`Assessment run has incomplete ${role} evidence`);
      }
      if (!Number.isInteger(outcome.tokens) || outcome.tokens < 0 ||
          !Number.isFinite(outcome.durationMs) || outcome.durationMs < 0) {
        throw new Error(`Assessment run has invalid ${role} non-negative efficiency evidence`);
      }
      totals[`${role}Tokens`] += outcome.tokens;
      totals[`${role}DurationMs`] += outcome.durationMs;
      for (const item of outcome.checklist) {
        if (!EVIDENCE_RESULTS.has(item?.result) ||
            !Array.isArray(item?.evidence) || item.evidence.length === 0) {
          throw new Error(`Assessment run has invalid ${role} checklist evidence`);
        }
        const suffix = item.result[0].toUpperCase() + item.result.slice(1);
        totals[`${role}${suffix}`] += 1;
      }
    }
  }

  let verdict;
  let behavior;
  if (totals.candidateFail > 0) {
    verdict = 'rejected';
    behavior = 'candidate-worse';
  } else if (totals.candidateInconclusive > 0 || totals.baselineInconclusive > 0) {
    verdict = 'inconclusive';
    behavior = 'inconclusive';
  } else if (totals.candidatePass > totals.baselinePass) {
    verdict = 'eligible-for-human-review';
    behavior = 'candidate-better';
  } else if (totals.candidatePass === totals.baselinePass &&
      evaluation.policy.compareEfficiencyAfterBehavior &&
      totals.candidateTokens < totals.baselineTokens) {
    verdict = 'eligible-for-human-review';
    behavior = 'behavior-tie-candidate-cheaper';
  } else {
    verdict = 'no-improvement';
    behavior = totals.candidatePass === totals.baselinePass
      ? 'behavior-tie'
      : 'candidate-worse';
  }

  return {
    evaluationId: evaluation.evaluationId,
    verdict,
    behavior,
    totals,
    autoPromoted: false
  };
}

function runCli(args) {
  const [command, ...commandArgs] = args;
  if (command === 'prepare' && commandArgs.length === 4) {
    const [campaignPath, baselinePath, candidatePath, outputRoot] = commandArgs;
    return prepareEvaluation({
      campaignPath,
      baselinePath,
      candidatePath,
      outputRoot
    });
  }
  if (command === 'score' && commandArgs.length === 3) {
    const [campaignPath, evaluationPath, assessmentPath] = commandArgs;
    const { evaluatorCases } = readCampaignBundle(campaignPath);
    return scoreAssessment(
      readJson(evaluationPath), readJson(assessmentPath), evaluatorCases);
  }
  throw new Error(USAGE);
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { pathsOverlap, prepareEvaluation, runCli, scoreAssessment };
