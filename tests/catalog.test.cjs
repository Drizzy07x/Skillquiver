const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const sharedSkillsRoot = path.join(root, 'skills');

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

test('catalog contains 24 universal skills with OpenAI metadata', () => {
  const shared = skillNames(sharedSkillsRoot);

  assert.equal(shared.length, 24);
  assert.ok(shared.includes('handle-host-boundaries'));
  assert.ok(shared.includes('improve-agent-instructions'));
  assert.ok(shared.includes('skillquiver-doctor'));

  for (const name of shared) {
    const skillRoot = path.join(sharedSkillsRoot, name);
    const content = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const frontmatter = readFrontmatter(content);
    const metadata = fs.readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
    assert.equal(frontmatter.name, name);
    assert.equal(typeof frontmatter.description, 'string');
    assert.ok(frontmatter.description.length > 0);
    assert.match(metadata, /^interface:\r?$/m);
    const defaultPrompt = metadata.match(/^  default_prompt: "([^"]+)"\r?$/m);
    assert.ok(defaultPrompt, `${name} must expose a default prompt`);
    assert.doesNotMatch(defaultPrompt[1], /[$@]/,
      `${name} default prompt must be host-neutral`);
    assert.match(metadata, /^policy:\r?$/m);
    assert.doesNotMatch(metadata, /^  products:/m);
  }

  const doctorMetadata = fs.readFileSync(
    path.join(sharedSkillsRoot, 'skillquiver-doctor', 'agents', 'openai.yaml'), 'utf8');
  assert.match(doctorMetadata, /^  allow_implicit_invocation: false\r?$/m);
  assert.match(doctorMetadata, /default_prompt: "Audit this host and confirm each repair\."/);
});

test('plugin manifests and marketplaces expose the intended catalogs', () => {
  const codexPlugin = readJson('.codex-plugin/plugin.json');
  const claudePlugin = readJson('.claude-plugin/plugin.json');
  const codexMarketplace = readJson('.agents/plugins/marketplace.json');
  const claudeMarketplace = readJson('.claude-plugin/marketplace.json');

  assert.equal(codexPlugin.name, 'skillquiver');
  assert.equal(codexPlugin.version, '2.2.0');
  assert.equal(codexPlugin.skills, './skills/');
  assert.deepEqual(codexPlugin.interface.capabilities, [
    'Read project files and relevant local context.',
    "Write project files when the user's task authorizes changes.",
    'Run host-approved local development commands and tests.',
    'Use optional host-provided browser, UI automation, or subagent capabilities when available.'
  ]);
  assert.equal(codexPlugin.interface.category, 'Productivity');
  assert.ok(codexPlugin.interface.displayName.length <= 30);
  assert.ok(codexPlugin.interface.shortDescription.length <= 30);
  assert.ok(codexPlugin.interface.longDescription.length <= 4_000);
  assert.equal(codexPlugin.author.name, codexPlugin.interface.developerName);
  assert.equal(codexPlugin.author.name, 'Drizzy07x');
  assert.equal(claudePlugin.author.name, 'Drizzy07x');
  assert.equal(claudeMarketplace.owner.name, 'Drizzy07x');
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
    assert.ok(codexPlugin.interface[key].length <= 1_024);
  }
  for (const key of ['mcpServers', 'apps', 'hooks']) assert.equal(key in codexPlugin, false);

  assert.equal(claudePlugin.name, 'skillquiver');
  assert.equal(claudePlugin.version, codexPlugin.version);
  assert.equal(claudePlugin.skills, './skills');
  assert.match(codexPlugin.description, /Twenty-four reusable Agent Skills/);
  assert.match(codexPlugin.description, /ChatGPT and Codex/);
  assert.match(codexPlugin.interface.longDescription, /skills-only package works in ChatGPT and Codex/);
  assert.match(codexPlugin.interface.longDescription, /same source catalog also supports Claude Code/);
  assert.ok(codexPlugin.keywords.includes('chatgpt'));
  assert.match(codexPlugin.interface.longDescription, /24 reusable Agent Skills/);
  assert.match(claudePlugin.description, /Twenty-four Agent Skills shared/);
  assert.match(claudePlugin.description, /ChatGPT, Claude Code, and Codex/);

  assert.equal(codexMarketplace.name, 'skillquiver');
  assert.equal(codexMarketplace.interface.displayName, 'Skillquiver');
  assert.equal(codexMarketplace.plugins.length, 1);
  assert.deepEqual(codexMarketplace.plugins[0], {
    name: 'skillquiver',
    source: { source: 'local', path: './' },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL'
    },
    category: 'Productivity'
  });

  assert.equal(claudeMarketplace.name, 'skillquiver');
  assert.match(claudeMarketplace.description, /Twenty-four Agent Skills shared/);
  assert.match(claudeMarketplace.description, /ChatGPT, Claude Code, and Codex/);
  assert.equal(claudeMarketplace.plugins.length, 1);
  assert.equal(claudeMarketplace.plugins[0].name, 'skillquiver');
  assert.equal(claudeMarketplace.plugins[0].source, './');
  assert.match(claudeMarketplace.plugins[0].description, /Twenty-four shared Agent Skills/);
});

