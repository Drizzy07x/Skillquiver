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

function gitEnvironment(environment) {
  return { ...environment, GIT_OPTIONAL_LOCKS: '0' };
}

function gitProcess(args, dependencies = {}, environment = process.env) {
  const options = {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: gitEnvironment(environment),
    shell: false,
    windowsHide: true,
  };
  if (dependencies.spawnSync) {
    return dependencies.spawnSync('git', args, options);
  }
  if (dependencies.execFileSync) {
    try {
      return {
        status: 0,
        stdout: dependencies.execFileSync('git', args, options) ?? '',
        stderr: '',
      };
    } catch (error) {
      return {
        status: typeof error?.status === 'number' ? error.status : 1,
        stdout: '',
        stderr: '',
        error,
      };
    }
  }
  return childProcess.spawnSync('git', args, options);
}

function findGitRoot(cwd, dependencies, environment) {
  const result = gitProcess(
    ['-C', cwd, 'rev-parse', '--show-toplevel'], dependencies, environment);
  if (result.status !== 0 || !String(result.stdout ?? '').trim()) return cwd;
  return path.resolve(String(result.stdout).trim());
}

function defaultClaudeManagedDirectory(platform, environment) {
  if (platform === 'win32') {
    return path.join(environment.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode');
  }
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  return '/etc/claude-code';
}

function environmentFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

export function parseArgs(argv, runtime = {}) {
  const fileSystem = runtime.fs ?? fs;
  const ambientCwd = path.resolve(runtimeValue(runtime.cwd, process.cwd()));
  const environment = runtime.env ?? process.env;
  const platform = runtimeValue(runtime.platform, process.platform);
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
    if (!property) throw new UsageError('unknown flag.');
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
    : findGitRoot(cwd, runtime, environment);
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
    platform,
    cwd,
    project,
    projectExplicit: Boolean(values.project),
    home,
    codexHome,
    claudeHome: values.claudeHome
      ? resolveFrom(ambientCwd, values.claudeHome)
      : explicitHome
        ? path.join(explicitHome, '.claude')
        : environment.CLAUDE_CONFIG_DIR
          ? resolveFrom(ambientCwd, environment.CLAUDE_CONFIG_DIR)
          : path.join(home, '.claude'),
    claudeManagedDir: values.claudeManagedDir
      ? resolveFrom(ambientCwd, values.claudeManagedDir)
      : defaultClaudeManagedDirectory(platform, environment),
    claudeAddDirs,
    claudeSettingSources: [...new Set(settingSources)],
    claudeSettingSourcesExplicit: Boolean(values.claudeSettingSources),
    claudeAdditionalDirectoriesEnabled: environmentFlag(
      environment.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD),
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
      _text: decoded.text,
    };
  } catch {
    return { resolvedPath, exists: true, readable: false };
  }
}

