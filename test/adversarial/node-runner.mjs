import {readFile, writeFile, rename, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const [tool, mode, output] = process.argv.slice(2);
if (!output || !['default', 'human-like'].includes(mode)) throw Error('tool mode output required');
const protocol = JSON.parse(await readFile(new URL('protocol.json', import.meta.url)));
const origin = 'http://127.0.0.1:8787';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const result = {tool, mode, events: [], versions: {}, notes: []};
let browser, page, profile;
async function packageVersion(name) {
  // Read the installed manifest directly: packages can forbid the /package.json export.
  return JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
}
async function save() {
  await writeFile(output + '.tmp', JSON.stringify(result, null, 2));
  await rename(output + '.tmp', output);
}
async function capture() {
  result.events = JSON.parse(await page.evaluate(protocol.readEvents));
  await save();
}
async function ready(path) {
  const expression = protocol.ready.replace('PATH', JSON.stringify(path));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await page.evaluate(expression)) { await capture(); return; } } catch {}
    await sleep(100);
  }
  throw Error('Visible loaded document not observed: ' + path);
}
async function approach(selector) {
  const target = JSON.parse(await page.evaluate(protocol.target.replace('SELECTOR', JSON.stringify(selector))));
  const start = {x: 30, y: 230};
  await page.mouse.move(start.x, start.y);
  for (let i = 1; i <= 30; i++) {
    const t = i / 30, ease = t * t * (3 - 2 * t);
    await page.mouse.move(start.x + (target.x - start.x) * ease,
      start.y + (target.y - start.y) * ease + Math.sin(t * Math.PI) * 30);
    await sleep(22);
  }
  await sleep(180);
  await page.mouse.down(); await page.mouse.up();
}
try {
  const executablePath = process.env.TC_ADV_CHROME || undefined;
  if (tool === 'patchright') {
    const {chromium} = await import('patchright');
    result.versions.patchright = await packageVersion('patchright');
    browser = await chromium.launch({headless: false, ...(executablePath ? {executablePath} : {})});
    page = await browser.newPage({viewport: null});
    result.notes.push('Patchright headed Chromium, no extra stealth patches.');
  } else if (tool === 'puppeteer-real-browser') {
    const realBrowser = await import('puppeteer-real-browser');
    const connect = realBrowser.connect || realBrowser.default?.connect;
    if (typeof connect !== 'function') throw Error('puppeteer-real-browser exports no connect function');
    result.versions['puppeteer-real-browser'] = await packageVersion('puppeteer-real-browser');
    profile = await mkdtemp(join(tmpdir(), 'tc-adv-real-'));
    ({browser, page} = await connect({headless: false, turnstile: false,
      disableXvfb: true, customConfig: {userDataDir: profile, ...(executablePath ? {chromePath: executablePath} : {})},
      connectOption: {defaultViewport: null}}));
    result.notes.push('Headed system Chrome; Xvfb disabled for native desktop. Package may be unavailable on this platform.');
  } else {
    let launcher;
    if (tool === 'puppeteer-stealth') {
      const {addExtra} = await import('puppeteer-extra');
      const {default: puppeteer} = await import('puppeteer');
      const {default: StealthPlugin} = await import('puppeteer-extra-plugin-stealth');
      launcher = addExtra(puppeteer).use(StealthPlugin());
      for (const name of ['puppeteer', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth']) result.versions[name] = await packageVersion(name);
    } else if (tool === 'rebrowser-puppeteer') {
      launcher = (await import('rebrowser-puppeteer')).default;
      result.versions[tool] = await packageVersion(tool);
    } else throw Error('Unknown tool: ' + tool);
    browser = await launcher.launch({headless: true, ...(executablePath ? {executablePath} : {})});
    page = await browser.newPage();
    result.notes.push('Headless launch with package defaults.');
  }
  result.browserVersion = typeof browser.version === 'function' ? await browser.version() : null;
  page.setDefaultTimeout(15000);
  if (page.setDefaultNavigationTimeout) page.setDefaultNavigationTimeout(15000);
  await page.bringToFront();
  await page.goto(origin + protocol.paths[0], {waitUntil: 'load'});
  await ready(protocol.paths[0]);
  for (const path of protocol.paths.slice(1)) {
    const selector = `a[href="${path}"]`;
    if (mode === 'human-like') {
      await sleep(2400);
      await approach(selector);
    } else await page.click(selector);
    await ready(path);
  }
  // No synthetic pagehide/final; wait for the detector's real visible-time final.
  if (mode === 'human-like') {
    await page.mouse.move(40, 210);
    await page.mouse.move(300, 260, {steps: 25});
  }
  await sleep(10000);
  await capture();
} catch (error) {
  result.error = String(error.stack || error);
  if (page) await capture().catch(() => {});
} finally {
  await save();
  if (browser) await browser.close().catch(error => {result.cleanupError = String(error);});
  if (profile) await rm(profile, {recursive: true, force: true}).catch(error => {result.cleanupError = String(error);});
  await save();
}
if (result.error || result.cleanupError) process.exitCode = 1;