test('host boundaries keep generic capability and destructive safeguards', () => {
  const routing = fs.readFileSync(
    path.join(sharedSkillsRoot, 'handle-host-boundaries', 'SKILL.md'), 'utf8');

  assert.match(routing, /Do not inspect or modify another host's configuration/);
  assert.match(routing, /Explicitly authorized AGENTS\.md or CLAUDE\.md file\s+maintenance through improve-agent-instructions is allowed/);
  assert.match(routing, /unavailable runtime loading remains unverified/);
  assert.match(routing, /ask it directly in plain chat/);
  assert.doesNotMatch(routing, /Skillquiver Doctor/);
  assert.doesNotMatch(routing, /Claude Code-only/);
});

test('planning and review instructions preserve scope and findings', () => {
  const planning = fs.readFileSync(
    path.join(sharedSkillsRoot, 'writing-plans', 'SKILL.md'), 'utf8');
  const fullPlanning = fs.readFileSync(
    path.join(sharedSkillsRoot, 'writing-plans', 'references', 'full-plan.md'), 'utf8');
  const review = fs.readFileSync(
    path.join(sharedSkillsRoot, 'requesting-code-review', 'SKILL.md'), 'utf8');

  assert.match(planning, /Creating a plan file is a workspace change/);
  assert.match(planning, /Never silently choose them/);
  assert.match(planning, /Bounded inline planning/);
  assert.match(planning, /Bounded inline planning takes precedence/);
  assert.match(planning, /interface without a repository path/);
  assert.match(planning, /Do not inspect the\s+workspace/);
  assert.match(planning, /at most four implementation tasks/);
  assert.ok(planning.split(/\r?\n/).length < 100);
  assert.match(planning, /references\/full-plan\.md/);
  assert.doesNotMatch(planning, /### Task N:/);
  assert.match(fullPlanning, /Every plan MUST start with this header/);
  assert.match(fullPlanning, /## No Placeholders/);
  assert.match(fullPlanning, /## Execution Handoff/);
  assert.match(fullPlanning, /Commit the independently passing deliverable/);
  assert.match(fullPlanning, /subagent-driven-development/);
  assert.match(fullPlanning, /executing-plans/);
  assert.match(review, /standalone bounded read-only code review directly/);
  assert.match(review, /Do not enumerate the workspace/);
  assert.match(review, /Every finding must name the defect, impact, and reasoning/);
  assert.match(review, /Never output a placeholder/);
  assert.match(review, /must\s+never erase an earlier verified issue/);
});

test('small static UI work has a bounded honest verification path', () => {
  const designUi = fs.readFileSync(
    path.join(sharedSkillsRoot, 'design-ui', 'SKILL.md'), 'utf8');

  assert.match(designUi, /Bounded path for a small static page/);
  assert.match(designUi, /Route before any tool call/);
  assert.match(designUi, /the bounded path below is mandatory/);
  assert.match(designUi, /Direction:\s+audience .*layout .*palette .*typography .*focus .*responsive/s);
  assert.match(designUi, /It never means implementing search, filtering, live/);
  assert.match(designUi, /must add no `script` element or event handler/);
  assert.match(designUi, /Make the 360px layout safe in the first patch/);
  assert.match(designUi, /single-column flow below 480px/);
  assert.match(designUi, /at least a 16px viewport gutter/);
  assert.match(designUi, /Do not\s+use `100vw`/);
  assert.match(designUi, /do not add badges, chips, eyebrow copy/);
  assert.match(designUi, /body\{margin:0;padding:16px\}/);
  assert.match(designUi, /Never delete the target file/);
  assert.match(designUi, /capture-static-page\.cjs/);
  assert.match(designUi, /inspect only the returned `inspectionPath`/);
  assert.match(designUi, /If it fails, stop/);
  assert.match(designUi, /Do not repair, inspect, or recapture after the second run/);
  assert.match(designUi, /rendered verification failed/);
});

test('diagnosis examples report secret presence without revealing values', () => {
  const tracing = fs.readFileSync(
    path.join(sharedSkillsRoot, 'diagnose-systematically', 'root-cause-tracing.md'), 'utf8');

  assert.match(tracing, /API_KEY: SET/);
  assert.match(tracing, /API_KEY propagated: SET/);
  assert.match(tracing, /Never print the credential itself/);
  assert.doesNotMatch(tracing, /\$\{API_KEY:-UNSET\}/);
  assert.doesNotMatch(tracing, /env \| grep API_KEY/);
});

test('README and website list every skill with matching compatibility', () => {
  const shared = skillNames(sharedSkillsRoot);
  const expected = [...shared].sort();
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const list = html.slice(html.indexOf('<div id="list">'), html.indexOf('id="empty"'));

  const readmeEntries = [...readme.matchAll(
    /\[([a-z0-9-]+)\]\((skills\/([a-z0-9-]+)\/SKILL\.md)\)/g
  )].map(match => ({ label: match[1], target: match[2], id: match[3] }));
  const siteEntries = [...list.matchAll(
    /data-id="([a-z0-9-]+)"[\s\S]*?class="compat (shared|claude)"/g
  )].map(match => ({ id: match[1], compatibility: match[2] }));

  assert.deepEqual([...new Set(readmeEntries.map(entry => entry.id))].sort(), expected);
  assert.deepEqual([...new Set(siteEntries.map(entry => entry.id))].sort(), expected);
  assert.ok(readmeEntries.every(entry => entry.label === entry.id));

  for (const name of shared) {
    const entry = readmeEntries.find(candidate => candidate.id === name);
    assert.equal(entry.target, `skills/${name}/SKILL.md`);
    assert.match(readme.split(/\r?\n/).find(line => line.includes(`](${entry.target})`)),
      /!\[ChatGPT \+ Claude Code \+ Codex\]/);
    assert.equal(siteEntries.find(candidate => candidate.id === name).compatibility, 'shared');
  }

  assert.equal(
    siteEntries.find(entry => entry.id === 'skillquiver-doctor').compatibility,
    'shared'
  );
});

test('ChatGPT host routes stay capability-aware', () => {
  const doctor = fs.readFileSync(
    path.join(sharedSkillsRoot, 'skillquiver-doctor', 'SKILL.md'), 'utf8');
  const visualCompanion = fs.readFileSync(
    path.join(sharedSkillsRoot, 'brainstorming', 'visual-companion.md'), 'utf8');
  const automateUi = fs.readFileSync(
    path.join(sharedSkillsRoot, 'automate-ui', 'SKILL.md'), 'utf8');
  const instructionSkill = fs.readFileSync(
    path.join(sharedSkillsRoot, 'improve-agent-instructions', 'SKILL.md'), 'utf8');
  const chatgptDoctorPath = path.join(
    sharedSkillsRoot, 'skillquiver-doctor', 'references', 'chatgpt.md');

  assert.match(doctor, /current ChatGPT, Claude Code, or Codex host/);
  assert.match(doctor, /ChatGPT: \[references\/chatgpt\.md\]/);
  assert.ok(fs.existsSync(chatgptDoctorPath));

  const chatgptDoctor = fs.readFileSync(chatgptDoctorPath, 'utf8');
  assert.match(chatgptDoctor, /Use only for a running ChatGPT session/);
  assert.match(chatgptDoctor, /record a coverage gap/i);
  assert.match(chatgptDoctor, /Plugins Directory/);
  assert.match(chatgptDoctor, /Do not inspect Claude Code or Codex configuration/);
  assert.doesNotMatch(chatgptDoctor, /~\/\.claude|~\/\.codex|codex plugin|claude plugin/);

  assert.match(visualCompanion, /\*\*ChatGPT:\*\*/);
  assert.match(visualCompanion, /long-running or yielded shell capability/);
  assert.match(visualCompanion, /continue text-only/);
  assert.match(automateUi, /ChatGPT and Codex examples include/);
  assert.match(instructionSkill, /Codex: \[references\/codex\.md\]/);
  assert.match(instructionSkill, /Claude Code: \[references\/claude\.md\]/);
});

test('website identifies the complete universal package honestly', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const packageSection = html.slice(html.indexOf('<section class="band" id="package"'),
    html.indexOf('<section class="band" id="install"'));

  assert.match(packageSection, /Skillquiver v2\.2\.0/);
  assert.match(packageSection, /24 shared Agent Skills/);
  assert.match(packageSection, /skills-only package works in ChatGPT and Codex/);
  assert.doesNotMatch(html, /Claude-only or Codex-only capability/);
  assert.match(fs.readFileSync(path.join(root, 'assets', 'banner.svg'), 'utf8'),
    /24 SKILLS · CHATGPT · CLAUDE CODE · CODEX/);
  assert.match(fs.readFileSync(path.join(root, 'privacy.html'), 'utf8'),
    /Skillquiver is a skills-only package of 24 Agent Skills for ChatGPT and Codex/);
  assert.match(fs.readFileSync(path.join(root, 'privacy.html'), 'utf8'),
    /published and maintained under the public publisher name <a[^>]+>Drizzy07x<\/a>/);
  assert.match(fs.readFileSync(path.join(root, 'terms.html'), 'utf8'),
    /Skillquiver is a skills-only package of 24 Agent Skills for ChatGPT and Codex/);
  assert.match(fs.readFileSync(path.join(root, 'terms.html'), 'utf8'),
    /published and maintained under the public publisher name <a[^>]+>Drizzy07x<\/a>/);
});

test('Codex manual install uses the user skill directory', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  for (const content of [readme, html]) {
    assert.match(content, /~\/\.codex\/skills/);
    assert.doesNotMatch(content, /mkdir -p ~\/\.agents\/skills/);
  }
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
