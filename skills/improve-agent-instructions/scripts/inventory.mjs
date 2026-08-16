import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = 1;

const DEFAULT_PROJECT_DOC_MAX_BYTES = 32 * 1024;
const SCALAR_FLAGS = new Map([
  ['--host', 'host'],
  ['--cwd', 'cwd'],
  ['--project', 'project'],
  ['--home', 'home'],
  ['--codex-home', 'codexHome'],
  ['--claude-home', 'claudeHome'],
  ['--claude-managed-dir', 'claudeManagedDir'],
  ['--claude-setting-sources', 'claudeSettingSources'],
]);

class UsageError extends Error {}

function binaryCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runtimeValue(value, fallback) {
  if (typeof value === 'function') return value();
  return value ?? fallback;
}

function resolveFrom(base, value) {
  return path.resolve(base, value);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function findGitRoot(cwd, execFile) {
  try {
    return path.resolve(execFile(
      'git', ['-C', cwd, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return cwd;
  }
}

export function parseArgs(argv, runtime = {}) {
  const fileSystem = runtime.fs ?? fs;
  const execFile = runtime.execFileSync ?? childProcess.execFileSync;
  const ambientCwd = path.resolve(runtimeValue(runtime.cwd, process.cwd()));
  const environment = runtime.env ?? process.env;
  const ambientHome = path.resolve(runtimeValue(runtime.homedir, os.homedir()));
  const values = {};
  const seen = new Set();
  const claudeAddDirs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--claude-add-dir') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError('Missing value for --claude-add-dir.');
      }
      claudeAddDirs.push(resolveFrom(ambientCwd, value));
      index += 1;
      continue;
    }

    const property = SCALAR_FLAGS.get(flag);
    if (!property) throw new UsageError(`Unknown flag ${flag}.`);
    if (seen.has(flag)) throw new UsageError(`Repeated flag ${flag}.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`Missing value for ${flag}.`);
    }
    seen.add(flag);
    values[property] = value;
    index += 1;
  }

  const host = values.host ?? 'both';
  if (!['both', 'codex', 'claude'].includes(host)) {
    throw new UsageError('Invalid --host value.');
  }

  const cwd = resolveFrom(ambientCwd, values.cwd ?? ambientCwd);
  let cwdStat;
  try {
    cwdStat = fileSystem.statSync(cwd);
  } catch {
    throw new UsageError('The working directory does not exist.');
  }
  if (!cwdStat.isDirectory()) throw new UsageError('The working directory is not a directory.');

  const project = values.project
    ? resolveFrom(ambientCwd, values.project)
    : findGitRoot(cwd, execFile);
  if (!isInside(project, cwd)) {
    throw new UsageError('The working directory is outside the project root.');
  }

  const explicitHome = values.home ? resolveFrom(ambientCwd, values.home) : null;
  const home = explicitHome ?? ambientHome;
  const codexHome = values.codexHome
    ? resolveFrom(ambientCwd, values.codexHome)
    : explicitHome
      ? path.join(explicitHome, '.codex')
      : environment.CODEX_HOME
        ? resolveFrom(ambientCwd, environment.CODEX_HOME)
        : path.join(home, '.codex');
  const settingSources = values.claudeSettingSources
    ? values.claudeSettingSources.split(',')
    : ['user', 'project', 'local'];
  if (settingSources.length === 0 || settingSources.some(
    (source) => !['user', 'project', 'local'].includes(source))) {
    throw new UsageError('Invalid --claude-setting-sources value.');
  }

  return {
    host,
    cwd,
    project,
    home,
    codexHome,
    claudeHome: values.claudeHome
      ? resolveFrom(ambientCwd, values.claudeHome)
      : path.join(home, '.claude'),
    claudeManagedDir: values.claudeManagedDir
      ? resolveFrom(ambientCwd, values.claudeManagedDir)
      : null,
    claudeAddDirs,
    claudeSettingSources: [...new Set(settingSources)],
  };
}

function resolvePhysical(logicalPath, fileSystem) {
  const absolute = path.resolve(logicalPath);
  let existing = absolute;
  const suffix = [];

  while (true) {
    try {
      fileSystem.lstatSync(existing);
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return absolute;
      suffix.unshift(path.basename(existing));
      existing = parent;
    }
  }

  let physical;
  try {
    physical = fileSystem.realpathSync.native
      ? fileSystem.realpathSync.native(existing)
      : fileSystem.realpathSync(existing);
  } catch {
    physical = existing;
  }
  return path.join(physical, ...suffix);
}

function decodeBytes(bytes) {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    return { encoding: 'utf8-bom', text: new TextDecoder('utf-8').decode(bytes.subarray(3)) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf16le', text: new TextDecoder('utf-16le').decode(bytes.subarray(2)) };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf16be', text: new TextDecoder('utf-16be').decode(bytes.subarray(2)) };
  }

  if (bytes.length >= 4 && bytes.length % 2 === 0) {
    let evenNulls = 0;
    let oddNulls = 0;
    for (let index = 0; index < bytes.length; index += 2) {
      if (bytes[index] === 0) evenNulls += 1;
      if (bytes[index + 1] === 0) oddNulls += 1;
    }
    const pairs = bytes.length / 2;
    if (oddNulls / pairs > 0.3 && evenNulls / pairs < 0.1) {
      return { encoding: 'utf16le', text: new TextDecoder('utf-16le').decode(bytes) };
    }
    if (evenNulls / pairs > 0.3 && oddNulls / pairs < 0.1) {
      return { encoding: 'utf16be', text: new TextDecoder('utf-16be').decode(bytes) };
    }
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) return { encoding: 'binary-or-unknown', text: null };
    return { encoding: 'utf8', text };
  } catch {
    return { encoding: 'binary-or-unknown', text: null };
  }
}

function classifyLineEndings(text) {
  if (text === null) return 'unknown';
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const withoutCrlf = text.replace(/\r\n/g, '');
  const lf = (withoutCrlf.match(/\n/g) ?? []).length;
  const cr = (withoutCrlf.match(/\r/g) ?? []).length;
  const kinds = [crlf, lf, cr].filter((count) => count > 0).length;
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  if (crlf > 0) return 'crlf';
  if (lf > 0) return 'lf';
  return 'cr';
}

function inspectFile(logicalPath, fileSystem) {
  const resolvedPath = resolvePhysical(logicalPath, fileSystem);
  let stat;
  try {
    stat = fileSystem.statSync(logicalPath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { resolvedPath, exists: false, readable: false };
    }
    return { resolvedPath, exists: true, readable: false };
  }
  if (!stat.isFile()) return { resolvedPath, exists: true, readable: false };

  try {
    const bytes = fileSystem.readFileSync(logicalPath);
    const decoded = decodeBytes(bytes);
    return {
      resolvedPath,
      exists: true,
      readable: true,
      byteCount: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      encoding: decoded.encoding,
      lineEndings: classifyLineEndings(decoded.text),
    };
  } catch {
    return { resolvedPath, exists: true, readable: false };
  }
}

function warning(code, logicalPath, field = null) {
  return { code, host: 'codex', logicalPath: path.resolve(logicalPath), field };
}

function parseCodexConfig(codexHome, fileSystem, warnings) {
  const configPath = path.join(codexHome, 'config.toml');
  const defaults = { fallbackFilenames: [], maxBytes: DEFAULT_PROJECT_DOC_MAX_BYTES };
  let contents;
  try {
    contents = fileSystem.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
      warnings.push(warning('config-unreadable', configPath));
    }
    return defaults;
  }

  const result = { ...defaults };
  const supported = [
    {
      key: 'project_doc_fallback_filenames',
      parse(line) {
        const match = line.match(/^\s*project_doc_fallback_filenames\s*=\s*(\[.*\])\s*(?:#.*)?$/);
        if (!match) return null;
        try {
          const value = JSON.parse(match[1]);
          return Array.isArray(value) && value.every((item) => typeof item === 'string')
            ? [...new Set(value.filter((item) => item.length > 0))]
            : null;
        } catch {
          return null;
        }
      },
      assign(value) { result.fallbackFilenames = value; },
    },
    {
      key: 'project_doc_max_bytes',
      parse(line) {
        const match = line.match(/^\s*project_doc_max_bytes\s*=\s*(\d+)\s*(?:#.*)?$/);
        if (!match) return null;
        const value = Number(match[1]);
        return Number.isSafeInteger(value) ? value : null;
      },
      assign(value) { result.maxBytes = value; },
    },
  ];

  const lines = contents.split(/\r\n|\n|\r/);
  for (const entry of supported) {
    const matching = lines.filter((line) => new RegExp(`^\\s*${entry.key}\\b`).test(line));
    if (matching.length === 0) continue;
    const value = matching.length === 1 ? entry.parse(matching[0]) : null;
    if (value === null) {
      warnings.push(warning('config-invalid', configPath, entry.key));
    } else {
      entry.assign(value);
    }
  }
  return result;
}

function gitStateFor(logicalPath, project, execFile) {
  if (!isInside(project, logicalPath)) return 'not-applicable';
  const relative = path.relative(project, logicalPath);
  try {
    const output = execFile(
      'git', ['-C', project, 'status', '--porcelain=v1', '--ignored',
        '--untracked-files=all', '--', relative],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const marker = output.slice(0, 2);
    if (marker === '??') return 'untracked';
    if (marker === '!!') return 'ignored';
    if (marker.trim()) return 'modified';
    try {
      execFile('git', ['-C', project, 'ls-files', '--error-unmatch', '--', relative],
        { encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'] });
      return 'tracked-clean';
    } catch {
      return 'untracked';
    }
  } catch {
    return 'unknown';
  }
}

function makeSource(logicalPath, scope, origin, options, dependencies) {
  const fileSystem = dependencies.fs ?? fs;
  const inspected = inspectFile(logicalPath, fileSystem);
  const gitState = scope === 'project'
    ? gitStateFor(logicalPath, options.project,
      dependencies.execFileSync ?? childProcess.execFileSync)
    : 'not-applicable';
  return {
    id: null,
    host: 'codex',
    scope,
    origin,
    logicalPath: path.resolve(logicalPath),
    resolvedPath: inspected.resolvedPath,
    ownership: scope === 'global' ? 'user' : 'project',
    exists: inspected.exists,
    loadState: inspected.exists ? 'unreadable' : 'missing',
    loadPosition: null,
    byteCount: inspected.readable ? inspected.byteCount : null,
    byteContribution: 0,
    sha256: inspected.readable ? inspected.sha256 : null,
    encoding: inspected.readable ? inspected.encoding : 'binary-or-unknown',
    lineEndings: inspected.readable ? inspected.lineEndings : 'unknown',
    gitState,
    import: null,
    conditions: [],
    inactiveReason: inspected.exists ? 'unreadable' : 'missing',
    _readable: inspected.readable,
    _chainOrder: null,
  };
}

function selectDirectorySource(candidates) {
  const selected = candidates.find((source) => source._readable && source.byteCount > 0);
  for (const source of candidates) {
    if (!source.exists || !source._readable) continue;
    if (source.byteCount === 0) {
      source.loadState = 'empty';
      source.inactiveReason = 'empty';
    } else if (source !== selected) {
      source.loadState = 'shadowed';
      source.inactiveReason = 'higher-precedence-source';
    }
  }
  return selected;
}

function projectDirectories(project, cwd) {
  const directories = [project];
  const relative = path.relative(project, cwd);
  if (!relative) return directories;
  let current = project;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return directories;
}

function addUnreadableWarnings(sources, warnings) {
  for (const source of sources) {
    if (source.loadState === 'unreadable') {
      warnings.push(warning('source-unreadable', source.logicalPath));
    }
  }
}

function rootRecord(logicalPath, fileSystem) {
  let exists = false;
  try {
    exists = fileSystem.statSync(logicalPath).isDirectory();
  } catch {
    // Missing roots are represented in the manifest.
  }
  return {
    logicalPath: path.resolve(logicalPath),
    resolvedPath: resolvePhysical(logicalPath, fileSystem),
    exists,
  };
}

export function buildInventory(options, dependencies = {}) {
  const fileSystem = dependencies.fs ?? fs;
  const warnings = [];
  const sources = [];
  const chainSources = [];
  const config = parseCodexConfig(options.codexHome, fileSystem, warnings);
  let chainOrder = 0;

  if (options.host === 'both' || options.host === 'codex') {
    const globalCandidates = ['AGENTS.override.md', 'AGENTS.md'].map((filename) =>
      makeSource(path.join(options.codexHome, filename), 'global', 'codex-home',
        options, dependencies));
    sources.push(...globalCandidates);
    const globalSelected = selectDirectorySource(globalCandidates);
    if (globalSelected) {
      globalSelected.loadState = 'active';
      globalSelected.inactiveReason = null;
      globalSelected.byteContribution = globalSelected.byteCount;
      globalSelected.loadPosition = chainOrder;
      globalSelected._chainOrder = chainOrder;
      chainOrder += 1;
      chainSources.push(globalSelected);
    }

    let remaining = config.maxBytes;
    for (const directory of projectDirectories(options.project, options.cwd)) {
      const filenames = [...new Set([
        'AGENTS.override.md', 'AGENTS.md', ...config.fallbackFilenames,
      ].filter((filename) => filename.length > 0))];
      const candidates = filenames.map((filename) =>
        makeSource(path.join(directory, filename), 'project', 'project-tree',
          options, dependencies));
      sources.push(...candidates);
      const selected = selectDirectorySource(candidates);
      if (!selected) continue;
      if (remaining === 0) {
        selected.loadState = 'excluded';
        selected.inactiveReason = 'project-byte-budget-exhausted';
        continue;
      }
      selected.byteContribution = Math.min(selected.byteCount, remaining);
      selected.loadState = selected.byteContribution < selected.byteCount
        ? 'truncated'
        : 'active';
      selected.inactiveReason = selected.loadState === 'truncated'
        ? 'project-byte-budget'
        : null;
      selected.loadPosition = chainOrder;
      selected._chainOrder = chainOrder;
      chainOrder += 1;
      chainSources.push(selected);
      remaining -= selected.byteContribution;
    }
  }

  addUnreadableWarnings(sources, warnings);
  sources.sort((left, right) =>
    binaryCompare(left.logicalPath, right.logicalPath) ||
    binaryCompare(left.host, right.host) ||
    binaryCompare(left.origin, right.origin));
  sources.forEach((source, index) => { source.id = `source-${String(index + 1).padStart(4, '0')}`; });
  const codexSourceIds = chainSources
    .sort((left, right) => left._chainOrder - right._chainOrder)
    .map((source) => source.id);
  for (const source of sources) {
    delete source._readable;
    delete source._chainOrder;
  }
  warnings.sort((left, right) =>
    binaryCompare(left.code, right.code) ||
    binaryCompare(left.logicalPath, right.logicalPath) ||
    binaryCompare(left.field ?? '', right.field ?? ''));

  const now = dependencies.now ? dependencies.now() : new Date();
  const generatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    run: { generatedAt, host: options.host },
    roots: {
      home: rootRecord(options.home, fileSystem),
      project: rootRecord(options.project, fileSystem),
      cwd: rootRecord(options.cwd, fileSystem),
      codexHome: rootRecord(options.codexHome, fileSystem),
    },
    sources,
    chains: { codex: { sourceIds: codexSourceIds } },
    warnings,
  };
}

export function normalizeManifest(manifest) {
  const normalized = structuredClone(manifest);
  if (normalized.run) delete normalized.run.generatedAt;
  return normalized;
}

function writeOutput(target, contents) {
  if (typeof target === 'function') target(contents);
  else target.write(contents);
}

export function runCli(argv, io = {}, runtime = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let options;
  try {
    options = parseArgs(argv, runtime);
  } catch (error) {
    if (error instanceof UsageError) {
      writeOutput(stderr, `Usage error: ${error.message}\n`);
      return 2;
    }
    writeOutput(stderr, 'Inventory failed: unable to resolve inputs.\n');
    return 1;
  }

  try {
    const manifest = buildInventory(options, runtime.dependencies ?? runtime);
    writeOutput(stdout, `${JSON.stringify(manifest, null, 2)}\n`);
    return 0;
  } catch {
    writeOutput(stderr, 'Inventory failed: unable to complete audit.\n');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2));
}
