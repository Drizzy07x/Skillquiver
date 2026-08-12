const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

function parseWidths(values) {
  const widths = values.map(value => Number(value));
  if (widths.length === 0 || widths.some(width =>
    !Number.isInteger(width) || width < 240 || width > 3840)) {
    throw new Error('Viewport widths must be integers between 240 and 3840.');
  }
  return widths;
}

function browserCandidates(env = process.env, platform = process.platform) {
  const candidates = [env.CHROME_PATH].filter(Boolean);
  if (platform === 'win32') {
    for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) {
      if (!root) continue;
      candidates.push(
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      );
    }
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    );
  }
  return [...new Set(candidates)];
}

function findBrowser() {
  return browserCandidates().find(candidate => fs.existsSync(candidate));
}

function captureArguments(pagePath, outputPath, width) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--screenshot=${outputPath}`,
    `--window-size=${width},900`,
    pathToFileURL(pagePath).href
  ];
}

function captureStaticPage(pagePath, outputDirectory, widths, dependencies = {}) {
  const resolvedPage = path.resolve(pagePath);
  if (!fs.existsSync(resolvedPage)) throw new Error(`Page not found: ${resolvedPage}`);

  const findBrowserImpl = dependencies.findBrowser || findBrowser;
  const spawnSyncImpl = dependencies.spawnSync || spawnSync;
  const browser = findBrowserImpl();
  if (!browser) throw new Error('No installed Chrome, Chromium, or Edge executable was found.');

  const resolvedOutput = path.resolve(outputDirectory);
  fs.mkdirSync(resolvedOutput, { recursive: true });
  const pageName = path.basename(resolvedPage, path.extname(resolvedPage));

  return widths.map(width => {
    const outputPath = path.join(resolvedOutput, `${pageName}-${width}.png`);
    const result = spawnSyncImpl(
      browser,
      captureArguments(resolvedPage, outputPath, width),
      { encoding: 'utf8', windowsHide: true }
    );
    if (result.error || result.status !== 0 || !fs.existsSync(outputPath) ||
        fs.statSync(outputPath).size === 0) {
      const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
      throw new Error(`Capture failed at ${width}px: ${detail}`);
    }
    return { width, height: 900, outputPath, browser };
  });
}

if (require.main === module) {
  try {
    const [pagePath, outputDirectory, ...widthValues] = process.argv.slice(2);
    if (!pagePath || !outputDirectory) {
      throw new Error('Usage: capture-static-page.cjs <page.html> <output-dir> <width...>');
    }
    const captures = captureStaticPage(pagePath, outputDirectory, parseWidths(widthValues));
    process.stdout.write(`${JSON.stringify({ captures })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  browserCandidates,
  captureArguments,
  captureStaticPage,
  findBrowser,
  parseWidths
};
