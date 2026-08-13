const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function listPayloadFiles(root, relative = '') {
  const current = path.join(root, relative);
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const entryRelative = path.join(relative, entry.name);
    if (entryRelative === 'candidate.json') continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`Candidate payload cannot contain links: ${entryRelative}`);
    }
    if (entry.isDirectory()) files.push(...listPayloadFiles(root, entryRelative));
    else if (entry.isFile()) files.push(entryRelative);
    else throw new Error(`Unsupported candidate payload entry: ${entryRelative}`);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function digestEntries(entries) {
  const hash = crypto.createHash('sha256');
  const sorted = entries
    .map(entry => ({ ...entry, path: entry.path.split(path.sep).join('/') }))
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const entry of sorted) {
    const content = entry.content;
    const portablePath = entry.path;
    hash.update(portablePath);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
  }
  return {
    digest: hash.digest('hex'),
    files: sorted.map(entry => entry.path)
  };
}

function digestPayload(root) {
  const files = listPayloadFiles(root);
  return digestEntries(files.map(relative => ({
    path: relative,
    content: fs.readFileSync(path.join(root, relative))
  })));
}

function digestGitPayload(root, commit, relativePaths) {
  const output = execFileSync('git', [
    '-C', root,
    'ls-tree', '-r', '--name-only', commit, '--', ...relativePaths
  ], { encoding: 'utf8' });
  const files = output.split(/\r?\n/).filter(Boolean);
  return digestEntries(files.map(relative => ({
    path: relative,
    content: execFileSync('git', [
      '-C', root, 'show', `${commit}:${relative}`
    ])
  })));
}

module.exports = { digestGitPayload, digestPayload };
