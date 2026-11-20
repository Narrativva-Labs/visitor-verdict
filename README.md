# Visitor Verdict

Label clear browser automation in GA4 with a privacy-minimal, client-side detector.

Visitor Verdict labels clear automation in GA4 that GA4's built-in bot filtering lets through. It does not try to catch operators who deliberately disguise automation and makes no accuracy guarantee. It is a first, privacy-minimal layer.

## Phase 2 (server-side verification, in progress)

On branch `phase2-verifier`, the [`server/` preview library](server/README.md) verifies operator HTTP signatures and published IP evidence independently of the browser class. The server package is not released or published to npm. Design and lab/demo work started before Phase 1 field validation; production use waits for that validation.

In a 2026-11-20 ChatGPT agent smoke test on one demo shop, 32 captured requests from one header-capture run had valid signatures. GA4 Realtime showed `signature_valid` on 5/5 `view_cart` events after cache warming (1/5 before). This is one operator on one site, not an accuracy or attribution study. See [field observations](research/agents-and-tells.md#field-observations-v10-2026-11-19) and the [conversion reference design](docs/conversion-guidance.md).

## What you get

| | v1.0.0 |
|---|---|
| Classes | `automated` (automation evidence), `declared_agent` (unverified UA claim), `suspicious` (uncertain evidence), `human` (no automation detected) |
| Catches | WebDriver/headless and Selenium/Puppeteer/Playwright defaults, audit tools, declared AI fetchers; some masked headless setups via opt-in UB → `suspicious`. Feature/configuration dependent, not universal tool detection. |
| Known misses | Patchright, undetected-chromedriver, nodriver, stealth with human-like input; see the [observed benchmark](docs/benchmark.md). |
| Footprint | ~13.7 KB minified; ~3 ms default in earlier local measurements; no runtime dependencies. |
| Privacy | One bounded `sessionStorage` key (`visitor_verdict`); no identifiers, fingerprints, cookies or detector requests. A blocked optional worker may cause a browser CSP report. |
| Integration | Initial/final data-layer events, GTM import, GA4 event parameters and last-observed user property. |

## Five-minute quickstart

1. In your GTM web container, **Admin → Import Container**, select [gtm/container-import.json](gtm/container-import.json), choose **Merge**, and review conflicts. The import creates no Google tag.
2. Set **VV - GA4 measurement ID** to the site's existing measurement ID. Keep **VV - detector** on **All Pages**, once per page, with no additional consent check; establish consent defaults first and review your site's consent decision below.
3. On the **existing Google tag**, replace its early All Pages/Initialization trigger with **VV - initial OR VV - timer fallback 1s** as two normal firing triggers (not a trigger group). Set **Once per page**. In its Shared event settings, set `traffic_class={{VV - current class}}`. This lets the first `page_view` use the initial result; the one-second fallback keeps the Google tag available if detection is delayed or unavailable. Retain existing consent handling.
4. Add `traffic_class={{VV - current class}}` to your other **GA4 event tags**, evaluated at firing time. Keep **VV - GA4 traffic_class** on **VV - final**, with its four `VV - DLV …` event mappings and DLV user property unchanged: it records that final publication.
5. In GA4 **Admin → Data display → Custom definitions**, create **Traffic class (event)** for event parameter `traffic_class` and **Traffic class (user — last observed)** for user property `traffic_class`. Optionally add event-scoped `traffic_phase` and `traffic_version`. Use event evidence for reporting; keep `suspicious` as a secondary view.
6. Preview in Tag Assistant: verify initial/final events, `traffic_version: '1.0.0'`, the first `page_view` class, final DLV values, one Google-tag start, consent paths and navigation. Then publish through your normal review process. Full [setup and reporting guide](docs/ga4-reporting.md), including the [sandboxed current-class template](gtm/templates/vv-current-class.tpl) for CSP-sensitive sites.

> **Limits:** `human` means no automation detected, not proof of a person. `suspicious` is a secondary view. This is client-side and spoofable, for reporting only: never block users or deny service. Consent is the site owner's decision; pre-consent classifications must never feed advertising platforms. Read the [privacy details](docs/privacy.md).

[![CI](https://github.com/Narrativva-Labs/visitor-verdict/actions/workflows/ci.yml/badge.svg)](https://github.com/Narrativva-Labs/visitor-verdict/actions/workflows/ci.yml)

## Pinned direct-script build

An alternative to the GTM detector tag. Set `window.visitorVerdictConfig` before loading if needed; optional worker/WebGL probes default off in this standalone build.

```html
<script src="https://cdn.jsdelivr.net/gh/Narrativva-Labs/visitor-verdict@v1.0.0/dist/visitor-verdict.min.js"
        integrity="sha384-lF6ouCYp8JoFz2lLN6BzdniSmk3W2OgQZmvqI5Glna1sHzHBvsptaV9Qy/KKO7/D"
        crossorigin="anonymous"></script>
```

The integrity value comes from [dist/visitor-verdict.min.js.sri](dist/visitor-verdict.min.js.sri). Loading from a CDN is a page resource request; the detector itself sends no requests. Self-host the same artifact if preferred. Direct loading still requires wiring your analytics integration.

## Documentation

- [How it works: signals, configuration, public interface and hardening](docs/how-it-works.md)
- [Privacy, storage and consent](docs/privacy.md)
- [GTM setup and GA4 reporting](docs/ga4-reporting.md)
- [Tests, adversarial benchmark and known limits](docs/benchmark.md)
- [Lightweight field-validation protocol](docs/study/protocol.md) — prospective; Phase 1 field validation remains open
- [Server verifier preview](server/README.md)
- [Conversion reference design](docs/conversion-guidance.md)
- [Agent research and field observations](research/agents-and-tells.md)
- [Session analysis SQL (not yet validated against a live export)](docs/analysis/session-classification.sql)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

For local builds and checks, see [Contributing](CONTRIBUTING.md). Report human misclassifications with short debug codes and synthetic reproductions, without URLs, IPs or visitor data. See [Security](SECURITY.md) for private data-leak reports.

[MIT](LICENSE). Copyright © 2026 František Bujnovský.
