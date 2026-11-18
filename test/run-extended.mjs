import {chromium, firefox, devices} from 'playwright';
import {addExtra} from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {startServer} from './server.mjs';
import {options, sleep, botd, botdCell, flakes, cell} from './support.mjs';
const {repeat} = options();
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/traffic-class.js', import.meta.url), 'utf8');
const stealth = addExtra(chromium).use(StealthPlugin());
const quiet = ['--disable-blink-features=AutomationControlled'];
const desktop = {viewport: {width: 1440, height: 900}};
const human = {human: true, engine: stealth, launch: {headless: false, args: quiet}, context: desktop};
const specs = [
  {...human, name: '13 Keyboard-only reader', mode: 'keyboard', dwell: 12000},
  {...human, name: '14 Passive reader', mode: 'passive', dwell: 12000},
  {...human, name: '14b Passive reader without any input', mode: 'idle', dwell: 12000},
  {...human, name: '15 Rapid manual clicks then reading', mode: 'rapid'},
  {...human, name: '16 Firefox headed human', engine: firefox, launch: {headless: false}, mask: true},
  {...human, name: '17 Chromium PDF disabled, empty plugins', pdf: true},
  {...human, name: '18 Chromium WebGL disabled', launch: {headless: false, args: [...quiet, '--disable-webgl', '--disable-3d-apis']}, webgl: true},
  {...human, name: '19 Background tab 15 seconds', mode: 'background'},
  {...human, name: '20 Reload twice and back/forward', mode: 'history'},
  {...human, name: '21a Android tablet', context: {...devices['Pixel 7'], userAgent: devices['Pixel 7'].userAgent.replace(' Mobile', ''), viewport: {width: 800, height: 1280}, screen: {width: 800, height: 1280}}, touch: true,
    note: 'Android touch tablet dimensions with Pixel 7 Android UA minus Mobile token; emulated tablet, not physical hardware.'},
  {...human, name: '21b Small Android phone 360x640', context: {...devices['Pixel 7'], viewport: {width: 360, height: 640}, screen: {width: 360, height: 640}}, touch: true},
  {...human, name: '22 sessionStorage denied', storage: true},
  {name: '23 Headless normal Chrome UA, webdriver true', engine: chromium, normalUA: true, expected: 'automated'},
  {name: '24 Headless webdriver disabled, idle each page', engine: chromium, launch: {args: quiet}, dwell: 10000},
  {name: '25 Stealth fast navigation without input', engine: stealth},
  {name: '26a Claude-Agent UA', engine: chromium, context: {userAgent: 'Claude-Agent/1.0'}, expected: 'declared_agent'},
  {name: '26b Google-Agent UA', engine: chromium, context: {userAgent: 'Google-Agent'}, expected: 'declared_agent'},
  {name: '27 Chrome-Lighthouse UA', engine: chromium, context: {userAgent: 'Chrome-Lighthouse/1.0'}, expected: 'automated'},
  {...human, name: 'C1 Desktop performance (20 fresh evaluations)', mode: 'performance'},
  {...human, name: 'C2 Zero-size iframe lifecycle', mode: 'iframe'},
  {...human, name: 'C3 Double inclusion', mode: 'double'},
  {name: 'C4 Inline-blocking CSP', mode: 'csp'}
];
class Skip extends Error {}
function check(value, message) { if (!value) throw Error(message); }
async function input(page, spec, step = 0) {
  if (spec.mode === 'keyboard') {
    await page.keyboard.press(step % 2 ? 'PageUp' : 'PageDown');
  } else if (spec.touch) {
    await page.touchscreen.tap(24 + step % 3 * 4, 100);
    await page.evaluate(dy => window.scrollBy(0, dy), step % 2 ? -200 : 200);
  } else {
    await page.mouse.move(30, 90);
    await page.mouse.move(180 + step % 4 * 20, 130, {steps: 12});
    await page.mouse.wheel(0, step % 2 ? -160 : 160);
  }
}
async function stay(page, spec, ms) {
  const deadline = Date.now() + ms;
  if (!spec.human || spec.mode === 'rapid' || spec.mode === 'idle') { await sleep(ms); return; }
  if (spec.mode === 'passive') { await page.mouse.wheel(0, 220); await sleep(ms); return; }
  let step = 0;
  do { await input(page, spec, step++); await sleep(Math.min(700, Math.max(0, deadline - Date.now()))); }
  while (Date.now() < deadline);
}
async function snapshot(page) {
  return page.evaluate(() => ({
    initial: window.dataLayer?.find(e => e.traffic_phase === 'initial'),
    finals: window.dataLayer?.filter(e => e.traffic_phase === 'final') || [],
    state: window.__trafficClass,
    cursor: (() => {try {return JSON.parse(sessionStorage.getItem('tc_test_events') || '[]').length;} catch {return null;}})()
  }));
}
// Console works even with denied storage; sessionStorage is the normal unload fallback.
function collector(page) {
  const entries = [];
  page.on('console', message => {
    if (!message.text().startsWith('traffic-class-test:')) return;
    try { entries.push(JSON.parse(message.text().slice('traffic-class-test:'.length))); } catch {}
  });
  return entries;
}
async function departure(page, entries, oldPath, before, consoleCursor) {
  if (before.finals.length) { check(before.finals.length === 1, 'Duplicate final'); return before.finals[0]; }
  const deadline = Date.now() + 2500;
  do {
    const stored = before.cursor === null ? [] : await page.evaluate(cursor => {
      try {return JSON.parse(sessionStorage.getItem('tc_test_events') || '[]').slice(cursor);} catch {return [];}
    }, before.cursor).catch(() => []);
    const found = [...stored, ...entries.slice(consoleCursor)].find(e => e.path === oldPath && e.event.traffic_phase === 'final');
    if (found) return found.event;
    await sleep(25);
  } while (Date.now() < deadline);
  throw Error(`Missing final for departing document ${oldPath}`);
}
const results = [];
let server, origin, setupError;
try { ({server, origin} = await startServer()); } catch (error) { setupError = error; }
try {
  for (let iteration = 1; iteration <= repeat; iteration++) for (const spec of specs) {
    const row = {name: spec.name, iteration, expected: spec.mode === 'csp' ? 'SKIP' : spec.mode?.match(/performance|iframe|double/) ? spec.mode : spec.human ? 'human' : spec.expected || 'not human', pages: [], notes: spec.note ? [spec.note] : []};
    let browser;
    try {
      if (spec.mode === 'passive') row.notes.push('One trusted scroll then 12s idle per page; current presence-only interaction model can suppress NI after that scroll. Human required either way.');
      if (spec.mode === 'csp') throw new Skip('CSP blocking inline deliberately deferred as requested.');
      if (setupError) throw new Skip(String(setupError));
      try { browser = await spec.engine.launch({headless: true, ...spec.launch}); }
      catch (error) { throw new Skip(String(error)); }
      row.browserVersion = browser.version();
      const contextOptions = {...spec.context};
      if (spec.normalUA) {
        const probe = await browser.newPage();
        contextOptions.userAgent = (await probe.evaluate(() => navigator.userAgent)).replace('HeadlessChrome/', 'Chrome/');
        await probe.close();
      }
      const context = await browser.newContext(contextOptions);
      if (spec.mask) {
        await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', {get: () => false}));
        row.notes.push('Firefox webdriver masked, analogous to baseline WebKit human control.');
      }
      if (spec.storage) await context.addInitScript(() => Object.defineProperty(window, 'sessionStorage', {get() {throw new DOMException('Blocked for test', 'SecurityError');}}));
      const page = await context.newPage(), entries = collector(page);
      if (spec.pdf) {
        await page.addInitScript(() => {
          Object.defineProperty(Navigator.prototype, 'pdfViewerEnabled', {get: () => false});
          Object.defineProperty(Navigator.prototype, 'plugins', {get: () => []});
        });
        row.notes.push('Explicit test-only PDF/plugin overrides, registered after page creation; effective values verified before testing.');
      }

      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.goto(`${origin}/index.html`);
      if (spec.pdf) check(await page.evaluate(() => navigator.pdfViewerEnabled === false && navigator.plugins.length === 0), 'PDF/plugin fixture did not apply');
      if (spec.name.startsWith('23 ')) check(await page.evaluate(() => navigator.webdriver === true), 'Normal-UA fixture must retain webdriver=true');
      if (spec.name.startsWith('24 ')) check(await page.evaluate(() => navigator.webdriver !== true), 'AutomationControlled override did not apply');
      if (spec.storage) check(await page.evaluate(() => {try {void window.sessionStorage; return false;} catch {return true;}}), 'Storage-denied fixture did not apply');
      if (spec.mode === 'performance') {
        row.samplesMs = [];
        for (let j = 0; j < 20; j++) {
          const handle = await page.evaluateHandle(() => {
            const frame = document.createElement('iframe'); frame.src = '/blank.html'; document.body.appendChild(frame); return frame;
          });
          const frame = await handle.asElement().contentFrame();
          await frame.waitForURL(`${origin}/blank.html`);
          await frame.waitForLoadState('load');
          row.samplesMs.push(await frame.evaluate(text => {
            const start = performance.now(); (0, eval)(text); return performance.now() - start;
          }, source));
          // Finalize and discard each isolated document outside the timed region.
          await frame.evaluate(() => window.dispatchEvent(new Event('pagehide')));
          await handle.evaluate(node => node.remove()); await handle.dispose();
        }
        const sorted = [...row.samplesMs].sort((a, b) => a - b);
        row.medianMs = (sorted[9] + sorted[10]) / 2;
        row.notes.push('Timing includes fresh source evaluation and synchronous environment probes; excludes iframe setup, cleanup and BotD. Each sample has a fresh window and no detector cache.');
        row.botd = await botd(page);
        row.status = row.medianMs < 5 ? 'PASS' : 'FAIL';
      } else if (spec.mode === 'iframe') {
        const handle = await page.evaluateHandle(() => {
          const iframe = document.createElement('iframe'); iframe.width = '0'; iframe.height = '0'; iframe.src = '/page2.html'; document.body.appendChild(iframe); return iframe;
        });
        const frame = await handle.asElement().contentFrame();
        await frame.waitForURL(`${origin}/page2.html`); await frame.waitForLoadState('load');
        await sleep(10000);
        const state = await snapshot(frame);
        check(state.initial && state.finals.length === 1, 'Iframe must emit both phases exactly once');
        row.pages.push({initial: state.initial, final: state.finals[0]});
        check(!state.initial.traffic_signals.includes('G0') && !state.finals[0].traffic_signals.includes('G0'), 'Iframe G0 false positive');
        row.botd = await botd(frame);
        await handle.evaluate(node => node.remove()); await handle.dispose();
        row.status = 'PASS';
      } else {
        if (spec.mode === 'double') {
          await page.addScriptTag({url: `${origin}/src/traffic-class.js`});
          await stay(page, spec, 10000);
          const state = await snapshot(page);
          const counts = await page.evaluate(() => ({initial: dataLayer.filter(e => e.traffic_phase === 'initial').length, final: dataLayer.filter(e => e.traffic_phase === 'final').length}));
          check(counts.initial === 1 && counts.final === 1, `Duplicate load emitted ${JSON.stringify(counts)}`);
          row.pages.push({initial: state.initial, final: state.finals[0]});
        } else {
          const steps = spec.mode === 'history' ? ['reload', 'reload', '/page2.html', 'back', 'forward', '/page3.html', null] : ['/page2.html', '/page3.html', null];
          const navigationStart = Date.now();
          for (let j = 0; j < steps.length; j++) {
            await page.bringToFront();
            if (spec.mode === 'background' && j === 0) {
              const other = await context.newPage(); await other.goto(`${origin}/blank.html`); await other.bringToFront();
              try { await page.waitForFunction(() => document.visibilityState === 'hidden', null, {polling: 100, timeout: 2000}); }
              catch { await other.close(); throw new Skip('Environment does not expose a hidden background tab.'); }
              await sleep(15000);
              const hidden = await snapshot(page);
              check(hidden.state.phase === 'initial', 'Hidden wall time incorrectly finalized detector');
              check(!hidden.state.signals.includes('NI'), 'Hidden wall time incorrectly added NI');
              await page.bringToFront(); await input(page, spec); await other.close();
              row.notes.push('Verified hidden for 15s, still initial before returning.');
            }
            const last = steps[j] === null;
            if (last && spec.mode === 'rapid') {
              row.navigationMs = Date.now() - navigationStart;
              if (row.navigationMs > 3500) throw new Skip(`Rapid fixture took ${row.navigationMs}ms; 3-page/~3s condition not exercised`);
              row.notes.push(`Three-page mouse navigation took ${row.navigationMs}ms.`);
            }
            let dwell = spec.dwell || (last ? 10000 : 2800);
            if (spec.mode === 'rapid') dwell = last ? 12000 : 0;
            if (spec.mode === 'history') dwell = last ? 10000 : j < 3 ? 0 : 2500;
            if (!spec.human && !spec.dwell) dwell = last ? 10000 : 0;
            await stay(page, spec, dwell);
            const before = await snapshot(page), oldPath = new URL(page.url()).pathname;
            check(before.initial, 'Missing synchronous initial classification');
            if (last) {
              check(before.finals.length === 1, `Expected one final, got ${before.finals.length}`);
              row.pages.push({path: oldPath, initial: before.initial, final: before.finals[0]});
              break;
            }
            const consoleCursor = entries.length;
            if (steps[j] === 'reload') await page.reload();
            else if (steps[j] === 'back') await page.goBack();
            else if (steps[j] === 'forward') await page.goForward();
            else if (spec.mode === 'keyboard') {
              await page.locator(`a[href="${steps[j]}"]`).focus(); await page.keyboard.press('Enter');
              await page.waitForURL(`${origin}${steps[j]}`);
            } else if (spec.human) await page.locator(`a[href="${steps[j]}"]`).click();
            else { await page.evaluate(path => { location.href = path; }, steps[j]); await page.waitForURL(`${origin}${steps[j]}`); }
            await page.waitForLoadState('load');
            row.pages.push({path: oldPath, initial: before.initial, final: await departure(page, entries, oldPath, before, consoleCursor)});
          }
        }
        row.botd = await botd(page);
        if (spec.mode === 'double') row.status = 'PASS';
        else row.status = row.pages.every(p => spec.human ? p.initial.traffic_class === 'human' && p.final.traffic_class === 'human' : spec.expected ? p.final.traffic_class === spec.expected : true) && (spec.human || spec.expected || row.pages.at(-1).final.traffic_class !== 'human') ? 'PASS' : 'FAIL';
        if (spec.mode === 'idle') check(row.pages.every(p => p.final.traffic_signals.includes('NI')), 'Zero-input reader did not exercise NI');
        if (spec.mode === 'history') check(!row.pages.some(p => p.final.traffic_signals.includes('FN')), 'Reload/history inflated FN');
        if (spec.mode === 'background') check(!row.pages.some(p => p.final.traffic_signals.includes('NI')), 'NI despite hidden time excluded and trusted input');
        if (spec.pdf) check(!row.pages.some(p => p.initial.traffic_signals.includes('PL')), 'PDF-disabled control fired PL');
        if (spec.webgl) check(row.pages.every(p => p.initial.traffic_signals.includes('WG')), 'WebGL-disable fixture did not disable WebGL');
      }
      check(!pageErrors.length, `Page crashed/errored: ${pageErrors.join('; ')}`);
      if (row.status === 'FAIL') row.notes.push('Honest mismatch; detector weights were not changed. Stealth/normal-browser misses are expected known limits.');
    } catch (error) {
      row.status = error instanceof Skip ? 'SKIP' : 'ERROR'; row.notes.push(String(error.stack || error));
    } finally {
      row.initial = row.pages.at(-1)?.initial?.traffic_class;
      row.final = row.pages.at(-1)?.final?.traffic_class;
      row.signals = [...new Set(row.pages.flatMap(p => [...(p.initial?.traffic_signals || []), ...(p.final?.traffic_signals || [])]))].sort();
      if (browser) await browser.close().catch(() => {});
    }
    results.push(row);
    console.log(`${row.status}: ${row.name} [${iteration}/${repeat}] ${row.final || ''} ${row.medianMs === undefined ? '' : row.medianMs + ' ms'}`);
  }
  const flakiness = flakes(results);
  const report = {generatedAt: new Date().toISOString(), playwright: require('playwright/package.json').version,
    botdVersion: require('@fingerprintjs/botd/package.json').version, repeat, results, flakiness};
  await writeFile(new URL('results/report-extended.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  const md = `# Extended traffic-class tests\n\nGenerated ${report.generatedAt}; Playwright ${report.playwright}; BotD ${report.botdVersion}; repeat ${repeat}.\n\n` +
    '| Scenario | Run | Expected | Initial | Final | Signals | BotD bot / kind | Median ms | Status |\n|---|---|---|---|---|---|---|---|---|\n' +
    results.map(r => '| ' + [r.name, r.iteration, r.expected, r.initial, r.final, r.signals.join(', '), botdCell(r.botd), r.medianMs?.toFixed(3), r.status].map(cell).join(' | ') + ' |').join('\n') +
    '\n\n## Flakiness\n\n' + flakiness.map(f => `- ${f.name}: ${f.flaky ? '**FLAKY**' : repeat < 2 ? 'single run; not assessed' : 'stable'} (${f.runs} runs)`).join('\n') +
    '\n\n## Evidence and limitations\n\n' + results.filter(r => r.notes.length).map(r => `- ${r.name}, run ${r.iteration}: ${r.notes.map(cell).join(' ')}`).join('\n') +
    '\n\nEvery human page must be initial/final human. BotD runs once per scenario, after our last result, with monitoring off, and only bot/botKind is retained. Benchmark errors are separate from classifier verdicts. Mobile/tablet inputs are emulated. Background requires confirmed hidden visibility; otherwise SKIP. Performance uses 20 fresh iframe windows on a desktop engine; median must be strictly <5ms (includes parse/eval and synchronous probes, excludes setup/cleanup). Timing variability does not alone imply classification flakiness. CSP is deliberately skipped. Reload/back-forward checks forbid FN. BFCache can restore an already-final document; no second final is required. Storage-denied scenarios use console fallback. Rapid and stealth bots may remain human; no weights are tuned for these fixtures.\n';
  await writeFile(new URL('results/report-extended.md', import.meta.url), md);
  if (results.some(r => r.status !== 'PASS' && r.name !== 'C4 Inline-blocking CSP' || r.botd?.status === 'ERROR') || flakiness.some(f => f.flaky)) process.exitCode = 1;
} finally { if (server) await new Promise(resolve => server.close(resolve)); }
