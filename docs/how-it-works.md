# How it works

Visitor Verdict is a first reporting layer for clear automation, not an attempt to detect deliberate disguise or an accuracy guarantee.

| Class | Meaning |
|---|---|
| `automated` | Hard browser automation evidence, or one document of carry-over (CA) from previous direct hard evidence. Does not establish intent or AI use. |
| `declared_agent` | A configured agent/fetcher/crawler UA claim without hard automation evidence. Tokens are not identity verification. |
| `suspicious` | Uncertain weighted evidence satisfying corroboration rules, or the direct UB rule. Keep as a secondary reporting view. |
| `human` | No sufficient automation evidence; not proof of a person. |

The **initial** phase runs synchronously using environment signals and permitted tab history, once the document is active. Frames return without probing, publishing, installing state or touching storage; prerendered documents defer observation until activation. The **final** phase adds behaviour and completed asynchronous probes after 8 seconds of visible time, or on `pagehide`, whichever comes first. Hidden time pauses the timer; early navigation does not count as eight seconds without input. Final fires once per document. Initial automation persists; an initial declaration persists unless hard evidence appears at final.

Precedence is hard/inherited automation → declared → suspicious → human. A declared UA with WebDriver evidence is `automated`; a declaration alone is `declared_agent`. The suspicious rule requires all of:

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
| `GL` | Callable values at recognised Phantom/Nightmare/DOM automation/Selenium names, document `$cdc_`/`$wdc_` names, narrow window `cdc_…_(Array\|Promise\|Symbol\|Object\|Proxy\|JSON\|Window)` | 100 / hard |
| `PW` | Exact `__playwright__binding__`, `__playwright__binding__controller__`, `__pwInitScripts` with callable values only; data-only arrays/objects, getters, DOM/host objects and window proxies ignored; initial and final | 100 / hard, feature-dependent |
| `CA` | Previous document's final result was `automated` from direct hard evidence; carries `automated` to the next document only; plain class strings do not qualify | 100 / inherited |
| `CD` | Previous document's final result was `declared_agent` from a direct declaration; carries `declared_agent` (never `automated`) to the next document only | 100 / inherited |
| `G0` | Both dimensions zero for screen, viewport or outer size; only visible, focused, top-level; rechecked final | 1 / geometry |
| `GS` | 800×600 screen or 1280×720 screen equal to viewport | 1 / geometry |
| `LA` | Empty/missing languages AND no language/userLanguage/browserLanguage/systemLanguage fallback | 1 / language |
| `PL` | Desktop Chromium-compatible empty plugins; excludes mobile/touch iPad, known WebView/in-app UA, pdfViewerEnabled false | 1 / plugins |
| `WG` | Opt-in (`webgl: true`): no WebGL, or exact software-renderer token SwiftShader/llvmpipe/softpipe or exact Mesa OffScreen; no broad Mesa/ANGLE match | 1 / graphics |
| `CH` | Desktop Chrome-compatible UA plus Chromium brands, window.chrome missing; excludes mobile/known embedded UA | 1 / chrome |
| `NP` | Secure top-level Chromium, supported denied/prompt notification mismatch, successful async query | 1 / permissions, final only |
| `HC` | Missing/zero hardwareConcurrency | 0 / debug only |
| `NI` | No accepted activity after a full configured visible window (default 8000 ms); missing isTrusted counts as activity | 2 / interaction |
| `FN` | At least 3 pageviews connected by consecutive positive intervals <2000 ms (2 intervals for count 3) | 3 / navigation, final only |
| `SY` | Explicitly untrusted mousemove/pointerdown/touchstart occurred, with no accepted activity (trusted or missing isTrusted) | 2 / interaction |
| `TP` | Positive >200px mousemove jump followed within 600ms by a trusted mouse click near the jump endpoint and fresh trusted mouse pointerdown; path/rest/repeat safeguards below | 3 / pointer, final only |
| `WK` | Opt-in (`worker: true`): supported UA, webdriver, languages or positive core-count mismatch between main and dedicated worker; unavailable fields ignored | 2 / worker, final only |
| `UB` | Opt-in (`worker: true`): non-empty main UA-CH brands, but an exposed worker userAgentData API has an undefined/null value or empty brands array. Unexposed API, malformed shapes, blocked getters and failed/CSP-blocked workers are unknown | 6 / worker, final only; directly suspicious, never automated alone or CA provenance |
| `HW` | Visible, focused, top-level desktop window: outer and inner dimensions equal screen dimensions on both axes, and available screen equals full screen. Excludes mobile/embedded UAs, document fullscreen and fullscreen/standalone display modes; unknown fullscreen capability is ignored | 2 / benign geometry; ordinary corroboration required |
| `TR` | Remaining `tpPages >=2` at final, after any eligible decay; no initial effect or class override | 2 / pointer, final only; capped at 3 together with TP |

