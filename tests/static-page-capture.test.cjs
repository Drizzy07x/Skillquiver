const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const {
  captureArguments,
  captureStaticPage,
  inspectionFrameHtml,
  parseWidths
} = require('../skills/design-ui/scripts/capture-static-page.cjs');

test('static page capture parses bounded viewport widths', () => {
  assert.deepEqual(parseWidths(['360', '1280']), [360, 1280]);
  assert.throws(() => parseWidths(['0']), /between 240 and 3840/);
  assert.throws(() => parseWidths(['wide']), /between 240 and 3840/);
});

test('static page capture builds deterministic headless arguments', () => {
  const pagePath = path.resolve('page.html');
  const outputPath = path.resolve('evidence', 'page-360.png');
  const args = captureArguments(pagePath, outputPath, 360);

  assert.deepEqual(args, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--screenshot=${outputPath}`,
    '--window-size=360,900',
    pathToFileURL(pagePath).href
  ]);
  assert.match(inspectionFrameHtml(outputPath, 360), /width:360px/);
  assert.match(inspectionFrameHtml(outputPath, 360),
    new RegExp(pathToFileURL(outputPath).href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('static page capture creates every requested image and rejects failed captures', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillquiver-capture-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pagePath = path.join(root, 'page.html');
  fs.writeFileSync(pagePath, '<!doctype html><title>Fixture</title>');

  const successfulSpawn = (_browser, args) => {
    const outputPath = args.find(arg => arg.startsWith('--screenshot=')).slice(13);
    fs.writeFileSync(outputPath, 'png');
    return { status: 0, stderr: '' };
  };
  const captures = captureStaticPage(pagePath, path.join(root, 'success'), [360, 1280], {
    findBrowser: () => 'fixture-browser',
    spawnSync: successfulSpawn
  });

  assert.deepEqual(captures.map(capture => capture.width), [360, 1280]);
  assert.ok(captures.every(capture => fs.statSync(capture.outputPath).size > 0));
  assert.ok(fs.statSync(captures[0].inspectionPath).size > 0);
  assert.equal(captures[1].inspectionPath, null);
  assert.equal(fs.existsSync(path.join(root, 'success', '.page-360-inspect.html')), false);
  assert.throws(() => captureStaticPage(pagePath, path.join(root, 'failure'), [360], {
    findBrowser: () => 'fixture-browser',
    spawnSync: () => ({ status: 1, stderr: 'capture error' })
  }), /Capture failed at 360px: capture error/);
});
