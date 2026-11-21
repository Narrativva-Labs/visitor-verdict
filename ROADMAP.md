# Roadmap

Visitor Verdict grows in small, verified steps. Nothing is released before it has been validated on real traffic. Phase 2 development runs alongside Phase 1 field validation; it is released only after Phase 1 meets its exit criterion.

## Phase 1 — Label clear automation in GA4 (current)

Goal: mark the obvious automation that GA4's built-in bot filtering lets through (headless browsers, WebDriver-driven browsers, audit and monitoring tools, self-declared agents) so it can be excluded from reports. It is not meant to catch operators who deliberately disguise automation, and it makes no accuracy guarantee.

- [x] Browser detector with four classes (`human`, `automated`, `suspicious`, `declared_agent`); `suspicious` is a secondary view, not part of the headline number
- [x] GTM import, GA4 event, event parameter on GA4 event tags, user property
- [x] Contracts, fuzz tests, synthetic browser suites, adversarial benchmark, manual human lab
- [x] CSP-friendly sandboxed variable template
- [x] v1.0.0 release (hardening, CI, pinned CDN build with SRI)
- [x] Class on the first `page_view` (Google tag fired on the detector's initial result, with a short timer fallback)
- [ ] Lightweight field validation, 2–4 weeks on a few live sites (in progress since 2026-11-19): share of clear automation per site, coverage, no converting or engaged sessions labelled as clear automation, small panel of real people and devices
- [ ] Publish the results, including what is missed

**Exit criterion:** field results show clear automation is labelled and real visitors are not, on every validated site.

## Phase 2 — Server-side verification and conversion APIs (in development)

Built on the [`phase2-verifier`](https://github.com/Narrativva-Labs/visitor-verdict/tree/phase2-verifier/server) branch. Not released and not on `main` yet.

- [x] Server verifier library ([`server/`](https://github.com/Narrativva-Labs/visitor-verdict/tree/phase2-verifier/server), 0.3.3, unpublished): Web Bot Auth / HTTP Message Signatures (RFC 9421) against operators' key directories, operators' published IP ranges, replay protection
- [x] Browser evidence, claimed identity and server verification kept as separate fields
- [x] First integration: [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side/tree/agent-verification), optional `AGENT_VERIFICATION=on`, running on its live demo since 2026-11-20 (a signed ChatGPT agent session was verified there)
- [ ] Field check of the server labels against known test traffic and real visitors
- [ ] Keep clear automation out of conversion feedback: server-side GTM reads `traffic_class` and withholds or marks conversions for Meta Conversions API and Google Ads Enhanced Conversions
- [ ] Merge to `main` and release after Phase 1 meets its exit criterion

## Later (ideas, not commitments)

- GTM Community Template Gallery template (separate repository, pinned CDN build)
- Scheduled checks of official AI-agent user-agent documentation