UB can also flag Chrome DevTools-style device emulation or CDP user-agent overrides: these can leave main-thread UA Client Hints brands populated while worker brands are empty, producing `suspicious` even with human input.

Mobile human controls therefore emulate viewport/screen, device scale, mobile layout and touch while retaining the browser's native UA. They do not validate mobile-UA-specific branches or physical-device behaviour. A separate informational scenario deliberately retains the device UA override and expects `suspicious` via UB.

**TP (teleport click)** requires positive jump evidence, not merely missing or sparse movement. A trusted `mousemove` must have a movement delta greater than 200px (Euclidean), or differ by more than 200px from the previous distinct position observed within 600ms. It suppresses jumps in a stream of at least three distinct moves whose successive gaps are at most 120ms. A trusted mouse click must follow within 600ms of both the jump and an explicit trusted mouse pointerdown, land within 2px of the jump endpoint, and be more than 40px from the previous recorded click if one exists. Touch/pen, keyboard activation (`detail: 0`), untrusted input, rested/expired jumps and repeated nearby clicks do not qualify. `mousemove` alone supplies the jump/path evidence, avoiding double counting compatibility pointer events. No trajectory is retained.

**TR (repeated teleport)** uses the decaying `tpPages` counter described in [privacy and storage](privacy.md). TP increments it synchronously in click capture before navigation, at most once per observed document, saturating at 255. At final, a document with accepted activity and no TP repays one count, subject to stale-write guards; idle and TP documents do not decay it. TR fires only at final if the remaining count is at least 2. It contributes 2 in the pointer family, capped at 3 together with TP, and uses the ordinary suspicious rule. Repeated history alone never starts a document suspicious. Duplicate inclusion, repeated clicks and BFCache restoration cannot increment again. New/reloaded documents may count separately; no unique-URL claim is possible. Blocked storage leaves page-local TP evidence; repeated clicks in one document cannot create TR alone.

**WK (worker mismatch)**, when enabled, compares supported main/worker user agent, webdriver, languages and positive hardware concurrency values. Missing worker fields are ignored. A worker exposing HeadlessChrome adds hard HL. Worker creation/errors/CSP denial produce no mismatch, and final never waits for the worker. Without a reply, the worker is terminated after at most 1500 ms (or idleMs if shorter). A legitimate main-only UA switcher can also produce WK, so it is weak evidence.

Activity listeners use window capture, falling back to document capture if window lacks a usable add/remove pair, with passive listeners where supported. If input listeners cannot be installed, inactivity is unknown rather than NI evidence. Accepted activity includes mousemove, pointermove, pointerdown, pointerup, touchstart, touchmove, touchend, touchcancel, scroll, keydown, keyup, wheel, click and focusin. Pointercancel clears pointer state but does not count as activity. `isTrusted === true` **or missing `isTrusted`** counts as activity for NI/SY and counter decay; TP requires explicitly trusted events. Accepted activity prevents NI/SY and, without TP, can decay history; it does not erase hard evidence. Trusted input can come from automation.

### Configuration and output

Load `src/visitor-verdict.js` after optionally setting:

