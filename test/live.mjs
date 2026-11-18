// Live check against the published GTM container on the Vanilla demo shop.
// Usage: node test/live.mjs [--only L2,L5]   Writes test/results/live-report.md + .json
import { chromium, firefox, webkit, devices } from 'playwright';
import { chromium as chromiumExtra } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { writeFileSync, mkdirSync } from 'node:fs';

chromiumExtra.use(stealth());
const ORIGIN = 'https://demoshop.frantisekbujnovsky.com';
const PAGES = ['/', '/kosik.html', '/doprava.html'];
const STAY = 20000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HUMAN_ARGS = ['--disable-blink-features=AutomationControlled'];

const scenarios = [
  { id: 'L1', name: 'Chromium headless, souhlas ODMÍTNUT', engine: chromium, launch: { headless: true }, consent: 'necessary', expect: 'none' },
  { id: 'L2', name: 'Chromium headless, souhlas přijat', engine: chromium, launch: { headless: true }, consent: 'all', expect: 'automated' },
  { id: 'L3', name: 'Firefox headless, souhlas přijat', engine: firefox, launch: { headless: true }, consent: 'all', expect: 'automated' },
  { id: 'L4', name: 'WebKit headless, souhlas přijat', engine: webkit, launch: { headless: true }, consent: 'all', expect: 'automated' },
  { id: 'L5', name: 'Chrome stealth, lidské chování', engine: chromiumExtra, launch: { headless: false, channel: 'chrome', args: HUMAN_ARGS }, consent: 'all', human: true, expect: 'human' },
  { id: 'L6', name: 'Pixel 7 stealth, lidské chování', engine: chromiumExtra, launch: { headless: false, args: HUMAN_ARGS }, context: { ...devices['Pixel 7'] }, consent: 'all', human: true, touch: true, expect: 'human' },
  { id: 'L7', name: 'UA ChatGPT-User, headless', engine: chromium, launch: { headless: true }, context: { userAgent: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot' }, consent: 'all', expect: 'declared_agent' },
  { id: 'L8', name: 'Chromium stealth headless, bez interakce', engine: chromiumExtra, launch: { headless: true, args: HUMAN_ARGS }, consent: 'all', expect: 'not human' },
];

const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const pick = s => { const o = {}; for (const p of decodeURIComponent(s).split('&')) { const i = p.indexOf('='); const k = p.slice(0, i); if (/^(en|gcs|ep\.traffic_class|up\.traffic_class|ep\.page_type)$/.test(k)) o[k] = p.slice(i + 1); } return o; };

async function humanStay(page, ms, touch) {
  const end = Date.now() + ms;
  const vp = page.viewportSize() || { width: 1200, height: 800 };
  while (Date.now() < end) {
    const x = 20 + Math.random() * (vp.width - 40), y = 80 + Math.random() * (vp.height - 160);
    if (touch) {
      // Tap a point without a link under it, so the stay is not cut short by navigation.
      const safe = await page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return !(el && el.closest('a,button,input,select,textarea,label,[data-cc]')); }, [x, y]).catch(() => false);
      if (safe) await page.touchscreen.tap(x, y).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, 120)).catch(() => {});
    }
    else { await page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 10) }); if (Math.random() < 0.4) await page.mouse.wheel(0, 150); }
    await sleep(600 + Math.random() * 900);
  }
}

