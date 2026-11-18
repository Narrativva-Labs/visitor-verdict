export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    return {name, runs: runs.length, flaky: new Set(outcomes).size > 1};
  });
}
export const cell = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
export const botdCell = result => result?.status === 'OK' ? `${result.bot} / ${result.botKind || '—'}` : result?.status || '—';
