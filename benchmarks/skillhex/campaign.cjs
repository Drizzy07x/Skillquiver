const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE_RESULTS = new Set(['pass', 'fail', 'inconclusive']);
const CASE_KINDS = new Set(['positive', 'negative']);
const FAILURE_LAYERS = new Set(['skill', 'harness', 'evaluator', 'orchestration']);
const EVIDENCE_CLASSES = new Set(['hard-contract', 'diagnostic-proxy']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE = 'Usage: campaign.cjs <validate|replay> <campaign.json> [scorecard.json]';

function validateCampaign(campaign, evaluatorCases) {
  const errors = [];
  if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) {
    throw new Error('Invalid campaign:\n- campaign must be an object');
  }

  if (campaign.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!campaign.id) errors.push('id is required');
  if (!campaign.targetSkill) errors.push('targetSkill is required');
  if (!/^[0-9a-f]{40}$/i.test(campaign.baseline?.sourceCommit || '')) {
    errors.push('baseline.sourceCommit must be a full Git commit');
  }
  if (!campaign.baseline?.scorecard) errors.push('baseline.scorecard is required');
  if (!campaign.evaluatorCases) errors.push('evaluatorCases is required');

  const development = Array.isArray(campaign.splits?.development)
    ? campaign.splits.development
    : [];
  const heldOut = Array.isArray(campaign.splits?.heldOut)
    ? campaign.splits.heldOut
    : [];
  if (development.length === 0) errors.push('development split must not be empty');
  if (heldOut.length === 0) errors.push('heldOut split must not be empty');

  const cases = [...development, ...heldOut];
  const caseIds = cases.map(item => item?.id).filter(Boolean);
  if (new Set(caseIds).size !== caseIds.length) {
    errors.push('case IDs must be unique across splits');
  }
  for (const item of cases) {
    if (!item?.id) errors.push('every case requires an id');
    if (!CASE_KINDS.has(item?.kind)) {
      errors.push(`case ${item?.id || '<unknown>'} kind must be positive or negative`);
    }
  }
  for (const item of development) {
    if (!item?.sourceScenarioId) {
      errors.push(`development case ${item?.id || '<unknown>'} requires sourceScenarioId`);
    }
  }
  for (const item of heldOut) {
    if (!item?.evaluatorCaseId) {
      errors.push(`held-out case ${item?.id || '<unknown>'} requires evaluatorCaseId`);
    }
  }

  const hypotheses = Array.isArray(campaign.hypotheses) ? campaign.hypotheses : [];
  const hypothesisIds = hypotheses.map(item => item?.id).filter(Boolean);
  if (new Set(hypothesisIds).size !== hypothesisIds.length) {
    errors.push('hypothesis IDs must be unique');
  }
  for (const hypothesis of hypotheses) {
    if (!hypothesis?.id) errors.push('every hypothesis requires an id');
    if (hypothesis?.status !== 'active') {
      errors.push(`phase-1 hypothesis ${hypothesis?.id || '<unknown>'} must be active`);
    }
    if (!FAILURE_LAYERS.has(hypothesis?.attributedLayer)) {
      errors.push(`hypothesis ${hypothesis?.id || '<unknown>'} has an invalid attributedLayer`);
    }
    if (!hypothesis?.falsifier) {
      errors.push(`hypothesis ${hypothesis?.id || '<unknown>'} requires a falsifier`);
    }
  }

  const nodes = Array.isArray(campaign.nodes) ? campaign.nodes : [];
  if (nodes.length !== 1 || nodes[0]?.status !== 'baseline') {
    errors.push('phase 1 must contain exactly one baseline node');
  }
  for (const node of nodes) {
    if (!node?.id) errors.push('baseline node requires an id');
    if (node?.parent !== null) errors.push('baseline node parent must be null');
    if (node?.affectedSkill !== campaign.targetSkill) {
      errors.push('baseline node affectedSkill must match targetSkill');
    }
    if (!Object.hasOwn(node, 'attributedLayer') || node.attributedLayer !== null) {
      errors.push('baseline node attributedLayer must be recorded as null');
    }
    if (!Object.hasOwn(node, 'patch') || node.patch !== null) {
      errors.push('baseline node patch must be recorded as null');
    }
    if (!Array.isArray(node?.hypothesisIds)) {
      errors.push('baseline node hypothesisIds must be an array');
    }
    if (!Array.isArray(node?.developmentRunIds) || node.developmentRunIds.length === 0) {
      errors.push('baseline node requires developmentRunIds');
    } else if (node.developmentRunIds.some(id => !UUID.test(id))) {
      errors.push('baseline developmentRunIds must contain UUIDs');
    }
    if (!Array.isArray(node?.hardGates) || node.hardGates.length === 0) {
      errors.push('baseline node requires hardGates');
    }
    for (const gate of node?.hardGates || []) {
      if (!gate?.id || !EVIDENCE_RESULTS.has(gate?.result)) {
        errors.push('baseline hard gate requires an id and three-valued result');
      }
    }
    for (const evidence of node?.evidence || []) {
      if (!caseIds.includes(evidence?.caseId)) {
        errors.push('baseline evidence references an unknown case');
      }
      if (!EVIDENCE_RESULTS.has(evidence?.result)) {
        errors.push('baseline evidence result must be pass, fail, or inconclusive');
      }
      if (evidence?.result !== 'inconclusive' && (
        !Number.isFinite(evidence?.checklistPassed) ||
        !Number.isFinite(evidence?.checklistTotal) ||
        !Number.isFinite(evidence?.durationMs) ||
        !Number.isFinite(evidence?.tokens)
      )) {
        errors.push('conclusive baseline evidence requires checklist, duration, and token measurements');
      }
    }
    for (const item of development) {
      if (!(node?.evidence || []).some(evidence => evidence.caseId === item.id)) {
        errors.push(`baseline evidence is missing development case ${item.id}`);
      }
    }
  }

  validateEvaluatorCases(campaign, evaluatorCases, hypothesisIds, heldOut, errors);
  if (errors.length > 0) throw new Error(`Invalid campaign:\n- ${errors.join('\n- ')}`);
  return true;
}

