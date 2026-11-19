# Visitor Verdict

Visitor Verdict classifies browser visits locally as `declared_agent`, `automated`, `suspicious`, or `human`. It pushes an initial result and a later behaviour-based result to a data layer for Google Tag Manager (GTM) and Google Analytics 4 (GA4). It has no runtime dependencies and creates no identifier or fingerprint; the detector makes no requests itself, but if CSP blocks its optional Blob worker the browser may send a CSP violation report to the site's endpoint.

| Class | Meaning |
|---|---|
| `declared_agent` | The user agent claims a configured agent, fetcher or crawler identity. Tokens are claims, not verification. |
| `automated` | Hard browser automation evidence, or one document of carry-over from a previous direct hard/declared result in this tab. This does not establish intent or AI use. |
| `suspicious` | Uncertain weighted evidence meeting the score, family and evidence-quality requirements below; repeated teleport history is one weighted signal. |
| `human` | No automation detected; not proof of a person. |

## How it works

The **initial** phase runs synchronously using environment signals and permitted tab history, once the document is active. Frames return without probing, publishing, installing state or touching storage; prerendered documents defer observation until activation. The **final** phase adds behaviour and completed asynchronous probes after 8 seconds of visible time, or on `pagehide`, whichever comes first. Hidden time pauses the timer; early navigation does not count as eight seconds without input. Final fires once per document; initial declared/automated classes retain precedence.

Precedence is declared → hard/inherited automation → suspicious → human. The suspicious rule requires all of:

1. **Score ≥ `suspiciousThreshold` (default 6)**.
2. **At least three distinct positive-weight families**.
3. At least one non-benign signal family (pointer via TP/TR, worker via WK, or explicitly synthetic input SY), **or** at least two distinct environment families plus behaviour (interaction or navigation). Environment families are geometry, language, plugins, graphics, chrome and permissions. NI alone is not the non-benign interaction evidence; SY is.

“Non-benign” names a heuristic category, not a judgement about the visitor. Each family contributes its highest weight: geometry is capped at 2 (HW=2, G0/GS=1), worker at 6 (UB=6, WK=2), graphics at 1, NI/SY together at 2, and TP/TR together at 3. Hard, declared and inherited results use sentinel score 100; scores are not probabilities. Quiet reading alone scores 2; fast navigation plus inactivity scores 5. FN+NI+WG or FN+NI+GS scores 6 across three families but still remains human, because it has only one environment family and no TP/TR/SY/WK. FN+NI+GS+WG qualifies at 7 with two environment families plus behaviour. TR never bypasses these requirements or affects initial classification. UB directly yields suspicious at final without the ordinary score/family gate; declared and hard evidence retain precedence. HW remains benign: HW+FN+NI alone stays human.

Duplicate inclusion is ignored. BFCache restoration retains the document's state and does not emit a second final. Reload/history navigation does not append pageview timestamps. SPA route changes do not restart detection.

### Signals

Weights below are the implemented defaults. Missing or blocked optional APIs are unknown rather than positive evidence; genuinely unavailable WebGL has the explicit weak WG weight.

