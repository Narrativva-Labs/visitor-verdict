# Tests, benchmarks and limits

## Tests and observed results

Use Node.js 20 or 22:

```sh
npm ci
npx playwright install chromium firefox webkit
npm run build
npm test
node test/fuzz/run.mjs --runs 1000
node test/run.mjs --repeat 2
node test/run-extended.mjs --repeat 2
```

Install Google Chrome for channel-Chrome and CDP cases. Headed scenarios need a desktop/display (or suitable Xvfb on Linux). `TRAFFIC_CHROME_EXECUTABLE` can point the CDP harness at another Chrome installation. `npm run serve` starts the local debug site at `http://127.0.0.1:8787`; `PORT` overrides it.

The base suite navigates index → page2 → page3 and stays about 10 seconds on the last page. Clean controls use plain Chrome/Chromium with the native automation flag disabled, no stealth or navigator masking, multi-step mouse approaches or touch, and 2.4/3.6-second inter-page waits. Every page must be human in both phases. Stealth with human-like behaviour is a separate informational category, never a clean human control. Mobile controls are emulation, not physical-device validation; engine/launcher restrictions and incomplete runs are recorded separately from classifications.

The extended suite covers readers, keyboard input, rapid navigation, disabled PDF/WebGL, hidden tabs, history/reload, denied storage, UA switching, rested/repeated clicks, worker CSP, duplicate inclusion, frame no-op behaviour, opt-in defaults, one-document carry, voice-like clicks, assistive warp patterns and real Chrome over CDP. Deterministic contracts check signal semantics and lifecycle, including positive-jump TP, weighted/decaying TR, provenance consumption, storage merges, configuration validation, accessibility activity and storage failure. CDP tests start their own empty temporary Chrome profile; they do not attach to your logged-in browser. BotD comparison runs only in the test harness after our result, with monitoring disabled; it is not ground truth or a runtime dependency.

## v1.2.0–v1.4.1 status and current build size

- **Current minified size (v1.4.1):** **21,168 bytes (~21.2 KB)** (`dist/visitor-verdict.min.js`, before the configuration/HTML wrapper).
- **Additions since v1.1.0:** `finalOnHidden` and one-document `CS` carry (1.2.0); WebMCP informational fields `traffic_webmcp` / `traffic_webmcp_count` and the versioned signal registry (1.3.0); experimental Claude in Chrome 1.0.107 host-shape check `DH` (`traffic_agent_claim: 'dom_host'`) and final-only form-interaction signals `BT`/`UC` (1.4.0); guarded UC/BT input evidence, WK/UB corroboration fixes, identity clearing, B7 current-class precedence and removal of the GTM user property (1.4.1).
- **Verification status:** deterministic detector/runner/registry contracts and seeded fuzz invariants were extended for 1.2.0–1.4.1; owner-run lab observations for `DH`/`BT`/`UC` are recorded in [research/claude-host-experiment.md](../research/claude-host-experiment.md); controlled ground-truth pilot runs (conducted on 1.1.0) are recorded in [test/validation/results/2026-11-22/summary.md](../test/validation/results/2026-11-22/summary.md). The full adversarial benchmark, extended browser suite and local execution-latency measurements below have **not yet been re-run** on 1.2.0–1.4.1.

## v1.1.0 agent UI marker checks (2026-11-22, macOS)

| Check | Result |
|---|---|
| Build | ES5 source/output validation passed; historical v1.1.0 minified detector **15,478 bytes** (~15.5 KB, +1,739 bytes over 1.0.1 for markers, watcher, agent phase, operator and split provenance). |
| Detector contracts | **100/100 for source and 100/100 for generated minified output**, including 11 marker contracts: marker at load (stored at initial), marker 2 s after load (one `agent` event, replaced snapshot, final `declared_agent`), marker after final, exact IDs and parents (`-inner`, sidebar root, wrong parent, null parent without `body` stay human), missing/throwing DOM APIs, operator carried once via CD and renewed before final, `automated` precedence without an operator, the WebDriver page → carried-`CA` page with a marker or UA token → next page `declared_agent` (never `automated`) chain, observer scope (root and `body` child lists only, `body` attached when it appears, late `id`, 32-watch cap), a marker added by a consumer of the initial push, and no observer without a `pagehide` listener. GTM contracts cover `VV - agent`, `traffic_agent` mapping and stable object IDs. |
| Runner contracts | **7 checks passed**. |
| Fuzz invariants | **3,176 cases and 1,176 with `--runs 1000`, zero failures** on an idle machine and with `--timeout 400` under load; marker schedules (start, late, after final, decoys, without `MutationObserver`), carried `automated` plus markers (no direct `automated` may be stored), `traffic_agent` only with `declared_agent`, forged operators in storage. Under heavy machine load (load average 6 to 9) the default 100 ms per-document budget produced a few timeouts that did not reproduce on replay; the 1.0.1 source showed the same timeouts in the same conditions. |
| Base browser suite | **18 PASS, 4 INFO** (known limits and stealth), iPhone WebKit note-only; human controls unchanged. Marker scenarios on synthetic markers in headed Chromium: M1 Claude marker at load (`declared_agent`/`anthropic` in both phases, carried to page 2 via CD), M2 OpenAI overlay and M2b Claude cursor injected after 2 s (`initial human` → `agent declared_agent` → `final declared_agent`, carried), M3 similar IDs and sidebar root stay `human`, M4 headless automation stays `automated` without an operator, M5 a planted direct `automated` record plus the OpenAI overlay: page 1 `automated` (CA), page 2 `declared_agent`/`openai`, not `automated`. |

