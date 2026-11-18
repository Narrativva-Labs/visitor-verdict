# traffic-class

A dependency-free ES5 detector for a GTM Custom HTML tag. It classifies each visit as `declared_agent`, `automated`, `suspicious`, or `human`. `human` means insufficient evidence of automation; it is not proof that a person is browsing.

The detector evaluates browser signals locally, creates no identifier or hash, and sends no network requests. Its only persistence is one `sessionStorage` entry (`traffic_class`) with at most 20 pageview timestamps and the last final class. No cookies or localStorage are used. Production output contains only class, phase and numeric score, plus the fixed event name. `debug: true` adds short signal codes. The test site separately POSTs these debug events to its local `/log` sink. Consent gating belongs in GTM.

## Run

Node.js 20 or newer:

```sh
npm install
npx playwright install chromium firefox webkit
npm run build
node test/run.mjs
```

The suite also needs installed Google Chrome for control 10 and a graphical desktop for headed scenarios 3, 7 and 10 (on Linux, use an appropriate display/Xvfb). Missing engines, dependencies or launch permissions produce `SKIP`, never a passing substitute; execution errors after launch produce `ERROR`. Each browser scenario uses a fresh context, follows index → page2 → page3 and remains 10 seconds on the last page. Browser versions, every page's initial/final event, and deviations appear in `test/results/report.json`; `report.md` contains the matrix. Any scenario failure or error causes a nonzero exit. No bot miss is hidden.

```sh
npm run test:contracts   # deterministic detector semantics without a browser
npm run serve            # http://127.0.0.1:8787 (PORT is overridable)
```

`test/results/log.jsonl` appends test-only dataLayer output and is ignored by Git. It contains no scenario identifier or browser attributes. Reports group scenario events in runner memory instead. Only the local test harness makes requests.

The current sandbox run is **incomplete**: localhost listening fails with `EPERM`, npm dependency downloads fail with `ENOTFOUND`, and an independent Chromium launch fails with a denied macOS MachPort bootstrap registration. Existing local Playwright and build dependencies were used where possible; `playwright-extra` and the stealth plugin could not be installed. All 12 scenario rows are `SKIP`/untested; fetch is represented as **no event**, with its unavailable transport clearly noted. The 17 deterministic contract checks pass. The detector parses as ES5, but currently minifies to **6,107 bytes**, exceeding the <5 KB target. Build warns about this open size issue. No claim that human controls pass or that framework globals appeared naturally can be made from this run. Re-run the commands above in an environment permitting browsers and localhost before deployment.

## Configuration and phases

Set `window.trafficClassConfig` before loading `src/traffic-class.js`. The config at the top of `gtm/custom-html.html` uses the defaults:

```js
window.trafficClassConfig = {
  idleMs: 8000,
  fastNavMs: 2000,
  fastNavCount: 3,
  suspiciousThreshold: 6,
  debug: false,
  dataLayerName: 'dataLayer'
  // agentTokens: ['your-regex-source'] // replaces, rather than extends, defaults
};
```

`agentTokens` is exactly the array in [research section 5](research/agents-and-tells.md), compiled as case-insensitive regex sources with token boundaries. It includes `Claude-Agent`, `Google-Agent`, the documented fetcher/crawler identities, and legacy `Google-NotebookLM` compatibility. It excludes `ChatGPT Agent`, `Google-Extended` and `Applebot-Extended`. Custom patterns replace the array; malformed patterns are ignored, and the same outer boundaries apply. A declared UA is self-identification, not authenticated vendor identity or proof of an interactive agent.

Initial classification is synchronous. Final classification adds behaviour after `idleMs` of **visible** time, pausing while hidden, or immediately on `pagehide`. Final fires once per document. `NI` requires at least **8000 ms** visible exposure regardless of an earlier `pagehide` or a shortened configured observation. Reinserting the script is ignored. BFCache restoration retains the existing document's completed state, adds no timestamp and never produces another final. Reload/back-forward navigation does not append navigation timestamps. SPA route changes do not rerun classification.