| Code | Evidence and safeguards | Weight / family |
|---|---|---|
| `AG` | Boundary-matched configured agent token | 100 / declared |
| `WD` | navigator.webdriver strictly true | 100 / hard |
| `HL` | HeadlessChrome in main UA/synchronous brands or opt-in dedicated worker UA (worker result final only); no high-entropy request | 100 / hard |
| `AU` | Bounded PhantomJS, Chrome-Lighthouse, Lighthouse, GTmetrix, Google-PageRenderer; PTST requires `/version` | 100 / hard |
| `GL` | Shape-checked named Phantom/Nightmare/DOM automation/Selenium globals, document `$cdc_`/`$wdc_` caches, narrow window `cdc_…_(Array\|Promise\|Symbol\|Object\|Proxy\|JSON\|Window)` | 100 / hard |
| `PW` | Exact `__playwright__binding__`, `__playwright__binding__controller__`, `__pwInitScripts` with function/array/plain-object shape, excluding DOM/host objects and window proxies; initial and final | 100 / hard, feature-dependent |
| `CA` | Previous final direct hard/declared evidence, consumed for one following document only; plain class strings do not qualify | 100 / inherited |
| `G0` | Both dimensions zero for screen, viewport or outer size; only visible, focused, top-level; rechecked final | 1 / geometry |
| `GS` | 800×600 screen or 1280×720 screen equal to viewport | 1 / geometry |
| `LA` | Empty/missing languages AND no language/userLanguage/browserLanguage/systemLanguage fallback | 1 / language |
| `PL` | Desktop Chromium-compatible empty plugins; excludes mobile/touch iPad, known WebView/in-app UA, pdfViewerEnabled false | 1 / plugins |
| `WG` | Opt-in (`webgl: true`): no WebGL, or exact software-renderer token SwiftShader/llvmpipe/softpipe or exact Mesa OffScreen; no broad Mesa/ANGLE match | 1 / graphics |
| `CH` | Desktop Chrome-compatible UA plus Chromium brands, window.chrome missing; excludes mobile/known embedded UA | 1 / chrome |
| `NP` | Secure top-level Chromium, supported denied/prompt notification mismatch, successful async query | 1 / permissions, final only |
| `HC` | Missing/zero hardwareConcurrency | 0 / debug only |
| `NI` | No accepted activity after a full configured visible window (default 8000 ms); missing isTrusted counts as activity | 2 / interaction |
| `FN` | At least 3 pageviews connected by consecutive positive intervals <2000 ms (2 intervals for count 3) | 3 / navigation |
| `SY` | Explicitly untrusted mousemove/pointerdown/touchstart occurred, with no accepted activity (trusted or missing isTrusted) | 2 / interaction |
| `TP` | Positive >200px mousemove jump followed within 600ms by a trusted mouse click near the jump endpoint and fresh trusted mouse pointerdown; path/rest/repeat safeguards below | 3 / pointer, final only |
| `WK` | Opt-in (`worker: true`): supported UA, webdriver, languages or positive core-count mismatch between main and dedicated worker; unavailable fields ignored | 2 / worker, final only |
| `UB` | Opt-in (`worker: true`): non-empty main UA-CH brands, but an exposed worker userAgentData API has an undefined/null value or empty brands array. Unexposed API, malformed shapes, blocked getters and failed/CSP-blocked workers are unknown | 6 / worker, final only; directly suspicious, never automated alone or CA provenance |
| `HW` | Visible, focused, top-level desktop window: outer and inner dimensions equal screen dimensions on both axes, and available screen equals full screen. Excludes mobile/embedded UAs, document fullscreen and fullscreen/standalone display modes; unknown fullscreen capability is ignored | 2 / benign geometry; ordinary corroboration required |
| `TR` | Remaining `tpPages >=2` at final, after any eligible decay; no initial effect or class override | 2 / pointer, final only; capped at 3 together with TP |

UB can also flag Chrome DevTools-style device emulation or CDP user-agent overrides: these can leave main-thread UA Client Hints brands populated while worker brands are empty, producing `suspicious` even with human input.

Mobile human controls therefore emulate viewport/screen, device scale, mobile layout and touch while retaining the browser's native UA. They do not validate mobile-UA-specific branches or physical-device behaviour. A separate informational scenario deliberately retains the device UA override and expects `suspicious` via UB.

**TP (teleport click)** requires positive jump evidence, not merely missing or sparse movement. A trusted `mousemove` must have a movement delta greater than 200px (Euclidean), or differ by more than 200px from the previous distinct position observed within 600ms. It suppresses jumps in a stream of at least three distinct moves whose successive gaps are at most 120ms. A trusted mouse click must follow within 600ms of both the jump and an explicit trusted mouse pointerdown, land within 2px of the jump endpoint, and be more than 40px from the previous recorded click if one exists. Touch/pen, keyboard activation (`detail: 0`), untrusted input, rested/expired jumps and repeated nearby clicks do not qualify. `mousemove` alone supplies the jump/path evidence, avoiding double counting compatibility pointer events. No trajectory is retained.

**TR (repeated teleport)** uses the decaying `tpPages` counter described below. TP increments it synchronously in click capture before navigation, at most once per observed document, saturating at 255. At final, a document with accepted activity and no TP repays one count, subject to stale-write guards; idle and TP documents do not decay it. TR fires only at final if the remaining count is at least 2. It contributes 2 in the pointer family, capped at 3 together with TP, and uses the ordinary suspicious rule. Repeated history alone never starts a document suspicious. Duplicate inclusion, repeated clicks and BFCache restoration cannot increment again. New/reloaded documents may count separately; no unique-URL claim is possible. Blocked storage leaves page-local TP evidence; repeated clicks in one document cannot create TR alone.

