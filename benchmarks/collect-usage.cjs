const fs = require('node:fs');
const path = require('node:path');

function readTurnUsage(logPath) {
  let usage = null;
  for (const line of fs.readFileSync(logPath, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'turn.completed' && Number.isFinite(event.usage?.input_tokens)) {
        usage = event.usage;
      }
    } catch {}
  }
  return usage;
}

function normalizeUsage(usage) {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens ?? usage.input_tokens + usage.output_tokens,
    input_token_details: {
      cached_tokens: usage.input_token_details?.cached_tokens ?? usage.cached_input_tokens ?? 0
    },
    output_tokens_details: {
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? usage.reasoning_output_tokens ?? 0
    }
  };
}

function collectUsage(targetPath, configPath = path.join(targetPath, '.plugin-eval', 'benchmark.json')) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const scenarios = new Map(config.scenarios.map(scenario => [scenario.id, scenario.title]));
  const selected = new Map();
  const runsPath = path.join(targetPath, '.plugin-eval', 'runs');
  const runNames = fs.existsSync(runsPath) ? fs.readdirSync(runsPath).sort().reverse() : [];

  for (const runName of runNames) {
    const runPath = path.join(runsPath, runName);
    for (const entry of fs.readdirSync(runPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const scenarioId = [...scenarios.keys()].find(id => entry.name.endsWith(id));
      if (!scenarioId || selected.has(scenarioId)) continue;
      const logPath = path.join(runPath, entry.name, 'codex.stdout.jsonl');
      if (!fs.existsSync(logPath)) continue;
      const usage = readTurnUsage(logPath);
      if (!usage) continue;
      selected.set(scenarioId, {
        id: `skillquiver-${scenarioId}`,
        usage: normalizeUsage(usage),
        metadata: {
          scenario: scenarios.get(scenarioId),
          scenario_id: scenarioId,
          benchmark_target_name: 'skillquiver',
          benchmark_target_kind: 'plugin'
        }
      });
    }
  }

  return config.scenarios.flatMap(scenario => selected.has(scenario.id) ? [selected.get(scenario.id)] : []);
}

if (require.main === module) {
  const targetPath = path.resolve(process.argv[2] || '.');
  const outputPath = path.resolve(process.argv[3] || path.join(targetPath, '.plugin-eval', 'benchmark-usage.jsonl'));
  const configPath = process.argv[4]
    ? path.resolve(process.argv[4])
    : path.join(targetPath, '.plugin-eval', 'benchmark.json');
  const samples = collectUsage(targetPath, configPath);
  fs.writeFileSync(outputPath, samples.map(sample => JSON.stringify(sample)).join('\n') + (samples.length ? '\n' : ''));
  process.stdout.write(`${JSON.stringify({ outputPath, sampleCount: samples.length })}\n`);
}

module.exports = { collectUsage, normalizeUsage, readTurnUsage };
