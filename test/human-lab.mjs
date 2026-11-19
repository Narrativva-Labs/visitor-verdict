// Human lab: opens a normal Google Chrome window (fresh temporary profile, no automation input)
// for a person to browse manually, and records everything the detector does.
// Usage: node test/human-lab.mjs [url ...]   Close the Chrome window (or Ctrl+C) to finish.
// Records to test/results/human-lab-<timestamp>.jsonl and prints a summary.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.TC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.TC_LAB_PORT || 9350);
const urls = process.argv.slice(2).length ? process.argv.slice(2) : ['https://demoshop.frantisekbujnovsky.com/'];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await mkdir('test/results', { recursive: true });
const out = `test/results/human-lab-${stamp}.jsonl`;
const log = async rec => appendFile(out, JSON.stringify({ t: new Date().toISOString(), ...rec }) + '\n');

const profile = await mkdtemp(join(tmpdir(), 'visitor-verdict-lab-'));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...urls], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const context = browser.contexts()[0];

// Lab only: switch the detector's debug flag on inside GTM so signal codes are visible.
await context.route(/googletagmanager\.com\/gtm\.js/, async route => {
  try {
    const res = await route.fetch(); let body = await res.text();
    body = body.replace(/debug: false/g, 'debug: true').replace(/debug:!1/g, 'debug:!0');
    await route.fulfill({ response: res, body });
  } catch { await route.continue().catch(() => {}); }
});

const pages = new Map(); // page -> last snapshot json
const finals = [];
function parseHits(req) {
  const u = req.url(); if (!/\/g\/collect/.test(u)) return [];
  const base = new URLSearchParams(u.split('?')[1] || ''); const hits = [];
  for (const line of (req.postData() || '').split('\n').concat([''])) {
    const q = new URLSearchParams(line); const en = q.get('en') || base.get('en');
    if (en) hits.push({ en, traffic_class: q.get('ep.traffic_class') || base.get('ep.traffic_class') || null, traffic_phase: q.get('ep.traffic_phase') || base.get('ep.traffic_phase') || null, traffic_version: q.get('ep.traffic_version') || base.get('ep.traffic_version') || null, up: q.get('up.traffic_class') || base.get('up.traffic_class') || null, gcs: base.get('gcs') });
    if (!line) break;
  }
  return hits;
}
function watch(page) {
  if (pages.has(page)) return; pages.set(page, '');
  page.on('request', async req => { for (const h of parseHits(req)) { await log({ kind: 'ga4', url: page.url(), ...h }); console.log(`  GA4 ${h.en}${h.traffic_class ? ' [' + h.traffic_class + ']' : ''} gcs=${h.gcs}`); } });
  page.on('framenavigated', async f => { if (f === page.mainFrame()) { await log({ kind: 'nav', url: f.url() }); console.log(`→ ${f.url()}`); } });
}
context.pages().forEach(watch); context.on('page', watch);

const snapshot = page => page.evaluate(() => {
  let storage = null; try { storage = sessionStorage.getItem('visitor_verdict'); } catch (e) { storage = 'blocked'; }
  const tc = window.__visitorVerdict ? { class: window.__visitorVerdict['class'], score: window.__visitorVerdict.score, phase: window.__visitorVerdict.phase, version: window.__visitorVerdict.version, signals: (window.dataLayer || []).filter(e => e && e.event === 'traffic_class').at(-1)?.traffic_signals || null } : null;
  const events = (window.dataLayer || []).filter(e => e && e.event === 'traffic_class').map(e => ({ phase: e.traffic_phase, class: e.traffic_class, score: e.traffic_score, version: e.traffic_version, signals: e.traffic_signals || null }));
  return { url: location.href, tc, events, storage, visibility: document.visibilityState };
}).catch(() => null);

let alive = true;
browser.on('disconnected', () => { alive = false; });
process.on('SIGINT', () => { alive = false; });
console.log(`Human lab running. Browse normally; close the Chrome window to finish.\nRecording to ${out}\n`);
while (alive) {
  for (const page of [...pages.keys()]) {
    if (page.isClosed()) { pages.delete(page); continue; }
    const s = await snapshot(page); if (!s) continue;
    const key = JSON.stringify([s.url, s.events]);
    if (key !== pages.get(page)) {
      pages.set(page, key); await log({ kind: 'state', ...s });
      const last = s.events[s.events.length - 1];
      if (last) console.log(`  detector ${last.phase}: ${last.class} (score ${last.score}) ${last.signals ? '[' + last.signals.join(',') + ']' : ''}`);
      if (last && last.phase === 'final') finals.push({ url: s.url, ...last });
    }
  }
  await new Promise(r => setTimeout(r, 700));
}
chrome.kill();
const bad = finals.filter(f => f.class !== 'human');
await log({ kind: 'summary', finals, nonHuman: bad });
console.log(`\nSummary: ${finals.length} final results, ${bad.length} non-human.`);
for (const f of finals) console.log(` ${f.class.padEnd(14)} score ${String(f.score).padEnd(4)} ${f.signals ? '[' + f.signals.join(',') + ']' : ''} ${f.url}`);
console.log(`Full record: ${out}`);