Both phases push:

```js
{event: 'traffic_class', traffic_class: 'human',
 traffic_phase: 'initial', traffic_score: 0}
```

`window.__trafficClass` holds `{class, score, phase}` and adds `signals` only in debug mode. Classification order is declared UA → hard/inherited automation → suspicious → human. Initial declared/automated classes persist into final. `CA` carries a previous **final** automated class in the same tab; this is inherited history, not fresh hard evidence. Hard/declared/inherited classes have sentinel score **100** regardless of the number of proofs; the score is not a probability.

## Signals and weights

[Research sections 4–5](research/agents-and-tells.md) take precedence over the earlier AGENTS.md proposals. Suspicious requires **score ≥6 AND at least 3 distinct positive-weight families**. Geometry is capped at 1, graphics at 1, and inactivity/synthetic input at 2. Other positive signals have separate families; zero-weight HC does not count.

| Code | Evidence and safeguards | Weight / family |
|---|---|---|
| `AG` | Boundary-matched configured agent token | 100 / declared |
| `WD` | navigator.webdriver strictly true | 100 / hard |
| `HL` | HeadlessChrome in UA or synchronous brands; no high-entropy request | 100 / hard |
| `AU` | Bounded PhantomJS, Chrome-Lighthouse, Lighthouse, GTmetrix, Google-PageRenderer; PTST requires `/version` | 100 / hard |
| `GL` | Shape-checked named Phantom/Nightmare/DOM automation/Selenium globals, document `$cdc_`/`$wdc_` caches, narrow window `cdc_…_(Array\|Promise\|Symbol\|Object\|Proxy\|JSON\|Window)` | 100 / hard |
| `PW` | Exact `__playwright__binding__`, `__playwright__binding__controller__`, `__pwInitScripts` with function/object shape; initial and final | 100 / hard, feature-dependent |
| `CA` | Previous final automated class | 100 / inherited |
| `G0` | Both dimensions zero for screen, viewport or outer size; only visible, focused, top-level; rechecked final | 1 / geometry |
| `GS` | 800×600 screen or 1280×720 screen equal to viewport | 1 / geometry |
| `LA` | Empty/missing languages AND no language/userLanguage/browserLanguage/systemLanguage fallback | 1 / language |
| `PL` | Desktop Chromium-compatible empty plugins; excludes mobile/touch iPad, known WebView/in-app UA, pdfViewerEnabled false | 1 / plugins |
| `WG` | No WebGL, or exact software-renderer token SwiftShader/llvmpipe/softpipe or exact Mesa OffScreen; no broad Mesa/ANGLE match | 1 / graphics |
| `CH` | Desktop Chrome-compatible UA plus Chromium brands, window.chrome missing; excludes mobile/known embedded UA | 1 / chrome |
| `NP` | Secure top-level Chromium, supported denied/prompt notification mismatch, successful async query | 1 / permissions, final only |
| `HC` | Missing/zero hardwareConcurrency | 0 / debug only |
| `NI` | No trusted interaction after a full 8000 visible ms | 2 / interaction |
| `FN` | At least 3 pageviews connected by consecutive positive intervals <2000 ms (2 intervals for count 3) | 3 / navigation |
| `SY` | Synthetic pointer input occurred, no trusted input of **any** accepted modality | 2 / interaction |

Accepted activity: mousemove, pointerdown, touchstart, scroll, keydown, wheel. A trusted key or scroll prevents both NI and SY; trusted events can also be generated by automation. NI and SY never add beyond 2 together. Reading quietly scores 2; rapid navigation plus inactivity scores 5 and remains human unless another environment family raises the score to 6. Scenario 7 may legitimately slip through. Weights are research proposals, not empirically tuned results; do not increase them to force that bot to pass.

