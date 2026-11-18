// Test-only external Chrome lifecycle. Never touches an existing browser/profile.
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {access, mkdtemp, rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join} from 'node:path';
import {sleep} from './support.mjs';
async function chromeExecutable() {
  const candidates = process.env.TRAFFIC_CHROME_EXECUTABLE ? [process.env.TRAFFIC_CHROME_EXECUTABLE] :
    process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')] :
    process.platform === 'win32' ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(root => join(root, 'Google/Chrome/Application/chrome.exe')) :
    ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  for (const candidate of candidates) {
    try { await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return candidate; } catch {}
  }
  throw Error('Google Chrome not found; set TRAFFIC_CHROME_EXECUTABLE to its executable (same installation as channel chrome).');
}
async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
export async function connectRealChrome(chromium) {
  const executable = await chromeExecutable();
  // A literal port=0 enables navigator.webdriver in Chrome; use a nonzero port.
  const port = await freeLoopbackPort();
  const profile = await mkdtemp(join(tmpdir(), 'traffic-class-cdp-'));
  let child, browser, spawnError, endpoint, diagnostics = '';
  async function close() {
    // CDP close/disconnect is bounded; the separately spawned process is ours.
    if (browser) {
      let timer;
      await Promise.race([browser.close().catch(() => {}), new Promise(resolve => {timer = setTimeout(resolve, 2500);})]);
      clearTimeout(timer);
    }
    if (child && child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const deadline = Date.now() + 3000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(50);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(1000)]);
      }
    }
    await rm(profile, {recursive: true, force: true, maxRetries: 4, retryDelay: 250});
  }
  try {
    child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      '--window-size=1440,1000', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
    child.on('error', error => {spawnError = error;});
    // Trust only the endpoint announced by OUR child process, never an arbitrary
    // responder on a port another process might claim after the reservation.
    child.stderr.on('data', chunk => {
      diagnostics = (diagnostics + chunk.toString()).slice(-8192);
      const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      try {
        const url = new URL(match[1]);
        if (url.hostname === '127.0.0.1' && Number(url.port) === port && url.pathname.startsWith('/devtools/browser/')) endpoint = url.href;
      } catch {}
    });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw Error('External Chrome exited before CDP became ready');
      if (endpoint) break;
      await sleep(100);
    }
    if (!endpoint) throw Error('External Chrome CDP startup timeout (20s)');
    browser = await chromium.connectOverCDP(endpoint, {timeout: 10000});
    const context = browser.contexts()[0];
    if (!context) throw Error('Connected Chrome has no default profile context');
    return {browser, context, close};
  } catch (error) { await close(); throw error; }
}
