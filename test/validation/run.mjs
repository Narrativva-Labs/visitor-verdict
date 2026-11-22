#!/usr/bin/env node
// Validation runner (protocol: docs/study/validation-protocol.md).
// Runs the automated ground-truth scenarios against an operator-controlled
// target and appends one CSV row per run to test/validation/results/<date>/runs.csv.
// Captures labels only: classes, phases, operator enums, debug codes and
// aggregate collector counters. No IPs, identifiers, URLs or page content.
import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Only targets the project operates. Never add third-party or client sites.
const TARGETS = {
  demo: {
    origin: 'https://demoshop.frantisekbujnovsky.com',
    collector: 'https://q4vtk8.demoshop.frantisekbujnovsky.com',
    // Checkout pages redirect to the cart when it is empty (and drop the query), so avoid them.
    pages: ['/', '/hledat.html', '/kosik.html'],
    consent: {all: '[data-role="all"]', necessary: '[data-role="necessary"]'}
  },
  local: {origin: null, collector: null, pages: ['/index.html', '/page2.html', '/page3.html'], consent: {}}
};

const quiet = ['--disable-blink-features=AutomationControlled'];
// true_class: ground-truth class from the protocol. expected: acceptable worst
// classes for a "match"; known misses are expected to fail and are kept anyway.
const SCENARIOS = [
  {id: 'pw-headless', trueClass: 'automation', tool: 'playwright', launch: {headless: true},
    expected: ['automated'], note: 'Playwright defaults (headless shell).'},
  {id: 'pw-headless-masked', trueClass: 'automation', tool: 'playwright', launch: {headless: true}, mask: true,
    expected: ['automated'], note: 'UA string and UA Client Hints overridden through CDP; webdriver left as is.'},
  {id: 'pw-headless-masked-quiet', trueClass: 'automation_masked', tool: 'playwright', launch: {headless: true, args: quiet}, mask: true,
    expected: ['automated', 'suspicious'], note: 'UA/UA-CH override plus AutomationControlled disabled (webdriver false).'},
  {id: 'pw-headed', trueClass: 'automation', tool: 'playwright', launch: {headless: false},
    expected: ['automated'], note: 'Headed bundled Chromium, Playwright defaults.'},
  {id: 'pw-headed-quiet', trueClass: 'automation_masked', tool: 'playwright', launch: {headless: false, args: quiet},
    expected: ['automated', 'suspicious'], note: 'Headed, --disable-blink-features=AutomationControlled.'},
  {id: 'pw-dom-marker', trueClass: 'browser_agent_synthetic', tool: 'playwright', launch: {headless: false, args: quiet},
    marker: {id: 'codex-agent-overlay-root', parent: 'root', delayMs: 2000},
    expected: ['declared_agent'], expectedAgent: 'openai',
    note: 'Headed quiet Chromium; synthetic codex-agent-overlay-root added to the root element 2 s after load on page 1.'},
  {id: 'patchright-headed', trueClass: 'automation_stealth', tool: 'patchright', launch: {headless: false, channel: 'chrome'},
    expected: ['automated', 'suspicious'], note: 'Patchright with installed Google Chrome; known miss in the v1.0 benchmark.'},
  {id: 'nodriver-headed', trueClass: 'automation_stealth', tool: 'nodriver', python: 'VV_VALIDATION_NODRIVER_PY',
    expected: ['automated', 'suspicious'], note: 'nodriver with installed Google Chrome (CDP, no WebDriver).'},
  {id: 'zendriver-headed', trueClass: 'automation_stealth', tool: 'zendriver', python: 'VV_VALIDATION_ZENDRIVER_PY',
    expected: ['automated', 'suspicious'], note: 'zendriver (nodriver fork) with installed Google Chrome.'},
  // GA4 known-bot filtering pair (protocol section "GA4 known-bot filtering check"):
  // run ids start with ga4f- so the BigQuery export can be searched for them later.
  {id: 'ga4f-headless', runPrefix: 'ga4f-headless', trueClass: 'automation', tool: 'playwright', launch: {headless: true},
    expected: ['automated'], note: 'HeadlessChrome UA (Playwright defaults); checks whether GA4 drops it as a known bot.'},
  {id: 'ga4f-masked', runPrefix: 'ga4f-masked', trueClass: 'automation', tool: 'playwright', launch: {headless: true}, mask: true,
    expected: ['automated'], note: 'Same headless browser with a non-headless UA string and UA-CH; webdriver left as is.'},
  {id: 'fetch-nojs', trueClass: 'crawler_nojs', tool: 'node-fetch', fetch: true,
    expected: ['no_event'], note: 'Plain HTTP GET of each page; JavaScript never runs.'}
];

