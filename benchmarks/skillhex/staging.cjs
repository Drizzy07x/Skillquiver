const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { assertSafeId, canonicalPath, isWithin } = require('./boundaries.cjs');
const { digestPayload } = require('./integrity.cjs');

const USAGE = 'Usage: staging.cjs stage <campaign.json> <candidate-id> <output-root>';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function repositoryRoot(campaignPath) {
  return execFileSync('git', [
    '-C', path.dirname(campaignPath), 'rev-parse', '--show-toplevel'
  ], { encoding: 'utf8' }).trim();
}

function readGitFile(root, commit, relativePath) {
  return execFileSync('git', [
    '-C', root, 'show', `${commit}:${relativePath.split(path.sep).join('/')}`
  ]);
}

function listGitFiles(root, commit, relativePaths) {
  const output = execFileSync('git', [
    '-C', root,
    'ls-tree', '-r', '--name-only', commit, '--', ...relativePaths
  ], { encoding: 'utf8' });
  return output.split(/\r?\n/).filter(Boolean);
}

function stageCandidate({ campaignPath, candidateId, outputRoot }) {
  const resolvedCampaign = canonicalPath(campaignPath);
  const requestedOutput = path.resolve(outputRoot);
  assertSafeId(candidateId, 'candidate-id');
  if (!fs.existsSync(requestedOutput) || !fs.statSync(requestedOutput).isDirectory()) {
    throw new Error('output-root must be an existing directory');
  }
  const resolvedOutput = canonicalPath(requestedOutput);

  const candidateRoot = path.join(resolvedOutput, candidateId);
  const candidatePath = path.join(candidateRoot, 'skillquiver');
  if (fs.existsSync(candidateRoot)) {
    throw new Error(`Candidate destination already exists: ${candidateRoot}`);
  }

  const campaign = readJson(resolvedCampaign);
  const root = canonicalPath(repositoryRoot(resolvedCampaign));
  if (isWithin(root, resolvedOutput)) {
    throw new Error('output-root must be outside the repository');
  }
  const manifestPath = '.codex-plugin/plugin.json';
  const logoPath = 'assets/plugin-logo.png';
  const skillPath = `skills/${campaign.targetSkill}`;
  const files = listGitFiles(
    root, campaign.baseline.sourceCommit, [manifestPath, logoPath, skillPath]);
  if (!files.includes(manifestPath) ||
      !files.includes(logoPath) ||
      !files.includes(`${skillPath}/SKILL.md`)) {
    throw new Error('Frozen baseline is missing the manifest, logo, or target skill');
  }

  fs.mkdirSync(candidatePath, { recursive: true });
  try {
    for (const relativePath of files) {
      const destination = path.join(candidatePath, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, readGitFile(
        root, campaign.baseline.sourceCommit, relativePath));
    }

    const payload = digestPayload(candidatePath);
    const candidate = {
      schemaVersion: 1,
      campaignId: campaign.id,
      candidateId,
      parentNodeId: campaign.nodes[0].id,
      sourceCommit: campaign.baseline.sourceCommit,
      targetSkill: campaign.targetSkill,
      status: 'staged',
      baselineDigest: payload.digest,
      candidateDigest: payload.digest,
      payloadFileCount: payload.files.length
    };
    fs.writeFileSync(
      path.join(candidatePath, 'candidate.json'),
      `${JSON.stringify(candidate, null, 2)}\n`
    );
    return { candidatePath, ...candidate };
  } catch (error) {
    fs.rmSync(candidateRoot, { recursive: true, force: true });
    throw error;
  }
}

function runCli(args) {
  const [command, campaignPath, candidateId, outputRoot] = args;
  if (args.length !== 4 ||
      command !== 'stage' || !campaignPath || !candidateId || !outputRoot) {
    throw new Error(USAGE);
  }
  return stageCandidate({ campaignPath, candidateId, outputRoot });
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { runCli, stageCandidate };