function validateEvaluatorCases(campaign, evaluatorCases, hypothesisIds, heldOut, errors) {
  if (evaluatorCases?.schemaVersion !== 1) errors.push('evaluator schemaVersion must be 1');
  if (evaluatorCases?.campaignId !== campaign.id) errors.push('evaluator campaignId must match campaign id');
  if (evaluatorCases?.visibility !== 'evaluator-only') {
    errors.push('evaluator visibility must be evaluator-only');
  }
  const evaluatorItems = Array.isArray(evaluatorCases?.cases) ? evaluatorCases.cases : [];
  const expectedIds = heldOut.map(item => item.evaluatorCaseId);
  const actualIds = evaluatorItems.map(item => item?.id).filter(Boolean);
  if (expectedIds.length !== actualIds.length ||
      expectedIds.some(id => !actualIds.includes(id))) {
    errors.push('evaluator cases must match the frozen held-out split');
  }
  for (const item of evaluatorItems) {
    if (!Array.isArray(item?.hypothesisIds) || item.hypothesisIds.length === 0) {
      errors.push(`evaluator case ${item?.id || '<unknown>'} must name at least one hypothesis`);
    } else if (item.hypothesisIds.some(id => !hypothesisIds.includes(id))) {
      errors.push(`evaluator case ${item.id} references an unknown hypothesis`);
    }
    if (!EVIDENCE_CLASSES.has(item?.evidenceClass)) {
      errors.push(`evaluator case ${item?.id || '<unknown>'} has an invalid evidenceClass`);
    }
    if (!Array.isArray(item?.evidenceSources) || item.evidenceSources.length === 0) {
      errors.push(`evaluator case ${item?.id || '<unknown>'} requires evidenceSources`);
    }
    if (!item?.userInput || !Array.isArray(item?.successChecklist) || item.successChecklist.length === 0) {
      errors.push(`evaluator case ${item?.id || '<unknown>'} requires a prompt and checklist`);
    }
  }
}

function replayScorecard(campaign, scorecard, evaluatorCases) {
  validateCampaign(campaign, evaluatorCases);
  if (scorecard?.sourceCommit !== campaign.baseline.sourceCommit) {
    throw new Error('scorecard sourceCommit does not match the frozen baseline');
  }
  const scenarios = Array.isArray(scorecard?.scenarios) ? scorecard.scenarios : [];

  return campaign.splits.development.map(item => {
    const scenario = scenarios.find(candidate => candidate.id === item.sourceScenarioId);
    const completed = scenario?.processStatus === 'completed';
    const result = completed && (scenario.outcome === 'pass' || scenario.outcome === 'fail')
      ? scenario.outcome
      : 'inconclusive';
    const inputTokens = Number.isFinite(scenario?.inputTokens) ? scenario.inputTokens : null;
    const outputTokens = Number.isFinite(scenario?.outputTokens) ? scenario.outputTokens : null;

    return {
      caseId: item.id,
      sourceScenarioId: item.sourceScenarioId,
      result,
      checklistPassed: scenario?.checklistPassed ?? null,
      checklistTotal: scenario?.checklistTotal ?? null,
      tokens: inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null,
      durationMs: scenario?.durationMs ?? null,
      evidence: scenario?.evidence ?? null,
      reason: scenario?.reason ?? null
    };
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function runCli(args) {
  const [command, campaignPath, scorecardPath] = args;
  if (!['validate', 'replay'].includes(command) || !campaignPath) throw new Error(USAGE);

  const campaign = readJson(campaignPath);
  const evaluatorCases = readJson(campaign.evaluatorCases);
  const scorecard = readJson(scorecardPath || campaign.baseline.scorecard);
  const evidence = replayScorecard(campaign, scorecard, evaluatorCases);
  if (command === 'validate') {
    return { valid: true, campaign: campaign.id };
  }
  return evidence;
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { replayScorecard, runCli, validateCampaign };