const help = `Usage: node test/validation/run.mjs [--target demo|local] [--n 3] [--scenarios a,b]
  [--pages 3] [--dwell-ms 9500] [--gap-ms 3000] [--consent all|necessary|none]
  [--no-debug] [--no-botd] [--hold-after-final-ms 0] [--round pilot-1] [--out test/validation/results/<date>]
Scenarios: ${SCENARIOS.map(s => s.id).join(', ')}
Runs are strictly sequential (one browser at a time). Every navigated URL carries
?vvp=<run_id> (and vvdebug unless --no-debug). Optional tools:
  VV_VALIDATION_TOOLS=<dir with node_modules/patchright>
  VV_VALIDATION_NODRIVER_PY / VV_VALIDATION_ZENDRIVER_PY=<python with the package>
Missing tools are recorded as status=skip, never as a detection result.`;

function parseArgs(argv) {
  const opts = {target: 'demo', n: 3, scenarios: null, pages: 3, dwell: 9500, gap: 3000, consent: 'all',
    debug: true, botd: true, round: 'pilot-1', out: null, hold: 0};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help') { console.log(help); process.exit(0); }
    if (key === '--no-debug') { opts.debug = false; continue; }
    if (key === '--no-botd') { opts.botd = false; continue; }
    const value = argv[++i];
    if (value === undefined) throw Error(`Missing value for ${key}`);
    if (key === '--target') opts.target = value;
    else if (key === '--n') opts.n = Number(value);
    else if (key === '--scenarios') opts.scenarios = value.split(',');
    else if (key === '--pages') opts.pages = Number(value);
    else if (key === '--dwell-ms') opts.dwell = Number(value);
    else if (key === '--gap-ms') opts.gap = Number(value);
    else if (key === '--consent') opts.consent = value;
    else if (key === '--round') opts.round = value;
    else if (key === '--hold-after-final-ms') opts.hold = Number(value);
    else if (key === '--out') opts.out = value;
    else throw Error(`Unknown option ${key}`);
  }
  if (!TARGETS[opts.target]) throw Error('Unknown target');
  if (!Number.isInteger(opts.n) || opts.n < 1 || opts.n > 20) throw Error('--n must be 1..20');
  if (!Number.isInteger(opts.pages) || opts.pages < 1 || opts.pages > TARGETS[opts.target].pages.length) throw Error('Invalid --pages');
  if (!Number.isInteger(opts.dwell) || opts.dwell < 9000 || opts.dwell > 60000) throw Error('--dwell-ms must be 9000..60000 (final needs 8 s visible)');
  if (!Number.isInteger(opts.gap) || opts.gap < 1000) throw Error('--gap-ms must be >= 1000');
  if (!Number.isInteger(opts.hold) || opts.hold < 0 || opts.hold > 30000) throw Error('--hold-after-final-ms must be 0..30000');
  if (!['all', 'necessary', 'none'].includes(opts.consent)) throw Error('Invalid --consent');
  if (!/^[a-z0-9-]{1,32}$/.test(opts.round)) throw Error('--round: lowercase letters, digits, hyphens');
  if (opts.scenarios) for (const id of opts.scenarios) if (!SCENARIOS.some(s => s.id === id)) throw Error(`Unknown scenario ${id}`);
  return opts;
}

const RANK = {no_event: 0, human: 1, suspicious: 2, declared_agent: 3, automated: 4};
const worst = classes => classes.filter(c => c in RANK).sort((a, b) => RANK[b] - RANK[a])[0] || 'no_event';
const tally = items => {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts].map(([k, v]) => v > 1 ? `${k}x${v}` : k).join(';');
};