```html
<script>
window.visitorVerdictConfig = {
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

`agentTokens` are **literal strings**, matched case-insensitively with token boundaries; regex metacharacters are escaped. A supplied array replaces the defaults and is truncated to 64 entries; only nonempty strings up to 128 characters are evaluated. The list is maintained in [the source](../src/visitor-verdict.js), with historical evidence in [the research notes](../research/agents-and-tells.md). It includes AI-associated fetchers and general crawlers; `Google-Extended` is not a UA and is excluded.

Numeric overrides must be finite integers: `idleMs` 1–3,600,000; `fastNavMs` 1–60,000; `fastNavCount` 2–20; `suspiciousThreshold` 1–1,000. Invalid values retain defaults. `dataLayerName` must be a nonempty string of at most 128 characters and cannot be `__proto__`, `prototype` or `constructor`. Boolean options enable only on strict `true`.

## Public interface and data contract

Set `window.visitorVerdictConfig` before loading the detector. v1 uses only the new names, with no runtime compatibility aliases or migration of the previous session-storage key. Session history uses only `sessionStorage['visitor_verdict']`; see the [storage schema](privacy.md).

Both phases publish the same fields (a broken/throwing data-layer consumer can prevent delivery while local finalization still completes):

```js
{
  event: 'traffic_class',
  traffic_class: 'human', // human | suspicious | automated | declared_agent
  traffic_phase: 'initial', // initial | final
  traffic_score: 0,
  traffic_version: '1.0.0'
}
```

There is at most one initial and one final detector publication per document. `traffic_version` is static release metadata, never a visitor identifier. With `debug: true`, events additionally contain `traffic_signals`, an array of short signal codes; keep debug disabled in production.

The detector exposes `window.__visitorVerdict` through a read-only, non-configurable accessor. Each publication produces a new frozen snapshot with exactly `{class, score, phase, version}`. Re-read the global when you need the latest phase; an earlier snapshot keeps its original values. Debug signals are absent from the public snapshot.

`window.__visitorVerdictLast` contains only the validated previous final class string captured at detector startup, or `undefined` when unavailable. Provenance objects are reduced to their validated class string. This is a read-only, non-configurable value; it does not refresh when storage changes. The GTM current-class variable reads the current snapshot first, then this startup fallback, and never reads storage itself or defaults to human.

## Hardening and its limits

Authoritative classification, score and lifecycle state remain in the detector closure. Public snapshots cannot be mutated after publication. Publication flags are set before invoking data-layer consumers, preventing reentrant initial/final duplication. A private per-document inclusion claim is independent of planted public globals; one small claim listener remains for the document lifetime to recognise duplicate inclusion after final or BFCache. Where the necessary event APIs are absent, the protected accessor supplies a closure handshake instead.

Only callable values at recognised GL/PW automation names qualify. Plain data, arrays (including a plain `__pwInitScripts` array), DOM named properties and property getters alone are ignored. Oversized storage records are rejected before parsing; class enums and finite numeric scores are validated at publication.

These safeguards protect against mutable state and ambiguous planted data; they do not authenticate scripts in the same JavaScript realm. Page code can plant callable automation functions, spoof browser APIs, edit permitted storage, alter data-layer consumers/events or push its own `traffic_class` events. Deliberately imitating the inclusion protocol or replacing platform primitives can interfere with detection; a hostile getter can imitate the legacy handshake.

If another script predefines a non-configurable `__visitorVerdict` or `__visitorVerdictLast`, JavaScript cannot replace it. The detector ignores its contents as authoritative state and continues real data-layer publications, with duplicate protection under normal document event APIs. Consumers reading the preempted name can nevertheless see the attacker's value. Frozen snapshots protect successfully claimed public properties; they do not authenticate preloaded globals or the page's data layer. This is a reporting aid, not a same-origin security boundary.


CA carries a previous direct automated result; CD carries a previous direct declared_agent result. Both use score 100 and expire after one document without renewed direct evidence. Carried declarations never become automated without hard evidence on the current page.
