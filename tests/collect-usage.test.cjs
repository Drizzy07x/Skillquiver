const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { collectUsage, readTurnUsage } = require('../benchmarks/collect-usage.cjs');

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('collector keeps the newest valid sample and normalizes token details', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-usage-'));
  write(path.join(target, '.plugin-eval', 'benchmark.json'), JSON.stringify({
    scenarios: [{ id: 'p1-example', title: 'P1 example' }]
  }));
  write(path.join(target, '.plugin-eval', 'runs', '2026-01-01', '01-p1-example', 'codex.stdout.jsonl'),
    `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } })}\n`);
  write(path.join(target, '.plugin-eval', 'runs', '2026-01-02', '01-p1-example', 'codex.stdout.jsonl'),
    `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 3, cached_input_tokens: 8, reasoning_output_tokens: 1 } })}\n`);

  try {
    const [sample] = collectUsage(target);
    assert.equal(sample.usage.total_tokens, 23);
    assert.equal(sample.usage.input_token_details.cached_tokens, 8);
    assert.equal(sample.usage.output_tokens_details.reasoning_tokens, 1);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('collector rejects intermediate agent messages as usage telemetry', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-usage-'));
  const logPath = path.join(target, 'codex.stdout.jsonl');
  write(logPath, `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'still working' } })}\n`);

  try {
    assert.equal(readTurnUsage(logPath), null);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('collector accepts a benchmark config outside the package target', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-usage-'));
  const configPath = path.join(target, 'benchmark.json');
  write(configPath, JSON.stringify({
    scenarios: [{ id: 'p1-example', title: 'P1 example' }]
  }));
  write(path.join(target, '.plugin-eval', 'runs', '2026-01-01', '01-p1-example', 'codex.stdout.jsonl'),
    `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 2 } })}\n`);

  try {
    const [sample] = collectUsage(target, configPath);
    assert.equal(sample.usage.total_tokens, 9);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
