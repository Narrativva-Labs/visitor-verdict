# Visitor Verdict

[![CI](https://github.com/Narrativva-Labs/visitor-verdict/actions/workflows/ci.yml/badge.svg)](https://github.com/Narrativva-Labs/visitor-verdict/actions/workflows/ci.yml)

Label clear browser automation in GA4 with a privacy-minimal, client-side detector.

Visitor Verdict labels clear automation in GA4 that GA4's built-in bot filtering lets through. It does not try to catch operators who deliberately disguise automation and makes no accuracy guarantee. It is a first, privacy-minimal layer.

## What you get

| | v1.4.1 |
|---|---|
| Classes | `automated` (automation evidence), `declared_agent` (unverified agent claim: UA token or agent UI marker), `suspicious` (uncertain evidence), `human` (no automation detected) |
| Catches | WebDriver/headless and Selenium/Puppeteer/Playwright defaults, audit tools, declared AI fetchers; OpenAI's in-page agent overlay (ChatGPT desktop browser plugin) and Claude in Chrome through legacy element IDs or its observed 1.0.107 host shape (operator in `traffic_agent`); some masked headless setups via opt-in UB → `suspicious`. Feature/configuration dependent, not universal tool detection. |
| Known misses | Patchright, undetected-chromedriver, nodriver, stealth with human-like input; agents that inject no known marker, including own-browser agents and remote agent browsers without another tell (the ChatGPT agent's remote browser ended `human` in v1.0 field runs; whether it shows the overlay marker is not yet verified); see the [observed benchmark](docs/benchmark.md). |
| Footprint | ~18.8 KB minified; ~3 ms default in earlier local measurements; no runtime dependencies. |
| Privacy | One bounded `sessionStorage` key (`visitor_verdict`); no identifiers, fingerprints, cookies or detector requests. Agent markers check three fixed IDs or element shape (tag, attribute/child counts and display); no page content or form values are read. A blocked optional worker may cause a browser CSP report. |
| Integration | Initial/agent/final data-layer events, GTM import, GA4 event parameters. |

**Visitor Verdict labels traffic; it never excludes it.** Nothing is filtered, held or withheld by default: not in GA4, not in ad-platform conversions, not in leads. Agent-assisted visits usually have a real person behind them (a browser agent such as OpenAI's in-browser agent runs in that person's own browser, with their own card), so their purchases are real revenue. Use the labels to report, compare and review. See [conversion guidance](docs/conversion-guidance.md).

**Agent UI markers (new in 1.1.0):** OpenAI's agent overlay adds `codex-agent-overlay-root` to the root element while the agent acts (confirmed in the ChatGPT desktop app's Chrome plugin). Older Claude in Chrome versions add `claude-agent-glow-border` / `claude-phantom-cursor` to the page body. **Claude in Chrome 1.0.107 is covered by an experimental host-shape check: a visible direct body child DIV with zero attributes, zero child nodes and computed display `contents`. Observed in 4/4 controlled runs versus 0/2 controls in one profile; unknown false positives require field monitoring.** Only the host shape is read; closed shadow content is never inspected. See the [experiment and limits](research/claude-host-experiment.md). The OpenAI browser's comments sidebar root is deliberately not a marker: it marks the browser, not an agent in control. The detector checks these exact IDs and the host shape at start and watches for them for the life of the page; a match yields `declared_agent` with `traffic_agent` `openai` (or `anthropic`). `traffic_agent` appears only together with `declared_agent`; if hard automation evidence holds, the class stays `automated` without an operator. Evidence level: **observed, self-declared by the agent UI**. It is trivially spoofable, but nobody has an incentive to look like an agent. Credit: [Microsoft Clarity](https://github.com/microsoft/clarity) (MIT) identified these markers. When a marker appears after the initial publication, the detector publishes one extra `traffic_class` event with `traffic_phase: 'agent'`.

**GTM container 1.1.0:** adds `traffic_agent` and fires the GA4 `traffic_class` tag on the new `agent` phase, in addition to hard initial evidence and all final results; includes an optional first-page-view readiness trigger set. See the [migration note](docs/ga4-reporting.md#migrating-an-existing-install-to-container-110).

**WebMCP information (1.3.0):** `traffic_webmcp` reports `none`, `capable` (API exposed at start) or `used` (trusted browser tool lifecycle observed), independently of the traffic class. Capability alone never means an agent; usage means a site tool was invoked through the browser agent integration, including cancellation. No tool content is read. See [semantics and limits](docs/how-it-works.md#webmcp-information-130) and [GTM migration](docs/ga4-reporting.md#webmcp-reporting-and-migration-to-130).

## Five-minute quickstart

1. In your GTM web container, **Admin → Import Container**, select [gtm/container-import.json](gtm/container-import.json), choose **Merge**, and review conflicts. The import creates no Google tag.
2. Set **VV - GA4 measurement ID** to the site's existing measurement ID. Keep **VV - detector** on **All Pages**, once per page, with no additional consent check; establish consent defaults first and review your site's consent decision below.
3. **Optional first `page_view` recipe:** the import folder **VV - OPTIONAL page_view readiness (OR, once per page)** contains the two triggers. On the **existing Google tag**, replace its early All Pages/Initialization trigger with **VV - initial OR VV - timer fallback 1s** as two normal firing triggers (not a trigger group). Set **Once per page**. In its Shared event settings, set `traffic_class={{VV - current class}}`. This lets the first `page_view` use the initial result; the one-second fallback keeps the Google tag available if detection is delayed or unavailable. Retain existing consent handling. This can delay `page_view` by up to 1 s; fallback may have no class. To roll back, restore the original trigger and firing option. For an explicit `page_view` tag, apply the same two-trigger recipe there and ensure automatic pageviews are disabled to avoid duplicates. If that tag also sends SPA/history pageviews, split it first: the first-document tag gets the recipe and Once per page, a separate history tag stays Once per event.
4. Add `traffic_class={{VV - current class}}` to your other **GA4 event tags**, evaluated at firing time. Keep **VV - GA4 traffic_class** on **VV - initial hard OR VV - agent OR VV - final**, **Once per event**, with its seven `VV - DLV …` event mappings. Initial sends only `automated` or `declared_agent`; agent sends the `declared_agent` escalation; final sends all classes. Phases can send the same class: report sessions with any matching hit, not event counts.
5. In GA4 **Admin → Data display → Custom definitions**, create **Traffic class (event)** for event parameter `traffic_class`, **Traffic agent (event)** for event parameter `traffic_agent`. Remove any legacy `traffic_class` User Property mapping from existing GA4 tags; 1.4.1 publishes event parameters only. Optionally add event-scoped `traffic_phase` and `traffic_version`. Use event evidence for reporting; keep `suspicious` as a secondary view.
6. Preview in Tag Assistant: verify the initial, agent and final `traffic_class` events (a page sends up to three), `traffic_version: '1.4.1'`, `traffic_agent` on agent-phase events (test with a synthetic `codex-agent-overlay-root` child of the root element), the first `page_view` class, final DLV values, one Google-tag start, consent paths and navigation. Then publish through your normal review process. Full [setup and reporting guide](docs/ga4-reporting.md), including the [sandboxed current-class template](gtm/templates/vv-current-class.tpl) for CSP-sensitive sites.

> **Limits:** `human` means no automation detected, not proof of a person. `suspicious` is a secondary view. This is client-side and spoofable, for reporting only: never block users or deny service. Consent is the site owner's decision; pre-consent classifications must never feed advertising platforms. Read the [privacy details](docs/privacy.md).

**Server-side verification (in development):** a verifier for signed AI agents (Web Bot Auth) and operators' published IP ranges is being built on the [`phase2-verifier`](https://github.com/Narrativva-Labs/visitor-verdict/tree/phase2-verifier/server) branch, alongside Phase 1 field validation. Its first integration is [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side), a server-side GA4 collector that forwards the browser class and verified agent labels to GA4 (branch [`agent-verification`](https://github.com/Narrativva-Labs/vanilla-server-side/tree/agent-verification)). Not released yet; see the [roadmap](ROADMAP.md#phase-2--recognise-and-measure-ai-agents-on-the-server-in-development).

## Pinned direct-script build

An alternative to the GTM detector tag. Set `window.visitorVerdictConfig` before loading if needed; optional worker/WebGL probes default off in this standalone build.

```html
<script src="https://cdn.jsdelivr.net/gh/Narrativva-Labs/visitor-verdict@v1.4.1/dist/visitor-verdict.min.js"
        integrity="sha384-1Sx10X9oJuk4PjDMCur/QDy/r+SfyhSilzi6Il5xlU3m2jpH8mU04yP5yaH2zyU7"
        crossorigin="anonymous"></script>
```

**Final timing (1.2.0):** the first tab hide now publishes final, with pagehide as fallback and the 8-second visible timer unchanged. A short tab switch ends behaviour observation early; set `finalOnHidden: false` before loading to keep the earlier pause behaviour. Agent UI markers can still publish a later agent phase. A suspicious final carries to one following document via `CS`, without becoming hard evidence.

The integrity value comes from [dist/visitor-verdict.min.js.sri](dist/visitor-verdict.min.js.sri). Loading from a CDN is a page resource request; the detector itself sends no requests. Self-host the same artifact if preferred. Direct loading still requires wiring your analytics integration.

## Documentation

- [Versioned signal registry: sources, product versions, review dates and known false positives](docs/signals.md)
- [How it works: signals, configuration, public interface and hardening](docs/how-it-works.md)
- [Privacy, storage and consent](docs/privacy.md)
- [GTM setup and GA4 reporting](docs/ga4-reporting.md)
- [Conversion guidance: label, never exclude](docs/conversion-guidance.md)
- [Tests, adversarial benchmark and known limits](docs/benchmark.md)
- Related: [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side), server-side GA4 collector and first integration of the server verifier (in development)
- [Agent research and field observations](research/agents-and-tells.md)
- [Validation protocol v2: controlled runs with known ground truth](docs/study/validation-protocol.md) — pilot round 1 on our own demo shop, 2026-11-22; no published accuracy figures yet
- [Lightweight field-validation protocol](docs/study/protocol.md) — validation in progress since 2026-11-19, no study results yet; agent runs on our own test shop: [field observations](research/agents-and-tells.md#field-observations-v10-2026-11-19)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

For local builds and checks, see [Contributing](CONTRIBUTING.md). Report human misclassifications with short debug codes and synthetic reproductions, without URLs, IPs or visitor data. See [Security](SECURITY.md) for private data-leak reports.

[MIT](LICENSE). Copyright © 2026 František Bujnovský.
