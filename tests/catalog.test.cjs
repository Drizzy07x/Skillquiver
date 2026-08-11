const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const skillsRoot = path.join(root, '.claude', 'skills');

function skillNames() {
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '.git') return markdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

test('catalog surfaces list the same 23 skills', () => {
  const expected = skillNames();
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const groups = html.slice(html.indexOf('const GROUPS'), html.indexOf('const FLAT'));

  const readmeNames = [...readme.matchAll(/\.claude\/skills\/([^/)]+)\/SKILL\.md/g)]
    .map(match => match[1]);
  const siteNames = [...groups.matchAll(/^\s+\["([a-z0-9-]+)",/gm)]
    .map(match => match[1]);

  assert.equal(expected.length, 23);
  assert.deepEqual([...new Set(readmeNames)].sort(), expected);
  assert.deepEqual([...new Set(siteNames)].sort(), expected);

  for (const name of expected) {
    const content = fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf8');
    assert.match(content, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(content, /^description: .+$/m);
  }

  assert.doesNotThrow(() => JSON.parse(
    fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')
  ));
  assert.doesNotThrow(() => JSON.parse(
    fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8')
  ));
});

test('local Markdown links resolve', () => {
  const missing = [];

  for (const file of markdownFiles(root)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(
      /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g,
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