Raw UA, renderer strings, dimensions, property names and event objects are not persisted or exported. Global scans inspect property descriptors rather than invoking arbitrary getters and discard the name list. WebGL is reduced to a boolean and its context released; a missing debug-renderer extension scores zero. Failures/unsupported APIs are unknown. Permission queries never prompt, never delay final, and late results are ignored. Blocked storage removes FN/carry signals but not either output phase.

FN validates finite ordered timestamps, rejects future/duplicate entries, keeps at most 20 and requires positive rapid intervals. Duplicate script insertion is guarded in memory; reload and history restoration do not append. A new document's same-URL navigation reported as ordinary `navigate` cannot be distinguished from other navigation using the permitted timestamp-only storage; URLs/identifiers are not stored. This limitation can still affect rapid-navigation evidence.

## Scenarios and control methodology

The runner includes both Chromium headless shell and new headless (`channel: 'chromium'`), headed Chromium, Firefox, WebKit, Chromium stealth, headed Chromium with webdriver disabled and rapid DOM clicks without pointer input, plain fetch and a ChatGPT-User override. Human controls use desktop Chrome, Pixel 7 and iPhone 15 emulation, trusted input, and deterministic 2.4/3.6 second waits between pages. Initial and final must be human on **all three pages** for a control PASS.

Chromium controls use `--disable-blink-features=AutomationControlled` and `playwright-extra` with `puppeteer-extra-plugin-stealth`. WebKit does not accept Chromium flags or that stealth plugin: its control explicitly overrides only `Navigator.prototype.webdriver` before page code. This is a test simulation of a non-WebDriver WebKit, not evidence about a physical iPhone. No detector output or other signal is patched. Touch controls use trusted touch taps and wheel scrolling. The report documents this deviation.

Exact automation globals are conditional artifacts, not promises of what Playwright always inject. The natural scenarios report only signals actually observed; separate injected contract checks validate named-marker matching without counting these as natural detections. The nonexistent assumed `__puppeteer_evaluation_script__` global and arbitrary `__playwright*` prefixes are deliberately ignored. Puppeteer is not one of the requested engines and is not independently tested. PW candidate collisions against clean real-browser baselines remain unverified because the browser scenarios were skipped.