**WK (worker mismatch)**, when enabled, compares supported main/worker user agent, webdriver, languages and positive hardware concurrency values. Missing worker fields are ignored. A worker exposing HeadlessChrome adds hard HL. Worker creation/errors/CSP denial produce no mismatch, and final never waits for the worker. A legitimate main-only UA switcher can also produce WK, so it is weak evidence.

Activity listeners use window capture, falling back to document capture if window lacks a usable add/remove pair, with passive listeners where supported. If input listeners cannot be installed, inactivity is unknown rather than NI evidence. Accepted activity includes mousemove, pointermove, pointerdown, pointerup, touchstart, touchmove, touchend, touchcancel, scroll, keydown, keyup, wheel, click and focusin. Pointercancel clears pointer state but does not count as activity. `isTrusted === true` **or missing `isTrusted`** counts as activity for NI/SY and counter decay; TP requires explicitly trusted events. Accepted activity prevents NI/SY and, without TP, can decay history; it does not erase hard evidence. Trusted input can come from automation.

### Configuration and output

Load `src/visitor-verdict.js` after optionally setting:

```html
<script>
window.trafficClassConfig = {
  idleMs: 8000,
  fastNavMs: 2000,
  fastNavCount: 3,
  suspiciousThreshold: 6,
  debug: false,
  webgl: false,
  worker: false,
  dataLayerName: 'dataLayer'
  // agentTokens: ['your-literal-token'] // replaces the default array
};
</script>
<script src="/src/visitor-verdict.js"></script>
```

`webgl` and `worker` are **opt-in probes, default `false` in the library**; only the boolean `true` enables them. The supplied GTM tag configuration and local test site explicitly enable both for WG, WK and worker-HL coverage. Set `worker: false` if your CSP does not permit `blob:` workers (or you do not want the allocation); blocking can also generate browser CSP reports. Set `webgl: false` on WebGL-heavy pages or where extra contexts risk context limits or GPU resource contention. Disabling either probe reduces evidence and can change classifications; it does not add a signal.

`agentTokens` are **literal strings**, matched case-insensitively with token boundaries; regex metacharacters are escaped. A supplied array replaces the defaults and is truncated to 64 entries; only nonempty strings up to 128 characters are evaluated. The list is maintained in [the source](src/visitor-verdict.js), with historical evidence in [the research notes](research/agents-and-tells.md). It includes AI-associated fetchers and general crawlers; `Google-Extended` is not a UA and is excluded.

Numeric overrides must be finite integers: `idleMs` 1–3,600,000; `fastNavMs` 1–60,000; `fastNavCount` 2–20; `suspiciousThreshold` 1–1,000. Invalid values retain defaults. `dataLayerName` must be a nonempty string of at most 128 characters and cannot be `__proto__`, `prototype` or `constructor`. Boolean options enable only on strict `true`.

Both phases normally push the same fields (a broken/throwing data-layer consumer can prevent delivery while local finalization still completes):

```js
{event: 'traffic_class', traffic_class: 'human',
 traffic_phase: 'initial', traffic_score: 0}
```

`window.__trafficClass` exposes `{class, score, phase}`. With `debug: true`, it adds `signals`, and events add `traffic_signals` containing short codes. Keep debug disabled in production. The state also has a non-enumerable internal duplicate-inclusion marker. Both `window.__trafficClass` and the data layer are readable by any script/tag on the page.

## Privacy and data minimisation

The detector reads these inputs locally (optional probes only when enabled):

