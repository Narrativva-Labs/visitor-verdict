import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {startServer} from '../server.mjs';
import {summarize, markdown} from './report.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const resultDir = fileURLToPath(new URL('../results/', import.meta.url));
const artifacts = join(resultDir, 'adversarial');
const python = join(process.env.TC_ADV_VENV || join(here, '.venv'), 'bin', 'python');
const tools = ['undetected-chromedriver', 'nodriver', 'camoufox', 'selenium-headed', 'selenium-headless',
  'puppeteer-stealth', 'rebrowser-puppeteer', 'puppeteer-real-browser', 'patchright'];
const pythonTools = new Set(tools.slice(0, 5));
const timeoutMs = Number(process.env.TC_ADV_TIMEOUT_MS || 120000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 30000) throw Error('TC_ADV_TIMEOUT_MS must be at least 30000');
const camoufoxLaunchMs = Number(process.env.TC_ADV_CAMOUFOX_LAUNCH_MS || 300000);
if (!Number.isFinite(camoufoxLaunchMs) || camoufoxLaunchMs < 1000) throw Error('TC_ADV_CAMOUFOX_LAUNCH_MS must be at least 1000');
const camoufoxTimeoutMs = Number(process.env.TC_ADV_CAMOUFOX_TIMEOUT_MS || Math.max(timeoutMs, camoufoxLaunchMs + 120000));
if (!Number.isFinite(camoufoxTimeoutMs) || camoufoxTimeoutMs < 30000) throw Error('TC_ADV_CAMOUFOX_TIMEOUT_MS must be at least 30000');
if (process.argv.length > 2) throw Error('No CLI arguments; see USAGE.md for environment options');
await mkdir(artifacts, {recursive: true});
const report = {generatedAt: new Date().toISOString(), origin: 'http://127.0.0.1:8787',
  runtime: {node: process.version, platform: process.platform, arch: process.arch}, results: []};
async function writeReports() {
  for (const [name, body] of [['adversarial-report.json', JSON.stringify(report, null, 2) + '\n'],
    ['adversarial-report.md', markdown(report)]]) {
    const target = join(resultDir, name);
    await writeFile(target + '.tmp', body);
    await rename(target + '.tmp', target);
  }
}
let activeChild;
function killGroup(child, signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function execute(command, args, logPath, runTimeoutMs) {
  let log = '', processError, exitCode;
  const child = spawn(command, args, {cwd: here, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  activeChild = child;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk.toString()).slice(-250000); });
  let forceTimer;
  const stop = () => {
    killGroup(child, 'SIGTERM');
    forceTimer = setTimeout(() => killGroup(child, 'SIGKILL'), 1500);
  };
  const timer = setTimeout(() => { processError = `Runner exceeded ${runTimeoutMs} ms (last saved stage/evidence retained)`; stop(); }, runTimeoutMs);
  await new Promise(resolve => {
    child.on('error', error => {processError = String(error); resolve();});
    child.on('exit', (code, signal) => {
      exitCode = code;
      if (code !== 0 && !processError) processError = `Runner exited with code ${code}, signal ${signal || 'none'}`;
      // Only this runner's fresh process group; never touch an existing browser.
      stop();
    });
    child.on('close', resolve);
  });
  clearTimeout(timer);
  // Kill any browser descendants that survived normal close or timeout cleanup.
  if (forceTimer) { clearTimeout(forceTimer); killGroup(child, 'SIGKILL'); }
  activeChild = undefined;
  await writeFile(logPath, log);
  return {processError, exitCode};
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  killGroup(activeChild, 'SIGKILL');
  process.exit(signal === 'SIGINT' ? 130 : 143);
});
let server, serverError;
try { ({server} = await startServer(8787)); }
catch (error) { serverError = `Could not start the local server on 127.0.0.1:8787: ${error}. Stop any existing server before running.`; }
try {
  for (const tool of tools) for (const mode of ['default', 'human-like']) {
    const name = tool + '-' + mode;
    const output = join(artifacts, name + '.json');
    let raw = {tool, mode, events: [], notes: []};
    try {
      await rm(output, {force: true}); // Never reuse evidence from an earlier run.
      if (serverError) throw Error(serverError);
      raw.stage = 'starting runner';
      await writeFile(output, JSON.stringify(raw, null, 2));
      const isPython = pythonTools.has(tool);
      const processResult = await execute(isPython ? python : process.execPath,
        [join(here, isPython ? 'python-runner.py' : 'node-runner.mjs'), tool, mode, output], join(artifacts, name + '.log'),
        tool === 'camoufox' ? camoufoxTimeoutMs : timeoutMs);
      try { raw = {...raw, ...JSON.parse(await readFile(output, 'utf8'))}; }
      catch (error) { raw.error = 'Runner did not write readable evidence: ' + error; }
      Object.assign(raw, processResult);
    } catch (error) { raw.error = String(error.stack || error); }
    const row = summarize(raw);
    report.results.push(row);
    await writeReports();
    console.log(`${tool} / ${mode}: ${row.status}; ends human: ${row.endsHuman ?? 'unknown'}`);
  }
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
}
console.log(`Reports: ${join(resultDir, 'adversarial-report.md')} and .json`);
// Errors affect exit status; any successfully measured class is informational.
if (report.results.some(r => r.status === 'ERROR')) process.exitCode = 1;
