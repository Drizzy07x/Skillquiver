const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { digestPayload } = require('./integrity.cjs');

const IGNORED_WORKSPACE_ROOTS = new Set(['.agents', '.git', 'plugins']);
const USAGE = 'Usage: runner.cjs run <evaluation.json> <workspace-source> <execution-root>';

function pairedOrders(randomInt = crypto.randomInt) {
  const first = randomInt(2) === 0
    ? ['baseline', 'candidate']
    : ['candidate', 'baseline'];
  return [first, [...first].reverse(), randomInt(2) === 0
    ? ['baseline', 'candidate']
    : ['candidate', 'baseline']];
}

function createSchedule(evaluation, randomInt = crypto.randomInt) {
  return {
    schemaVersion: 1,
    evaluationId: evaluation.evaluationId,
    createdAt: new Date().toISOString(),
    cases: evaluation.cases.map(testCase => ({
      caseId: testCase.id,
      repeats: pairedOrders(randomInt).map((order, index) => ({
        repeat: index + 1,
        order
      }))
    }))
  };
}

function runCommand(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    input: '',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs || 60000,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${executable} ${args.slice(0, 3).join(' ')} exited ${result.status}: ${result.stderr}`);
  }
  return result;
}

function installPlugin({
  executable,
  workspacePath,
  homePath,
  codexHomePath,
  expectedDigest,
  commandRunner = runCommand
}) {
  const env = { ...process.env, HOME: homePath, CODEX_HOME: codexHomePath };
  commandRunner(executable, [
    'plugin', 'marketplace', 'add', workspacePath, '--json'
  ], { cwd: workspacePath, env });
  const added = commandRunner(executable, [
    'plugin', 'add', 'skillquiver@plugin-eval-benchmark', '--json'
  ], { cwd: workspacePath, env });
  const installed = JSON.parse(added.stdout);
  const installedPath = path.resolve(installed.installedPath || '');
  if (installed.name !== 'skillquiver' || !fs.existsSync(installedPath)) {
    throw new Error('Codex did not install Skillquiver from the isolated marketplace');
  }
  const installedDigest = digestPayload(installedPath).digest;
  if (installedDigest !== expectedDigest) {
    throw new Error(`Installed payload digest mismatch: expected ${expectedDigest}, got ${installedDigest}`);
  }
  return { installedPath, installedDigest, env };
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function snapshotWorkspace(root, relative = '') {
  const result = new Map();
  const current = path.join(root, relative);
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (!relative && IGNORED_WORKSPACE_ROOTS.has(entry.name)) continue;
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      for (const [key, value] of snapshotWorkspace(root, entryRelative)) result.set(key, value);
    } else if (entry.isFile()) {
      result.set(entryRelative.split(path.sep).join('/'), {
        sha256: hashFile(path.join(root, entryRelative)),
        size: fs.statSync(path.join(root, entryRelative)).size
      });
    }
  }
  return result;
}

function diffSnapshots(before, after) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.flatMap(filePath => {
    const left = before.get(filePath);
    const right = after.get(filePath);
    if (left?.sha256 === right?.sha256) return [];
    return [{
      path: filePath,
      status: !left ? 'added' : !right ? 'deleted' : 'modified',
      before: left || null,
      after: right || null
    }];
  });
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new Error(`Codex emitted a non-JSON event: ${line.slice(0, 160)}`);
    }
  }
  const completed = [...events].reverse().find(event => event.type === 'turn.completed');
  const commands = events
    .filter(event => event.type === 'item.completed' && event.item?.type === 'command_execution')
    .map(event => ({
      command: event.item.command,
      exitCode: event.item.exit_code,
      status: event.item.status
    }));
  return { events, commands, usage: completed?.usage || null };
}

function writeMarketplace(workspacePath) {
  const marketplacePath = path.join(workspacePath, '.agents', 'plugins', 'marketplace.json');
  const marketplace = {
    name: 'plugin-eval-benchmark',
    interface: { displayName: 'Plugin Eval Benchmark' },
    plugins: [{
      name: 'skillquiver',
      source: { source: 'local', path: './plugins/skillquiver' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Developer Tools'
    }]
  };
  fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
  fs.writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
}

function writeCodexConfig(codexHomePath) {
  const config = [
    'approval_policy = "never"',
    '',
    '[windows]',
    'sandbox = "unelevated"',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(codexHomePath, 'config.toml'), config);
}

function copyChangedFiles(workspacePath, changes, evidencePath) {
  for (const change of changes) {
    if (change.status === 'deleted') continue;
    const source = path.join(workspacePath, change.path);
    const destination = path.join(evidencePath, change.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function executeRun({
  evaluation,
  testCase,
  role,
  repeat,
  runRoot,
  workspaceSource,
  executable
}) {
  const ephemeralRoot = fs.mkdtempSync(path.join(os.tmpdir(), `skillhex-${testCase.id}-`));
  const workspacePath = path.join(ephemeralRoot, 'workspace');
  const homePath = path.join(ephemeralRoot, 'home');
  const codexHomePath = path.join(homePath, '.codex');
  const pluginPath = path.join(workspacePath, 'plugins', 'skillquiver');
  const stdoutPath = path.join(runRoot, 'codex.stdout.jsonl');
  const stderrPath = path.join(runRoot, 'codex.stderr.log');
  const finalMessagePath = path.join(runRoot, 'final-message.txt');
  fs.mkdirSync(runRoot, { recursive: true });
  fs.cpSync(workspaceSource, workspacePath, { recursive: true });
  fs.cpSync(evaluation[`${role}Path`], pluginPath, { recursive: true });
  fs.mkdirSync(codexHomePath, { recursive: true });
  const sourceAuth = path.join(os.homedir(), '.codex', 'auth.json');
  if (fs.existsSync(sourceAuth)) fs.copyFileSync(sourceAuth, path.join(codexHomePath, 'auth.json'));
  writeCodexConfig(codexHomePath);
  writeMarketplace(workspacePath);

  const expectedDigest = evaluation[`${role}Digest`];
  const sourceDigest = digestPayload(pluginPath).digest;
  if (sourceDigest !== expectedDigest) {
    throw new Error(`${role} run payload digest mismatch before installation`);
  }

  let outcome;
  try {
    const installed = installPlugin({
      executable,
      workspacePath,
      homePath,
      codexHomePath,
      expectedDigest
    });
    const before = snapshotWorkspace(workspacePath);
    const startedAt = Date.now();
    const codex = runCommand(executable, [
      'exec', '--json', '--skip-git-repo-check',
      '--output-last-message', finalMessagePath,
      '-m', 'gpt-5.4', '-s', 'workspace-write',
      '-C', workspacePath, testCase.userInput
    ], {
      cwd: workspacePath,
      env: installed.env,
      timeoutMs: 360000
    });
    const durationMs = Date.now() - startedAt;
    fs.writeFileSync(stdoutPath, codex.stdout);
    fs.writeFileSync(stderrPath, codex.stderr);
    const parsed = parseEvents(codex.stdout);
    const after = snapshotWorkspace(workspacePath);
    const workspaceChanges = diffSnapshots(before, after);
    copyChangedFiles(workspacePath, workspaceChanges, path.join(runRoot, 'workspace-after'));
    outcome = {
      schemaVersion: 1,
      runId: path.basename(runRoot),
      evaluationId: evaluation.evaluationId,
      caseId: testCase.id,
      role,
      repeat,
      status: 'completed',
      durationMs,
      finalMessagePath,
      rawEventLogPath: stdoutPath,
      stderrLogPath: stderrPath,
      usage: parsed.usage,
      commands: parsed.commands,
      workspaceChanges,
      installedDigest: installed.installedDigest
    };
  } finally {
    const resolved = path.resolve(ephemeralRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
  fs.writeFileSync(path.join(runRoot, 'result.json'), `${JSON.stringify(outcome, null, 2)}\n`);
  return outcome;
}

function runEvaluation({ evaluationPath, workspaceSource, executionRoot }) {
  const evaluation = JSON.parse(fs.readFileSync(path.resolve(evaluationPath), 'utf8'));
  const resolvedWorkspace = path.resolve(workspaceSource);
  const resolvedExecution = path.resolve(executionRoot);
  const executable = process.env.PLUGIN_EVAL_CODEX_EXECUTABLE || 'codex';
  for (const role of ['baseline', 'candidate']) {
    const actual = digestPayload(evaluation[`${role}Path`]).digest;
    if (actual !== evaluation[`${role}Digest`]) {
      throw new Error(`${role} sealed payload digest mismatch`);
    }
  }
  fs.mkdirSync(resolvedExecution, { recursive: true });
  const schedulePath = path.join(resolvedExecution, 'schedule.json');
  const schedule = fs.existsSync(schedulePath)
    ? JSON.parse(fs.readFileSync(schedulePath, 'utf8'))
    : createSchedule(evaluation);
  if (!fs.existsSync(schedulePath)) {
    fs.writeFileSync(schedulePath, `${JSON.stringify(schedule, null, 2)}\n`);
  }

  let completed = 0;
  const total = evaluation.cases.length * 3 * 2;
  for (const scheduledCase of schedule.cases) {
    const testCase = evaluation.cases.find(item => item.id === scheduledCase.caseId);
    if (!testCase) throw new Error(`Unknown scheduled case: ${scheduledCase.caseId}`);
    for (const scheduledRepeat of scheduledCase.repeats) {
      for (const role of scheduledRepeat.order) {
        const runId = `${testCase.id}-r${scheduledRepeat.repeat}-${role}`;
        const runRoot = path.join(resolvedExecution, 'runs', runId);
        const resultPath = path.join(runRoot, 'result.json');
        if (fs.existsSync(resultPath)) {
          const prior = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
          if (prior.status !== 'completed') throw new Error(`Incomplete prior run: ${runId}`);
          completed += 1;
          process.stdout.write(`SKIP ${completed}/${total} ${runId}\n`);
          continue;
        }
        executeRun({
          evaluation,
          testCase,
          role,
          repeat: scheduledRepeat.repeat,
          runRoot,
          workspaceSource: resolvedWorkspace,
          executable
        });
        completed += 1;
        process.stdout.write(`DONE ${completed}/${total} ${runId}\n`);
      }
    }
  }
  return { completed, total, schedulePath };
}

function runCli(args) {
  const [command, evaluationPath, workspaceSource, executionRoot] = args;
  if (command !== 'run' || !evaluationPath || !workspaceSource || !executionRoot) {
    throw new Error(USAGE);
  }
  return runEvaluation({ evaluationPath, workspaceSource, executionRoot });
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  createSchedule,
  diffSnapshots,
  executeRun,
  installPlugin,
  pairedOrders,
  runCli,
  runEvaluation,
  writeCodexConfig
};
