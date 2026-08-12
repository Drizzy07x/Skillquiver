const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CORE_LONG_DESCRIPTION = 'Skillquiver Core is a focused set of six reusable Codex workflows for decision-complete planning, evidence-first diagnosis, test-driven implementation, actionable code review, accessible static UI work, and safe host or destructive boundaries. It has no hosted backend, account, or authentication requirement; workflows run through Codex and user-approved local tools. The broader Skillquiver source catalog is distributed separately and is not part of this directory bundle.';
const CORE_CAPABILITIES = [
  'Read project files and relevant local context.',
  "Write project files when the user's task authorizes changes.",
  'Run host-approved local development commands and tests.',
  'Use optional host-provided browser, UI automation, or subagent capabilities when available.'
];
const PORTABLE_TEXT_EXTENSIONS = new Set([
  '.cjs', '.js', '.json', '.md', '.ps1', '.sh', '.txt', '.yaml', '.yml'
]);

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

function normalizePortableText(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      normalizePortableText(entryPath);
    }
    else if (entry.name === 'LICENSE' ||
      PORTABLE_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const content = fs.readFileSync(entryPath, 'utf8').replace(/\r\n?/g, '\n');
      fs.writeFileSync(entryPath, content);
    }
  }
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
      longDescription: CORE_LONG_DESCRIPTION,
      capabilities: CORE_CAPABILITIES
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

  normalizePortableText(resolvedOutput);

  return { outputRoot: resolvedOutput, skills: config.skills };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const outputRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, '.plugin-eval', 'codex-core', 'skillquiver');
  process.stdout.write(`${JSON.stringify(buildCodexCore(root, outputRoot), null, 2)}\n`);
}

module.exports = {
  CORE_CAPABILITIES,
  CORE_LONG_DESCRIPTION,
  buildCodexCore,
  isInside,
  normalizePortableText,
  readCoreConfig
};