// ---------- collector counters (aggregate, public /health) ----------
async function health(target) {
  if (!target.collector) return null;
  try {
    const response = await fetch(`${target.collector}/health`, {signal: AbortSignal.timeout(8000)});
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
function healthDelta(before, after) {
  if (!before || !after) return {text: 'unavailable', total: null};
  const a = after.agentVerification?.counters, b = before.agentVerification?.counters;
  if (!a || !b) return {text: 'unavailable', total: null};
  if (a.since !== b.since) return {text: 'collector-restarted', total: null};
  const parts = [], diff = (x, y) => (x || 0) - (y || 0);
  const filtered = diff(after.google?.botsFiltered, before.google?.botsFiltered);
  if (filtered) parts.push(`dropped_obvious_bot=${filtered}`);
  let total = filtered;
  for (const kind of ['events', 'pings']) {
    for (const [type, value] of Object.entries(a[kind].byType)) {
      const d = diff(value, b[kind].byType[type]);
      if (d) { parts.push(`${kind}.${type}=${d}`); total += d; }
    }
  }
  return {text: parts.join(';') || 'none', total};
}

// ---------- browser scenarios (Playwright API: playwright or patchright) ----------
async function loadEngine(tool) {
  if (tool === 'playwright') {
    const {chromium} = await import('playwright');
    return {chromium, version: require('playwright/package.json').version, mainWorld: (page, fn, arg) => page.evaluate(fn, arg)};
  }
  if (tool === 'patchright') {
    const dir = process.env.VV_VALIDATION_TOOLS || path.join(here, '.tools');
    const pkg = path.join(dir, 'node_modules/patchright');
    if (!existsSync(pkg)) throw Object.assign(Error('patchright not installed (set VV_VALIDATION_TOOLS)'), {skip: true});
    const {chromium} = await import(pathToFileURL(path.join(pkg, 'index.mjs')).href);
    const version = JSON.parse(await readFile(path.join(pkg, 'package.json'), 'utf8')).version;
    // Patchright evaluates in an isolated world by default; the detector's globals live in the main world.
    return {chromium, version, mainWorld: (page, fn, arg) => page.evaluate(fn, arg, undefined, false)};
  }
  throw Error(`No engine for ${tool}`);
}

function maskedUserAgent(fullVersion) {
  const major = fullVersion.split('.')[0];
  return {
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    platform: 'MacIntel',
    userAgentMetadata: {
      brands: [{brand: 'Chromium', version: major}, {brand: 'Google Chrome', version: major}, {brand: 'Not_A Brand', version: '99'}],
      fullVersionList: [{brand: 'Chromium', version: fullVersion}, {brand: 'Google Chrome', version: fullVersion}, {brand: 'Not_A Brand', version: '99.0.0.0'}],
      fullVersion, platform: 'macOS', platformVersion: '15.0.0', architecture: 'arm', model: '', mobile: false, bitness: '64', wow64: false
    }
  };
}

function readPage() {
  const snapshot = window.__visitorVerdict ? {...window.__visitorVerdict} : null;
  const events = (window.dataLayer || []).filter(e => e && e.event === 'traffic_class').map(e => ({
    phase: e.traffic_phase, class: e.traffic_class, score: e.traffic_score, version: e.traffic_version,
    agent: e.traffic_agent, signals: Array.isArray(e.traffic_signals) ? e.traffic_signals.slice(0, 40) : undefined
  }));
  return {snapshot, events, visibility: document.visibilityState, ageMs: Math.round(performance.now()), focus: document.hasFocus()};
}

const LABEL_KEYS = ['traffic_class', 'traffic_phase', 'traffic_agent'];
function ga4Label(params) {
  const en = params.get('en');
  if (!en) return null;
  const v = k => params.get(`ep.${k}`);
  return `${en}:${v('traffic_class') || '-'}${v('traffic_phase') ? '/' + v('traffic_phase') : ''}${v('traffic_agent') ? '/' + v('traffic_agent') : ''}`;
}

async function browserRun(scenario, opts, target, url) {
  const engine = await loadEngine(scenario.tool);
  const result = {toolVersion: engine.version, pages: [], ga4: [], vanilla: [], notes: []};
  const browser = await engine.chromium.launch(scenario.launch);
  try {
    result.browserVersion = browser.version();
    const contextOptions = {viewport: {width: 1280, height: 800}};
    let mask;
    if (scenario.mask) { mask = maskedUserAgent(result.browserVersion); contextOptions.userAgent = mask.userAgent; }
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    if (mask) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setUserAgentOverride', mask);
    }
    // Network observation happens in the driver, outside the page: labels only.
    // Network observation through CDP, outside the page: labels only. Playwright's own
    // request events miss some unload beacons (CDP type "Other"); the CDP stream does not.
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    network.on('Network.requestWillBeSent', ({request}) => {
      try {
        const u = new URL(request.url);
        let body = request.postData || '';
        if (!body && request.postDataEntries) body = request.postDataEntries.map(e => Buffer.from(e.bytes || '', 'base64').toString('utf8')).join('');
        if (/\/g\/collect$/.test(u.pathname)) {
          const lines = body ? body.split('\n').filter(Boolean) : [''];
          for (const line of lines) {
            const merged = new URLSearchParams(u.search);
            for (const [k, v] of new URLSearchParams(line)) merged.set(k, v);
            const label = ga4Label(merged);
            if (label) result.ga4.push(label);
          }
        } else if (target.collector && u.origin === target.collector && ['/e', '/d'].includes(u.pathname)) {
          if (request.method !== 'POST') return;
          // Some unload beacons expose no body to CDP: count them as '?'.
          const json = body ? JSON.parse(body) : {name: '?'};
          const p = json.params || {};
          result.vanilla.push(`${u.pathname.slice(1)}:${json.name}:${p.traffic_class || '-'}${p.traffic_phase ? '/' + p.traffic_phase : ''}${p.traffic_agent ? '/' + p.traffic_agent : ''}`);
        }
      } catch { /* unparsable beacon: ignored */ }
    });
    page.on('pageerror', () => result.notes.push('page-error'));
    for (let i = 0; i < opts.pages; i++) {
      const loadedAt = Date.now();
      await page.goto(url(i), {waitUntil: 'load', timeout: 30000});
      if (i === 0 && opts.consent !== 'none' && target.consent[opts.consent]) {
        await sleep(1500);
        const button = page.locator(target.consent[opts.consent]).first();
        if (await button.count()) await button.click({timeout: 5000}); else result.notes.push('consent-button-missing');
      }
      if (i === 0 && scenario.marker) {
        await sleep(Math.max(0, loadedAt + scenario.marker.delayMs - Date.now()));
        await engine.mainWorld(page, marker => {
          const node = document.createElement('div');
          node.id = marker.id;
          (marker.parent === 'root' ? document.documentElement : document.body).appendChild(node);
        }, scenario.marker);
      }
      await sleep(Math.max(0, loadedAt + opts.dwell - Date.now()));
      // The detector starts only after the tag manager loads it; its 8-second final can
      // land after the minimum dwell. Wait for it, bounded, instead of reading too early.
      for (let t = 0; t < 40; t++) {
        if (await engine.mainWorld(page, () => (window.dataLayer || []).some(e => e && e.event === 'traffic_class' && e.traffic_phase === 'final'))) break;
        await sleep(250);
      }
      result.pages.push(await engine.mainWorld(page, readPage));
      // GA4 batches hits: the final-phase traffic_class hit is sent seconds after the
      // final event. Holding the page lets delivery checks observe it.
      if (opts.hold) await sleep(opts.hold);
    }
    if (opts.botd) result.botd = await injectBotd(page, engine);
    // Leave the last page like a visitor closing the tab, so its unload beacons are sent and observed.
    await page.goto('about:blank').catch(() => {});
    await sleep(2500);
    await context.close();
  } finally { await browser.close().catch(() => {}); }
  return result;
}

// Lab-only comparison: BotD is injected after the detector's final result on the
// last page, from the locked node_modules copy, with monitoring disabled. It
// changes the page environment, so it never runs before or during observation.
async function injectBotd(page, engine) {
  try {
    const source = await readFile(require.resolve('@fingerprintjs/botd/dist/botd.esm.js'), 'utf8');
    const version = require('@fingerprintjs/botd/package.json').version;
    await page.addScriptTag({type: 'module', content: `${source}\nwindow.__vvLabBotd = load;`});
    const out = await engine.mainWorld(page, async () => {
      for (let i = 0; i < 50 && !window.__vvLabBotd; i++) await new Promise(r => setTimeout(r, 100));
      if (!window.__vvLabBotd) return {status: 'ERROR', error: 'not loaded'};
      const detector = await window.__vvLabBotd({monitoring: false});
      const r = detector.detect();
      return {status: 'OK', bot: r.bot, kind: r.botKind || ''};
    });
    return out.status === 'OK' ? `botd-${version}:${out.bot ? 'bot' : 'not_bot'}${out.kind ? '/' + out.kind : ''}` : `botd-${version}:error`;
  } catch { return 'botd:error'; }
}

// ---------- Python CDP drivers (nodriver, zendriver) ----------
function pythonRun(scenario, opts, target, url) {
  const python = process.env[scenario.python];
  if (!python || !existsSync(python)) return Promise.reject(Object.assign(Error(`${scenario.python} not set`), {skip: true}));
  const spec = {tool: scenario.tool, urls: Array.from({length: opts.pages}, (_, i) => url(i)), dwellMs: opts.dwell,
    consentSelector: opts.consent !== 'none' ? target.consent[opts.consent] || null : null};
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', path.join(here, 'cdp-driver.py'), JSON.stringify(spec)], {stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000 + opts.pages * (opts.dwell + 15000));
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      clearTimeout(timer);
      const line = out.trim().split('\n').filter(l => l.startsWith('{')).at(-1) || '';
      try {
        const parsed = JSON.parse(line);
        if (parsed.skip) return reject(Object.assign(Error(parsed.error), {skip: true}));
        if (parsed.error && !parsed.pages?.length) return reject(Error(parsed.error));
        resolve({...parsed, ga4: null, vanilla: null, notes: parsed.error ? ['driver-error-after-pages'] : []});
      } catch { reject(Error(`driver exit ${code}: ${(err.split('\n').filter(Boolean).at(-1) || '').slice(0, 160)}`)); }
    });
  });
}

