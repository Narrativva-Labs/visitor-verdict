export const paths = ['/index.html', '/page2.html', '/page3.html'];
const cell = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ').replaceAll('\r', ' ');
const classes = new Set(['human', 'suspicious', 'automated', 'declared_agent']);
function cleanEvent(event) {
  return {traffic_class: event.traffic_class, traffic_phase: event.traffic_phase,
    traffic_score: event.traffic_score, traffic_version: event.traffic_version,
    traffic_signals: Array.isArray(event.traffic_signals) ? event.traffic_signals.filter(s => typeof s === 'string') : []};
}
export function summarize(raw) {
  const issues = [];
  const events = Array.isArray(raw.events) ? raw.events : [];
  const pages = paths.map(path => {
    const entries = events.filter(e => e?.path === path && e.event?.event === 'traffic_class').map(e => e.event);
    const initial = entries.filter(e => e.traffic_phase === 'initial');
    const final = entries.filter(e => e.traffic_phase === 'final');
    if (initial.length !== 1 || final.length !== 1) issues.push(`${path}: ${initial.length} initial, ${final.length} final events (expected one each)`);
    for (const event of entries) {
      if (event.traffic_version !== '1.1.0' || !classes.has(event.traffic_class) || !Number.isFinite(event.traffic_score) || !Array.isArray(event.traffic_signals) || event.traffic_signals.some(s => typeof s !== 'string')) issues.push(`${path}: malformed detector event or debug signals missing`);
    }
    return {path, initial: initial[0] ? cleanEvent(initial[0]) : null, final: final[0] ? cleanEvent(final[0]) : null,
      initialCount: initial.length, finalCount: final.length};
  });
  if (raw.error) issues.push(raw.error);
  if (raw.cleanupError) issues.push('Cleanup: ' + raw.cleanupError);
  if (raw.processError) issues.push(raw.processError);
  const complete = issues.length === 0;
  return {...raw, events: undefined, pages, issues, status: complete ? 'COMPLETE' : 'ERROR',
    endsHuman: complete ? pages[2].final.traffic_class === 'human' : null,
    signals: [...new Set(pages.flatMap(p => [p.initial, p.final].flatMap(e => e?.traffic_signals || [])))].sort()};
}
export function markdown(report) {
  return '# Adversarial tools benchmark\n\n' +
    `Generated ${report.generatedAt}. Informational outcomes; classification is never graded.\n\n` +
    'Ends human = page 3 final is human AND the full three-page trace is complete. An incomplete/error run is unknown.\n\n' +
    '| Tool | Mode | Execution | Page 3 initial | Page 3 final | Ends human | All signals |\n|---|---|---|---|---|---|---|\n' +
    report.results.map(r => '| ' + [r.tool, r.mode, r.status, r.pages[2].initial?.traffic_class,
      r.pages[2].final?.traffic_class, r.endsHuman === null ? 'unknown' : r.endsHuman ? 'yes' : 'no', r.signals.join(', ')].map(cell).join(' | ') + ' |').join('\n') +
    '\n\n## Per-page observations\n\n| Tool | Mode | Page | Initial | Initial score | Initial signals | Final | Final score | Final signals |\n|---|---|---|---|---|---|---|---|---|\n' +
    report.results.flatMap(r => r.pages.map(p => '| ' + [r.tool, r.mode, p.path, p.initial?.traffic_class,
      p.initial?.traffic_score, p.initial?.traffic_signals?.join(', '), p.final?.traffic_class,
      p.final?.traffic_score, p.final?.traffic_signals?.join(', ')].map(cell).join(' | ') + ' |')).join('\n') +
    '\n\n## Execution notes\n\n' + report.results.map(r =>
      `- ${cell(r.tool)} / ${cell(r.mode)}: ${[...(r.notes || []), ...r.issues].map(cell).join(' ') || 'No execution issues.'} Versions: ${cell(JSON.stringify(r.versions || {}))}; browser: ${cell(r.browserVersion)}; last stage: ${cell(r.stage)}; failed stage: ${cell(r.failedStage)}.`).join('\n') +
    '\n\n## Method and limits\n\n' +
    'Each run starts a fresh browser/profile and visits index → page2 → page3 using links. Default mode uses the tool\'s element click, with no intentional delay. Human-like mode waits 2.4 seconds before each link, approaches it along a curved mouse path, rests 180 ms, and clicks with native input. It also moves the mouse on page 3, then waits 10 seconds. Timing and input both differ between modes; this is not a mouse-only experiment.\n\n' +
    'Finals for pages 1–2 normally fire on pagehide; page 3 must reach its real timed final. Hidden tabs may prevent that final: this is recorded as an execution error, never inferred from the initial class. SessionStorage tc_test_events is read after navigation, preserving departing-page events without detector hooks. No navigator properties or input traces are exported. There is no BotD benchmark or external target. Browser/driver downloaders may need network access.\n\n' +
    'Headed: undetected-chromedriver, nodriver, camoufox (or Linux virtual display when explicitly selected), selenium-headed, puppeteer-real-browser, patchright. Headless: selenium-headless, puppeteer-stealth, rebrowser-puppeteer. Camoufox disables GeoIP and default addons to avoid unrelated download stalls; its exact configuration and last stage appear above. These choices are explicit launch configurations; default navigation describes click behavior, not an identical browser across tools. Results can vary with browser versions, platform and package patches. Real desktop agents with natural input can end human. No classifier changes are made to force outcomes.\n';
}
