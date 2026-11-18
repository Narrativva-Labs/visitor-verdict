import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {startServer} from './server.mjs';
import {runContracts} from './contracts.mjs';
const require = createRequire(import.meta.url);
let chromium, firefox, webkit, devices = {}, stealth, dependencyError, stealthError;
try { ({chromium, firefox, webkit, devices} = await import('playwright')); }
catch (error) { dependencyError = error; }
try {
  const {addExtra} = await import('playwright-extra');
  const {default: StealthPlugin} = await import('puppeteer-extra-plugin-stealth');
  stealth = addExtra(chromium).use(StealthPlugin());
} catch (error) { stealthError = error; }
const quiet = ['--disable-blink-features=AutomationControlled'];
const scenarios = [
  {name: '1 Chromium headless shell', engine: chromium},
  {name: '2 Chromium new headless', engine: chromium, launch: {channel: 'chromium'}},
  {name: '3 Chromium headed', engine: chromium, launch: {headless: false}},
  {name: '4 Firefox headless', engine: firefox},
  {name: '5 WebKit headless', engine: webkit},
  {name: '6 Chromium stealth headless', engine: stealth},
  {name: '7 Chromium automation flag disabled, fast navigation', engine: chromium,
    launch: {headless: false, args: quiet}, noInteraction: true},
  {name: '8 Fetch without JavaScript', fetch: true},
  {name: '9 ChatGPT-User', engine: chromium, context: {userAgent: 'ChatGPT-User'}, declared: true},
  {name: '10 Human desktop Chrome', engine: stealth, human: true,
    launch: {channel: 'chrome', headless: false, args: quiet}, context: {viewport: {width: 1440, height: 900}}},
  {name: '11 Human Pixel 7', engine: stealth, human: true, touch: true,
    launch: {args: quiet}, context: devices['Pixel 7']},
  {name: '12 Human iPhone 15 WebKit', engine: webkit, human: true, touch: true,
    context: devices['iPhone 15'], webkitControl: true}
];
const catalog = {
  AG: 'Boundary-matched declared UA (100, declared)', WD: 'Strict webdriver true (100, hard)',
  HL: 'HeadlessChrome UA/brands (100, hard)', AU: 'Bounded known automation/audit UA (100, hard)',
  GL: 'Shape-checked legacy/Selenium/ChromeDriver globals (100, hard)',
  PW: 'Three exact shape-checked Playwright names, initial and final (100, hard; feature-dependent, natural coverage unverified)',
  CA: 'Previous final automated class (100, inherited)',
  G0: 'Both dimensions zero, visible focused top-level only; rechecked final (1, geometry)',
  GS: '800×600 screen or matching 1280×720 screen/viewport (1, geometry)',
  LA: 'Empty languages and all language fallbacks absent (1, language)',
  PL: 'Desktop Chromium empty plugins; excludes mobile/WebView/PDF disabled (1, plugins)',
  WG: 'Unavailable WebGL or exact software-renderer family; missing debug extension alone ignored (1, graphics)',
  CH: 'Desktop Chromium corroborated by brands, missing chrome (1, chrome)',
  NP: 'Secure top-level Chromium denied/prompt notification mismatch (1, permissions; final only)',
  HC: 'Missing/zero cores (0, debug only)', NI: 'No trusted activity after at least 8000 visible ms (2, interaction)',
  FN: 'Consecutive positive rapid intervals; timestamp dedupe, reload/back-forward excluded (3, navigation)',
  SY: 'Synthetic pointer input without any trusted input modality (2, interaction)'
};
const results = [];
let server, origin, serverError;
try { ({server, origin} = await startServer()); }
catch (error) { serverError = error; }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function interaction(page, touch, step) {
  if (touch) {
    // Stay in the left margin so repeated taps never activate navigation links.
    await page.touchscreen.tap(24 + (step % 3) * 4, 100 + (step % 4) * 8);
    await page.evaluate(() => window.scrollBy(0, 240));
  } else {
    await page.mouse.move(20, 30);
    await page.mouse.move(350, 220, {steps: 24});
    await page.mouse.wheel(0, 280);
    await page.mouse.move(180, 120, {steps: 16});
  }
  await sleep(180);
  if (touch) await page.evaluate(() => window.scrollBy(0, -1000));
  else await page.mouse.wheel(0, -1000);
}
async function humanStay(page, touch, duration) {
  const deadline = Date.now() + duration;
  let step = 0;
  do {
    await interaction(page, touch, step++);
    await sleep(Math.min(650, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
}
try {
  for (const scenario of scenarios) {
    const row = {name: scenario.name, expected: scenario.fetch ? 'no event' : scenario.human ? 'human' : scenario.declared ? 'declared_agent' : 'not human', pages: [], notes: []};
    let browser;
    try {
      if (dependencyError) throw dependencyError;
      if (!scenario.fetch && !scenario.engine) throw stealthError || new Error('Browser engine unavailable');
      if (serverError) throw serverError;
      if (scenario.fetch) {
        row.initial = row.final = 'no event';
        for (const file of ['index.html', 'page2.html', 'page3.html']) {
          const response = await fetch(`${origin}/${file}`);
          if (!response.ok || !(await response.text()).includes('/src/traffic-class.js')) throw new Error('Fetch failed');
        }
        row.status = 'PASS'; row.notes.push('HTML downloaded; JavaScript never executes, so no classification or GA4 event.');
      } else {
        browser = await scenario.engine.launch({headless: true, ...scenario.launch});
        row.browserVersion = browser.version();
        const context = await browser.newContext({...scenario.context});
        if (scenario.webkitControl) {
          // Chromium flags and the Chromium-only stealth package do not work on WebKit.
          // Emulate a non-WebDriver WebKit for the human control, explicitly and narrowly.
          await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', {get: () => false}));
          row.notes.push('WebKit control: only webdriver masked; Chromium stealth/flags unsupported. Other environment signals remain real.');
        }
        const page = await context.newPage();
        // Keep events in Node memory across document destruction. Console text is
        // serialized by the test site before its POST and survives cancelled logs.
        const collected = new Map();
        function collect(path, event) {
          if (event?.event !== 'traffic_class') return;
          if (!collected.has(path)) collected.set(path, new Map());
          collected.get(path).set(event.traffic_phase, event);
        }
        page.on('console', message => {
          const text = message.text(), prefix = 'traffic-class-test:';
          if (!text.startsWith(prefix)) return;
          try { const {path, event} = JSON.parse(text.slice(prefix.length)); collect(path, event); }
          catch { /* Ignore unrelated/malformed console messages. */ }
        });
        // Secondary channel: collect logs as they occur, without waiting for a
        // particular navigation's keepalive request to be delivered.
        page.on('request', request => {
          if (request.url() !== `${origin}/log` || request.method() !== 'POST') return;
          try { collect(new URL(request.headers().referer).pathname, request.postDataJSON()); }
          catch { /* Missing referrer/body: console and page snapshots still work. */ }
        });
        async function navigationFinal(path) {
          const deadline = Date.now() + 2000;
          while (!collected.get(path)?.has('final') && Date.now() < deadline) {
            const stored = await page.evaluate(() => {
              try { return JSON.parse(sessionStorage.getItem('tc_test_events') || '[]'); } catch { return []; }
            }).catch(() => []);
            for (const entry of stored) collect(entry.path, entry.event);
            if (!collected.get(path)?.has('final')) await sleep(25);
          }
          const event = collected.get(path)?.get('final');
          if (!event) throw new Error(`No final classification collected for ${path} through console or /log`);
          return event;
        }
        page.on('pageerror', error => row.notes.push(`Page error: ${error.message}`));
        await page.goto(`${origin}/index.html`);
        for (let i = 0; i < 3; i++) {
          await page.bringToFront();
          const initial = await page.evaluate(() => window.dataLayer.find(e => e.traffic_phase === 'initial'));
          if (scenario.human) {
            // Input continues through the entire observation, including final.
            await humanStay(page, scenario.touch, i === 2 ? 10000 : i === 0 ? 2400 : 3600);
          } else if (i === 2) await sleep(10000);
          if (i < 2) {
            const previousPath = new URL(page.url()).pathname;
            if (scenario.noInteraction) {
              // Programmatic DOM click creates no pointer/mouse signals.
              await page.evaluate(url => { document.querySelector(`a[href="${url}"]`).click(); }, `/page${i + 2}.html`);
              await page.waitForURL(`${origin}/page${i + 2}.html`);
            } else {
              await page.locator(`a[href="/page${i + 2}.html"]`).click();
            }
            await page.waitForLoadState('load');
            row.pages.push({page: i + 1, initial, final: await navigationFinal(previousPath)});
          } else {
            const events = await page.evaluate(() => window.dataLayer.filter(e => e.traffic_phase === 'final'));
            if (events.length !== 1) throw new Error(`Expected one final event, got ${events.length}`);
            row.pages.push({page: 3, initial, final: events[0]});
          }
        }
        row.initial = row.pages[2].initial.traffic_class;
        row.final = row.pages[2].final.traffic_class;
        row.signals = [...new Set(row.pages.flatMap(p => [...p.initial.traffic_signals, ...p.final.traffic_signals]))];
        row.status = (scenario.human ? row.pages.every(p => p.initial.traffic_class === 'human' && p.final.traffic_class === 'human') : scenario.declared ? row.final === 'declared_agent' : row.final !== 'human') ? 'PASS' : 'FAIL';
        if (row.status === 'FAIL') row.notes.push('Observed result differs from expectation; see signals and page evidence.');
      }
    } catch (error) {
      row.status = browser ? 'ERROR' : 'SKIP';
      if (scenario.fetch) { row.initial = row.final = 'no event'; row.notes.push('Fetch transport unavailable; no-event describes a non-JS client, not a successful transport check.'); }
      row.notes.push(String(error.stack || error));
    } finally { if (browser) await browser.close().catch(() => {}); }
    results.push(row);
    console.log(`${row.status}: ${row.name} — ${row.initial || '—'} → ${row.final || '—'} [${row.signals || ''}]`);
  }
  const contracts = await runContracts();
  const fired = new Set(results.flatMap(r => r.signals || []));
  const never = Object.keys(catalog).filter(code => !fired.has(code));
  const html = await readFile(new URL('../gtm/custom-html.html', import.meta.url), 'utf8');
  const detectorBytes = Buffer.byteLength(html.trim().split('\n').at(-2));
  const report = {detectorBytes, sizeTargetBytes: 5000, sizeTargetMet: detectorBytes < 5000, generatedAt: new Date().toISOString(), platform: process.platform, playwright: dependencyError ? 'unavailable' : require('playwright/package.json').version,
    setupErrors: [dependencyError, stealthError, serverError].filter(Boolean).map(String),
    results, contracts, completedScenarios: results.filter(r => !['ERROR', 'SKIP'].includes(r.status)).length, neverFired: never, catalog};
  await mkdir(new URL('results/', import.meta.url), {recursive: true});
  await writeFile(new URL('results/report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  const cell = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const md = `# Traffic class scenario report\n\nGenerated ${report.generatedAt}; ${report.platform}; Playwright ${report.playwright}.\n\n` +
    `Detector ${report.detectorBytes} bytes minified; <5000-byte target ${report.sizeTargetMet ? 'met' : '**missed (open issue)**'}.\n\n${report.completedScenarios}/12 scenarios completed. ${contracts.filter(c => c.status === 'PASS').length}/${contracts.length} deterministic contract checks passed. ${report.completedScenarios === 0 ? '**Browser evidence unavailable; human controls have not been validated. All signals are unobserved, not proven absent.**' : ''}\n\n` +
    '| Scenario | Fired signals (all pages) | Initial (page 3) | Final (page 3) | Expected | Result |\n|---|---|---|---|---|---|\n' +
    results.map(r => `| ${[r.name, (r.signals || []).join(', '), r.initial, r.final, r.expected, r.status].map(cell).join(' | ')} |`).join('\n') +
    '\n\nHuman controls require initial and final human on **every** page. JSON contains all page events. Each last page stays 10 seconds.\n\n' +
    results.filter(r => r.notes.length).map(r => `- **${r.name}:** ${r.notes.map(cell).join(' ')}`).join('\n') +
    '\n\nPolicy: threshold 6 AND at least 3 distinct positive-weight families. Geometry capped at 1, graphics at 1, NI/SY at 2. Hard/declared/inherited score is sentinel 100. Fast navigation plus inactivity alone scores 5 and remains human; scenario 7 is allowed to slip through.\n\n## What each signal catches\n\n' + Object.entries(catalog).map(([code, text]) => `- \`${code}\`: ${text}. Observed: ${fired.has(code) ? 'yes' : 'no'}.`).join('\n') +
    '\n\nOnly completed scenarios contribute observations; SKIP means unavailable setup/launch, never a detection PASS. ERROR means execution did not complete.\n\nNever fired in natural scenarios (injected contract checks excluded): ' + never.map(s => '`' + s + '`').join(', ') + '.\n\n' +
    '## Contract checks\n\n' + contracts.map(c => `- ${c.status}: ${c.name}${c.error ? ' — ' + c.error : ''}`).join('\n') +
    '\n\n## Known limits\n\n- Real logged-in browsers operated by agents can look human. No identity, fingerprint, or certainty about humanity is inferred.\n- Fetch/curl and crawlers that do not execute JavaScript are invisible to this detector and client GA4.\n- Mobile controls are device emulation, not physical devices. WebKit uses an explicitly documented webdriver override because Chromium stealth/flags are unsupported there.\n- Default dimensions, software WebGL, missing APIs and inactivity are weak evidence. Full 8 seconds visible are required for NI; early pagehide never manufactures inactivity. Reload/back-forward navigation does not inflate timestamps; BFCache retains one final per document.\n- Pagehide final events may not reach GA4 before unload; blocked storage removes navigation/carry signals.\n- Exact Playwright markers are feature-dependent; natural runtime coverage remains unverified when scenarios are skipped. The Puppeteer sourceURL label is not probed as a global. Current default runtimes may expose none.\n- Test site alone posts debug events to the loopback /log sink; production detector makes no requests.\n';
  await writeFile(new URL('results/report.md', import.meta.url), md);
  console.log(`Report written. Never fired: ${never.join(', ')}`);
  if (results.some(r => r.status !== 'PASS') || contracts.some(c => c.status !== 'PASS')) process.exitCode = 1;
} finally { if (server) await new Promise(resolve => server.close(resolve)); }
