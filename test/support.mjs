export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Arm the destination waiter before an action can initiate navigation. Waiting
// for the current document's already-complete load is not a navigation barrier.
export async function navigateAndWait(page, targetURL, action) {
  await Promise.all([page.waitForURL(targetURL, {waitUntil: 'load'}), Promise.resolve().then(action)]);
}
export function observationDwell(spec, last, step = 0) {
  if (spec.mode === 'rapid') return last ? 12000 : 0;
  // Distinct 100ms timestamp buckets, with margin under the real 2000ms limit.
  if (['benign', 'cdp-agent'].includes(spec.mode)) return last ? 10000 : 250;
  if (spec.mode === 'history') return last ? 10000 : step < 3 ? 0 : 2500;
  if (spec.cdp) return last ? 10000 : 1150;
  if (!spec.human && !spec.dwell) return last ? 10000 : 0;
  return spec.dwell || (last ? 10000 : 2800);
}
export function performanceSummary(samplesMs, budgetMs) {
  if (!samplesMs.length || samplesMs.some(ms => !Number.isFinite(ms) || ms < 0)) throw Error('Invalid performance samples');
  const sorted = [...samplesMs].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {samplesMs, medianMs, budgetMs: budgetMs ?? null,
    status: budgetMs === undefined ? 'INFO' : medianMs < budgetMs ? 'PASS' : 'FAIL'};
}
export function options(args = process.argv.slice(2)) {
  let repeat = 1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--repeat' || !/^\d+$/.test(args[i + 1] || '')) throw Error('Usage: node test/run[-extended].mjs [--repeat N]');
    repeat = Number(args[++i]);
    if (!Number.isSafeInteger(repeat) || repeat < 1) throw Error('--repeat must be a positive safe integer');
  }
  return {repeat};
}
export async function botd(page) {
  try {
    return await page.evaluate(async () => {
      const timeout = new Promise(resolve => setTimeout(() => resolve({status: 'ERROR', error: 'BotD timeout (5s)'}), 5000));
      return Promise.race([import('/benchmark.js').then(m => m.benchmarkBotD()), timeout]);
    });
  } catch (error) { return {status: 'ERROR', error: String(error)}; }
}
export function flakes(results) {
  return [...new Set(results.map(r => r.name))].map(name => {
    const runs = results.filter(r => r.name === name);
    const outcomes = runs.map(r => JSON.stringify({status: r.status,
      classes: r.pages?.map(p => [p.initial?.traffic_class, p.final?.traffic_class]),
      signals: r.signals, botd: r.botd}));
    return {name, runs: runs.length, informational: runs.every(r => r.informational), flaky: new Set(outcomes).size > 1};
  });
}
export const cell = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
export const botdCell = result => result?.status === 'OK' ? `${result.bot} / ${result.botKind || '—'}` : result?.status || '—';

// Human control: approach the target through multiple trusted mouse moves.
export async function humanClick(page, locator, restMs = 0) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw Error('Human click target has no bounding box');
  await page.mouse.move(24, 100);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 20});
  if (restMs) await sleep(restMs);
  await page.mouse.down(); await page.mouse.up();
}

// Native control preflight, on /blank.html before any fixture-specific overrides.
// WorkerNavigator.webdriver is usually absent; do not patch it to manufacture false.
export async function cleanPreflight(page) {
  return page.evaluate(() => new Promise(resolve => {
    const main = navigator.webdriver === false;
    let worker, url, timer;
    function end(result) {
      clearTimeout(timer); if (worker) worker.terminate(); if (url) URL.revokeObjectURL(url);
      resolve({mainWebdriverFalse: main, ...result});
    }
    try {
      url = URL.createObjectURL(new Blob([`onmessage=e=>{const a=e.data,n=navigator;
        postMessage({workerWebdriverNotTrue:n.webdriver!==true,workerWebdriverSupported:typeof n.webdriver==='boolean',
        consistent:a.ua===n.userAgent&&JSON.stringify(a.la)===JSON.stringify(n.languages)&&a.hc===n.hardwareConcurrency});close();}`], {type: 'text/javascript'}));
      worker = new Worker(url);
      worker.onmessage = event => end({status: 'OK', ...event.data});
      worker.onerror = event => {event.preventDefault(); end({status: 'UNKNOWN'});};
      timer = setTimeout(() => end({status: 'UNKNOWN'}), 1500);
      worker.postMessage({ua: navigator.userAgent, la: navigator.languages, hc: navigator.hardwareConcurrency});
    } catch { end({status: 'UNKNOWN'}); }
  }));
}