async function fetchRun(opts, target, url) {
  const notes = [];
  for (let i = 0; i < opts.pages; i++) {
    const response = await fetch(url(i), {headers: {'User-Agent': 'VisitorVerdictValidation/0.1 (+no-js fetch)'}, signal: AbortSignal.timeout(15000)});
    await response.arrayBuffer();
    if (!response.ok) notes.push(`http-${response.status}`);
  }
  return {toolVersion: process.version, browserVersion: '', pages: Array.from({length: opts.pages}, () => ({snapshot: null, events: []})), ga4: [], vanilla: [], notes};
}

// ---------- rows ----------
const COLUMNS = ['run_id', 'round', 'scenario', 'true_class', 'expected_vv', 'tool', 'tool_version', 'browser_version',
  'headless', 'consent', 'debug', 'started_at', 'ended_at', 'status', 'pages_completed', 'vv_initial', 'vv_final',
  'vv_worst', 'vv_agent_phase', 'traffic_agent', 'vv_pages', 'signals', 'ga4_hits', 'ga4_labels', 'vanilla_labels',
  'vanilla_server_delta', 'botd_result', 'match', 'notes'];
const csvCell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

function toRow(base, scenario, result) {
  const pages = result?.pages || [];
  const pageEvents = pages.map(p => p.events || []);
  const all = pageEvents.flat();
  const initialOf = events => events.find(e => e.phase === 'initial')?.class;
  const finalOf = events => events.find(e => e.phase === 'final')?.class;
  const agentPhase = pageEvents.map((events, i) => events.filter(e => e.phase === 'agent').map(e => `p${i + 1}:${e.class}/${e.agent || '-'}`)).flat();
  const vvWorst = scenario.fetch ? 'no_event' : worst(all.map(e => e.class));
  const agents = [...new Set(all.map(e => e.agent).filter(Boolean))];
  let match = '';
  if (base.status === 'complete') {
    match = scenario.expected.includes(vvWorst) && (!scenario.expectedAgent || agents.includes(scenario.expectedAgent)) ? 'yes' : 'no';
  }
  return {
    ...base,
    pages_completed: pages.length,
    vv_initial: scenario.fetch ? 'no_event' : initialOf(pageEvents[0] || []) || (base.status === 'complete' ? 'missing' : ''),
    vv_final: scenario.fetch ? 'no_event' : finalOf(pageEvents.at(-1) || []) || (base.status === 'complete' ? 'missing' : ''),
    vv_worst: base.status === 'complete' ? vvWorst : '',
    vv_agent_phase: agentPhase.join(';'),
    traffic_agent: agents.join(';'),
    vv_pages: pages.map(p => (p.events || []).map(e => `${e.phase[0]}:${e.class}${e.agent ? '/' + e.agent : ''}`).join(' ') + (p.visibility && p.visibility !== 'visible' ? ` [${p.visibility}]` : '') || '-').join(' | '),
    signals: base.debug === 'on' ? [...new Set(all.flatMap(e => e.signals || []))].join(' ') : '',
    ga4_hits: result?.ga4 == null ? '' : result.ga4.length,
    ga4_labels: result?.ga4 == null ? 'not_captured' : tally(result.ga4),
    vanilla_labels: result?.vanilla == null ? 'not_captured' : tally(result.vanilla),
    botd_result: result?.botd ? `${result.botd} (lab injection after final, affects environment)` : '',
    match,
    tool_version: result?.toolVersion || '',
    browser_version: result?.browserVersion || '',
    notes: [...new Set([...(base.notes ? [base.notes] : []), ...(result?.notes || [])])].join(';')
  };
}

