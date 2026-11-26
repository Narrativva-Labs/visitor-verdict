# Visitor Verdict

[![CI](https://github.com/Narrativva-Labs/visitor-verdict/actions/workflows/ci.yml/badge.svg)](https://github.com/Narrativva-Labs/visitor-verdict/actions/workflows/ci.yml)

Label clear browser automation in GA4 with a privacy-minimal, client-side detector.

Visitor Verdict labels clear automation in GA4 that GA4's built-in bot filtering lets through. It does not try to catch operators who deliberately disguise automation and makes no accuracy guarantee. It is a first, privacy-minimal layer.

## Phase 2 (server-side verification, in progress)

The 0.6.1 [`server/` library](server/README.md) (unreleased) verifies operator HTTP signatures and published IP evidence independently of the browser class. Its first integration is [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side/tree/main), running on its live demo. The server package is not released or published to npm. Design and lab/demo work started before Phase 1 field validation; production use waits for that validation.

In a 2026-11-20 ChatGPT agent smoke test on one demo shop, 32 captured requests from one header-capture run had valid signatures. GA4 Realtime showed `signature_valid` on 5/5 `view_cart` events after cache warming (1/5 before). This is one operator on one site, not an accuracy or attribution study. See [field observations](research/agents-and-tells.md#field-observations-v10-2026-11-19) and the [conversion guidance](docs/conversion-guidance.md#server-side-verification): the server labels, it withholds nothing.

## What you get

1.6.0 adds observed CP (two Chromium centre clicks with zero pressure and fresh movement), KT (eight paired keys with median interval below 5 ms), and TG (callable tool globals). Each directly yields `suspicious`, never identity or automation. One late human → suspicious final uses `traffic_replay: late`; consent replay remains `consent`. UC stays live after final. TG alone, CP after two qualifying clicks and KT after eight qualifying paired keys seed one-document CS carry.


| | v1.6.0 |
|---|---|
| Classes | `automated` (automation evidence), `declared_agent` (unverified agent claim: UA token or agent UI marker), `suspicious` (uncertain evidence), `human` (no automation detected) |
| Catches | WebDriver/headless and Selenium/Puppeteer/Playwright defaults, audit tools, declared AI fetchers; OpenAI's in-page agent overlay (ChatGPT desktop browser plugin) and Claude in Chrome through legacy element IDs or its observed 1.0.107 host shape (operator in `traffic_agent`); some masked headless setups via opt-in UB → `suspicious`. Feature/configuration dependent, not universal tool detection. |
| Known misses | Patchright, undetected-chromedriver, nodriver, stealth with human-like input; agents that inject no known marker, including own-browser agents and remote agent browsers without another tell (**confirmed in 22 November 2026 runs:** ChatGPT's cloud agent remote browser shows no overlay marker and ends `human` in the browser detector; it is recognised only on the server as `agent_verified` via HTTP Message Signatures); see the [observed benchmark](docs/benchmark.md). |
| Observed agent signals | CP: two zero-pressure Chromium centre clicks with fresh movement; KT: eight paired keys, median <5 ms; TG: callable tool globals. Direct `suspicious`, one-document CS carry; live after final. |
| Footprint | 26,120 bytes minified (`dist/visitor-verdict.min.js`); ~3 ms default was measured locally before v1.0 hardening (v1.6.0 latency not yet re-measured); no runtime dependencies. |
| Privacy | One bounded `sessionStorage` key (`visitor_verdict`); no identifiers, fingerprints, cookies or detector requests. Agent markers check three fixed IDs or element shape (tag, attribute/child counts and display); no page content or form values are read. A blocked optional worker may cause a browser CSP report. |
| Integration | Initial/agent/final data-layer events, GTM import, GA4 event parameters (session classification in SQL/Explorations; no user property). |

**Visitor Verdict labels traffic; it never excludes it.** Nothing is filtered, held or withheld by default: not in GA4, not in ad-platform conversions, not in leads. Agent-assisted visits usually have a real person behind them (a browser agent such as OpenAI's in-browser agent runs in that person's own browser, with their own card), so their purchases are real revenue. Use the labels to report, compare and review. See [conversion guidance](docs/conversion-guidance.md).

**Agent UI markers (new in 1.1.0):** OpenAI's agent overlay adds `codex-agent-overlay-root` to the root element while the agent acts (confirmed in the ChatGPT desktop app's Chrome plugin). Older Claude in Chrome versions add `claude-agent-glow-border` / `claude-phantom-cursor` to the page body. **Claude in Chrome 1.0.107 is covered by an experimental host-shape check: a visible direct body child DIV with zero attributes, zero child nodes and computed display `contents`. Observed in 4/4 controlled runs versus 0/2 controls in one profile; unknown false positives require field monitoring.** Only the host shape is read; closed shadow content is never inspected. See the [experiment and limits](research/claude-host-experiment.md). The OpenAI browser's comments sidebar root is deliberately not a marker: it marks the browser, not an agent in control. The detector checks these exact IDs and the host shape at start and watches for them for the life of the page; a match yields `declared_agent` with `traffic_agent` `openai` (or `anthropic`). `traffic_agent` appears only together with `declared_agent`; if hard automation evidence holds, the class stays `automated` without an operator. Evidence level: **observed, self-declared by the agent UI**. It is trivially spoofable, but nobody has an incentive to look like an agent. Credit: [Microsoft Clarity](https://github.com/microsoft/clarity) (MIT) identified these markers. When a marker appears after the initial publication, the detector publishes one extra `traffic_class` event with `traffic_phase: 'agent'`.

**GTM container 1.6.0:** 2 tags, 10 variables (including 8 `VV - DLV …` variables), 5 triggers and 1 optional first-page-view readiness folder. Maps `traffic_class`, `traffic_phase`, `traffic_score`, `traffic_version`, `traffic_agent`, `traffic_webmcp`, `traffic_agent_claim` and `traffic_replay`, and fires the GA4 `traffic_class` tag on `initial` (hard), `agent` (introduced in 1.1.0) and `final`. See [GTM setup and migrations](docs/ga4-reporting.md).

**Experimental automation window signal (AW, 1.5.0):** Linux desktop windows with an emulated viewport shape contribute 3 points with one corroborator; unavailable WebGL together with startup Notification denied or Chromium brands without Google Chrome directly yields `suspicious`, including during clicks/scrolls. This direct rule cannot seed CS carry without independently sufficient ordinary evidence. A source-based Linux ARM + SwiftShader variant uses architecture only when already exposed; no high-entropy request is added. This can also match headed Playwright/CDP, never identifies ChatGPT or an operator, and excludes known fullscreen, PWA, PiP, Electron and mobile contexts. See [checks, limits and evidence](docs/how-it-works.md#signals).

**WebMCP information (1.3.0):** `traffic_webmcp` reports `none`, `capable` (API exposed at start) or `used` (trusted browser tool lifecycle observed), independently of the traffic class. Capability alone never means an agent; usage means a site tool was invoked through the browser agent integration, including cancellation. No tool content is read. See [semantics and limits](docs/how-it-works.md#webmcp-information-130) and [GTM migration](docs/ga4-reporting.md#webmcp-reporting-and-migration-to-130).

## Five-minute quickstart

1. In your GTM web container, **Admin → Import Container**, select [gtm/container-import.json](gtm/container-import.json), choose **Merge**, and review conflicts. The import creates no Google tag.
2. Set **VV - GA4 measurement ID** to the site's existing measurement ID. Keep **VV - detector** on **All Pages**, once per page, with no additional consent check; establish consent defaults first and review your site's consent decision below.
3. **Optional first `page_view` recipe:** the import folder **VV - OPTIONAL page_view readiness (OR, once per page)** contains the two triggers. On the **existing Google tag**, replace its early All Pages/Initialization trigger with **VV - initial OR VV - timer fallback 1s** as two normal firing triggers (not a trigger group). Set **Once per page**. In its Shared event settings, set `traffic_class={{VV - current class}}`. This lets the first `page_view` use the initial result; the one-second fallback keeps the Google tag available if detection is delayed or unavailable. Retain existing consent handling. This can delay `page_view` by up to 1 s; fallback may have no class. To roll back, restore the original trigger and firing option. For an explicit `page_view` tag, apply the same two-trigger recipe there and ensure automatic pageviews are disabled to avoid duplicates. If that tag also sends SPA/history pageviews, split it first: the first-document tag gets the recipe and Once per page, a separate history tag stays Once per event.
4. Add `traffic_class={{VV - current class}}` to your other **GA4 event tags**, evaluated at firing time. Keep **VV - GA4 traffic_class** on **VV - initial hard OR VV - agent OR VV - final**, **Once per event**, with its eight `VV - DLV …` event mappings unchanged (do not rely on a `traffic_class` user property; it was removed in GTM 1.4.1). Initial sends only `automated` or `declared_agent`; agent sends the `declared_agent` escalation; final sends all classes. Phases can send the same class: report sessions with any matching hit, not event counts.
5. In **GTM**, remove any legacy `traffic_class` User Property mapping from GA4 tags (1.4.1 sends event parameters only). In GA4 **Admin → Data display → Custom definitions**, create event-scoped dimensions only: **Traffic class (event)** for `traffic_class`, **Traffic agent (event)** for `traffic_agent`, and **Traffic agent claim (event)** for `traffic_agent_claim` (needed to separate experimental `dom_host` from `dom_marker`/`ua_token` and monitor potential false positives). Optionally add event-scoped `traffic_webmcp`, `traffic_phase` and `traffic_version`. Do not create a user-scoped `traffic_class` dimension; classify whole sessions in SQL ([bigquery.sql](docs/analysis/bigquery.sql) / [campaign-dashboard.sql](docs/analysis/campaign-dashboard.sql)) or GA4 Exploration session segments, and keep `suspicious` as a secondary view.
6. Preview in Tag Assistant: verify the initial, agent and final `traffic_class` events (a page sends up to five, including one consent replay), `traffic_version: '1.6.0'`, `traffic_agent` and `traffic_agent_claim` on agent-phase events (test with a synthetic `codex-agent-overlay-root` child of the root element), the first `page_view` class, final DLV values, one Google-tag start, consent paths and navigation. Then publish through your normal review process. Full [setup and reporting guide](docs/ga4-reporting.md), including the [sandboxed current-class template](gtm/templates/vv-current-class.tpl) for CSP-sensitive sites.

With `replayOnConsent: true` (default), a late `gtag('consent', 'update', {analytics_storage: 'granted'})` transition after final replays the latest result once with `traffic_phase: 'final'` and `traffic_replay: 'consent'`. The primary configured layer is created and watched when absent; the secondary default layer is only watched if it already exists. Arrays and gtag Arguments share page-wide consent state. Set consent defaults before standalone loading. Regional analytics denied defaults remain unknown until an explicit update; regional granted and ad-only/CCPA defaults do not revoke analytics grant. A final already published with observed granted consent is never replayed after withdrawal/regrant. The existing final trigger and **Once per event** fire the GA4 tag once for this new event. Import the new DLV `traffic_replay` (ID 18) and its GA4 event parameter; optionally register an event-scoped dimension. Set `replayOnConsent: false` to disable. Consent granted before final or repeated granted updates add no replay. Report sessions with matching hits: replay is an update, not another visit. Nothing is excluded. Vanilla holds the pending class until consent and should deduplicate only `traffic_replay: consent`. It must accept `traffic_replay: late` as a new classification (including after a prior final), update the pending class when consent is denied, and preserve verified server priority; B7 echoes retain their loop guard. Automatic replay observes only gtag/dataLayer consent commands, not GTM template `setDefaultConsentState` / `updateConsentState`: for those, disable automatic replay and use a guarded GTM trigger after the integration’s consent update. In Advanced Consent Mode the original final may already be a cookieless ping, so replay adds a second hit; classify sessions/relations using any matching hit, never event counts. See [integration limits and load order](docs/how-it-works.md#signals).

> **Limits:** `human` means no automation detected, not proof of a person. `suspicious` is a secondary view. This is client-side and spoofable, for reporting only: never block users or deny service. Consent is the site owner's decision; pre-consent classifications must never feed advertising platforms, and any post-consent label forwarded to ad platforms (e.g. via sGTM) is strictly a passive reporting parameter, never an optimization target or exclusion. Read the [privacy details](docs/privacy.md) and [conversion guidance](docs/conversion-guidance.md).

**Server-side verification (in development):** a verifier for signed AI agents (Web Bot Auth / HTTP Message Signatures), operators' published IP ranges and optional Poppy 1.0 (server library v0.6.1, unpublished) is being developed alongside Phase 1 field validation. It labels verified agent identities (`agent_verified`, with `user_directed` or `unknown` purpose), verified crawlers (`crawler_verified`) and verified automation platforms (`automation_verified`: Browserbase, Kernel, Cloudflare Browser Run, Shopify Cloudsurf). SQL reports verified agents with unknown purpose separately as `agent_verified_unknown_purpose`, rather than asserting customer intent. Its first integration is [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side), a server-side GA4 collector that forwards the browser class and verified server labels to GA4 (branch [`agent-verification`](https://github.com/Narrativva-Labs/vanilla-server-side/tree/main)), where a signed ChatGPT cloud agent session was verified as `agent_verified` while ending `human` in the browser. See the [roadmap](ROADMAP.md#phase-2--recognise-and-measure-ai-agents-on-the-server-in-development).

## Pinned direct-script build

An alternative to the GTM detector tag. Set `window.visitorVerdictConfig` before loading if needed; optional worker/WebGL probes default off in this standalone build.

```html
<script>window.dataLayer = window.dataLayer || [];</script>
<!-- Set consent defaults and install the consent consumer before the detector. -->
<script src="https://cdn.jsdelivr.net/gh/Narrativva-Labs/visitor-verdict@v1.6.0/dist/visitor-verdict.min.js"
        integrity="sha384-Z81P6ygCoiL/A/pbAgVibD84YaX9ecbtr7d0F0O3RBhkd0dVJjLJGt4RbpJ1XK1n"
        crossorigin="anonymous"></script>
```

**Final timing (1.2.0):** the first tab hide now publishes final, with pagehide as fallback and the 8-second visible timer unchanged. A short tab switch ends behaviour observation early; set `finalOnHidden: false` before loading to keep the earlier pause behaviour. Agent UI markers can still publish a later agent phase. An ordinary corroborated suspicious final can carry to one following document via `CS`, without becoming hard evidence; direct UB/strong AW alone cannot.

The integrity value comes from [dist/visitor-verdict.min.js.sri](dist/visitor-verdict.min.js.sri). Loading from a CDN is a page resource request; the detector itself sends no requests. Self-host the same artifact if preferred. Direct loading still requires wiring your analytics integration.

## Documentation

- [Versioned signal registry: sources, product versions, review dates and known false positives](docs/signals.md)
- [How it works: signals, configuration, public interface and hardening](docs/how-it-works.md)
- [Privacy, storage and consent](docs/privacy.md)
- [GTM setup and GA4 reporting](docs/ga4-reporting.md)
- [Conversion guidance: label, never exclude](docs/conversion-guidance.md)
- [Meta and Google Ads: passive reporting recipes](docs/ad-platform-recipes.md)
- [Tests, adversarial benchmark and known limits](docs/benchmark.md)
- Related: [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side), server-side GA4 collector and first integration of the server verifier (in development)
- [Agent research and field observations](research/agents-and-tells.md)
- [Validation protocol v2: controlled runs with known ground truth](docs/study/validation-protocol.md) — pilot round 1 on our own demo shop, 2026-11-22; no published accuracy figures yet
- [Lightweight field-validation protocol](docs/study/protocol.md) — validation in progress since 2026-11-19, no study results yet; agent runs on our own test shop: [field observations](research/agents-and-tells.md#field-observations-v10-2026-11-19)
- [Server verifier preview](server/README.md)
- [Session analysis SQL (validated once against the demo property export, 2026-11-21)](docs/analysis/session-classification.sql)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

For local builds and checks, see [Contributing](CONTRIBUTING.md). Report human misclassifications with short debug codes and synthetic reproductions, without URLs, IPs or visitor data. See [Security](SECURITY.md) for private data-leak reports.

[MIT](LICENSE). Copyright © 2026 František Bujnovský.