- Navigator: `userAgent`, `userAgentData.brands` and each `brand`, `webdriver`, `languages` (length and entries), `language`, `userLanguage`, `browserLanguage`, `systemLanguage`, `plugins.length`, `pdfViewerEnabled`, `maxTouchPoints` and `hardwareConcurrency`. No high-entropy UA-data request is made. The local worker reads `userAgent`, `webdriver`, `languages` and `hardwareConcurrency` too.
- The optional worker additionally checks `userAgentData` property presence and `userAgentData.brands` array shape/length; it returns only a boolean, never brands. Geometry additionally reads `screen.availWidth`, `screen.availHeight`, `document.fullscreenElement` and `matchMedia('(display-mode: fullscreen)' / '(display-mode: standalone)').matches`. No high-entropy UA-data request is made.
- Window/document: `top`, `screen.width/height`, `innerWidth/innerHeight`, `outerWidth/outerHeight`, `document.visibilityState`, `document.prerendering`, `document.hasFocus()`, `isSecureContext`, `chrome`, configuration and existing detector state. It enumerates own window/document property names and reads matching property descriptors and their `value` fields, including `__trafficClass` / `__tcDetector`. Shape checks inspect candidate `window`, `nodeType`, `ownerDocument`, object type and prototypes to reject host/DOM/window objects.
- Automation candidates: window `callPhantom`, `_phantom`, `__nightmare`, `domAutomation`, `domAutomationController`, exact `__playwright__binding__`, `__playwright__binding__controller__`, `__pwInitScripts`, and names matching `cdc_[A-Za-z0-9]+_(Array|Promise|Symbol|Object|Proxy|JSON|Window)`. Document candidates match `__(selenium|webdriver|driver|fxdriver)_(evaluate|unwrapped)`, `__webdriver_script_(fn|func|function)`, `__$webdriverAsyncExecutor`, and `$cdc_` / `$wdc_` prefixes. Names/values are not exported.
- Opt-in WebGL: canvas `getContext('webgl'/'experimental-webgl')`, extension availability through `getExtension`, `WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL` and its renderer via `getParameter`, and `WEBGL_lose_context.loseContext` for cleanup. It draws no fingerprint image or canvas pixels.
- Permissions: `Notification.permission`, availability of `navigator.permissions.query`, and the returned notification permission `state`. It never requests notification permission.
- Timing/history: `Date.now()`, `performance.getEntriesByType('navigation')[0].type` or legacy `performance.navigation.type`, and the stored `timestamps`, `lastClass` (including `value` / `direct`) and `tpPages` below.
- Input: event `type`, `isTrusted`, `pointerType`, `detail`, `clientX`, `clientY`, **`movementX` and `movementY`**. It retains short-lived observation times, a bounded path counter and jump flag, not event objects or a trajectory. It does not inspect event targets, typed keys, text, page content, URLs or browsing destinations.
- Integration/capability checks: configured data-layer availability, `length` and `push`; DOM listener and timer APIs (including passive-option support), `Worker`, `Blob`, `URL` / `webkitURL` and their object-URL methods, worker messaging/termination, worker message `data.m` / `data.h` booleans and error `preventDefault`. These support local execution and cleanup, not additional scoring attributes.

Raw values are reduced to flags locally and discarded after use. Main navigator values pass only to the local worker, whose reply contains booleans; the worker is terminated and its Blob URL revoked. Pointer state is bounded to the latest move/click, timing, jump and small path-count fields and cleared at final; no click trace is collected.

The only detector storage is **one `sessionStorage` entry named `traffic_class`**, containing exactly these three keys:

```js
{
  timestamps: [/* newest fastNavCount pageview times; default maximum 3 */],
  lastClass: '', // class string, or {value: 'automated', direct: true}
  tpPages: 0    // integer 0–255
}
```

- `timestamps`: finite nonnegative nonfuture times, rounded **down to 100ms**, deduplicated, sorted and limited to `fastNavCount` (default 3, configurable up to 20). Reload/back-forward does not append. Writes merge current storage so stale finalizers preserve newer page times.
- `lastClass`: initially an empty string; normally a final class string. A final with direct hard/declared evidence stores `{value: 'automated' | 'declared_agent', direct: true}` instead. **CA consumes that direct provenance at the next document's initial processing**, converting it to a plain string even if that document never finalizes. That document is automated via CA unless declared identity wins. CA alone cannot renew provenance; a second consecutive document without direct evidence has no CA. A legacy/plain `automated` string does not seed CA. Fresh direct evidence on a carried document can renew it. Stale finalizers preserve a newer stored class/provenance.
- `tpPages`: bounded, saturating count of observed TP documents, incremented once per document before navigation. Missing, invalid, noninteger and out-of-range values reset to 0. At final, accepted activity without TP decrements it by one, down to 0; no activity or current TP leaves history undecayed. Decay occurs before checking TR. It is guarded against newer documents, changed class snapshots or changed counters, so stale finalizers cannot repay newer evidence or resurrect a decayed count. It is not a lifetime total, unique-URL count or time-based expiry.

No signals, raw properties, coordinates, URLs or IDs are stored. Storage denial does not stop local classification/output, but removes cross-document history.

There are **no cookies, localStorage, hashes, fingerprints or identifiers** in the detector. **The detector makes no requests itself; if CSP blocks the Blob worker, the browser may send a CSP violation report to the site's endpoint.** Production data-layer output contains only the fixed event name, class, phase and numeric score. Downstream tools such as GA4 attach the result to their own identifiers; in advanced consent-mode setups, an event may reach Google as a cookieless ping before consent. Installing this library does not change those tools' collection, storage or consent settings. The local test site separately posts debug events to `/log` and maintains test-only event history; that instrumentation is absent from the detector and GTM HTML.

