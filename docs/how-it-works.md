# How it works

Visitor Verdict is a first reporting layer for clear automation, not an attempt to detect deliberate disguise or an accuracy guarantee.

| Class | Meaning |
|---|---|
| `automated` | Hard browser automation evidence, or one document of carry-over (CA) from previous direct hard evidence. Does not establish intent or AI use. |
| `declared_agent` | A configured agent/fetcher/crawler UA claim, or an agent UI marker in the page, without hard automation evidence. Tokens and markers are self-declarations, not identity verification. Agent-assisted visits usually have a real person behind them. |
| `suspicious` | Uncertain weighted evidence satisfying corroboration rules, the direct UB rule, or one document of CS carry-over. Keep as a secondary reporting view. |
| `human` | No sufficient automation evidence; not proof of a person. |

The **initial** phase runs synchronously using environment signals, agent UI markers already in the page and permitted tab history, once the document is active. Frames return without probing, publishing, installing state or touching storage; prerendered documents defer observation until activation. The **final** phase adds behaviour and completed asynchronous probes on the first `visibilitychange` to `hidden`, after 8 seconds of visible time, or on `pagehide`, whichever comes first. Set `finalOnHidden: false` to retain the previous pause-on-hidden behaviour. Hidden time never counts toward inactivity; early navigation does not count as eight seconds without input. Final fires once per document. A short tab switch therefore finalizes early by default: later behaviour and unfinished async probes are not counted. Loading in an already hidden document does not itself finalize; only a subsequent visible-to-hidden transition does. The agent marker watcher remains active after final until a match or pagehide. Initial automation persists; an initial declaration persists unless hard evidence appears at final. If an agent UI marker appears later (before or after final), one **agent** phase publishes the escalation immediately; see [agent UI markers](#agent-ui-markers-dm).

Precedence is hard/inherited automation → declared → suspicious → human. A declared UA with WebDriver evidence is `automated`; a declaration alone is `declared_agent`. The suspicious rule requires all of:

1. **Score ≥ `suspiciousThreshold` (default 6)**.
2. **At least three distinct positive-weight families**.
3. At least one non-benign signal family (pointer via TP/TR, worker via WK, or explicitly synthetic input SY), **or** at least two distinct environment families plus behaviour (interaction or navigation). Environment families are geometry, language, plugins, graphics, chrome and permissions. NI alone is not the non-benign interaction evidence; SY is.

“Non-benign” names a heuristic category, not a judgement about the visitor. Each family contributes its highest weight: geometry is capped at 2 (HW=2, G0/GS=1), worker at 6 (UB=6, WK=2), graphics at 1, NI/SY/BT/UC together at 2, and TP/TR together at 3. Hard and declared results (including CA/CD) use sentinel score 100; CS adds no score or scoring family; scores are not probabilities. Quiet reading alone scores 2; fast navigation plus inactivity scores 5. FN+NI+WG or FN+NI+GS scores 6 across three families but still remains human, because it has only one environment family and no TP/TR/SY/WK. FN+NI+GS+WG qualifies at 7 with two environment families plus behaviour. TR never bypasses these requirements or affects initial classification. UB directly yields suspicious at final without the ordinary score/family gate; declared and hard evidence retain precedence. HW remains benign: HW+FN+NI alone stays human.

Duplicate inclusion is ignored. BFCache restoration retains the document's state and does not emit a second final. Reload/history navigation does not append pageview timestamps. SPA route changes do not restart detection.

### Signals

The [versioned signal registry](signals.md) records every output code, default UA token and agent element ID, with sources, product/version scope, review dates, lifecycle status and known false positives. It is documentation and a CI contract, separate from the runtime.

Weights below are the implemented defaults. Missing or blocked optional APIs are unknown rather than positive evidence; genuinely unavailable WebGL has the explicit weak WG weight.

| Code | Evidence and safeguards | Weight / family |
|---|---|---|
| `AG` | Boundary-matched configured agent token | 100 / declared |
| `WD` | navigator.webdriver strictly true | 100 / hard |
| `HL` | HeadlessChrome in main UA/synchronous brands or opt-in dedicated worker UA (worker result final only); no high-entropy request | 100 / hard |
| `AU` | Bounded PhantomJS, Chrome-Lighthouse, Lighthouse, GTmetrix, Google-PageRenderer; PTST requires `/version` | 100 / hard |
| `GL` | Callable values at recognised Phantom/Nightmare/DOM automation/Selenium names, document `$cdc_`/`$wdc_` names, narrow window `cdc_…_(Array\|Promise\|Symbol\|Object\|Proxy\|JSON\|Window)` | 100 / hard |
| `PW` | Exact `__playwright__binding__`, `__playwright__binding__controller__`, `__pwInitScripts` with callable values only; data-only arrays/objects, getters, DOM/host objects and window proxies ignored; initial and final | 100 / hard, feature-dependent |
| `CA` | Previous document's result was `automated` from direct hard evidence in that document (never from a carried CA or a declaration); carries `automated` to the next document only, without an operator; plain class strings do not qualify | 100 / inherited |
| `CD` | Previous document had a direct declaration (UA token or agent UI marker), stored at initial (marker at load), agent phase or final; carries `declared_agent` (never `automated`) to the next document only, with the stored operator if a marker set one | 100 / inherited |
| `CS` | Previous final was suspicious from current-page evidence; `{value: "suspicious", direct: true}` is consumed to a passive string at start and carries one document only. CS alone cannot renew itself or upgrade to automated/declared_agent | 0 / inherited |
| `DH` | Observed Claude host shape; visible direct body DIV, no attributes/children, display contents; same declaration precedence/carry as DM | 100 / declared |
| `BT` | Three trusted non-composing insertText events on the same control within 5 ms | 2 / interaction |
| `UC` | Untrusted SELECT/checkbox/radio change, no trusted page input in prior 2000 ms | 2 / interaction |
| `DM` | Agent UI marker: element with an exact ID at its expected parent (`codex-agent-overlay-root` as a child of the root element → `openai`; `claude-agent-glow-border` or `claude-phantom-cursor` as a child of `body` → `anthropic`, older Claude in Chrome versions only). Checked at start, then watched until found | 100 / declared; sets `traffic_agent` (with `declared_agent` only) |
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

### Form interaction (1.4.0)

BT adds 2 interaction points for three trusted non-composing `insertText` events on the same form control within 5 ms. Event creation timestamps prevent queued events after a main-thread stall from appearing simultaneous; the fallback uses `performance.now()` where available. Identical quantized timestamps are ignored. Paste, replacement/autofill and composing input do not qualify. Assistive technology, voice input, text expanders and scanners may still match. UC adds 2 points only for untrusted `change` on enabled, writable SELECT or checkbox/radio, with no trusted page input in the preceding 2000 ms. Hidden inputs and text fields never qualify. Delayed framework/select hydration can still match. Both share the original interaction cap of 2 and require existing corroboration. Input/change observations do not set activity, suppress NI/SY or decay TR. Listeners are removed at final; one target reference and three times are cleared. Retargeted Shadow DOM controls may not be detected; shadow content and form values are never read.

### Agent UI markers (DM)

Some browser agents act inside an ordinary browser and leave no automation flag, but they draw their own UI into the page while they control it. [Microsoft Clarity](https://github.com/microsoft/clarity) (MIT) identified these markers and their placement ([PR #1142](https://github.com/microsoft/clarity/pull/1142), [PR #1173](https://github.com/microsoft/clarity/pull/1173), live tag `0.8.79-beta`); Visitor Verdict uses the same exact IDs and parents:

| Element ID | Expected parent | Operator |
|---|---|---|
| `claude-agent-glow-border` | `document.body` | `anthropic` (older Claude in Chrome versions) |
| `claude-phantom-cursor` | `document.body` | `anthropic` (older Claude in Chrome versions) |
| `codex-agent-overlay-root` | `document.documentElement` | `openai` (agent overlay of the ChatGPT desktop app's Chrome plugin) |

**Claude in Chrome 1.0.107 host (DH, new in 1.4.0):** desktop Chromium only, visible direct body DIV, zero attributes and light children, closed or absent shadow root, computed display `contents`, confirmed after at least 250 ms while still attached. Open roots are excluded without calling attachShadow. Another attributed or populated body DIV computing to `contents` disables this pattern. Visibility changes recheck candidates, including after final. A match yields `declared_agent`, operator `anthropic` and claim `dom_host`, retained with one-document CD carry. DM uses `dom_marker`; UA declarations use `ua_token`. The supplied GTM tag maps `traffic_agent_claim` as a GA4 event parameter (DLV ID 17); register an event-scoped custom dimension to filter evidence. Evidence is **observed**: 4/4 controlled runs, 0/2 controls in one profile, Chrome 158/macOS and extension 1.0.107. Closed-shadow widgets using `:host { display: contents }` and persistent empty portals under selective CSS remain false-positive sources. A persistent host indicates tab control, not every action. See the [experiment](../research/claude-host-experiment.md).

Matching is exact: `claude-agent-glow-border-inner`, `-copy` suffixes, nested copies and markers at the wrong parent do not count. `codex-browser-sidebar-comments-root` is deliberately ignored, as in Clarity's current proposal: it marks the OpenAI browser surface (present while a person browses), not an agent in control. Evidence level: **observed, self-declared by the agent UI**. Page code can plant the IDs, but nobody has an incentive to look like an agent; a marker never yields `automated`.

The start check uses `document.getElementById` for the three IDs. The check runs again right after the watcher starts, so a marker added by a consumer of the initial data-layer push is not missed. If none is found, one `MutationObserver` watches only the child lists of the root element and of `body` (attached as soon as `body` exists), with no subtree, because markers are direct children of those two. Direct children without an `id` get an ID watch; direct body DIVs get an all-attribute watch so attributes stripped after insertion can reveal the host (32 attribute watches total, including existing children). Host checks run at start and on direct body additions/attribute changes while visible. No subtree is observed; populated/attributed/block DIVs, including the lab logger, fail the shape. Each mutation batch re-runs the same three lookups; mutations inside the page's own content reach no callback. The watcher starts only when a `pagehide` listener could be attached, and it disconnects on the first match or on `pagehide`, and keeps watching after final, so an agent that takes over an already open tab is still seen. Without `MutationObserver` only the start check runs. A marker added and removed within one task is not seen.

Verdict only escalates. A marker found after initial publishes one extra `traffic_class` event with `traffic_phase: 'agent'`, class `declared_agent`, score 100 and `traffic_agent`, and replaces the frozen `__visitorVerdict` snapshot; final keeps `declared_agent`. No agent event is published when hard automation evidence already holds (`automated` keeps precedence and is reported without an operator: `traffic_agent` and `agent` appear only together with `declared_agent`) or when the class and operator are unchanged. The declaration is stored immediately, including the operator, so the next document starts as `declared_agent` via `CD` with the same `traffic_agent`. A declaration never stores `automated`: on a document that is automated only through a carried `CA`, it stores `declared_agent`, so the following document is `declared_agent`, not `automated`.

The carry lasts one document. If the person stops the agent and clicks to another page, that page can still start as `declared_agent` with `traffic_agent`; the page after it is unlabelled unless the marker returns. Read a session's last agent-labelled page with that in mind.

Limits: markers inside shadow roots (open or closed) or frames are not inspected (the detector does not run in frames; Clarity ignores both too); host light-DOM shape is checked, but shadow content is never inspected; only the first element with each ID is checked; a BFCache-restored page is not watched again; marker names can change with agent releases. Agents without a known marker remain unlabelled unless other evidence applies.

**TR (repeated teleport)** uses the decaying `tpPages` counter described in [privacy and storage](privacy.md). TP increments it synchronously in click capture before navigation, at most once per observed document, saturating at 255. At final, a document with accepted activity and no TP repays one count, subject to stale-write guards; idle and TP documents do not decay it. TR fires only at final if the remaining count is at least 2. It contributes 2 in the pointer family, capped at 3 together with TP, and uses the ordinary suspicious rule. Repeated history alone never starts a document suspicious. Duplicate inclusion, repeated clicks and BFCache restoration cannot increment again. New/reloaded documents may count separately; no unique-URL claim is possible. Blocked storage leaves page-local TP evidence; repeated clicks in one document cannot create TR alone.

**WK (worker mismatch)**, when enabled, compares supported main/worker user agent, webdriver, languages and positive hardware concurrency values. Missing worker fields are ignored. A worker exposing HeadlessChrome adds hard HL. Worker creation/errors/CSP denial produce no mismatch, and final never waits for the worker. Without a reply, the worker is terminated after at most 1500 ms (or idleMs if shorter). A legitimate main-only UA switcher can also produce WK, so it is weak evidence.

Activity listeners use window capture, falling back to document capture if window lacks a usable add/remove pair, with passive listeners where supported. If input listeners cannot be installed, inactivity is unknown rather than NI evidence. Accepted activity includes mousemove, pointermove, pointerdown, pointerup, touchstart, touchmove, touchend, touchcancel, scroll, keydown, keyup, wheel, click, focusin, input and change. Pointercancel clears pointer state but does not count as activity. `isTrusted === true` **or missing `isTrusted`** counts as activity for NI/SY and counter decay; TP requires explicitly trusted events. Accepted activity prevents NI/SY and, without TP, can decay history; it does not erase hard evidence. Trusted input can come from automation.

### WebMCP information (1.3.0)

WebMCP is recorded independently of classification. At active document start the detector samples `document.modelContext` and legacy `navigator.modelContext` once, tolerating blocked getters. A truthy API value yields `capable`; capability alone never means an agent. It does not enumerate or register tools, call their APIs, or read tool names, arguments, results or page content.

Event instances with strictly trusted (`isTrusted === true`) `toolactivated` and
`toolcancel` flags yield `used`, an observed lifecycle event. When the API is present at startup, capture listeners watch
window, document, start-time document.modelContext and navigator.modelContext native
EventTargets. Repeated delivery of the same event is counted once. Missing/false
trust is ignored; prototype registration bypasses context instance methods.
Cancellation does not establish completion, operator identity or intent.

`traffic_webmcp` is `none` | `capable` | `used`; `traffic_webmcp_count` is a per-document lifecycle-event count, saturating at 255. Activations and cancellations each count, so this is not a unique or successful invocation count. Public snapshots expose the same information as `webmcp` and `webmcpCount`. These fields are always present in 1.3.0, including `none` and zero; older detectors omit them.

Observation starts before the initial publication, continues after final, and stops at `pagehide`. Without a usable pagehide listener observation is skipped. Each accepted event replaces the frozen snapshot while preserving class, score, phase and operator. WebMCP never adds a debug signal, scoring family, declaration, carry, or extra `traffic_class` publication. Existing initial/agent/final publications include the information known at that time; an invocation after the last publication updates the global only and will not reach GA4 through the supplied tag. Earlier snapshots and events keep their historical values. There is no cross-document storage or BFCache restart.

Evidence is experimental: WebMCP targets/events are evolving and synthetic tests do not validate browser release coverage. Page-authored events cannot normally set `isTrusted`, but same-realm API replacement remains possible. Sources: [Chrome guide](https://developer.chrome.com/docs/ai/webmcp), [W3C community proposal](https://github.com/webmachinelearning/webmcp), Clarity [presence PR #1150](https://github.com/microsoft/clarity/pull/1150) and [usage PR #1166](https://github.com/microsoft/clarity/pull/1166).

### Configuration and output

Load `src/visitor-verdict.js` after optionally setting:

```html
<script>
window.visitorVerdictConfig = {
  idleMs: 8000,
  finalOnHidden: true,
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

Numeric overrides must be finite integers: `idleMs` 1–3,600,000; `fastNavMs` 1–60,000; `fastNavCount` 2–20; `suspiciousThreshold` 1–1,000. Invalid values retain defaults. `dataLayerName` must be a nonempty string of at most 128 characters and cannot be `__proto__`, `prototype` or `constructor`. Boolean overrides must be actual booleans; invalid values retain defaults.

## Public interface and data contract

Set `window.visitorVerdictConfig` before loading the detector. v1 uses only the new names, with no runtime compatibility aliases or migration of the previous session-storage key. Session history uses only `sessionStorage['visitor_verdict']`; see the [storage schema](privacy.md).

All publication phases publish the same fields (a broken/throwing data-layer consumer can prevent delivery while local finalization still completes):

```js
{
  event: 'traffic_class',
  traffic_class: 'human', // human | suspicious | automated | declared_agent
  traffic_phase: 'initial', // initial | agent | final
  traffic_score: 0,
  traffic_version: '1.4.0',
  // traffic_agent_claim: 'dom_host', // optional declaration evidence, also on CD
  traffic_webmcp: 'none', // none | capable | used; informational only
  traffic_webmcp_count: 0, // trusted lifecycle events, capped at 255
  traffic_agent: 'openai' // openai | anthropic; only with declared_agent and operator evidence (DM/DH/CD)
}
```

There is at most one initial, one agent and one final detector publication per document. Initial always comes first; agent (a `declared_agent` escalation from an agent UI marker) can come before or after final. `traffic_agent` is set only when the class is `declared_agent` and an agent UI marker in this document, or the carried result of the previous document, names the operator; a UA token alone never sets it, and `automated` never carries it. `traffic_version` is static release metadata, never a visitor identifier. With `debug: true`, events additionally contain `traffic_signals`, an array of short signal codes; keep debug disabled in production.

The detector exposes `window.__visitorVerdict` through a read-only, non-configurable accessor. Each publication produces a new frozen snapshot with `{class, score, phase, version, webmcp, webmcpCount}` and, only with class `declared_agent` when the operator is known from a marker, `agent` (`'openai'` or `'anthropic'`), plus optional evidence `claim` (`dom_marker`, `dom_host`, `ua_token`). `phase` is `'initial'`, `'agent'` or `'final'`. Re-read the global when you need the latest phase or WebMCP information; an earlier snapshot keeps its original values. Debug signals are absent from the public snapshot.

`window.__visitorVerdictLast` contains the validated previous stored class string captured at detector startup, or `undefined` when unavailable. Storage may reflect a final, an earlier marker publication, or a consumed carry when that document never finalized. Provenance objects are reduced to their validated class string. This is a read-only, non-configurable value; it does not refresh when storage changes. The GTM current-class variable reads the current snapshot first, then this startup fallback, and never reads storage itself or defaults to human.

## Hardening and its limits

Authoritative classification, score and lifecycle state remain in the detector closure. Public snapshots cannot be mutated after publication. Publication flags are set before invoking data-layer consumers, preventing reentrant initial/final duplication. A private per-document inclusion claim is independent of planted public globals; one small claim listener remains for the document lifetime to recognise duplicate inclusion after final or BFCache. Where the necessary event APIs are absent, the protected accessor supplies a closure handshake instead.

Only callable values at recognised GL/PW automation names qualify. Plain data, arrays (including a plain `__pwInitScripts` array), DOM named properties and property getters alone are ignored. Oversized storage records are rejected before parsing; class enums and finite numeric scores are validated at publication.

These safeguards protect against mutable state and ambiguous planted data; they do not authenticate scripts in the same JavaScript realm. Page code can plant callable automation functions, spoof browser APIs, edit permitted storage, alter data-layer consumers/events or push its own `traffic_class` events. Deliberately imitating the inclusion protocol or replacing platform primitives can interfere with detection; a hostile getter can imitate the legacy handshake.

If another script predefines a non-configurable `__visitorVerdict` or `__visitorVerdictLast`, JavaScript cannot replace it. The detector ignores its contents as authoritative state and continues real data-layer publications, with duplicate protection under normal document event APIs. Consumers reading the preempted name can nevertheless see the attacker's value. Frozen snapshots protect successfully claimed public properties; they do not authenticate preloaded globals or the page's data layer. This is a reporting aid, not a same-origin security boundary.


CA carries a previous direct automated result; CD carries a previous direct declared_agent result. Both use score 100 and expire after one document without renewed direct evidence. Carried declarations never become automated without hard evidence on the current page.

CS uses `{value: 'suspicious', direct: true}` for fresh suspicious evidence. On the next document,
startup first writes the passive string `'suspicious'`, then applies CS only if that write succeeds.
CA/CD use the same consume-before-apply rule. Readable but unwritable storage cannot chain inherited
classes. A clean CS-only page stays suspicious through final and stores the passive string,
so `__visitorVerdictLast` remains truthful while the following clean page starts human. Plain strings
(including those written by the earlier 1.2.0 implementation) are passive and do not seed carry.
Fresh evidence can renew suspicious provenance. Older 1.1 detectors ignore suspicious provenance
and may consume it to a string, so mixed versions can lose the grace classification. Opening a new
tab with an opener may clone unconsumed sessionStorage into each tab; use noopener to avoid that
browser-level copy. Same-origin scripts can plant provenance; this is not authenticated evidence.

Keep `finalOnHidden: false` on SPA sites that need behaviour after a tab switch, or when pending
Worker/Permissions probes must complete. Early final intentionally cancels those probes and ends
behaviour observation. Trusted input only after return cannot repay TP history after final; the
regression contracts verify that pause-on-hidden keeps probes and trusted-input decay available.
The default remains immediate hidden final to improve the chance of an exit-time publication.

WebMCP is **observed, page-forgeable** information, never authentication or a
classification signal. EventTarget prototype registration rejects ordinary
polyfill callback spoofing; handlers require an Event with strict isTrusted and
catch hostile getters. Earlier same-realm scripts can replace platform globals,
so this cannot establish cryptographic or tamper-proof provenance. Capture listeners
observe window, document and both modelContext locations; repeated delivery of the
same event is deduplicated. At 255 observations listeners disconnect.

**GA4 undercounts WebMCP usage after the final event (normally 8 seconds).** Later
tool events update only the local snapshot, with no extra analytics publication.
Agents that read longer before calling tools therefore systematically appear as
`capable`/`none` in GA4 even when the local snapshot later says `used`.