function warning(code, logicalPath, field = null, host = 'codex') {
  return { code, host, logicalPath: path.resolve(logicalPath), field };
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

  let topLevel = true;
  const lines = contents.split(/\r\n|\n|\r/).map((line) => {
    if (/^\s*\[/.test(line)) topLevel = false;
    return { line, topLevel };
  });
  for (const entry of supported) {
    const matching = lines.filter(({ line }) =>
      new RegExp(`^\\s*${entry.key}\\b`).test(line));
    if (matching.length === 0) continue;
    const value = matching.length === 1 && matching[0].topLevel
      ? entry.parse(matching[0].line)
      : null;
    if (value === null) {
      warnings.push(warning('config-invalid', configPath, entry.key));
    } else {
      entry.assign(value);
    }
  }
  return result;
}

function createGitInspector(options, dependencies, warnings, reportProblems) {
  const environment = dependencies.env ?? process.env;
  const projectResolved = resolvePhysical(options.project, dependencies.fs ?? fs);
  const rootResult = gitProcess(
    ['-C', options.project, 'rev-parse', '--show-toplevel'], dependencies, environment);
  let gitRoot = null;
  let unavailable = false;
  if (rootResult.error?.code === 'ENOENT') {
    unavailable = true;
    if (reportProblems) {
      warnings.push(warning('git-unavailable', options.project, null, 'claude'));
    }
  } else if (rootResult.status === 0 && String(rootResult.stdout ?? '').trim()) {
    gitRoot = path.resolve(String(rootResult.stdout).trim());
    const resolvedGitRoot = resolvePhysical(gitRoot, dependencies.fs ?? fs);
    if (options.projectExplicit && resolvedGitRoot !== projectResolved) {
      if (reportProblems) {
        warnings.push(warning(
          'project-git-root-mismatch', options.project, null, 'claude'));
      }
    }
    gitRoot = resolvedGitRoot;
  } else {
    if (reportProblems) {
      warnings.push(warning(
        'project-git-root-mismatch', options.project, null, 'claude'));
    }
  }

  return (logicalPath, resolvedPath, applicable = true) => {
    if (!applicable) return 'not-applicable';
    if (unavailable) return 'unknown';
    if (!gitRoot || !isInside(gitRoot, resolvedPath)) return 'outside-repository';
    const relative = path.relative(gitRoot, resolvedPath);
    const status = gitProcess(
      ['-C', gitRoot, 'status', '--porcelain=v1', '--ignored',
        '--untracked-files=all', '--', relative], dependencies, environment);
    if (status.error?.code === 'ENOENT') return 'unknown';
    if (status.status !== 0) return 'unknown';
    const marker = String(status.stdout ?? '').slice(0, 2);
    if (marker === '??') return 'untracked';
    if (marker === '!!') return 'ignored';
    if (marker.trim()) return 'modified';
    const tracked = gitProcess(
      ['-C', gitRoot, 'ls-files', '--error-unmatch', '--', relative],
      dependencies, environment);
    return tracked.status === 0 ? 'tracked-clean' : 'untracked';
  };
}

function makeSource(logicalPath, scope, origin, options, dependencies) {
  const fileSystem = dependencies.fs ?? fs;
  const inspected = inspectFile(logicalPath, fileSystem);
  const gitState = dependencies.gitState
    ? dependencies.gitState(logicalPath, inspected.resolvedPath, scope === 'project')
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
      warnings.push(warning('source-unreadable', source.logicalPath, null, source.host));
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

function claudeOwnership(resolvedPath, options, fileSystem, managed = false) {
  if (managed) return 'managed';
  const roots = [
    ['project', resolvePhysical(options.project, fileSystem)],
    ['user', resolvePhysical(options.home, fileSystem)],
  ];
  for (const [owner, root] of roots) {
    if (isInside(root, resolvedPath)) return owner;
  }
  return 'external';
}

function makeClaudeSource(logicalPath, scope, origin, options, dependencies,
  { managed = false, virtualText = null } = {}) {
  const fileSystem = dependencies.fs ?? fs;
  let inspected;
  if (virtualText === null) {
    inspected = inspectFile(logicalPath, fileSystem);
  } else {
    const bytes = Buffer.from(virtualText, 'utf8');
    inspected = {
      resolvedPath: resolvePhysical(logicalPath, fileSystem),
      exists: true,
      readable: true,
      byteCount: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      encoding: 'utf8',
      lineEndings: classifyLineEndings(virtualText),
      _text: virtualText,
    };
  }
  const ownership = claudeOwnership(inspected.resolvedPath, options, fileSystem, managed);
  const gitState = dependencies.gitState(
    logicalPath, inspected.resolvedPath, ownership !== 'managed');
  let loadState = 'missing';
  let inactiveReason = 'missing';
  if (inspected.exists && !inspected.readable) {
    loadState = 'unreadable';
    inactiveReason = 'unreadable';
  } else if (inspected.readable && inspected.byteCount === 0) {
    loadState = 'empty';
    inactiveReason = 'empty';
  } else if (inspected.readable) {
    loadState = 'active';
    inactiveReason = null;
  }
  return {
    id: null,
    host: 'claude',
    scope,
    origin,
    logicalPath: path.resolve(logicalPath),
    resolvedPath: inspected.resolvedPath,
    ownership,
    exists: inspected.exists,
    loadState,
    loadPosition: null,
    byteCount: inspected.readable ? inspected.byteCount : null,
    byteContribution: inspected.readable ? inspected.byteCount : 0,
    sha256: inspected.readable ? inspected.sha256 : null,
    encoding: inspected.readable ? inspected.encoding : 'binary-or-unknown',
    lineEndings: inspected.readable ? inspected.lineEndings : 'unknown',
    gitState,
    import: null,
    approval: null,
    conditions: [],
    inactiveReason,
    _text: inspected._text ?? null,
    _chainOrder: null,
  };
}

function parseClaudeSettings(settingsPath, scope, origin, options, dependencies,
  warnings, managed) {
  const fileSystem = dependencies.fs ?? fs;
  const inspected = inspectFile(settingsPath, fileSystem);
  if (!inspected.exists) return { source: null, excludes: [] };
  if (!inspected.readable || inspected._text === null) {
    warnings.push(warning(managed ? 'managed-settings-partial' : 'config-invalid',
      settingsPath, null, 'claude'));
    return { source: null, excludes: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(inspected._text);
  } catch {
    warnings.push(warning(managed ? 'managed-settings-partial' : 'config-invalid',
      settingsPath, null, 'claude'));
    return { source: null, excludes: [] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnings.push(warning(managed ? 'managed-settings-partial' : 'config-invalid',
      settingsPath, null, 'claude'));
    return { source: null, excludes: [] };
  }

  let source = null;
  if (typeof parsed.claudeMd === 'string') {
    source = makeClaudeSource(settingsPath, scope, origin, options, dependencies, {
      managed,
      virtualText: parsed.claudeMd,
    });
  } else if (parsed.claudeMd !== undefined) {
    warnings.push(warning(managed ? 'managed-settings-partial' : 'config-invalid',
      settingsPath, 'claudeMd', 'claude'));
  }

  let excludes = [];
  if (parsed.claudeMdExcludes !== undefined) {
    if (Array.isArray(parsed.claudeMdExcludes) &&
        parsed.claudeMdExcludes.every((entry) => typeof entry === 'string')) {
      excludes = parsed.claudeMdExcludes;
    } else {
      warnings.push(warning(managed ? 'managed-settings-partial' : 'config-invalid',
        settingsPath, 'claudeMdExcludes', 'claude'));
    }
  }
  return { source, excludes };
}

function expandClaudePath(value, base, home) {
  if (value === '~') return path.resolve(home);
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/') || value.startsWith('~\\')) {
    return path.resolve(home, value.slice(2));
  }
  return path.resolve(base, value);
}

function excludeMatches(source, excludePath, fileSystem) {
  const resolvedExclude = resolvePhysical(excludePath, fileSystem);
  if (!/[?*]/.test(resolvedExclude)) return source.resolvedPath === resolvedExclude;
  const escaped = resolvedExclude.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, `[^${path.sep === '\\' ? '\\\\' : '/'}]*`)
    .replace(/\?/g, '.')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`, process.platform === 'win32' ? 'i' : '').test(
    source.resolvedPath);
}

function listRuleFiles(directory, fileSystem, warnings) {
  const results = [];
  const visited = new Set();
  const visit = (current) => {
    let resolved;
    try {
      resolved = fileSystem.realpathSync.native
        ? fileSystem.realpathSync.native(current)
        : fileSystem.realpathSync(current);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
        warnings.push(warning('source-unreadable', current, null, 'claude'));
      }
      return;
    }
    if (visited.has(resolved)) return;
    visited.add(resolved);
    let entries;
    try {
      entries = fileSystem.readdirSync(current, { withFileTypes: true });
    } catch {
      warnings.push(warning('source-unreadable', current, null, 'claude'));
      return;
    }
    entries.sort((left, right) => binaryCompare(left.name, right.name));
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        let stat;
        try {
          stat = fileSystem.statSync(entryPath);
        } catch {
          warnings.push(warning('source-unreadable', entryPath, null, 'claude'));
          continue;
        }
        if (stat.isDirectory()) visit(entryPath);
        else if (stat.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          results.push(entryPath);
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(entryPath);
      }
    }
  };
  visit(directory);
  return results;
}

function unquoteYamlValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseRuleConditions(source, warnings) {
  const text = source._text;
  if (text === null || !text.startsWith('---')) return [];
  const lines = text.split(/\r\n|\n|\r/);
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closing < 0) {
    warnings.push(warning('config-invalid', source.logicalPath, 'paths', 'claude'));
    return [];
  }
  const frontmatter = lines.slice(1, closing);
  const pathsIndex = frontmatter.findIndex((line) => /^paths\s*:/.test(line));
  if (pathsIndex < 0) return [];
  const sameLine = frontmatter[pathsIndex].replace(/^paths\s*:/, '').trim();
  if (sameLine) {
    try {
      const parsed = JSON.parse(sameLine.replaceAll("'", '"'));
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
        return parsed;
      }
    } catch {
      // The warning below is deliberately value-free.
    }
    warnings.push(warning('config-invalid', source.logicalPath, 'paths', 'claude'));
    return [];
  }
  const conditions = [];
  for (let index = pathsIndex + 1; index < frontmatter.length; index += 1) {
    const line = frontmatter[index];
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s+-\s+(.+?)\s*$/);
    if (match) conditions.push(unquoteYamlValue(match[1]));
    else if (line.trim()) {
      warnings.push(warning('config-invalid', source.logicalPath, 'paths', 'claude'));
      return [];
    }
  }
  if (conditions.length === 0) {
    warnings.push(warning('config-invalid', source.logicalPath, 'paths', 'claude'));
  }
  return conditions;
}

function parseClaudeImports(text) {
  if (text === null) return [];
  const imports = [];
  let fence = null;
  for (const line of text.split(/\r\n|\n|\r/)) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === marker ? null : fence ?? marker;
      continue;
    }
    if (fence) continue;
    const withoutInlineCode = line.replace(/`+[^`]*`+/g, ' ');
    for (const match of withoutInlineCode.matchAll(/(?:^|\s)@([^\s`"'<>()[\]{}]+)/g)) {
      const candidate = match[1].replace(/[.,;:!?]+$/, '');
      if (candidate.includes('/') || candidate.includes('\\') || candidate.includes('.')) {
        imports.push(candidate);
      }
    }
  }
  return [...new Set(imports)];
}

function buildClaudeInventory(options, dependencies, sources, warnings) {
  const fileSystem = dependencies.fs ?? fs;
  const chainSources = [];
  const conditionalSources = [];
  const sourceKeys = new Set();
  let chainOrder = 0;
  let maxImportDepth = 0;
  let partialCoverage = !options.claudeSettingSourcesExplicit;

  const addSource = (source) => {
    const key = `${source.origin}\0${source.logicalPath}`;
    if (sourceKeys.has(key)) return false;
    sourceKeys.add(key);
    sources.push(source);
    return true;
  };
  const queueSource = (source) => {
    if (!['active', 'conditional', 'truncated'].includes(source.loadState)) return;
    source.loadPosition = chainOrder;
    source._chainOrder = chainOrder;
    chainOrder += 1;
    if (source.loadState === 'conditional') conditionalSources.push(source);
    else chainSources.push(source);
  };

  const settings = [];
  settings.push({
    path: path.join(options.claudeManagedDir, 'managed-settings.json'),
    scope: 'managed',
    origin: 'managed-settings',
    base: options.claudeManagedDir,
    managed: true,
  });
  if (options.claudeSettingSources.includes('user')) {
    settings.push({
      path: path.join(options.claudeHome, 'settings.json'),
      scope: 'global',
      origin: 'user-settings',
      base: options.home,
      managed: false,
    });
  }
  if (options.claudeSettingSources.includes('project')) {
    settings.push({
      path: path.join(options.project, '.claude', 'settings.json'),
      scope: 'project',
      origin: 'project-settings',
      base: options.project,
      managed: false,
    });
  }
  if (options.claudeSettingSources.includes('local')) {
    settings.push({
      path: path.join(options.project, '.claude', 'settings.local.json'),
      scope: 'project',
      origin: 'local-settings',
      base: options.project,
      managed: false,
    });
  }

  const settingSources = [];
  const excludePaths = [];
  for (const setting of settings) {
    const parsed = parseClaudeSettings(setting.path, setting.scope, setting.origin,
      options, dependencies, warnings, setting.managed);
    if (parsed.source) settingSources.push(parsed.source);
    for (const exclude of parsed.excludes) {
      excludePaths.push(expandClaudePath(exclude, setting.base, options.home));
    }
  }
  const excludes = [...new Set(excludePaths)].sort(binaryCompare);

  const applyExcludes = (source) => {
    if (source.ownership === 'managed' || !source.exists) return;
    if (excludes.some((exclude) => excludeMatches(source, exclude, fileSystem))) {
      source.loadState = 'excluded';
      source.inactiveReason = 'claude-md-exclude';
      source.byteContribution = 0;
    }
  };

  const resolveImportPath = (value, parent) => {
    const normalized = path.sep === '\\' ? value.replaceAll('/', '\\') : value;
    if (normalized === '~' || normalized.startsWith('~/') || normalized.startsWith('~\\')) {
      return expandClaudePath(normalized, options.home, options.home);
    }
    return path.resolve(path.dirname(parent.logicalPath), normalized);
  };

  const walkImports = (parent, rootScope, depth, stack) => {
    if (!parent.exists || parent._text === null ||
        ['excluded', 'unreadable', 'empty', 'missing', 'approval-blocked'].includes(
          parent.loadState)) return;
    for (const importValue of parseClaudeImports(parent._text)) {
      const logicalPath = resolveImportPath(importValue, parent);
      const resolvedPath = resolvePhysical(logicalPath, fileSystem);
      if (stack.includes(resolvedPath)) {
        warnings.push(warning('import-cycle', logicalPath, null, 'claude'));
        partialCoverage = true;
        continue;
      }
      const source = makeClaudeSource(logicalPath, rootScope, 'import', options, dependencies);
      source.import = { parentSourceId: parent, depth };
      maxImportDepth = Math.max(maxImportDepth, Math.min(depth, 4));
      if (depth > 4) {
        source.loadState = 'approval-blocked';
        source.inactiveReason = 'import-depth-exceeded';
        source.byteContribution = 0;
        warnings.push(warning('import-depth-exceeded', logicalPath, null, 'claude'));
        partialCoverage = true;
      } else if (rootScope === 'project' && source.ownership === 'external') {
        source.loadState = 'conditional';
        source.inactiveReason = 'external-import-approval-unknown';
        source.approval = 'unknown';
        warnings.push(warning(
          'external-import-approval-unknown', logicalPath, null, 'claude'));
        partialCoverage = true;
      } else if (parent.loadState === 'conditional' && source.loadState === 'active') {
        source.loadState = 'conditional';
        source.inactiveReason = 'parent-conditional';
      }
      applyExcludes(source);
      if (!addSource(source)) continue;
      queueSource(source);
      if (depth <= 4 && source.approval !== 'unknown') {
        walkImports(source, rootScope, depth + 1, [...stack, resolvedPath]);
      }
    }
  };

  const addMemorySource = (logicalPath, scope, origin, managed = false) => {
    const source = makeClaudeSource(
      logicalPath, scope, origin, options, dependencies, { managed });
    applyExcludes(source);
    addSource(source);
    queueSource(source);
    walkImports(source, scope, 1, [source.resolvedPath]);
    return source;
  };

  const managedFile = addMemorySource(
    path.join(options.claudeManagedDir, 'CLAUDE.md'), 'managed', 'managed-policy', true);
  for (const source of settingSources.filter((entry) => entry.scope === 'managed')) {
    addSource(source);
    queueSource(source);
  }

  const userFile = addMemorySource(
    path.join(options.claudeHome, 'CLAUDE.md'), 'global', 'claude-home');
  for (const source of settingSources.filter((entry) => entry.scope === 'global')) {
    applyExcludes(source);
    addSource(source);
    queueSource(source);
  }
  for (const rulePath of listRuleFiles(
    path.join(options.claudeHome, 'rules'), fileSystem, warnings)) {
    const source = makeClaudeSource(rulePath, 'global', 'rule', options, dependencies);
    source.conditions = parseRuleConditions(source, warnings);
    if (source.conditions.length > 0 && source.loadState === 'active') {
      source.loadState = 'conditional';
      source.inactiveReason = 'path-conditional';
    }
    applyExcludes(source);
    addSource(source);
    queueSource(source);
  }

  for (const source of settingSources.filter((entry) => entry.scope === 'project')) {
    applyExcludes(source);
    addSource(source);
    queueSource(source);
  }
  for (const directory of projectDirectories(options.project, options.cwd)) {
    const rootSource = makeClaudeSource(
      path.join(directory, 'CLAUDE.md'), 'project', 'project-tree', options, dependencies);
    const nestedSource = makeClaudeSource(
      path.join(directory, '.claude', 'CLAUDE.md'), 'project', 'project-tree',
      options, dependencies);
    applyExcludes(rootSource);
    applyExcludes(nestedSource);
    if (rootSource.exists && rootSource._text !== null &&
        nestedSource.exists && nestedSource._text !== null) {
      for (const source of [rootSource, nestedSource]) {
        if (source.loadState === 'active') {
          source.loadState = 'conditional';
          source.inactiveReason = 'ambiguous-project-location';
        }
      }
      warnings.push(warning(
        'claude-project-file-ambiguity', directory, null, 'claude'));
      partialCoverage = true;
    }
    for (const source of [rootSource, nestedSource]) {
      addSource(source);
      queueSource(source);
      walkImports(source, 'project', 1, [source.resolvedPath]);
    }
    addMemorySource(
      path.join(directory, 'CLAUDE.local.md'), 'project', 'project-local');
  }

  const visitedProjectRules = new Set();
  for (const directory of projectDirectories(options.project, options.cwd)) {
    for (const rulePath of listRuleFiles(
      path.join(directory, '.claude', 'rules'), fileSystem, warnings)) {
      const resolved = resolvePhysical(rulePath, fileSystem);
      if (visitedProjectRules.has(resolved)) continue;
      visitedProjectRules.add(resolved);
      const source = makeClaudeSource(rulePath, 'project', 'rule', options, dependencies);
      source.conditions = parseRuleConditions(source, warnings);
      if (source.conditions.length > 0 && source.loadState === 'active') {
        source.loadState = 'conditional';
        source.inactiveReason = 'path-conditional';
      }
      applyExcludes(source);
      addSource(source);
      queueSource(source);
    }
  }

  if (options.claudeAdditionalDirectoriesEnabled) {
    for (const directory of options.claudeAddDirs) {
      addMemorySource(
        path.join(directory, 'CLAUDE.md'), 'project', 'additional-directory');
    }
  }

  if (managedFile.loadState === 'excluded') {
    managedFile.loadState = 'active';
    managedFile.inactiveReason = null;
  }
  if (userFile.loadState === 'conditional') partialCoverage = true;

  return {
    chainSources,
    conditionalSources,
    maxImportDepth,
    excludes,
    settingSources: {
      state: options.claudeSettingSourcesExplicit ? 'explicit' : 'unknown',
      sources: [...options.claudeSettingSources],
    },
    coverage: partialCoverage || warnings.some((entry) => entry.host === 'claude')
      ? 'partial'
      : 'complete',
  };
}

export function buildInventory(options, dependencies = {}) {
  const fileSystem = dependencies.fs ?? fs;
  const warnings = [];
  const sources = [];
  const chainSources = [];
  const inspectClaude = options.host === 'both' || options.host === 'claude';
  const gitState = createGitInspector(
    options, { ...dependencies, fs: fileSystem }, warnings, inspectClaude);
  const inspectionDependencies = { ...dependencies, fs: fileSystem, gitState };
  const config = options.host === 'both' || options.host === 'codex'
    ? parseCodexConfig(options.codexHome, fileSystem, warnings)
    : { fallbackFilenames: [], maxBytes: DEFAULT_PROJECT_DOC_MAX_BYTES };
  let chainOrder = 0;

  if (options.host === 'both' || options.host === 'codex') {
    const globalCandidates = ['AGENTS.override.md', 'AGENTS.md'].map((filename) =>
      makeSource(path.join(options.codexHome, filename), 'global', 'codex-home',
        options, inspectionDependencies));
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
          options, inspectionDependencies));
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

  const claude = inspectClaude
    ? buildClaudeInventory(options, inspectionDependencies, sources, warnings)
    : null;

  addUnreadableWarnings(sources, warnings);
  if (claude && warnings.some((entry) => entry.host === 'claude')) {
    claude.coverage = 'partial';
  }
  sources.sort((left, right) =>
    binaryCompare(left.logicalPath, right.logicalPath) ||
    binaryCompare(left.host, right.host) ||
    binaryCompare(left.origin, right.origin));
  sources.forEach((source, index) => { source.id = `source-${String(index + 1).padStart(4, '0')}`; });
  const codexSourceIds = chainSources
    .sort((left, right) => left._chainOrder - right._chainOrder)
    .map((source) => source.id);
  const claudeSourceIds = claude
    ? claude.chainSources
      .sort((left, right) => left._chainOrder - right._chainOrder)
      .map((source) => source.id)
    : [];
  const claudeConditionalSourceIds = claude
    ? claude.conditionalSources
      .sort((left, right) => left._chainOrder - right._chainOrder)
      .map((source) => source.id)
    : [];
  for (const source of sources) {
    if (source.import?.parentSourceId && typeof source.import.parentSourceId === 'object') {
      source.import.parentSourceId = source.import.parentSourceId.id;
    }
    delete source._readable;
    delete source._chainOrder;
    delete source._text;
  }
  const warningKeys = new Set();
  for (let index = warnings.length - 1; index >= 0; index -= 1) {
    const entry = warnings[index];
    const key = `${entry.code}\0${entry.host}\0${entry.logicalPath}\0${entry.field ?? ''}`;
    if (warningKeys.has(key)) warnings.splice(index, 1);
    else warningKeys.add(key);
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
      ...(inspectClaude ? {
        claudeHome: rootRecord(options.claudeHome, fileSystem),
        claudeManaged: rootRecord(options.claudeManagedDir, fileSystem),
      } : {}),
    },
    sources,
    chains: {
      codex: { sourceIds: codexSourceIds },
      ...(claude ? {
        claude: {
          sourceIds: claudeSourceIds,
          conditionalSourceIds: claudeConditionalSourceIds,
          maxImportDepth: claude.maxImportDepth,
          excludes: claude.excludes,
          settingSources: claude.settingSources,
          coverage: claude.coverage,
        },
      } : {}),
    },
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
