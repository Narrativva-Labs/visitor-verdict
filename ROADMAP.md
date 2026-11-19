# Roadmap

Visitor Verdict grows in small, verified steps. A phase starts only after the previous one has been validated on real traffic.

## Phase 1 — Label clear automation in GA4 (current)

Goal: mark the obvious automation that GA4's built-in bot filtering lets through (headless browsers, WebDriver-driven browsers, audit and monitoring tools, self-declared agents) so it can be excluded from reports. It is not meant to catch operators who deliberately disguise automation, and it makes no accuracy guarantee.

- [x] Browser detector with four classes (`human`, `automated`, `suspicious`, `declared_agent`); `suspicious` is a secondary view, not part of the headline number
- [x] GTM import, GA4 event, event parameter on GA4 event tags, user property
- [x] Contracts, fuzz tests, synthetic browser suites, adversarial benchmark, manual human lab
- [ ] v1.0.0 release (hardening, CI, pinned CDN build with SRI)
- [ ] Class on the first `page_view` (Google tag fired on the detector's initial result, with a short timer fallback)
- [ ] Lightweight field validation, 2–4 weeks on a few live sites: share of clear automation per site, coverage, no converting or engaged sessions labelled as clear automation, small panel of real people and devices
- [ ] Publish the results, including what is missed

**Exit criterion:** field results show clear automation is labelled and real visitors are not, on every validated site.

## Phase 2 — Server-side and conversion APIs (planned)

Starts only after Phase 1 meets its exit criterion.

- Keep clear automation out of conversion feedback: server-side GTM reads `traffic_class` and withholds or marks conversions for Meta Conversions API and Google Ads Enhanced Conversions
- Server-side verification of declared agents (HTTP message signatures / Web Bot Auth, operators' published IP ranges)
- Keep browser evidence, claimed identity and server verification as separate fields

## Later (ideas, not commitments)

- GTM Community Template Gallery template (separate repository, pinned CDN build)
- CSP-friendly sandboxed variable template
- Scheduled checks of official AI-agent user-agent documentation