// ---------- summary ----------
const Z = 1.95996398454;
function wilson(k, n) {
  if (!n) return 'n/e';
  const p = k / n, d = 1 + Z * Z / n;
  const c = (p + Z * Z / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / d;
  return `${Math.round(Math.max(0, c - h) * 100)}–${Math.round(Math.min(1, c + h) * 100)}%`;
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  const [header, ...body] = rows;
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
async function writeSummary(dir) {
  const rows = parseCsv(await readFile(path.join(dir, 'runs.csv'), 'utf8'));
  const file = path.join(dir, 'summary.md');
  const marker = '<!-- notes: everything below is kept when the runner regenerates the tables -->';
  let kept = `${marker}\n\n## Observations\n\n(add pilot observations here)\n`;
  if (existsSync(file)) { const old = await readFile(file, 'utf8'); if (old.includes(marker)) kept = old.slice(old.indexOf(marker)); }
  const ids = [...new Set(rows.map(r => `${r.round}\t${r.scenario}`))];
  const lines = ['| Round | Scenario | True class | Expected | Runs | Complete | Skip/error | Worst class (complete runs) | Match k/n | Wilson 95% | Agent phase | BotD (lab) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const id of ids) {
    const [round, scenario] = id.split('\t');
    const rs = rows.filter(r => r.round === round && r.scenario === scenario), done = rs.filter(r => r.status === 'complete');
    const k = done.filter(r => r.match === 'yes').length;
    lines.push(`| ${round} | ${scenario} | ${rs[0].true_class} | ${rs[0].expected_vv.replaceAll('|', ' or ')} | ${rs.length} | ${done.length} | ${rs.length - done.length} | ${tally(done.map(r => r.vv_worst)) || '—'} | ${done.length ? `${k}/${done.length}` : '—'} | ${wilson(k, done.length)} | ${tally(done.map(r => r.vv_agent_phase).filter(Boolean)) || '—'} | ${tally(done.map(r => r.botd_result.split(' ')[0]).filter(Boolean)) || '—'} |`);
  }
  const rounds = [...new Set(rows.map(r => r.round))].join(', ');
  const md = `# Validation runs ${path.basename(dir)}\n\nGenerated ${new Date().toISOString()} from runs.csv (${rows.length} rows; rounds: ${rounds}). ` +
    'Units are runs, not pages. Match = worst class across all pages and phases is in the expected set (and the expected operator for agent scenarios). ' +
    'Wilson intervals are descriptive; repeated runs of one configuration on one machine are not independent samples of real traffic. ' +
    'Skipped and errored runs are not detection results.\n\n' + lines.join('\n') + '\n\n' + kept;
  await writeFile(file, md);
}

// ---------- main ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = {...TARGETS[opts.target]};
  let server;
  if (opts.target === 'local') {
    const {startServer} = await import(pathToFileURL(path.join(root, 'test/server.mjs')).href);
    const started = await startServer();
    server = started.server; target.origin = started.origin;
  }
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.resolve(opts.out || path.join(here, 'results', opts.target === 'demo' ? date : `${date}-${opts.target}`));
  await mkdir(dir, {recursive: true});
  const csv = path.join(dir, 'runs.csv');
  if (!existsSync(csv)) await writeFile(csv, COLUMNS.join(',') + '\n');
  else if ((await readFile(csv, 'utf8')).split('\n')[0] !== COLUMNS.join(',')) throw Error('runs.csv header mismatch');
  const scenarios = SCENARIOS.filter(s => !opts.scenarios || opts.scenarios.includes(s.id));
  try {
    for (let n = 1; n <= opts.n; n++) for (const scenario of scenarios) {
      const stamp = date.replaceAll('-', ''), nonce = randomBytes(2).toString('hex');
      const runId = scenario.runPrefix ? `${scenario.runPrefix}-${n}-${stamp}-${nonce}` : `vval-${stamp}-${scenario.id}-${n}-${nonce}`;
      const url = i => {
        const u = new URL(target.pages[i], target.origin);
        u.searchParams.set('vvp', runId);
        if (opts.debug && !scenario.fetch) u.searchParams.set('vvdebug', '1');
        return u.href;
      };
      const base = {run_id: runId, round: opts.round, scenario: scenario.id, true_class: scenario.trueClass,
        expected_vv: scenario.expected.join('|') + (scenario.expectedAgent ? '/' + scenario.expectedAgent : ''),
        tool: scenario.tool, headless: scenario.fetch ? '' : scenario.python ? 'no' : scenario.launch?.headless ? 'yes' : 'no',
        consent: scenario.fetch ? '' : opts.consent, debug: opts.debug && !scenario.fetch ? 'on' : 'off',
        started_at: new Date().toISOString(), status: 'complete', notes: ''};
      const before = await health(target);
      let result;
      try {
        result = scenario.fetch ? await fetchRun(opts, target, url)
          : scenario.python ? await pythonRun(scenario, opts, target, url)
          : await browserRun(scenario, opts, target, url);
        if (result.pages.length < opts.pages) base.status = 'incomplete';
      } catch (error) {
        base.status = error.skip ? 'skip' : 'error';
        base.notes = String(error.message || error).split('\n')[0].replace(/https?:\/\/\S+/g, '<url>').slice(0, 160);
      }
      base.ended_at = new Date().toISOString();
      await sleep(4000); // let beacons reach the collector before reading counters
      const delta = healthDelta(before, await health(target));
      const observed = result?.vanilla?.length;
      base.vanilla_server_delta = delta.text + (delta.total != null && observed != null && delta.total > observed ? ';possibly-contaminated' : '');
      const row = toRow(base, scenario, result);
      await appendFile(csv, COLUMNS.map(c => csvCell(row[c])).join(',') + '\n');
      console.log(`${row.status} ${scenario.id} #${n}: ${row.vv_pages || '-'} worst=${row.vv_worst || '-'} match=${row.match || '-'} ${row.notes}`);
      await sleep(opts.gap);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
  await writeSummary(dir);
  console.log(`Wrote ${path.relative(root, csv)} and summary.md`);
}

main().catch(error => { console.error(error.message); process.exit(2); });
