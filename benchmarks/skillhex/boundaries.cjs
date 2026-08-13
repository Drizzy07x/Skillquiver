const fs = require('node:fs');
const path = require('node:path');

const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;

function assertSafeId(value, label) {
  if (!SAFE_ID.test(value || '')) {
    throw new Error(`${label} must contain only lowercase letters, digits, dots, underscores, or hyphens`);
  }
}

function canonicalPath(value) {
  return fs.realpathSync.native(path.resolve(value));
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function pathsOverlap(left, right) {
  return isWithin(left, right) || isWithin(right, left);
}

module.exports = { assertSafeId, canonicalPath, isWithin, pathsOverlap };
