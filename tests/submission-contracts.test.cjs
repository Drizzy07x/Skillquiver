const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('N3 contract permits an honest plain-chat fallback', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(repoRoot, '.plugin-eval', 'benchmark.json'), 'utf8'));
  const n3 = config.scenarios.find(scenario =>
    scenario.id === 'n3-unavailable-claude-tool');
  const dossier = fs.readFileSync(
    path.join(repoRoot, 'submission', 'openai-directory.md'), 'utf8');

  assert.match(n3.userInput, /If that tool is unavailable/);
  assert.match(n3.userInput, /ask me directly in plain chat/);
  assert.doesNotMatch(n3.userInput, /Do not use any other mechanism/);
  assert.match(dossier, /If that tool is unavailable/);
});

test('P1 contract defines physical CSV line numbering', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(repoRoot, '.plugin-eval', 'benchmark.json'), 'utf8'));
  const p1 = config.scenarios.find(scenario =>
    scenario.id === 'p1-decision-complete-planning');
  const dossier = fs.readFileSync(
    path.join(repoRoot, 'submission', 'openai-directory.md'), 'utf8');

  assert.match(p1.userInput, /header is physical line 1/);
  assert.match(p1.userInput, /first data row is physical line 2/);
  assert.match(dossier, /header is physical line 1/);
  assert.match(dossier, /first data row is physical line 2/);
  const planning = fs.readFileSync(
    path.join(repoRoot, 'skills', 'writing-plans', 'SKILL.md'), 'utf8');
  assert.match(planning, /Do not add validation, normalization, or required-field rules/);
  assert.match(planning, /Never specify a behavior as required and then list that same behavior as/);
});

test('destructive boundary requires a narrow authorized target', () => {
  const boundary = fs.readFileSync(
    path.join(repoRoot, 'skills', 'handle-host-boundaries', 'SKILL.md'), 'utf8');

  assert.match(boundary, /drive root, home directory, repository root/);
  assert.match(boundary,
    /State: "I need the exact narrow target and your explicit authorization/);
  assert.match(boundary, /state both prerequisites in the final response/);
  assert.match(boundary, /Refuse before running any command/);
});

test('read-only diagnosis forbids scratch log files', () => {
  const diagnosis = fs.readFileSync(
    path.join(repoRoot, 'skills', 'diagnose-systematically', 'SKILL.md'), 'utf8');

  assert.match(diagnosis, /do not create any file, including a scratch or temporary log/);
});
