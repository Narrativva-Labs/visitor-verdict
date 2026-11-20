# Roadmap

Phase 1 field validation and its exit criterion remain open. Phase 2 started early as separate design and lab/demo work on branch `phase2-verifier`; its server package is not released. Production use of Phase 2 waits for Phase 1 validation.

## Phase 1 — Label clear automation in GA4 (current)

Goal: mark the obvious automation that GA4's built-in bot filtering lets through (headless browsers, WebDriver-driven browsers, audit and monitoring tools, self-declared agents) so it can be excluded from reports. It is not meant to catch operators who deliberately disguise automation, and it makes no accuracy guarantee.

- [x] Browser detector with four classes (`human`, `automated`, `suspicious`, `declared_agent`); `suspicious` is a secondary view, not part of the headline number
- [x] GTM import, GA4 event, event parameter on GA4 event tags, user property
- [x] Contracts, fuzz tests, synthetic browser suites, adversarial benchmark, manual human lab
- [x] CSP-friendly sandboxed variable template
- [x] v1.0.0 release (hardening, CI, pinned CDN build with SRI)
- [x] Class on the first `page_view` (Google tag fired on the detector's initial result, with a short timer fallback)
- [ ] Lightweight field validation, 2–4 weeks on a few live sites: share of clear automation per site, coverage, no converting or engaged sessions labelled as clear automation, small panel of real people and devices
- [ ] Publish the results, including what is missed

**Exit criterion (open):** field results show clear automation is labelled and real visitors are not, on every validated site.

## Phase 2 — Recognise and measure AI agents on the server (in progress)

Goal: recognise and measure AI agents and verified bots, keep their conversions and label them. Planned conversion routing uses how the conversion itself is verified (paid order, confirmed lead); routing is not implemented in the library or collector. See [conversion guidance](docs/conversion-guidance.md).

- [x] Smoke test on one demo shop (2026-11-20): 32/32 signed requests verified in one ChatGPT agent header-capture run, including analytics requests to a first-party subdomain; [sample and limits](research/agents-and-tells.md#field-observations-v10-2026-11-19)
- [x] Server verifier library in [`server/`](server/README.md): Web Bot Auth signatures, operators' published IP ranges, optional reverse DNS; browser evidence, claimed identity and server verification kept as separate fields
- [x] Label hits in the self-hosted collector (GA4 field `agent_verification`), nothing withheld; ChatGPT agent smoke test on one demo shop (2026-11-20): GA4 Realtime showed the server label on 5/5 `view_cart` events after warming, 1/5 before; standard reports and BigQuery not verified
- [x] Warm the key cache and serve cached keys while refreshing
- [ ] Longer field test on live sites
- [ ] Measure on live sites how many bot and agent conversions reach ad platforms (GA4 → Google Ads import, Conversions API), before any conversion routing
- [ ] Then test the browser class as a negative screen for ad conversions (after the privacy review)
- [ ] Server-side GTM: verification service and optional routing of conversions by verification, built only for a real lead-spam case

## Later (ideas, not commitments)

- GTM Community Template Gallery template (separate repository, pinned CDN build)
- Scheduled checks of official AI-agent user-agent documentation
