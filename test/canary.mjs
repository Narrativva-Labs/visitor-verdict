#!/usr/bin/env node
// Read-only navigation harness. No request logging, traces, signals or identifiers.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const help = `Usage: node test/canary.mjs --url https://example.com/ [--url https://example.com/about]
  [--pages 3] [--configs default,ua-fixed,stealth] [--site example.com]
  [--wait-ms 10000] [--gap-ms 15000] [--output test/results/canary-windows.csv]
Optional configuration: patchright (requires locally installed package/browser).
URLs must share a hostname and contain no credentials, query or fragment.
One fresh browser/context per configuration; N pages cycles through the URL list.
Only ordinary GET navigation: no clicks, forms, consent changes or purchases.
Missing optional packages are SKIP; missing final results/errors set exit code 1.
CSV is append-only; run one writer at a time. Classes print to stdout only.`;
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log(help); process.exit(0); }
const opts = { urls: [], pages: 3, configs: 'default,ua-fixed,stealth', wait: 10000,
  gap: 15000, output: 'test/results/canary-windows.csv' };
try {
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing option value');
    if (key === '--url') opts.urls.push(new URL(value));
    else if (key === '--pages') opts.pages = Number(value);
    else if (key === '--wait-ms') opts.wait = Number(value);
    else if (key === '--gap-ms') opts.gap = Number(value);
    else if (key === '--configs') opts.configs = value;
    else if (key === '--site') opts.site = value;
    else if (key === '--output') opts.output = value;
    else throw new Error('Unknown option');
  }
  if (!opts.urls.length) throw new Error('At least one --url is required');
  for (const u of opts.urls) {
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash ||
        u.host !== opts.urls[0].host) throw new Error('Invalid URL list (see --help)');
  }
  for (const [v, min, max] of [[opts.pages, 1, 30], [opts.wait, 10000, 60000], [opts.gap, 10000, 60000]]) {
    if (!Number.isInteger(v) || v < min || v > max) throw new Error('Invalid page count or timing');
  }
  opts.configs = [...new Set(opts.configs.split(','))];
  if (opts.configs.some(c => !['default', 'ua-fixed', 'stealth', 'patchright'].includes(c))) {
    throw new Error('Unknown configuration');
  }
  opts.site ||= opts.urls[0].host;
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(opts.site)) throw new Error('Use a short non-personal site name');
} catch (e) { console.error(e.message); process.exit(2); }

const output = resolve(opts.output);
const header = 'start_ts,end_ts,label,site,notes\n';
await mkdir(dirname(output), { recursive: true });
try {
  const existing = await readFile(output, 'utf8');
  if (!existing.startsWith(header) || !existing.endsWith('\n')) throw new Error('Invalid CSV header/end');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  await appendFile(output, header, { flag: 'wx' });
}
const cell = v => '"' + String(v).replaceAll('"', '""') + '"';
const classes = ['human', 'suspicious', 'automated', 'declared_agent'];
for (const config of opts.configs) {
  const start = new Date().toISOString();
  let browser, context, visited = 0, missing = 0, clearPages = 0, suspiciousPages = 0, humanPages = 0, status = 'complete';
  try {
    let chromium;
    try {
      if (config === 'stealth') {
        const extra = await import('playwright-extra');
        const plugin = await import('puppeteer-extra-plugin-stealth');
        chromium = extra.chromium;
        chromium.use(plugin.default());
      } else {
        ({ chromium } = await import(config === 'patchright' ? 'patchright' : 'playwright'));
      }
    } catch (e) {
      if (e.code === 'ERR_MODULE_NOT_FOUND' && ['stealth', 'patchright'].includes(config)) {
        status = 'skip-package';
      } else throw e;
    }
    if (status === 'complete') {
      browser = await chromium.launch({ headless: true,
        ...(config === 'ua-fixed' ? { args: ['--disable-blink-features=AutomationControlled'] } : {}) });
      let userAgent;
      if (config === 'ua-fixed') {
        // Change only the UA string; worker/UA-CH inconsistencies can remain.
        const probe = await browser.newPage();
        userAgent = (await probe.evaluate(() => navigator.userAgent)).replace(/HeadlessChrome/g, 'Chrome');
        await probe.close();
      }
      context = await browser.newContext(userAgent ? { userAgent } : {});
      const page = await context.newPage();
      for (let i = 0; i < opts.pages; i++) {
        const response = await page.goto(opts.urls[i % opts.urls.length].href,
          { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!response || response.status() >= 400) throw new Error('Navigation failure');
        await page.bringToFront();
        await delay(opts.wait);
        const result = await page.evaluate(() => {
          const s = window.__visitorVerdict;
          return s ? { class: s.class, phase: s.phase } : null;
        });
        const valid = result && classes.includes(result.class);
        const final = valid && result.phase === 'final';
        console.log(`${config} page=${i + 1} class=${valid ? result.class : 'unknown'} phase=${final ? 'final' : 'initial-or-missing'}`);
        visited++;
        if (final && ['automated', 'declared_agent'].includes(result.class)) clearPages++;
        if (final && result.class === 'suspicious') suspiciousPages++;
        if (final && result.class === 'human') humanPages++;
        if (!final) missing++;
      }
    }
  } catch {
    // Do not print exception text: browsers can include URLs or response data.
    status = 'error'; process.exitCode = 1;
  } finally {
    try { await context?.close(); await browser?.close(); }
    catch { status = 'error-close'; process.exitCode = 1; }
    if (missing) process.exitCode = 1;
    const end = new Date().toISOString();
    const notes = `status=${status};pages=${visited}/${opts.pages};missing_final=${missing};clear_pages=${clearPages};suspicious_pages=${suspiciousPages};human_pages=${humanPages};wait_ms=${opts.wait}`;
    await appendFile(output, [start, end, `canary:${config}`, opts.site, notes].map(cell).join(',') + '\n');
    console.log(`${config} ${notes}`);
  }
  await delay(opts.gap);
}