Synthetic markers test the detector's handling, not that a given agent release injects them. The OpenAI overlay ID was confirmed in the ChatGPT desktop app's Chrome plugin code; in v1.1.0, Claude in Chrome 1.0.107 hid its UI in a closed shadow root and was **not** detected (v1.4.0 later added the experimental `DH`/`dom_host` host-shape check; see above). The extended suite was not rerun for 1.1.0.

## v1.0.0 verification and earlier browser observations

The v1.0.0 hardening pass recorded the following deterministic results:

| Check | Result |
|---|---|
| Build | ES5 source/output validation passed; minified detector **13,739 bytes** (~13.7 KB). |
| Detector contracts | **83/83 for source and 83/83 for generated minified output**. Includes frozen/replaced snapshots, reentrancy, duplicate loads, poisoned globals, callable-only automation names, hard/declaration precedence, storage bounds, readiness triggers, DLV mappings and template permissions/behaviour. |
| Runner contracts | **7 checks passed**. |
| Fuzz invariants | **3,145 cases, zero failures**, seed `20261118`, 100ms/document budget. Storage/output/configuration/lifecycle and immutability invariants; not detection accuracy. |
| Fuzz self-test | **8/8 injected faults detected**, including infinite-loop and mutable-snapshot fixtures. |
| v1 browser rerun (macOS, Google Chrome installed) | Base suite **12/12 PASS**. Extended suite **44 PASS, 2 FAIL, 3 SKIP**: FAIL 25 (stealth fast navigation without input, known limit) and FAIL 33 (headed, webdriver flag disabled, locator navigation; ended `human` with FN, GS, TP, TR, below threshold — it was `suspicious` in an earlier run, so it is a borderline, timing-dependent case); SKIP 16, 19, C4 (environment limits, not passes). Chrome-channel cases: masked headless with CDP UA override (24b) `suspicious`, CDP-driven real Chrome agent (35) `suspicious`, real headed Chrome with natural approach (35b) and fullscreen Chromium (31b) `human`. |
| GTM template | Local structure, permissions and variable behaviour checked. Authenticated Template Editor import not yet verified. |

Earlier local runs, before the v1 hardening pass, observed no synthetic human control classified non-human and median execution of **~3 ms default / ~7 ms with worker and WebGL enabled**. These are historical local observations, not new v1 measurements or guarantees for other devices/pages. Scripted controls and emulation are not real people or physical-device validation. No real assistive technology was tested; the voice-like fixture is not representative of real voice-control behaviour.

Those controls covered desktop, Pixel 7, iPhone WebKit, keyboard-only navigation, passive reading, rapid clicks followed by reading, a rested cursor, same-spot clicks, Enter navigation, a UA switcher, Android tablet/phone emulation, PDF disabled, WebGL disabled, and reload/back-forward. Some launcher/engine configurations cannot supply a clean control and must be recorded as limitations. These observations do not establish a population false-positive rate. Earlier CDP-driven Chrome without mouse paths became suspicious on later pages; TR still has no initial effect.

The [field-validation protocol](study/protocol.md) is in progress and has no study results yet. It checks deployment, coverage and clear automation with a small real-device panel and canaries; it makes no accuracy guarantee. See the [roadmap](../ROADMAP.md).

### Adversarial benchmark

The v1.0.0 benchmark ran on macOS against the local test site in two modes: each tool's **default clicks**, and **human-like input** using curved mouse paths with pauses. Classes are for the last page (final phase). These are observed outcomes for the tested versions/configurations, not permanent properties of the tools.

