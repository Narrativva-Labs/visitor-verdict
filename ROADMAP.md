# Roadmap

Visitor Verdict grows in small, verified steps. A phase starts only after the previous one has been validated on real traffic.

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

**Exit criterion:** field results show clear automation is labelled and real visitors are not, on every validated site.

## Phase 2 — Recognise and measure AI agents on the server (in progress)

Goal: recognise and measure AI agents and verified bots, keep their conversions and label them. Conversions are routed by how the conversion itself is verified (paid order, confirmed lead), not dropped because an agent made them. See [conversion guidance](docs/conversion-guidance.md).

- [x] Measurement: the ChatGPT agent's cloud browser signs every request with Web Bot Auth, including analytics hits to a first-party subdomain (2026-11-20)
- [x] Server verifier library in [`server/`](server/README.md): Web Bot Auth signatures, operators' published IP ranges, optional reverse DNS; browser evidence, claimed identity and server verification kept as separate fields
- [x] Label hits in the self-hosted collector (GA4 field `agent_verification`), nothing withheld; first end-to-end test with the ChatGPT agent on the demo shop (2026-11-20)
- [x] Warm the key cache and serve cached keys while refreshing
- [ ] Longer field test on live sites
- [ ] Measure on live sites how many bot and agent conversions reach ad platforms (GA4 → Google Ads import, Conversions API), before any conversion routing
- [ ] Then test the browser class as a negative screen for ad conversions (after the privacy review)
- [ ] Server-side GTM: verification service and optional routing of conversions by verification, built only for a real lead-spam case

## Later (ideas, not commitments)

- GTM Community Template Gallery template (separate repository, pinned CDN build)
- Scheduled checks of official AI-agent user-agent documentation
