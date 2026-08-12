const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const sharedSkillsRoot = path.join(root, 'skills');
const claudeSkillsRoot = path.join(root, 'skills-claude');

function skillNames(skillsRoot) {
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort();
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readFrontmatterScalar(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    const parsed = JSON.parse(value);
    assert.equal(typeof parsed, 'string', 'frontmatter values must be strings');
    return parsed;
  }

  assert.match(value, /^[a-z0-9]/i, 'plain frontmatter values must start with text');
  assert.doesNotMatch(value, /:(?:\s|$)|(?:^|\s)#|\t/,
    'plain frontmatter values contain invalid YAML syntax');
  return value;
}

function readFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(match, 'SKILL.md must start with closed YAML frontmatter');

  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const pair = line.match(/^([a-z][a-z0-9_-]*):\s+(.+)$/);
    assert.ok(pair, `invalid frontmatter line: ${line}`);

    const [, key, rawValue] = pair;
    assert.equal(key in metadata, false, `duplicate frontmatter key: ${key}`);
    metadata[key] = readFrontmatterScalar(rawValue);
  }

  return metadata;
}

test('frontmatter parser rejects invalid YAML scalars', () => {
  for (const description of ['broken: value', "'unterminated"]) {
    assert.throws(() => readFrontmatter(
      `---\nname: example\ndescription: ${description}\n---\n`
    ));
  }
});

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '.git') return markdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

test('catalog contains 22 shared skills and one Claude-only skill', () => {
  const shared = skillNames(sharedSkillsRoot);
  const claudeOnly = skillNames(claudeSkillsRoot);
  const all = [...shared, ...claudeOnly];

  assert.equal(shared.length, 22);
  assert.ok(shared.includes('handle-host-boundaries'));
  assert.deepEqual(claudeOnly, ['skillquiver-doctor']);
  assert.equal(new Set(all).size, 23);

  for (const [skillsRoot, names] of [
    [sharedSkillsRoot, shared],
    [claudeSkillsRoot, claudeOnly]
  ]) {
    for (const name of names) {
      const content = fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf8');
      const frontmatter = readFrontmatter(content);
      assert.equal(frontmatter.name, name);
      assert.equal(typeof frontmatter.description, 'string');
      assert.ok(frontmatter.description.length > 0);
    }
  }
});

