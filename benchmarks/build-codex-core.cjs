const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readCoreConfig(root) {
  const config = readJson(path.join(root, 'submission', 'codex-core.json'));

  if (!Array.isArray(config.skills) || config.skills.length === 0) {
    throw new Error('Codex Core must select at least one skill.');
  }
  if (new Set(config.skills).size !== config.skills.length) {
    throw new Error('Codex Core skill names must be unique.');
  }

  for (const skill of config.skills) {
    if (!/^[a-z0-9-]+$/.test(skill)) {
      throw new Error(`Invalid Codex Core skill name: ${skill}`);
    }
    if (!fs.existsSync(path.join(root, 'skills', skill, 'SKILL.md'))) {
      throw new Error(`Codex Core skill is missing: ${skill}`);
    }
  }

  return config;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative);
}

function buildCodexCore(root, outputRoot) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(outputRoot);
  const artifactRoot = path.join(resolvedRoot, '.plugin-eval', 'codex-core');
  if (!isInside(artifactRoot, resolvedOutput) &&
      !isInside(path.resolve(os.tmpdir()), resolvedOutput)) {
    throw new Error('Codex Core output must be inside the artifact root or system temp.');
  }

  const config = readCoreConfig(resolvedRoot);
  const skillCount = config.skills.length;
  const sourceManifest = readJson(path.join(resolvedRoot, '.codex-plugin', 'plugin.json'));
  const manifest = {
    ...sourceManifest,
    description: `${skillCount} portable Agent Skills for representative Codex software workflows.`,
    interface: {
      ...sourceManifest.interface,
      displayName: 'Skillquiver Core',
      shortDescription: 'Focused software workflows',
      longDescription: `${skillCount} portable Agent Skills for planning, diagnosis, test-driven implementation, code review, static UI work, and safety-boundary handling in Codex.`
    }
  };

  fs.rmSync(resolvedOutput, { recursive: true, force: true });
  fs.mkdirSync(path.join(resolvedOutput, '.codex-plugin'), { recursive: true });
  fs.mkdirSync(path.join(resolvedOutput, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(resolvedOutput, 'assets'), { recursive: true });

  fs.writeFileSync(
    path.join(resolvedOutput, '.codex-plugin', 'plugin.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  fs.copyFileSync(
    path.join(resolvedRoot, 'assets', 'plugin-logo.png'),
    path.join(resolvedOutput, 'assets', 'plugin-logo.png')
  );
  fs.copyFileSync(
    path.join(resolvedRoot, 'LICENSE'),
    path.join(resolvedOutput, 'LICENSE')
  );

  for (const skill of config.skills) {
    fs.cpSync(
      path.join(resolvedRoot, 'skills', skill),
      path.join(resolvedOutput, 'skills', skill),
      { recursive: true }
    );
  }

  return { outputRoot: resolvedOutput, skills: config.skills };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const outputRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, '.plugin-eval', 'codex-core', 'skillquiver');
  process.stdout.write(`${JSON.stringify(buildCodexCore(root, outputRoot), null, 2)}\n`);
}

module.exports = { buildCodexCore, isInside, readCoreConfig };
