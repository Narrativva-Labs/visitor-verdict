# Roadmap

Visitor Verdict grows in small, verified steps. Each release states what has and has not been validated; field validation on real traffic is in progress. Phase 2 development runs alongside it and is released only after Phase 1 meets its exit criterion.

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

## Phase 2 — Recognise and measure AI agents on the server (in development)

Built on the [`phase2-verifier`](https://github.com/Narrativva-Labs/visitor-verdict/tree/phase2-verifier/server) branch; not released and not on `main` yet. The branch [roadmap](https://github.com/Narrativva-Labs/visitor-verdict/blob/phase2-verifier/ROADMAP.md) is the detailed, current version.

Goal: recognise and measure AI agents and verified bots, keep their conversions and label them. Conversion routing is not implemented; any routing would use how the conversion itself is verified (paid order, confirmed lead). See the [conversion guidance](https://github.com/Narrativva-Labs/visitor-verdict/blob/phase2-verifier/docs/conversion-guidance.md).

- [x] Server verifier library ([`server/`](https://github.com/Narrativva-Labs/visitor-verdict/tree/phase2-verifier/server), 0.3.3, unpublished): Web Bot Auth / HTTP Message Signatures (RFC 9421) against operators' key directories, operators' published IP ranges, replay protection; browser evidence, claimed identity and server verification kept as separate fields
- [x] First integration: [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side/tree/agent-verification) labels GA4 hits with `vv_type` and `vv_detail`, nothing withheld; running on its live demo since 2026-11-20, where a signed ChatGPT agent session was verified
- [ ] Longer field test on live sites
- [ ] Measure on live sites how many bot and agent conversions reach ad platforms (GA4 → Google Ads import, Conversions API), before any conversion routing
- [ ] Then test the browser class as a negative screen for ad conversions (after the privacy review)
- [ ] Server-side GTM: verification service and optional routing of conversions by verification, built only for a real lead-spam case
- [ ] Merge to `main` and release after Phase 1 meets its exit criterion

## Later (ideas, not commitments)

- GTM Community Template Gallery template (separate repository, pinned CDN build)
- Scheduled checks of official AI-agent user-agent documentation