test('plugin manifests and marketplaces expose the intended catalogs', () => {
  const codexPlugin = readJson('.codex-plugin/plugin.json');
  const claudePlugin = readJson('.claude-plugin/plugin.json');
  const codexMarketplace = readJson('.agents/plugins/marketplace.json');
  const claudeMarketplace = readJson('.claude-plugin/marketplace.json');

  assert.equal(codexPlugin.name, 'skillquiver');
  assert.equal(codexPlugin.version, '2.0.0');
  assert.equal(codexPlugin.skills, './skills/');
  assert.deepEqual(codexPlugin.interface.capabilities, ['Read', 'Write']);
  assert.equal(codexPlugin.interface.category, 'Productivity');
  assert.equal(codexPlugin.interface.logo, './assets/plugin-logo.png');
  assert.equal(codexPlugin.interface.composerIcon, './assets/plugin-logo.png');
  assert.deepEqual(codexPlugin.interface.defaultPrompt, [
    'Turn this feature idea into a decision-complete implementation plan.',
    'Diagnose this failing test systematically and verify the root cause.',
    'Review this code change and report only evidence-backed findings.'
  ]);
  assert.ok(codexPlugin.interface.defaultPrompt.every(prompt => prompt.length <= 128));
  assert.ok(fs.existsSync(path.resolve(root, codexPlugin.interface.logo)));
  for (const key of ['websiteURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    assert.match(codexPlugin.interface[key], /^https:\/\//);
  }
  for (const key of ['mcpServers', 'apps', 'hooks']) assert.equal(key in codexPlugin, false);

  assert.equal(claudePlugin.name, 'skillquiver');
  assert.equal(claudePlugin.version, codexPlugin.version);
  assert.deepEqual(claudePlugin.skills, ['./skills', './skills-claude']);
  assert.match(codexPlugin.description, /Twenty-two portable Agent Skills/);
  assert.match(codexPlugin.interface.longDescription, /22 portable Agent Skills/);
  assert.match(claudePlugin.description, /Twenty-two Agent Skills shared/);

  assert.equal(codexMarketplace.name, 'skillquiver');
  assert.equal(codexMarketplace.interface.displayName, 'Skillquiver');
  assert.equal(codexMarketplace.plugins.length, 1);
  assert.deepEqual(codexMarketplace.plugins[0], {
    name: 'skillquiver',
    source: { source: 'local', path: './' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity'
  });

  assert.equal(claudeMarketplace.name, 'skillquiver');
  assert.match(claudeMarketplace.description, /Twenty-two Agent Skills shared/);
  assert.equal(claudeMarketplace.plugins.length, 1);
  assert.equal(claudeMarketplace.plugins[0].name, 'skillquiver');
  assert.equal(claudeMarketplace.plugins[0].source, './');
  assert.match(claudeMarketplace.plugins[0].description, /Twenty-two shared Agent Skills/);
});

test('Codex manifest declares unavailable Claude capabilities safely', () => {
  const codexPlugin = readJson('.codex-plugin/plugin.json');
  const boundary = `${codexPlugin.description} ${codexPlugin.interface.longDescription}`;
  const routing = fs.readFileSync(
    path.join(sharedSkillsRoot, 'handle-host-boundaries', 'SKILL.md'), 'utf8');

  assert.match(boundary, /Skillquiver Doctor/);
  assert.match(routing, /Skillquiver Doctor/);
  assert.match(routing, /Claude Code-only/);
  assert.match(routing, /Do not inspect or modify another host's configuration/);
  assert.match(routing, /ask it directly in plain chat/);
});

test('planning and review instructions preserve scope and findings', () => {
  const planning = fs.readFileSync(
    path.join(sharedSkillsRoot, 'writing-plans', 'SKILL.md'), 'utf8');
  const review = fs.readFileSync(
    path.join(sharedSkillsRoot, 'requesting-code-review', 'SKILL.md'), 'utf8');

  assert.match(planning, /Creating a plan file is a workspace change/);
  assert.match(planning, /Never silently choose them/);
  assert.match(planning, /Bounded inline planning/);
  assert.match(planning, /Do not inspect the\s+workspace/);
  assert.match(planning, /at most four implementation tasks/);
  assert.match(review, /standalone bounded read-only code review directly/);
  assert.match(review, /must\s+never erase an earlier verified issue/);
});

test('small static UI work has a bounded honest verification path', () => {
  const designUi = fs.readFileSync(
    path.join(sharedSkillsRoot, 'design-ui', 'SKILL.md'), 'utf8');

  assert.match(designUi, /Bounded path for a small static page/);
  assert.match(designUi, /Never delete the target file/);
  assert.match(designUi, /capture-static-page\.cjs/);
  assert.match(designUi, /If it fails, stop/);
});

test('README and website list every skill with matching compatibility', () => {
  const shared = skillNames(sharedSkillsRoot);
  const claudeOnly = skillNames(claudeSkillsRoot);
  const expected = [...shared, ...claudeOnly].sort();
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const groups = html.slice(html.indexOf('const GROUPS'), html.indexOf('const FLAT'));

  const readmeEntries = [...readme.matchAll(
    /\[([a-z0-9-]+)\]\(((?:skills|skills-claude)\/([a-z0-9-]+)\/SKILL\.md)\)/g
  )].map(match => ({ label: match[1], target: match[2], id: match[3] }));
  const siteEntries = [...groups.matchAll(
    /^\s+\["([a-z0-9-]+)",.*,\s*"(shared|claude)"\],?$/gm
  )].map(match => ({ id: match[1], compatibility: match[2] }));

  assert.deepEqual([...new Set(readmeEntries.map(entry => entry.id))].sort(), expected);
  assert.deepEqual([...new Set(siteEntries.map(entry => entry.id))].sort(), expected);
  assert.ok(readmeEntries.every(entry => entry.label === entry.id));

  for (const name of shared) {
    const entry = readmeEntries.find(candidate => candidate.id === name);
    assert.equal(entry.target, `skills/${name}/SKILL.md`);
    assert.match(readme.split(/\r?\n/).find(line => line.includes(`](${entry.target})`)),
      /!\[Claude Code \+ Codex\]/);
    assert.equal(siteEntries.find(candidate => candidate.id === name).compatibility, 'shared');
  }

  const doctor = readmeEntries.find(entry => entry.id === 'skillquiver-doctor');
  assert.equal(doctor.target, 'skills-claude/skillquiver-doctor/SKILL.md');
  assert.match(readme.split(/\r?\n/).find(line => line.includes(`](${doctor.target})`)),
    /!\[Claude Code only\]/);
  assert.equal(
    siteEntries.find(entry => entry.id === 'skillquiver-doctor').compatibility,
    'claude'
  );
});

test('local Markdown links resolve', () => {
  const missing = [];

  for (const file of markdownFiles(root)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(
      /(^|\r?\n)(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?\r?\n\2(?=\r?\n|$)/g,
      '\n'
    );

    for (const match of content.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)) {
      let target = match[1];
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      target = decodeURIComponent(target.split('#')[0]);
      if (!target) continue;

      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved)) {
        missing.push(`${path.relative(root, file)} -> ${target}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});
