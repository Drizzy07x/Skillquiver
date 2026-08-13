const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  replayScorecard,
  validateCampaign
} = require('../benchmarks/skillhex/campaign.cjs');

function makeCampaign() {
  return {
    schemaVersion: 1,
    id: 'host-boundaries-pilot',
    targetSkill: 'handle-host-boundaries',
    baseline: {
      sourceCommit: '10bdb634a698ef4368a67e1c99306063d6faffce',
      scorecard: 'benchmarks/skillhex/baselines/host-boundaries-2.0.6.json'
    },
    evaluatorCases: 'benchmarks/skillhex/evaluator/host-boundaries.json',
    evaluatorSourceCommit: '42d54b2ec6898f103da1c98e357651bd4a7f74d9',
    splits: {
      development: [
        {
          id: 'dev-doctor-boundary',
          kind: 'negative',
          sourceScenarioId: 'n1-claude-only-doctor'
        },
        {
          id: 'dev-tool-boundary',
          kind: 'negative',
          sourceScenarioId: 'n3-unavailable-claude-tool'
        }
      ],
      heldOut: [
        {
          id: 'heldout-doctor-command',
          kind: 'negative',
          evaluatorCaseId: 'doctor-command'
        }
      ]
    },
    hypotheses: [
      {
        id: 'explicit-trigger-wording',
        status: 'active',
        attributedLayer: 'skill',
        falsifier: 'The baseline routes every held-out host-boundary case correctly.'
      },
      {
        id: 'static-warning-only',
        status: 'active',
        attributedLayer: 'evaluator',
        falsifier: 'A held-out host-boundary case fails under the baseline.'
      }
    ],
    nodes: [
      {
        id: 'baseline-2.0.6',
        parent: null,
        status: 'baseline',
        affectedSkill: 'handle-host-boundaries',
        attributedLayer: null,
        patch: null,
        hypothesisIds: [],
        developmentRunIds: [
          '019ff626-4124-7b31-bd0d-12bbf164d67d',
          '019ff626-ad7e-7681-8af0-1d5c9f0eb595'
        ],
        hardGates: [
          { id: 'catalog', result: 'pass' }
        ],
        evidence: [
          {
            caseId: 'dev-doctor-boundary',
            result: 'pass',
            checklistPassed: 3,
            checklistTotal: 3,
            durationMs: 100,
            tokens: 12
          },
          {
            caseId: 'dev-tool-boundary',
            result: 'pass',
            checklistPassed: 3,
            checklistTotal: 3,
            durationMs: 100,
            tokens: 12
          }
        ]
      }
    ]
  };
}

function makeEvaluatorCases() {
  return {
    schemaVersion: 1,
    campaignId: 'host-boundaries-pilot',
    visibility: 'evaluator-only',
    cases: [
      {
        id: 'doctor-command',
        hypothesisIds: ['explicit-trigger-wording', 'static-warning-only'],
        evidenceClass: 'hard-contract',
        evidenceSources: ['final-message', 'tool-trace', 'workspace-diff'],
        userInput: 'Run an unavailable command.',
        successChecklist: ['State the boundary.']
      }
    ]
  };
}

test('campaign accepts frozen disjoint splits and three-valued evidence', () => {
  assert.equal(validateCampaign(makeCampaign(), makeEvaluatorCases()), true);
});

test('campaign rejects split leakage and invalid evidence states', () => {
  const campaign = makeCampaign();
  const evaluatorCases = makeEvaluatorCases();
  campaign.splits.heldOut[0].id = 'dev-doctor-boundary';
  campaign.nodes[0].evidence[0].result = 'skipped';
  campaign.nodes[0].developmentRunIds[0] = 'boundary-result.json';
  evaluatorCases.cases[0].hypothesisIds = [];

  assert.throws(
    () => validateCampaign(campaign, evaluatorCases),
    error => {
      assert.match(error.message, /case IDs must be unique across splits/);
      assert.match(error.message, /evidence result must be pass, fail, or inconclusive/);
      assert.match(error.message, /developmentRunIds must contain UUIDs/);
      assert.match(error.message, /must name at least one hypothesis/);
      return true;
    }
  );
});

test('scorecard replay records pass, fail, and inconclusive evidence', () => {
  const campaign = makeCampaign();
  campaign.splits.development.push({
    id: 'dev-missing-run',
    kind: 'negative',
    sourceScenarioId: 'missing-scenario'
  });
  campaign.nodes[0].evidence.push({
    caseId: 'dev-missing-run',
    result: 'inconclusive',
    checklistPassed: null,
    checklistTotal: null,
    durationMs: null,
    tokens: null
  });
  const scorecard = {
    sourceCommit: campaign.baseline.sourceCommit,
    scenarios: [
      {
        id: 'n1-claude-only-doctor',
        processStatus: 'completed',
        outcome: 'pass',
        checklistPassed: 3,
        checklistTotal: 3,
        inputTokens: 10,
        outputTokens: 2,
        durationMs: 100
      },
      {
        id: 'n3-unavailable-claude-tool',
        processStatus: 'completed',
        outcome: 'fail',
        checklistPassed: 2,
        checklistTotal: 3,
        inputTokens: 20,
        outputTokens: 3,
        durationMs: 200
      }
    ]
  };
  const evidence = replayScorecard(campaign, scorecard, makeEvaluatorCases());

  assert.deepEqual(evidence.map(item => ({ caseId: item.caseId, result: item.result })), [
    { caseId: 'dev-doctor-boundary', result: 'pass' },
    { caseId: 'dev-tool-boundary', result: 'fail' },
    { caseId: 'dev-missing-run', result: 'inconclusive' }
  ]);
  assert.equal(evidence[0].tokens, 12);

  scorecard.sourceCommit = '0000000000000000000000000000000000000000';
  assert.throws(
    () => replayScorecard(campaign, scorecard, makeEvaluatorCases()),
    /scorecard sourceCommit does not match the frozen baseline/
  );
});

test('campaign CLI reports stable usage when arguments are missing', () => {
  const script = path.resolve(__dirname, '..', 'benchmarks', 'skillhex', 'campaign.cjs');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: campaign\.cjs <validate|replay>/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});