Browser/channel selection and emulation follow the official [Playwright browser documentation](https://playwright.dev/docs/browsers) and [emulation documentation](https://playwright.dev/docs/emulation).

## GTM / GA4 setup

1. Run `npm run build` after source changes. This checks ES5 syntax, warns if the detector exceeds the 5,000-byte target, and regenerates `gtm/custom-html.html` from the same source. Copy the entire generated HTML into a **Custom HTML** tag. Keep `debug: false` in production.
2. Fire on **Initialization – All Pages**. In the tag's consent settings add the required additional consent **analytics_storage**. Establish consent beforehand using Consent Initialization and your consent manager. GTM consent checks gate firing; this script does not check consent itself. If consent arrives later, configure a consent-granted event to run the tag then; GTM does not automatically replay every blocked tag. The duplicate-load guard prevents duplicate classification.
3. Create Data Layer Variables (Version 2) for `traffic_class`, `traffic_phase`, and optionally `traffic_score`. For a custom data layer name, configure the GTM container snippet consistently.
4. Create a **Custom Event** trigger named `traffic_class`. Attach a **GA4 Event** tag with event name `traffic_class` and parameters `traffic_class`, `traffic_phase`, and optionally `traffic_score` mapped to those variables. Send both phases intentionally. Set the GA4 **user property** `traffic_class` from the same variable on this event tag; it updates when final changes the class. Register event-scoped custom dimensions for class/phase and a user-scoped custom dimension for that user property in GA4 as needed.
5. For conversion tags, add trigger exceptions with conditions `traffic_class` matches `^(declared_agent|automated|suspicious)$`. Exception event types must match the tag's normal firing event: use All Pages/pageview exceptions for pageview tags, and Custom Event exceptions matching each conversion event for event tags. Ensure classification has run before the conversion trigger. A `traffic_class` exception alone cannot block a tag firing on an unrelated event. Preview these timings and consent paths in Tag Assistant.
6. Initial filtering cannot use later behaviour. To filter conversions using final, defer their triggering until final classification and retain the conversion intent in your integration. This library does not queue/replay conversion events. A final update cannot retract an earlier GA4 event. Avoid delaying critical measurement solely for a heuristic result.

Do not send debug signal codes to production analytics. The user property is the last observed class for a user, whereas the event parameter describes a particular phase; use event parameters for visit-level analysis.

## Limits

Real logged-in Chrome operated by an agent may look human. UA/global spoofing and stealth can evade detection. Fetch/curl never execute the script and therefore never create client GA4 classification events. Accessibility tools, virtual machines, privacy settings, real fast navigation and idle readers can resemble weak automation evidence. No false-positive rate is established by the synthetic controls alone.

`pagehide` updates the data layer, but unloading may prevent GTM/GA4 from delivering a request; use normal analytics delivery mechanisms and do not assume final events always arrive. Hidden pages can remain initial indefinitely until visible or pagehide. Crashes/termination may never emit pagehide. Blocked sessionStorage, cross-origin navigation, and a new tab can remove session history. A carried automated class persists within the tab until a later final class changes it (hard carry means it normally remains automated). Namespaced globals can collide with unrelated code. Only enable debug for local inspection.

No commits or pushes are part of the build/test commands.


## Extended tests and BotD benchmark

```sh
npm install
node test/run.mjs --repeat 3
node test/run-extended.mjs --repeat 3
```

`--repeat N` defaults to 1 in both runners; every repetition gets a fresh browser/context. The original report stays at `test/results/report.md/json`; the additional suite writes `test/results/report-extended.md/json`. A single run cannot establish stability. Reports flag changes in verdicts, per-page classes, fired signals or BotD outcomes as flaky; raw timing differences alone do not count as flaky. JSON retains every repetition, page event and all 20 performance samples. Run these commands on a desktop that allows headed browser launch; background visibility and the headed Firefox control require it. Missing launch support is SKIP. Detector mismatches remain FAIL, including stealth misses; weights are unchanged.

The extended suite covers keyboard-only and passive 12-second readers, rapid real mouse clicks, headed Firefox with webdriver masked, explicitly disabled PDF/plugins, disabled WebGL, a confirmed 15-second hidden tab, reload/history navigation, Android tablet and 360×640 phone emulation, blocked sessionStorage, masked-UA and stealth bots, declared Claude/Google agents and Lighthouse. PDF/plugin and storage overrides are test-only and checked for effective application. Reload/back-forward must not fire FN; hidden time must not finalize the detector. An environment that cannot hide a background tab, or cannot execute the rapid sequence within ~3 seconds, is marked SKIP rather than claiming the fixture ran.

Additional checks measure the median of 20 fresh source evaluations in new desktop iframe windows (strictly <5ms), require both phases without G0 inside a zero-size iframe, and require exactly one initial/final after double script inclusion. Each timed sample includes source parse/eval and synchronous probes, excludes iframe setup, BotD and cleanup, and cannot reuse the detector's duplicate-load guard. Inline-blocking CSP is explicitly SKIP. The performance cleanup's synthetic pagehide is outside timing; ordinary visit tests use real navigation/pagehide.

`@fingerprintjs/botd` is a devDependency. Only the opt-in test module `test/site/benchmark.js` loads it, from the local server's narrowly mapped `/vendor/botd.js` route. It calls `load({monitoring: false})`, retaining only `bot` and `botKind`; no BotD components or fingerprints are logged or persisted. This uses the [official BotD load API](https://github.com/fingerprintjs/BotD/blob/main/src/index.ts). Both runners invoke BotD once after reading our last-page classification so it cannot influence that visit's measured result or slow rapid navigation. BotD results are comparison evidence, not ground truth, and are not folded into our verdict. Benchmark load/detection failures are recorded separately and make the command exit nonzero. Fetch clients have no BotD result (`NO_JS`). The detector, generated GTM HTML and source weights are untouched by the benchmark.