| Tool | Default clicks | Human-like input |
|---|---|---|
| Selenium, headed and headless | `automated` | `automated` |
| rebrowser-puppeteer | `automated` | `automated` |
| puppeteer-real-browser | `automated` | `automated` |
| Puppeteer + stealth | `suspicious` | `human` |
| Patchright | `human` | `human` |
| undetected-chromedriver | `human` | `human` |
| nodriver | `human` | `human` |
| Camoufox | Could not launch on macOS (browser launch timeout) | Could not launch on macOS (browser launch timeout) |

The earlier, pre-hardening benchmark gave the same classes, except that nodriver's default mode ended in an execution error.

A failed run or launch gives no classification result and is not a detection pass. The misses show that patched browsers and natural input can evade the detector. Stealth with only benign signals can also end human under the conservative scoring rule.

To reproduce the adversarial benchmark from the repository root:

```sh
bash test/adversarial/setup.sh
bash test/adversarial/run-all.sh
```

The runner's Python venv defaults to **`test/adversarial/.venv`**; override it with **`TC_ADV_VENV`**. It needs the tool/browser dependencies and a desktop session for headed runs. It owns the local server on port 8787, so stop a separately running test server first. See [adversarial usage](../test/adversarial/USAGE.md) for setup and configuration. It writes `test/results/adversarial-report.md` / `.json`, including incomplete runs; it does not grade an observed `human` result as a harness failure.

Run the fuzz checks with `node test/fuzz/run.mjs`; see [fuzz methodology](../test/fuzz/README.md) for seeds, replay and invariant coverage. The report is `test/results/fuzz-report.md`.

The browser runners write `test/results/report.md` / `report.json` and `report-extended.md` / `report-extended.json`, with per-page events, signals, versions, errors and repetition/flakiness evidence. Results and logs are local generated artifacts. Missing setup/launch is SKIP; incomplete execution is ERROR; neither counts as a detection pass. Browser-suite mismatches and relevant errors/skips produce a nonzero exit. The test-only `/log` sink appends event JSON lines to `test/results/log.jsonl`. `test/live.mjs` is an optional check against a separately deployed demo, not part of the local release checks.

## Manual human lab

For manual input in a fresh Chrome profile, run `npm run serve` and, in another terminal, `node test/human-lab.mjs http://127.0.0.1:8787`. The lab observes `window.__visitorVerdict`, debug codes from data-layer events and versioned output; it does not synthesize input. Its local logs include page URLs, so use synthetic pages and keep logs private. See [contributing](../CONTRIBUTING.md) for setup. Neither this tool's existence nor a scripted control is evidence of completed field validation.

## Browser support, size and limits

The detector uses ES5 syntax and no runtime dependencies. It targets modern Chrome/Chromium, Firefox, Safari/WebKit and mobile browsers with standard DOM events and JSON APIs. ES5 syntax is not a promise of legacy Internet Explorer support. Optional workers, permission queries, UA Client Hints and WebGL extensions are feature-detected; CSP-blocked workers lose WK/worker-HL evidence. Sites must permit the Custom HTML script under their CSP.

The current v1.4.1 minified detector (`dist/visitor-verdict.min.js`) is **21,168 bytes (~21.2 KB)** before the configuration/HTML wrapper (historical snapshots above: v1.0.0 was 13,739 bytes, v1.1.0 was 15,478 bytes). It exceeds the original 5 KB target; the build reports this warning and validates source/output as ES5.

Tools with natural input or patched browsers can end `human`, as the adversarial results show. Stealth with only benign signals can also end `human`; the detector favours conservative classification over catching every bot. Client-side detection is spoofable. Declared tokens can be spoofed and are never authenticated; JS-less fetchers never run the detector. `human` means no sufficient evidence, and a missing event means **unknown**, not human. Privacy tools, accessibility input, VMs and unusual browser settings may resemble weak signals. Global names are conditional implementation artifacts, not permanent framework signatures. Direct evidence can keep a subsequent human takeover classified automated for one following document via CA; CA alone cannot perpetuate it.

A hidden page may remain initial until it becomes visible or unloads. `pagehide` updates the data layer but delivery to GA4 can be lost during unload; crashes may never emit final. Cross-origin navigation, new tabs and denied storage remove history. Repeated same-URL ordinary navigations cannot be distinguished using timestamps alone. TP/TR describe input patterns, not agent reasoning or malicious intent.


For the released public interface and its same-realm poisoning limits, see [hardening](how-it-works.md#hardening-and-its-limits). Hard evidence takes precedence over declared tokens in v1; historical tool labels must not be treated as a guarantee for every current version/configuration.
