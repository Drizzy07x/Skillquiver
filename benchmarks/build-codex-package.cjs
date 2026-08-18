const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PACKAGE_LONG_DESCRIPTION = 'Skillquiver is a collection of 24 reusable Agent Skills for planning, implementation, debugging, review, verification, UI, host boundaries, agent instructions, and safe environment maintenance. The skills-only package works in ChatGPT and Codex; the same source catalog also supports Claude Code. It has no hosted backend, account, authentication, MCP server, bundled hooks, or app UI, and runs only through host-approved tools.';
const PACKAGE_CAPABILITIES = [
  'Read project files and relevant local context.',
  "Write project files when the user's task authorizes changes.",
  'Run host-approved local development commands and tests.',
  'Use optional host-provided browser, UI automation, or subagent capabilities when available.'
];
const PORTABLE_TEXT_EXTENSIONS = new Set([
  '.cjs', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.sh', '.txt', '.yaml', '.yml'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertPortableTree(directory) {
  if (fs.lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Codex package must not contain a symbolic link: ${directory}`);
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (fs.lstatSync(entryPath).isSymbolicLink()) {
      throw new Error(`Codex package must not contain a symbolic link: ${entryPath}`);
    }
    if (entry.isDirectory()) assertPortableTree(entryPath);
  }
}

function listSharedSkills(root) {
  const skillsRoot = path.join(root, 'skills');
  assertPortableTree(skillsRoot);
  const skills = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();

  if (skills.length !== 24) {
    throw new Error(`Codex package must contain exactly 24 skills; found ${skills.length}.`);
  }

  for (const skill of skills) {
    if (!/^[a-z0-9-]+$/.test(skill)) {
      throw new Error(`Invalid Codex skill name: ${skill}`);
    }
    const skillRoot = path.join(skillsRoot, skill);
    if (!fs.existsSync(path.join(skillRoot, 'SKILL.md'))) {
      throw new Error(`Codex package skill is missing SKILL.md: ${skill}`);
    }
  }

  return skills;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative);
}

function resolvePhysicalPath(candidate) {
  const missingSegments = [];
  let existingPath = path.resolve(candidate);

  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath);
    if (parent === existingPath) break;
    missingSegments.unshift(path.basename(existingPath));
    existingPath = parent;
  }

  return path.resolve(fs.realpathSync.native(existingPath), ...missingSegments);
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

function buildCodexPackage(root, outputRoot) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(outputRoot);
  const artifactRoot = path.join(resolvedRoot, '.plugin-eval', 'codex-package');
  const physicalOutput = resolvePhysicalPath(resolvedOutput);
  const physicalArtifactRoot = path.join(
    fs.realpathSync.native(resolvedRoot),
    '.plugin-eval',
    'codex-package'
  );
  const physicalTempRoot = fs.realpathSync.native(path.resolve(os.tmpdir()));
  if (!isInside(physicalArtifactRoot, physicalOutput) &&
      !isInside(physicalTempRoot, physicalOutput)) {
    throw new Error('Codex package output must be inside the artifact root or system temp.');
  }

  const skills = listSharedSkills(resolvedRoot);
  const sourceManifest = readJson(path.join(resolvedRoot, '.codex-plugin', 'plugin.json'));
  const manifest = {
    ...sourceManifest,
    interface: {
      ...sourceManifest.interface,
      displayName: 'Skillquiver',
      shortDescription: 'Practical software workflows',
      longDescription: PACKAGE_LONG_DESCRIPTION,
      capabilities: PACKAGE_CAPABILITIES
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

  for (const skill of skills) {
    fs.cpSync(
      path.join(resolvedRoot, 'skills', skill),
      path.join(resolvedOutput, 'skills', skill),
      { recursive: true }
    );
  }

  normalizePortableText(resolvedOutput);
  return { outputRoot: resolvedOutput, skills };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const outputRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, '.plugin-eval', 'codex-package', 'skillquiver');
  process.stdout.write(`${JSON.stringify(buildCodexPackage(root, outputRoot), null, 2)}\n`);
}

module.exports = {
  PACKAGE_CAPABILITIES,
  PACKAGE_LONG_DESCRIPTION,
  assertPortableTree,
  buildCodexPackage,
  isInside,
  listSharedSkills,
  normalizePortableText
};