const rows = [];
for (const sc of scenarios) {
  if (only.length && !only.includes(sc.id)) continue;
  const row = { id: sc.id, name: sc.name, expect: sc.expect, pages: [], hits: [], notes: [] };
  let browser;
  try {
    browser = await sc.engine.launch(sc.launch).catch(async e => {
      if (sc.launch.channel) { row.notes.push('channel chrome unavailable, using bundled Chromium'); const l = { ...sc.launch }; delete l.channel; return sc.engine.launch(l); }
      throw e;
    });
    const context = await browser.newContext({ ...(sc.context || {}) });
    const page = await context.newPage();
    page.on('request', r => {
      const u = r.url(); if (!/\/g\/collect/.test(u)) return;
      const base = pick(u.split('?')[1] || ''); const body = r.postData();
      const lines = body ? body.split('\n').map(pick) : [{}];
      for (const l of lines) { const h = { ...base, ...l }; if (h.en) row.hits.push(h); }
    });
    await page.goto(ORIGIN + PAGES[0], { waitUntil: 'load' });
    await sleep(1500);
    const btn = page.locator(`[data-role="${sc.consent}"]`).first();
    if (await btn.count()) { if (sc.human) await btn.hover().catch(() => {}); await btn.click(); } else row.notes.push('consent button not found');
    await sleep(800);
    for (let i = 0; i < PAGES.length; i++) {
      if (i > 0) {
        if (sc.human) await sleep(400 + Math.random() * 600);
        await page.goto(ORIGIN + PAGES[i], { waitUntil: 'load' });
      } else await page.reload({ waitUntil: 'load' });
      if (sc.human) await humanStay(page, STAY, sc.touch); else await sleep(STAY);
      row.pages.push(await page.evaluate(() => ({
        path: location.pathname,
        tc: window.__trafficClass || null,
        events: (window.dataLayer || []).filter(e => e && e.event === 'traffic_class').map(e => e.traffic_phase + ':' + e.traffic_class),
        storage: (() => { try { return sessionStorage.getItem('traffic_class'); } catch (e) { return 'ERR'; } })(),
      })));
    }
    await page.goto(ORIGIN + '/hledat.html', { waitUntil: 'load' }); // flush last page
    await sleep(3000);
  } catch (e) { row.notes.push('ERROR ' + e.message.split('\n')[0]); }
  finally { if (browser) await browser.close().catch(() => {}); }

  const finals = row.pages.map(p => p.tc && p.tc.class).filter(Boolean);
  const tcHits = row.hits.filter(h => h.en === 'traffic_class').map(h => h['ep.traffic_class']);
  const pvTagged = row.hits.filter(h => h.en === 'page_view').map(h => h['ep.traffic_class'] || '-');
  if (sc.expect === 'none') row.status = (!finals.length && !tcHits.length && row.pages.every(p => !p.storage)) ? 'PASS' : 'FAIL';
  else if (sc.expect === 'not human') row.status = finals.length && finals.every(c => c !== 'human') ? 'PASS' : 'FAIL';
  else row.status = finals.length && finals.every(c => c === sc.expect) && tcHits.length && tcHits.every(c => c === sc.expect) ? 'PASS' : 'FAIL';
  if (row.notes.some(n => n.startsWith('ERROR'))) row.status = 'ERROR';
  row.summary = { finals, gaTrafficClassEvents: tcHits, pageViewParam: pvTagged, gcs: [...new Set(row.hits.map(h => h.gcs))] };
  rows.push(row);
  console.log(`${row.status}: ${sc.id} ${sc.name} | třídy ${finals.join(',') || '—'} | GA4 traffic_class ${tcHits.join(',') || '—'} | page_view param ${pvTagged.join(',')} | gcs ${row.summary.gcs.join(',')} ${row.notes.join('; ')}`);
}

mkdirSync('test/results', { recursive: true });
writeFileSync('test/results/live-report.json', JSON.stringify(rows, null, 2));
writeFileSync('test/results/live-report.md', ['# Live test demoshop', '', `Run: ${new Date().toISOString()}`, '', '| id | scénář | očekáváno | třídy | GA4 traffic_class | page_view param | gcs | výsledek |', '|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.id} | ${r.name} | ${r.expect} | ${r.summary.finals.join(', ')} | ${r.summary.gaTrafficClassEvents.join(', ')} | ${r.summary.pageViewParam.join(', ')} | ${r.summary.gcs.join(', ')} | ${r.status} ${r.notes.join('; ')} |`)].join('\n') + '\n');