The detector writes to `sessionStorage` and reads device/browser properties. [EDPB Guidelines 2/2023](https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf) treat storing/reading such information as within the technical scope of Article 5(3) of the ePrivacy Directive regardless of cookies, including local processing. This project does not assess exemptions; site owners decide the applicable setup with their DPO.

For withdrawal, `sessionStorage.removeItem('traffic_class')` clears the stored local record. It does not erase already-published state, data-layer events or downstream data, and an active detector can write again at TP/final. Integrate withdrawal with gating future loads/analytics and clearing storage after active observation has ended; the detector has no consent listener or stop API.

## Install in GTM

### Import the supplied container

1. In a web container, open **Admin → Import Container** and select [gtm/container-import.json](gtm/container-import.json). Choose a workspace, select **Merge**, and review conflicts and the import preview before confirming. See [Google's import instructions](https://support.google.com/tagmanager/answer/6106997?hl=en).
2. Set the constant **VV - GA4 measurement ID** to your measurement ID instead of `G-XXXXXXXXXX`. Use the site's existing Google tag for that destination, with its normal consent configuration; the import does not create a Google tag or consent manager.
3. Choose one of the consent setups below. The imported detector explicitly has **no additional consent check** and runs on All Pages, once per page, with firing priority 100. The GA4 event tag retains Google's built-in consent behaviour; configure any additional checks according to the chosen setup.
4. Preview with Tag Assistant: expect one initial and one final data-layer event, and one final GA4 event per document when delivery is permitted. Verify the measurement ID, consent paths, delayed consent and page navigation before publishing.

The import creates two tags, five variables and one custom trigger. **traffic_class final** matches custom event `traffic_class` only when `traffic_phase` equals `final`. **GA4 - traffic_class** sends all three fields as event parameters and `traffic_class` as a user property. Its class parameter uses **VV - current class**; the final event remains necessary for coverage, even if no later interaction occurs. The import does not modify the site's existing Google tag or other GA4 event tags: configure them as below.

### Manual installation

1. Create a **Custom HTML** tag named **VV - detector** and paste all of [gtm/custom-html.html](gtm/custom-html.html), including its configuration block. Keep `debug: false` and review the explicit `webgl: true` / `worker: true` opt-ins described above.
2. Use **All Pages (Page View)**, **Once per page**, priority **100**. Do not use Initialization: on sites that push an event before their consent default, Initialization can run with consent unset. Set consent defaults in the site's consent integration before All Pages; priority orders tags on the same event and cannot repair an earlier consent race.
3. Create Version 2 Data Layer Variables named `traffic_class`, `traffic_phase` and `traffic_score`, each reading the identically named key. If using a custom data-layer name, configure the GTM snippet consistently.
4. Create Custom Event trigger **traffic_class final**: event name `traffic_class`, condition `{{traffic_phase}}` equals `final`.
5. Create constant **VV - GA4 measurement ID**, then a **Google Analytics: GA4 Event** tag named **GA4 - traffic_class**. Set measurement ID to that constant and event name to `traffic_class`. Map event parameter `traffic_class` to `{{VV - current class}}`, and `traffic_phase` / `traffic_score` to their data-layer variables; under User Properties map `traffic_class` to `{{traffic_class}}`. Use the final trigger and the site's existing Google tag destination.

6. Create **Custom JavaScript** variable **VV - current class** (included in the import). It reads the current page first, then the previous stored class, and returns undefined for missing/invalid data or blocked storage. It never writes storage:

```javascript
function() {
  var c;
  function valid(v) {
    return typeof v === 'string' && /^(human|suspicious|automated|declared_agent)$/.test(v);
  }
  try {
    c = window.__trafficClass && window.__trafficClass['class'];
    if (valid(c)) { return c; }
  } catch (e) {}
  try {
    c = JSON.parse(window.sessionStorage.getItem('traffic_class') || '{}').lastClass;
    if (c && typeof c === 'object') { c = c.value; }
    if (valid(c)) { return c; }
  } catch (e) {}
  return undefined;
}
```

7. On **every Google Analytics: GA4 Event tag** (`gaawe`), add event parameter **traffic_class = `{{VV - current class}}`**. The variable is evaluated when that tag fires. Audit ecommerce, click and other event tags; adding it only to the dedicated classification tag does not cover them.
8. Optionally add the same parameter under the existing **Google tag → Shared event settings** (through its event settings variable). This is evaluated once when the Google tag fires, usually Initialization, before the detector runs. It supplies the previous page's stored class to automatic events from page 2; it does not refresh with later detector phases. Verify actual event requests in Tag Assistant/DebugView.

**CSP-safe variable alternative:** sites without `unsafe-eval` can create a **JavaScript Variable** (GTM type `j`, not Custom JavaScript) named **VV - current class (page only)** with **Global Variable Name = `__trafficClass.class`**. Substitute it in the event tags and optionally shared settings. It reads the current page only and has no storage fallback, so an Initialization Google tag will normally receive no value. Do not weaken CSP just for the fallback; [Google documents Custom JavaScript's CSP limitation](https://developers.google.com/tag-platform/security/guides/csp).

### Choose when it runs

The script does not read consent. Running it before consent is a decision for the site owner together with their DPO; these are configuration options, not legal advice.

- **After analytics consent:** require additional consent `analytics_storage` on both the detector and GA4 event tag. Keep All Pages for already-granted consent and add your CMP's consent-granted custom event as another detector trigger for later grants, after the consent update has taken effect. Blocked All Pages tags are not automatically replayed. The once-per-page setting and duplicate guard prevent a second run. Observation begins when the detector actually loads. If consent is later withdrawn, the already-loaded detector continues local observation; GTM consent checks gate the GA4 event at firing time.
- **Before consent:** leave the detector's additional consent setting at **No additional consent required**, on All Pages. Configure consent defaults and updates through the CMP, and retain the Google tag's built-in consent checks for any permitted cookieless analytics delivery. A local class result does not grant consent. Keep pre-consent classification out of advertising tags, remarketing and ad-platform exports.

Google describes [built-in versus additional consent checks](https://support.google.com/tagmanager/answer/10718549?hl=en); requiring additional consent blocks firing rather than simply changing the request format.

### GA4 integration and reporting

The working integration maps **traffic_class = `{{VV - current class}}` on each GA4 event tag**, evaluated at that tag's firing time. Initial/final detector updates are then available to later tagged events. Events sent before the detector can use only the storage fallback; the first `page_view` of a session is typically unlabelled. The earlier global-command approach failed in live testing with GTM's Google tag and must not be used.

Automatic Google-tag events (`page_view`, `user_engagement`, enhanced-measurement scroll) use shared event settings evaluated once at Google tag Initialization. With the optional storage fallback they can carry the **previous page's class from page 2**, not the current page's later initial/final result. Storage denial or the CSP-safe page-only variable removes that fallback. Automatic and explicitly tagged events therefore have different timing semantics. Sites without GA4 event tags rely on the dedicated final `traffic_class` event plus the last-observed user property; shared settings can only add the limited automatic-event coverage above. No configuration backfills earlier events or guarantees a label on every event.

Keep **GA4 - traffic_class** on final, with explicit class/phase/score parameters and its user property: it records coverage even without subsequent events. Never mark `traffic_class` as a key event. The user property means **last observed class**, applies from set time, can persist into later visits, and is not a stable visitor attribute. Never use it for session exclusion or backfill earlier events from it. Collection and conversions remain enabled; the detector cannot retract events.

In **Admin → Data display → Custom definitions**, create:

| Display name | Scope | Field |
|---|---|---|
| Traffic class (event) | Event | Event parameter `traffic_class` |
| Traffic class (user — last observed) | User | User property `traffic_class` |
| Traffic phase (event), optional | Event | Event parameter `traffic_phase` |

Register `traffic_score` as a custom metric only if needed. Score is a heuristic, not a probability.

| Stored value | Reporting label and interpretation |
|---|---|
| `human` | **No automation detected**; not proof of a person |
| `suspicious` | Uncertain evidence; show separately for review |
| `automated` | Automation evidence; does not establish intent or abuse |
| `declared_agent` | Unverified identity claim; tokens can be spoofed |
| Missing | Unknown; never silently treat as human |

Use these session views, scoped to the web stream and the same date range:

- **All sessions**: baseline including unknown coverage.
- **Sessions excluding detected automation**: exclude the whole session if any event carries `automated` or `declared_agent`. Keep unknown sessions; show suspicious sessions separately within this retained traffic.
- **Stricter sensitivity view**: additionally exclude sessions containing `suspicious`.
- **Observed human-only cohort**, diagnostic only: at least one `human` observation and no automated, declared or suspicious observations. It selects measurable, labelled visits and misses unknown traffic.

Exclusion preserves unlabelled sessions and their earlier pageviews/purchases while removing sessions with observed evidence. “Only human” would bias the headline toward visits with successful classification and delivery. Always show coverage: sessions with any valid class versus sessions without, plus missing-ID pings separately. A later human label never cancels earlier automation evidence in that session.

Headline purchase conversion rate = **purchasing sessions / sessions in the same cohort**. Do not mix filtered purchasers with all-session denominators; do not count `add_to_cart` as headline conversion. Show excluded purchase revenue separately. Removing low-converting bot sessions can raise CR by arithmetic; it does not demonstrate marketing improvement.

For GA4 UI steps use [Explorations and comparisons](docs/analysis/ga4-explorations.md): create a **Session segment** including all web-stream sessions, then exclude sessions where a `traffic_class` event has class `automated|declared_agent` **OR any event has that event parameter**. Keep name and class conditions on the same event; event name alone must not exclude all classified sessions. Standard-report comparisons on the event-scoped dimension are scoped label comparisons, not reliable whole-session exclusions; never use the user property as a shortcut. [BigQuery SQL](docs/analysis/bigquery.sql) supplies session flags, first/last evidence, class at first purchase and consistent cohorts; [Looker Studio](docs/analysis/looker-studio.md) uses those session aggregates.

**Do not use the class to block access, deny service or make decisions about individuals.** Assistive technology can resemble some input patterns. Leave conversion collection running while reviewing evidence. Any tag exception must match that tag's own firing event and have a class available then; a `traffic_class` exception cannot block an unrelated conversion event. Pre-consent classification must never feed advertising platforms.

## Tests and observed results

Use Node.js 20 or newer:

```sh
npm install
npx playwright install chromium firefox webkit
npm run build
npm run test:contracts
node test/run.mjs --repeat 2
node test/run-extended.mjs --repeat 2
```

Install Google Chrome for channel-Chrome and CDP cases. Headed scenarios need a desktop/display (or suitable Xvfb on Linux). `TRAFFIC_CHROME_EXECUTABLE` can point the CDP harness at another Chrome installation. `npm run serve` starts the local debug site at `http://127.0.0.1:8787`; `PORT` overrides it.

The base suite navigates index → page2 → page3 and stays about 10 seconds on the last page. Clean controls use plain Chrome/Chromium with the native automation flag disabled, no stealth or navigator masking, multi-step mouse approaches or touch, and 2.4/3.6-second inter-page waits. Every page must be human in both phases. Stealth with human-like behaviour is a separate informational category, never a clean human control. Mobile controls are emulation, not physical-device validation; engine/launcher restrictions and incomplete runs are recorded separately from classifications.

The extended suite covers readers, keyboard input, rapid navigation, disabled PDF/WebGL, hidden tabs, history/reload, denied storage, UA switching, rested/repeated clicks, worker CSP, duplicate inclusion, frame no-op behaviour, opt-in defaults, one-document carry, voice-like clicks, assistive warp patterns and real Chrome over CDP. Deterministic contracts check signal semantics and lifecycle, including positive-jump TP, weighted/decaying TR, provenance consumption, storage merges, configuration validation, accessibility activity and storage failure. CDP tests start their own empty temporary Chrome profile; they do not attach to your logged-in browser. BotD comparison runs only in the test harness after our result, with monitoring disabled; it is not ground truth or a runtime dependency.

The final measured release results are:

| Check | Result |
|---|---|
| Fuzz invariants | **3,088 cases, 0 failures**. VM-based checks of storage, output, configuration and lifecycle invariants; not a detection-accuracy measurement. |
| Contracts | **64 contract checks**, exercised against both source and minified output. |
| Synthetic human controls | **No synthetic human control run was classified non-human**. Controls are scripted; no real assistive technology was tested, and the voice-like scenario is not representative of real voice-control behaviour. |
| Performance | Median **~3 ms** with the default configuration; **~7 ms** with `webgl` and `worker` enabled. These local timings are not a guarantee for other devices/pages. |
| CDP-driven real Chrome agent without mouse paths | Suspicious from later pages; history/behaviour can contribute to final classification, while TR has no initial effect. |

The synthetic human controls covered desktop, Pixel 7, iPhone WebKit, keyboard-only navigation, passive reading, rapid clicks followed by reading, a rested cursor, same-spot clicks, Enter navigation, a UA switcher, Android tablet/phone emulation, PDF disabled, WebGL disabled, and reload/back-forward. These observations do not establish a population false-positive rate or validate real assistive technology.

### Adversarial benchmark

The benchmark ran against the local test site in two modes: each tool's **default clicks**, and **human-like input** using curved mouse paths with pauses. These are observed outcomes for the tested versions/configurations, not permanent properties of the tools.

| Tool | Default clicks | Human-like input |
|---|---|---|
| Selenium, headed and headless | `automated` | `automated` |
| rebrowser-puppeteer | `automated` | `automated` |
| puppeteer-real-browser | `automated` | `automated` |
| Puppeteer + stealth | `suspicious` | `human` |
| Patchright | `human` | `human` |
| undetected-chromedriver | `human` | `human` |
| nodriver | Execution error; unknown | `human` |
| Camoufox | Could not launch on macOS in this run | Could not launch on macOS in this run |

A failed run or launch gives no classification result and is not a detection pass. The misses show that patched browsers and natural input can evade the detector. Stealth with only benign signals can also end human under the conservative scoring rule.

To reproduce the adversarial benchmark from the repository root:

```sh
bash test/adversarial/setup.sh
bash test/adversarial/run-all.sh
```

The runner's Python venv defaults to **`test/adversarial/.venv`**; override it with **`TC_ADV_VENV`**. It needs the tool/browser dependencies and a desktop session for headed runs. It owns the local server on port 8787, so stop a separately running test server first. See [adversarial usage](test/adversarial/USAGE.md) for setup and configuration. It writes `test/results/adversarial-report.md` / `.json`, including incomplete runs; it does not grade an observed `human` result as a harness failure.

Run the fuzz checks with `node test/fuzz/run.mjs`; see [fuzz methodology](test/fuzz/README.md) for seeds, replay and invariant coverage. The report is `test/results/fuzz-report.md`.

The browser runners write `test/results/report.md` / `report.json` and `report-extended.md` / `report-extended.json`, with per-page events, signals, versions, errors and repetition/flakiness evidence. Results and logs are local generated artifacts. Missing setup/launch is SKIP; incomplete execution is ERROR; neither counts as a detection pass. Browser-suite mismatches and relevant errors/skips produce a nonzero exit. The test-only `/log` sink appends event JSON lines to `test/results/log.jsonl`. `test/live.mjs` is an optional check against a separately deployed demo, not part of the local release checks.

## Browser support, size and limits

The detector uses ES5 syntax and no runtime dependencies. It targets modern Chrome/Chromium, Firefox, Safari/WebKit and mobile browsers with standard DOM events and JSON APIs. ES5 syntax is not a promise of legacy Internet Explorer support. Optional workers, permission queries, UA Client Hints and WebGL extensions are feature-detected; CSP-blocked workers lose WK/worker-HL evidence. Sites must permit the Custom HTML script under their CSP.

The minified detector is **~13 KB** before the configuration/HTML wrapper. It exceeds the original 5 KB target; the build reports this warning and validates source/output as ES5.

Tools with natural input or patched browsers can end `human`, as the adversarial results show. Stealth with only benign signals can also end `human`; the detector favours conservative classification over catching every bot. Client-side detection is spoofable. Declared tokens can be spoofed and are never authenticated; JS-less fetchers never run the detector. `human` means no sufficient evidence, and a missing event means **unknown**, not human. Privacy tools, accessibility input, VMs and unusual browser settings may resemble weak signals. Global names are conditional implementation artifacts, not permanent framework signatures. Direct evidence can keep a subsequent human takeover classified automated for one following document via CA; CA alone cannot perpetuate it.

A hidden page may remain initial until it becomes visible or unloads. `pagehide` updates the data layer but delivery to GA4 can be lost during unload; crashes may never emit final. Cross-origin navigation, new tabs and denied storage remove history. Repeated same-URL ordinary navigations cannot be distinguished using timestamps alone. TP/TR describe input patterns, not agent reasoning or malicious intent.

## Contributing

Open an issue or pull request at [Narrativva-Labs/visitor-verdict](https://github.com/Narrativva-Labs/visitor-verdict). Include browser versions, a minimal reproduction and debug codes without raw visitor data. Changes should preserve data minimisation, ES5 output and conservative human controls; document misses rather than increasing weights to fit a fixture.

Run `npm run build` after source/configuration changes: it regenerates both GTM HTML and the import JSON. `npm run build:container` regenerates only the JSON from the current HTML. Do not edit generated files directly. Run contracts and relevant browser suites, and report skipped/errored cases honestly.

## License

[MIT](LICENSE). Copyright © 2026 František Bujnovský.
