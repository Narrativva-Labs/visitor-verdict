import {chromium, firefox, devices} from 'playwright';
import {addExtra} from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import {readFile, writeFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {connectRealChrome} from './cdp-chrome.mjs';
import {startServer} from './server.mjs';
import {options, sleep, botd, botdCell, flakes, cell, humanClick, cleanPreflight, navigateAndWait, observationDwell, performanceSummary} from './support.mjs';
const {repeat} = options();
const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/visitor-verdict.js', import.meta.url), 'utf8');
const stealth = addExtra(chromium).use(StealthPlugin());
const quiet = ['--disable-blink-features=AutomationControlled'];
const desktop = {viewport: {width: 1440, height: 900}};
const human = {human: true, category: 'clean-human', engine: chromium, launch: {headless: false, args: quiet}, context: desktop};
const specs = [
  {...human, name: '13 Keyboard-only reader', mode: 'keyboard', dwell: 12000},
  {...human, name: '14 Passive reader', mode: 'passive', dwell: 12000},
  {...human, name: '14b Passive reader without any input', mode: 'idle', dwell: 12000},
  {...human, name: '15 Rapid manual clicks then reading', mode: 'rapid'},
  {name: '16 Firefox clean-control limitation', category: 'limitation', mode: 'note', noteOnly: true, note: 'No unpatched non-WebDriver Firefox control available through this launcher; not counted as a clean human.'},
  {...human, name: '17 Chromium PDF disabled, empty plugins', pdf: true},
  {...human, name: '18 Chromium WebGL disabled', launch: {headless: false, args: [...quiet, '--disable-webgl', '--disable-3d-apis']}, webgl: true},
  {...human, name: '19 Background tab 15 seconds', mode: 'background'},
  {...human, name: '20 Reload twice and back/forward', mode: 'history'},
  {...human, name: '21a Android tablet', context: {...devices['Pixel 7'], userAgent: devices['Pixel 7'].userAgent.replace(' Mobile', ''), viewport: {width: 800, height: 1280}, screen: {width: 800, height: 1280}}, touch: true,
    note: 'Android touch tablet dimensions with Pixel 7 Android UA minus Mobile token; emulated tablet, not physical hardware.'},
  {...human, name: '21b Small Android phone 360x640', context: {...devices['Pixel 7'], viewport: {width: 360, height: 640}, screen: {width: 360, height: 640}}, touch: true},
  {...human, name: '22 sessionStorage denied', storage: true, dwell: 10000},
  {name: '23 Headless normal Chrome UA, webdriver true', engine: chromium, normalUA: true, expected: 'automated'},
  {name: '24 Headless webdriver disabled, idle each page', engine: chromium, launch: {args: quiet}, dwell: 10000},
  {name: '25 Stealth fast navigation without input', engine: stealth},
  {name: '25b FN+NI+WG benign combination', category: 'regression', engine: chromium, mode: 'benign', environment: 'WG', expected: 'human',
    launch: {headless: false, args: [...quiet, '--disable-webgl', '--disable-3d-apis']}, context: {...desktop, screen: {width: 1440, height: 900}}},
  {name: '25c FN+NI+GS benign combination', category: 'regression', engine: chromium, mode: 'benign', environment: 'GS', expected: 'human',
    launch: {headless: false, args: quiet}, context: {viewport: {width: 800, height: 600}, screen: {width: 800, height: 600}}},
  {name: '25d GS+NI+FN+WK corroborated combination', category: 'regression', engine: chromium, mode: 'benign', environment: 'GS', uaSwitcher: true,
    expectedFinal: 'suspicious', expectedDescription: 'last final suspicious', launch: {headless: false, args: quiet},
    context: {viewport: {width: 800, height: 600}, screen: {width: 800, height: 600}}},
  {name: '26a Claude-Agent UA', engine: chromium, context: {userAgent: 'Claude-Agent/1.0'}, expected: 'declared_agent'},
  {name: '26b Google-Agent UA', engine: chromium, context: {userAgent: 'Google-Agent'}, expected: 'declared_agent'},
  {name: '27 Chrome-Lighthouse UA', engine: chromium, context: {userAgent: 'Chrome-Lighthouse/1.0'}, expected: 'automated'},
  {...human, name: '28 Human cursor rested before navigation', mode: 'rest'},
  {...human, name: '29 Human repeated clicks at same spot', mode: 'repeat-click'},
  {...human, name: '30 Human Enter navigation', mode: 'keyboard'},
  {...human, name: '30b Cursor remains on Next across navigation, no movement', mode: 'stationary'},
  {...human, name: '30c Voice-control-like click without movement', mode: 'voice'},
  {...human, name: '30d Fast human flick with many events', mode: 'flick'},
  {...human, name: '30e TP history decays after natural movement', category: 'regression', mode: 'decay',
    expectedDescription: 'all phases human; tpPages 1 then 0'},
  {...human, name: '30f Assistive warp clicks, slow navigation and keyboard', mode: 'assistive-warp'},
  {...human, name: '31 Human main-only UA switcher', uaSwitcher: true},
  {name: '32 Stealth headless locator navigation', engine: stealth, mode: 'locator'},
  {name: '33 Headed webdriver-disabled locator navigation', engine: chromium, launch: {headless: false, args: quiet}, mode: 'locator'},
  {...human, name: '34 Worker blocked by CSP', cspWorker: true},
  {name: '35 Real Chrome over CDP agent', cdp: true, category: 'CDP agent', mode: 'cdp-agent',
    expectedDescription: 'all initials human; page 3 final suspicious via TR+FN+NI'},
  {name: '35b Real Chrome over CDP with natural approach', cdp: true, human: true, informational: true,
    category: 'CDP agent with human-like movement', mode: 'cdp-human', expectedDescription: 'human (informational)'},
  {...human, name: 'S28 Stealth bot behaving humanly, rested clicks', engine: stealth, informational: true, category: 'stealth bot behaving humanly', mode: 'rest'},
  {...human, name: 'S15 Stealth bot behaving humanly, rapid navigation', engine: stealth, informational: true, category: 'stealth bot behaving humanly', mode: 'rapid'},
  {...human, name: 'C1 Default-config performance (20 fresh evaluations)', mode: 'performance', budgetMs: 5},
  {...human, name: 'C1b Probes-on performance (20 fresh evaluations)', mode: 'performance', probes: true, informational: true,
    category: 'performance observation', expectedDescription: 'informational median, webgl+worker enabled'},
  {...human, name: 'C2 Zero-size iframe lifecycle', mode: 'iframe'},
  {...human, name: 'C3 Double inclusion', mode: 'double'},
  {...human, name: 'C4a HTML named properties are not automation', mode: 'named'},
  {...human, name: 'C4b Heavy probes default off', mode: 'probe-defaults'},
  {...human, name: 'C4c Throwing dataLayer push still finalizes', mode: 'publication'},
  {...human, name: 'C4d Prerender defers until activation (property fixture)', mode: 'prerender'},
  {...human, name: 'C4e Direct hard carry expires on second clean page', category: 'regression', mode: 'carry',
    expectedDescription: 'automated, automated via CA, then human'},
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
  if (!spec.human || ['rapid', 'idle', 'stationary', 'voice', 'flick', 'assistive-warp'].includes(spec.mode)) { await sleep(ms); return; }
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
    activity: {...window.__tcTestActivity?.observed},
    navigationGapsMs: (() => {try {
      const times = JSON.parse(sessionStorage.getItem('traffic_class') || '{}').timestamps || [];
      return times.slice(1).map((time, index) => time - times[index]);
    } catch {return [];}})(),
    tpPages: (() => {try {return JSON.parse(sessionStorage.getItem('traffic_class') || '{}').tpPages || 0;} catch {return null;}})(),
    cursor: (() => {try {return JSON.parse(sessionStorage.getItem('tc_test_events') || '[]').length;} catch {return null;}})()
  }));
}
// Console works even with denied storage; sessionStorage is the normal unload fallback.
async function collector(page) {
  const entries = [];
  page.on('console', message => {
    if (!message.text().startsWith('visitor-verdict-test:')) return;
    try { entries.push(JSON.parse(message.text().slice('visitor-verdict-test:'.length))); } catch {}
  });
  // Observe requests before forwarding them; unload may cancel delivery to /log.
  // This requires no storage or exposed binding and retains only test events.
  await page.route('**/log', async route => {
    try {
      const request = route.request(), event = request.postDataJSON();
      const referrer = request.headers().referer;
      const path = referrer ? new URL(referrer).pathname : entries.pendingPath;
      if (path && event?.event === 'traffic_class') entries.push({path, event});
    } catch {}
    await route.continue().catch(() => {});
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
    const row = {name: spec.name, iteration, category: spec.category || 'bot', informational: !!spec.informational, noteOnly: !!spec.noteOnly, expected: spec.expectedDescription || (spec.noteOnly ? 'limitation' : spec.informational ? 'not-human-or-human (informational)' : spec.mode === 'csp' ? 'SKIP' : spec.mode?.match(/performance|iframe|double/) ? spec.mode : spec.human ? 'human' : spec.expected || 'not human'), pages: [], notes: spec.note ? [spec.note] : []};
    let browser, context, profileDir, cdp;
    try {
      if (spec.noteOnly) throw new Skip(spec.note);
      if (spec.mode === 'passive') row.notes.push('One trusted scroll then 12s idle per page; current presence-only interaction model can suppress NI after that scroll. Human required either way.');
      if (spec.mode === 'csp') throw new Skip('CSP blocking inline deliberately deferred as requested.');
      if (setupError) throw new Skip(String(setupError));
      try {
        if (spec.cdp) {
          cdp = await connectRealChrome(chromium);
          ({browser, context} = cdp);
          row.notes.push('Spawned separate headed Google Chrome with temporary profile and a nonzero remote-debugging port; no Playwright launch flags, stealth or init-script navigator patches.');
        } else if (spec.pdf) {
          // Use Chrome's native PDF preference, not a navigator init-script patch.
          profileDir = await mkdtemp(join(tmpdir(), 'visitor-verdict-pdf-'));
          await mkdir(join(profileDir, 'Default'));
          await writeFile(join(profileDir, 'Default', 'Preferences'), JSON.stringify({plugins: {always_open_pdf_externally: true}}));
          context = await spec.engine.launchPersistentContext(profileDir, {headless: true, ...spec.launch, ...spec.context});
          browser = context.browser();
        } else browser = await spec.engine.launch({headless: true, ...spec.launch});
      } catch (error) { throw new Skip(String(error)); }
      row.browserVersion = browser.version();
      const contextOptions = {...spec.context};
      if (spec.normalUA) {
        const probe = await browser.newPage();
        contextOptions.userAgent = (await probe.evaluate(() => navigator.userAgent)).replace('HeadlessChrome/', 'Chrome/');
        await probe.close();
      }
      context = context || await browser.newContext(contextOptions);
      if (spec.storage) await context.addInitScript(() => Object.defineProperty(window, 'sessionStorage', {get() {throw new DOMException('Blocked for test', 'SecurityError');}}));
      const page = await context.newPage(), entries = await collector(page);
      if (spec.category === 'clean-human' || spec.cdp) {
        await page.goto(`${origin}/blank.html`);
        row.preflight = await cleanPreflight(page);
        check(row.preflight.mainWebdriverFalse && row.preflight.status === 'OK' && row.preflight.workerWebdriverNotTrue,
          'Clean native webdriver preflight failed: ' + JSON.stringify(row.preflight));
      }
      await page.addInitScript(() => {
        const evidence = window.__tcTestActivity = {lastInputAt: performance.now(), observed: {}};
        for (const type of 'mousemove pointermove pointerdown pointerup pointercancel touchstart touchmove touchend touchcancel scroll keydown keyup wheel click focusin'.split(' ')) {
          window.addEventListener(type, event => {
            if (event.isTrusted === false || document.visibilityState === 'hidden') return;
            evidence.lastInputAt = performance.now();
            if (window.__trafficClass?.phase === 'initial' && type !== 'pointercancel') {
              evidence.observed[type] = Math.min(255, (evidence.observed[type] || 0) + 1);
            }
          }, {capture: true, passive: true});
        }
      });
      // Only these controlled regression fixtures postpone the last document's
      // detector. Native navigation input must settle before a no-input window.
      // The detector still receives every input that occurs while it is running.
      if (['benign', 'cdp-agent'].includes(spec.mode)) {
        await context.route('**/page3.html', async route => {
          const response = await route.fetch(), html = await response.text();
          const detectorTag = '<script src="/src/visitor-verdict.js"></script>';
          check(html.includes(detectorTag), 'Deferred fixture detector tag missing');
          await route.fulfill({response, body: html.replace(detectorTag, '')});
        });
        row.notes.push('Controlled last-page observation: park cursor outside the viewport, wait for 250ms input quiescence, then load the detector. No running-detector input is filtered or ignored.');
      }
      if (spec.cspWorker) await context.route('**/*.html*', async route => {
        const response = await route.fetch();
        await route.fulfill({response, headers: {...response.headers(), 'content-security-policy': "worker-src 'none'"}});
      });

      if (spec.uaSwitcher) await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'userAgent', {get: () => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 UA-Switcher'});
      });
      if (['probe-defaults', 'publication', 'prerender'].includes(spec.mode)) await page.addInitScript(mode => {
        window.tcTestConfig = {debug: true};
        if (mode === 'publication') {
          window.tcTestConfig.dataLayerName = 'throwingLayer';
          window.throwingLayer = {length: 0, push() {throw Error('Consumer failed');}};
        }
        if (mode === 'prerender') Object.defineProperty(document, 'prerendering', {value: true, configurable: true});
        if (mode === 'probe-defaults') {
          window.__tcProbeCounts = {canvas: 0, worker: 0};
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            if (/webgl/.test(type)) window.__tcProbeCounts.canvas++;
            return getContext.call(this, type, ...args);
          };
          window.Worker = new Proxy(window.Worker, {construct(target, args) {
            window.__tcProbeCounts.worker++; return Reflect.construct(target, args);
          }});
        }
      }, spec.mode);
      if (spec.mode === 'carry') await page.addInitScript(() => {
        if (location.pathname === '/index.html') Object.defineProperty(navigator, 'webdriver', {value: true});
      });
      if (spec.mode === 'benign') await page.addInitScript(({graphics, worker}) => {
        window.tcTestConfig = {debug: true, webgl: graphics, worker};
      }, {graphics: spec.environment === 'WG', worker: !!spec.uaSwitcher});
      if (spec.mode === 'decay') await page.addInitScript(() => {
        if (location.pathname === '/index.html') sessionStorage.setItem('traffic_class', JSON.stringify({tpPages: 2}));
      });
      if (spec.mode === 'named') await context.route('**/*.html', async route => {
        const response = await route.fetch();
        const html = (await response.text()).replace('<body>', `<body>
          <div id="__trafficClass"></div><form name="callPhantom"></form>
          <div id="__playwright__binding__"></div><form name="__pwInitScripts"></form><form name="__pwInitScripts"></form>
          <iframe name="__playwright__binding__controller__" hidden></iframe>`);
        await route.fulfill({response, body: html});
      });
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.goto(`${origin}/index.html${spec.cspWorker ? '?worker=none' : ''}`);
      if (spec.pdf) {
        if (!await page.evaluate(() => navigator.pdfViewerEnabled === false && navigator.plugins.length === 0)) throw new Skip('Native PDF preference not supported by this installed browser; no navigator overrides used.');
        row.notes.push('Native plugins.always_open_pdf_externally preference; no navigator overrides.');
      }
      if (spec.storage) row.notes.push('Storage denied: each page reaches its real timed final before navigation; snapshot is authoritative, console/route remain backups. This control does not claim unload delivery coverage.');
      if (spec.name.startsWith('23 ')) check(await page.evaluate(() => navigator.webdriver === true), 'Normal-UA fixture must retain webdriver=true');
      if (spec.name.startsWith('24 ')) check(await page.evaluate(() => navigator.webdriver !== true), 'AutomationControlled override did not apply');
      if (spec.storage) check(await page.evaluate(() => {try {void window.sessionStorage; return false;} catch {return true;}}), 'Storage-denied fixture did not apply');
      if (spec.mode === 'performance') {
        const samples = [];
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        for (let j = 0; j < 20; j++) {
          const sample = await context.newPage();
          try {
            await sample.goto(`${origin}/blank.html`);
            await sample.evaluate(probes => {window.trafficClassConfig = probes ? {webgl: true, worker: true} : {};}, !!spec.probes);
            samples.push(await sample.evaluate(text => {
              const start = performance.now(); (0, eval)(text); return performance.now() - start;
            }, source));
            await sample.evaluate(() => window.dispatchEvent(new Event('pagehide')));
          } finally { await sample.close(); }
        }
        Object.assign(row, performanceSummary(samples, spec.budgetMs));
        row.probes = !!spec.probes;
        row.notes.push('Twenty fresh top-level source evaluations; includes parse/eval and synchronous probes, excludes setup, cleanup and BotD. ' +
          (spec.probes ? 'WebGL and Worker enabled; median is informational with no 5ms gate.' : 'Default config (WebGL/Worker off); median must be strictly below 5ms.'));
        row.botd = await botd(page);
      } else if (spec.mode === 'iframe') {
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        const storedBefore = await page.evaluate(() => sessionStorage.getItem('traffic_class'));
        const handle = await page.evaluateHandle(() => {
          const iframe = document.createElement('iframe'); iframe.width = '0'; iframe.height = '0'; iframe.src = '/page2.html'; document.body.appendChild(iframe); return iframe;
        });
        const frame = await handle.asElement().contentFrame();
        await frame.waitForURL(`${origin}/page2.html`); await frame.waitForLoadState('load');
        await sleep(10000);
        const state = await snapshot(frame);
        check(!state.initial && !state.finals.length && !state.state, 'Iframe must not start the detector');
        check(await page.evaluate(() => sessionStorage.getItem('traffic_class')) === storedBefore, 'Iframe changed detector storage');
        row.notes.push('Zero-size subframe emitted no phases and created no detector state or storage writes.');
        row.botd = await botd(frame);
        await handle.evaluate(node => node.remove()); await handle.dispose();
        row.status = 'PASS';
      } else if (['publication', 'prerender'].includes(spec.mode)) {
        if (spec.mode === 'prerender') {
          check(!await page.evaluate(() => window.dataLayer.length || sessionStorage.getItem('traffic_class')), 'Prerender emitted or stored before activation');
          await page.evaluate(() => {
            Object.defineProperty(document, 'prerendering', {value: false, configurable: true});
            document.dispatchEvent(new Event('prerenderingchange'));
          });
          row.notes.push('Property/event fixture exercises real browser event scheduling; this is not a native speculation-rules prerender claim.');
        }
        row.initial = (await snapshot(page)).state.class;
        await page.waitForFunction(() => window.__trafficClass.phase === 'final', null, {timeout: 12000});
        const state = await snapshot(page);
        check(state.state.class === 'human', 'Publication/prerender control must stay human');
        if (spec.mode === 'prerender') check(state.initial && state.finals.length === 1, 'Activation phases missing or duplicated');
        else check(!state.initial && !state.finals.length, 'Broken layer should not populate the unrelated dataLayer');
        row.final = state.state.class;
        row.botd = await botd(page); row.status = 'PASS';
      } else {
        if (spec.mode === 'double') {
          await page.addScriptTag({url: `${origin}/src/visitor-verdict.js`});
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
            if (steps[j] === null && ['benign', 'cdp-agent'].includes(spec.mode)) {
              await page.mouse.move(-20, -20);
              await page.waitForFunction(() => document.visibilityState !== 'hidden' &&
                performance.now() - window.__tcTestActivity.lastInputAt >= 250, null, {timeout: 3000});
              await page.addScriptTag({content: source});
            }
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
            const dwell = observationDwell(spec, last, j);
            if (spec.mode === 'repeat-click') {
              // A stable pagination-like button: several trusted clicks, no new moves.
              await page.evaluate(() => {
                const button = document.createElement('button'); button.id = 'repeat-target';
                button.textContent = 'Next item'; document.body.prepend(button);
              });
              await humanClick(page, page.locator('#repeat-target'), 1200);
              for (let k = 0; k < 4; k++) { await page.mouse.down(); await page.mouse.up(); await sleep(120); }
            }
            // Accessibility tools can produce the same positive jump as an agent.
            // Keyboard activity and slow navigation must keep this control human.
            if (spec.mode === 'assistive-warp') {
              await page.keyboard.press('Shift');
              if (last) {
                await page.evaluate(() => {const b = document.createElement('button'); b.id = 'assistive-target'; b.style.cssText = 'position:fixed;left:950px;top:450px'; b.textContent = 'Inspect'; document.body.prepend(b);});
                await page.mouse.move(10, 10); await sleep(150);
                await page.locator('#assistive-target').click();
              }
            }
            // Agent's third page is idle. Its current input must not be ignored
            // to manufacture NI; only final historical TR + real FN + real NI qualify.
            if (spec.mode === 'flick') {
              await page.mouse.move(20, 20); await page.mouse.move(1000, 100, {steps: 40});
              await page.mouse.down(); await page.mouse.up();
            }
            if (spec.cdp) await sleep(dwell); else await stay(page, spec, dwell);
            if (spec.mode === 'stationary' && !last) {
              await page.evaluate(path => {
                const link = document.createElement('a'); link.id = 'stationary-next'; link.href = path;
                link.textContent = 'Next'; link.style.cssText = 'position:fixed;left:800px;top:100px'; document.body.prepend(link);
              }, steps[j]);
              if (j === 0) {
                const box = await page.locator('#stationary-next').boundingBox();
                await page.mouse.move(10, 10); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 24});
                await sleep(700);
              }
            }
            if (last) await page.waitForFunction(() => window.__trafficClass?.phase === 'final', null, {timeout: 12000});
            const before = await snapshot(page), oldPath = new URL(page.url()).pathname;
            check(before.initial, 'Missing synchronous initial classification');
            if (last) {
              check(before.finals.length === 1, `Expected one final, got ${before.finals.length}`);
              row.pages.push({path: oldPath, initial: before.initial, final: before.finals[0], tpPages: before.tpPages, activity: before.activity, navigationGapsMs: before.navigationGapsMs});
              break;
            }
            const consoleCursor = entries.length;
            entries.pendingPath = oldPath;
            if (steps[j] === 'reload') await page.reload({waitUntil: 'load'});
            else if (steps[j] === 'back') await page.goBack({waitUntil: 'load'});
            else if (steps[j] === 'forward') await page.goForward({waitUntil: 'load'});
            else await navigateAndWait(page, `${origin}${steps[j]}`, async () => {
              if (['locator', 'cdp-agent', 'assistive-warp'].includes(spec.mode)) {
                await page.locator(`a[href="${steps[j]}"]`).evaluate(link => {link.style.cssText = 'position:fixed;left:950px;top:450px';});
                await page.mouse.move(10, 10); await sleep(150);
                await page.locator(`a[href="${steps[j]}"]`).click();
              } else if (spec.mode === 'stationary') {
                await page.mouse.down(); await page.mouse.up();
              } else if (spec.mode === 'voice') {
                await page.locator(`a[href="${steps[j]}"]`).evaluate(link => link.click());
              } else if (spec.mode === 'keyboard') {
                await page.locator(`a[href="${steps[j]}"]`).focus(); await page.keyboard.press('Enter');
              } else if (spec.human && !spec.touch) await humanClick(page, page.locator(`a[href="${steps[j]}"]`), spec.mode === 'rest' ? 1600 : 0);
              else if (spec.human && spec.touch) await page.locator(`a[href="${steps[j]}"]`).tap();
              else await page.evaluate(path => {location.href = path;}, steps[j]);
            });
            const final = await departure(page, entries, oldPath, before, consoleCursor);
            const next = await snapshot(page);
            row.pages.push({path: oldPath, initial: before.initial, final, tpPages: next.tpPages, activity: before.activity, navigationGapsMs: before.navigationGapsMs});
          }
        }
        if (spec.mode === 'double') row.status = 'PASS';
        else row.status = row.pages.every(p => spec.human ? p.initial.traffic_class === 'human' && p.final.traffic_class === 'human' : spec.expected ? p.final.traffic_class === spec.expected : true) && (spec.human || spec.expected || row.pages.at(-1).final.traffic_class !== 'human') ? 'PASS' : 'FAIL';
        if (['cdp-agent', 'locator'].includes(spec.mode)) {
          const last = row.pages.at(-1);
          if (spec.mode === 'cdp-agent') row.status = row.pages.every(p => p.initial.traffic_class === 'human') &&
            last.final.traffic_class === 'suspicious' && ['TR', 'FN', 'NI'].every(code => last.final.traffic_signals.includes(code)) ? 'PASS' : 'FAIL';
          else row.status = last.final.traffic_class !== 'human' ? 'PASS' : 'FAIL';
          const missing = ['TR', 'FN', 'NI'].filter(code => !last.final.traffic_signals.includes(code));
          row.fixture = {required: ['TR', 'FN', 'NI'], missing};
          row.notes.push('Last-page diagnostics: missing ' + JSON.stringify(missing) + '; rounded navigation gaps (ms) ' + JSON.stringify(last.navigationGapsMs) + '; trusted activity counts ' + JSON.stringify(last.activity) + '. Trusted activity legitimately suppresses NI and decays TP history; it is never discarded to force a result.');
          row.notes.push('First two documents each record one trusted baseline before a >200px locator jump. Third document has no input: TR2+FN3+NI2=7 across pointer/navigation/interaction; its initial stays human. Unobserved first movements and nearby clicks remain inconclusive. TP counters: ' + JSON.stringify(row.pages.map(p => p.tpPages)) + '. Missing TP/TR/NI remains an honest detector FAIL.');
        }
        if (spec.mode === 'idle') {
          row.niByPage = row.pages.map(p => !!p.final.traffic_signals?.includes('NI'));
          row.notes.push('NI observed per page: ' + JSON.stringify(row.niByPage));
          if (!row.niByPage.some(Boolean)) row.notes.push('No NI observed: browser-generated trusted input may suppress inactivity; classification still assessed.');
        }
        if (['rest', 'repeat-click', 'keyboard', 'stationary', 'voice', 'flick'].includes(spec.mode)) check(!row.pages.some(p => p.final.traffic_signals.includes('TP')), 'Natural/rested/repeated/keyboard control fired TP');
        if (['rest', 'repeat-click', 'keyboard', 'stationary', 'voice', 'flick'].includes(spec.mode)) check(row.pages.every(p => p.tpPages === 0), 'Human rested/repeated/Enter control increased tpPages');
        if (spec.mode === 'locator') {
          row.tpByPage = row.pages.map(p => !!p.final.traffic_signals?.includes('TP'));
          row.notes.push('TP observed per page: ' + JSON.stringify(row.tpByPage) + '; absence is a detection miss, not a harness error.');
        }
        if (spec.mode === 'decay') {
          check(row.pages.every(p => p.initial.traffic_class === 'human'), 'TP history changed initial class');
          check(row.pages.every(p => p.final.traffic_class === 'human'), 'Trusted input did not clear TR');
          check(row.pages.at(-1).tpPages === 0, 'tpPages did not decay to zero');
          row.status = 'PASS';
        }
        if (spec.mode === 'assistive-warp') {
          check(row.pages.every(p => p.initial.traffic_class === 'human' && p.final.traffic_class === 'human'), 'Assistive warp control falsely classified');
          check(row.pages.every(p => p.final.traffic_signals.includes('TP')), 'Warp pattern not exercised');
          check(row.pages.every(p => !p.final.traffic_signals.includes('FN') && !p.final.traffic_signals.includes('NI')), 'Slow/keyboard control produced FN or NI');
          check(row.pages.at(-1).final.traffic_signals.includes('TR'), 'Repeat warp history not exercised');
        }
        if (spec.mode === 'carry') {
          check(row.pages.map(p => p.initial.traffic_class).join(',') === 'automated,automated,human', 'CA initial expiry failed');
          check(row.pages.map(p => p.final.traffic_class).join(',') === 'automated,automated,human', 'CA final expiry failed');
          check(row.pages[0].initial.traffic_signals.includes('WD') && row.pages[1].initial.traffic_signals.includes('CA') && !row.pages[2].initial.traffic_signals.includes('CA'), 'CA provenance fixture failed');
          row.status = 'PASS';
        }
        if (spec.mode === 'named') {
          check(await page.evaluate(() => window.callPhantom instanceof HTMLFormElement && window.__pwInitScripts instanceof HTMLCollection && window.__playwright__binding__controller__.window === window.__playwright__binding__controller__), 'HTML named property fixture failed');
          check(!row.pages.some(p => p.final.traffic_signals.some(code => ['GL', 'PW'].includes(code))), 'Named HTML falsely automated');
        }
        if (spec.mode === 'probe-defaults') check(await page.evaluate(() => window.__tcProbeCounts.canvas === 0 && window.__tcProbeCounts.worker === 0), 'Heavy probe ran despite default off');
        if (spec.mode === 'benign') {
          const final = row.pages.at(-1).final;
          const required = ['FN', 'NI', spec.environment, ...(spec.uaSwitcher ? ['WK'] : [])];
          const missing = required.filter(code => !final.traffic_signals.includes(code));
          row.fixture = {required, missing};
          if (missing.length) row.notes.push('Fixture missed ' + missing.join(', ') + '; classification retained. Rounded navigation gaps (ms): ' + JSON.stringify(row.pages.at(-1).navigationGapsMs) + '; trusted activity counts: ' + JSON.stringify(row.pages.at(-1).activity));
          row.status = !missing.length && final.traffic_class === (spec.expectedFinal || spec.expected) ? 'PASS' : 'FAIL';
        }
        if (spec.uaSwitcher && spec.mode !== 'benign') check(row.pages.at(-1).final.traffic_signals.includes('WK'), 'Main-only UA override did not exercise WK');
        if (spec.cspWorker) check(!row.pages.some(p => p.final.traffic_signals.includes('WK')), 'Blocked worker must remain unknown');
        if (spec.mode === 'history') check(!row.pages.some(p => p.final.traffic_signals.includes('FN')), 'Reload/history inflated FN');
        if (spec.mode === 'background') check(!row.pages.some(p => p.final.traffic_signals.includes('NI')), 'NI despite hidden time excluded and trusted input');
        if (spec.pdf) check(!row.pages.some(p => p.initial.traffic_signals.includes('PL')), 'PDF-disabled control fired PL');
        if (spec.webgl) check(row.pages.every(p => p.initial.traffic_signals.includes('WG')), 'WebGL-disable fixture did not disable WebGL');
        row.botd = await botd(page);
      }
      if (spec.informational) { row.observedStatus = row.status; row.status = 'INFO'; }
      check(!pageErrors.length, `Page crashed/errored: ${pageErrors.join('; ')}`);
      if (row.status === 'FAIL') row.notes.push('Honest mismatch; existing weights/threshold were not increased to force this fixture. Stealth/normal-browser misses are expected known limits.');
    } catch (error) {
      row.status = error instanceof Skip ? 'SKIP' : 'ERROR'; row.notes.push(String(error.stack || error));
    } finally {
      row.initial = row.pages.at(-1)?.initial?.traffic_class ?? row.initial;
      row.final = row.pages.at(-1)?.final?.traffic_class ?? row.final;
      row.signals = [...new Set(row.pages.flatMap(p => [...(p.initial?.traffic_signals || []), ...(p.final?.traffic_signals || [])]))].sort();
      if (cdp) await cdp.close().catch(error => { row.status = 'ERROR'; row.notes.push('External Chrome cleanup failed: ' + String(error)); }); else if (browser) await browser.close().catch(() => {});
      if (profileDir) await rm(profileDir, {recursive: true, force: true});
    }
    results.push(row);
    console.log(`${row.status}: ${row.name} [${iteration}/${repeat}] ${row.final || ''} ${row.medianMs === undefined ? '' : row.medianMs + ' ms'}`);
  }
  const flakiness = flakes(results);
  const report = {generatedAt: new Date().toISOString(), playwright: require('playwright/package.json').version,
    botdVersion: require('@fingerprintjs/botd/package.json').version, repeat, results, flakiness};
  await writeFile(new URL('results/report-extended.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  const md = `# Extended visitor-verdict tests\n\nGenerated ${report.generatedAt}; Playwright ${report.playwright}; BotD ${report.botdVersion}; repeat ${repeat}.\n\n` +
    '| Scenario | Category | Run | Expected | Initial | Final | Signals | BotD bot / kind | Median ms | Budget ms | Status |\n|---|---|---|---|---|---|---|---|---|---|---|\n' +
    results.map(r => '| ' + [r.name, r.category, r.iteration, r.expected, r.initial, r.final, r.signals.join(', '), botdCell(r.botd), r.medianMs?.toFixed(3), r.medianMs !== undefined ? r.budgetMs ?? 'informational' : r.budgetMs, r.status].map(cell).join(' | ') + ' |').join('\n') +
    '\n\n## Flakiness\n\n' + flakiness.map(f => `- ${f.name}: ${f.flaky ? '**FLAKY**' : repeat < 2 ? 'single run; not assessed' : 'stable'} (${f.runs} runs)`).join('\n') +
    '\n\n## Evidence and limitations\n\n' + results.filter(r => r.notes.length).map(r => `- ${r.name}, run ${r.iteration}: ${r.notes.map(cell).join(' ')}`).join('\n') +
    '\n\nEvery human page must be initial/final human. BotD runs once per scenario, after our last result, with monitoring off, and only bot/botKind is retained. Benchmark errors are separate from classifier verdicts. Mobile/tablet inputs are emulated. Background requires confirmed hidden visibility; otherwise SKIP. Each performance profile uses 20 fresh top-level pages on a desktop engine. Only default-config median must be strictly <5ms; probes-on median is reported separately without that gate (includes parse/eval and synchronous probes, excludes setup/cleanup). Timing variability does not alone imply classification flakiness. CSP is deliberately skipped. Reload/back-forward checks forbid FN. BFCache can restore an already-final document; no second final is required. Storage-denied scenarios use console plus intercepted /log requests before forwarding; delivery to the log server is not required. TP=3 and TR=2 (shared pointer cap3, final only), WK=2 (worker), worker HeadlessChrome adds hard HL=100. Threshold/family caps stay unchanged; score also needs TP/TR/SY/WK or two environment families plus behaviour. FN+NI+WG and FN+NI+GS now stay human; GS+NI+FN+WK remains suspicious. Prior scenarios 6/7/25 may lose their benign-only suspicious result; no-movement/nearby locator clicks no longer qualify as TP. These are policy changes pending browser observations. Rapid and stealth bots may remain human; TP does not carry as raw input; tpPages/TR carries positive repeated teleport evidence as a bounded counter, decaying once per document with any trusted input and no TP. TR never overrides the normal score/family gate or affects initial classification. Trusted focusin/keyup/pointerup also count in window capture. Assistive warps with slow navigation and keyboard input stay human; scenario 35 tests a controlled idle final document after native navigation input settles: historical TR2+FN3+NI2=7, with all initials human. The previous human run had FN but also trusted activity, so NI was absent and tpPages correctly decayed from 2 to 1. Rounded gaps and bounded trusted-event counts now explain such misses. Regression navigation is spaced by 250ms to avoid same-100ms-bucket deduplication while retaining the 2000ms fast-navigation limit. Library heavy probes default off; the test site opts in explicitly except the default-off control.\n';
  await writeFile(new URL('results/report-extended.md', import.meta.url), md);
  if (results.some(r => !r.noteOnly && !['PASS', 'INFO'].includes(r.status) && r.name !== 'C4 Inline-blocking CSP' || r.botd?.status === 'ERROR') || flakiness.some(f => f.flaky && !f.informational)) process.exitCode = 1;
} finally { if (server) await new Promise(resolve => server.close(resolve)); }
