# Roadmap

Visitor Verdict grows in small, verified steps. Each release states what has and has not been validated; field validation on real traffic is in progress. Phase 2 development runs alongside it and is released only after Phase 1 meets its exit criterion.

## Phase 1 — Label clear automation in GA4 (current)

Goal: mark the obvious automation that GA4's built-in bot filtering lets through (headless browsers, WebDriver-driven browsers, audit and monitoring tools, self-declared agents) so it can be reported separately. Visitor Verdict labels; it never excludes data by default. It is not meant to catch operators who deliberately disguise automation, and it makes no accuracy guarantee.

- [x] Browser detector with four classes (`human`, `automated`, `suspicious`, `declared_agent`); `suspicious` is a secondary view, not part of the headline number
- [x] GTM import, GA4 event, event parameter on GA4 event tags, user property
- [x] Contracts, fuzz tests, synthetic browser suites, adversarial benchmark, manual human lab
- [x] CSP-friendly sandboxed variable template
- [x] v1.0.0 release (hardening, CI, pinned CDN build with SRI)
- [x] Class on the first `page_view` (Google tag fired on the detector's initial result, with a short timer fallback)
- [x] v1.1.0: agent UI markers (OpenAI agent overlay, older Claude in Chrome) as `declared_agent` with `traffic_agent`, new `agent` phase
- [ ] Detect current Claude in Chrome, whose UI sits in a closed shadow root (open question; no heuristic without a field check)
- [ ] Versioned signal registry: for each marker or token its source, version range, date last checked and status (experimental / validated / retired), so signals that agents stop emitting are retired instead of silently missing
- [ ] More agent UI markers only with a public source and a version (candidate: Genspark `#genspark-float-bar`, reported by a third party), first as evidence without changing the class
- [ ] WebMCP as two separate fields: the browser supports it (`document.modelContext`) and a tool was actually used (`toolactivated`); support alone never labels a visitor
- [ ] Lightweight field validation, 2–4 weeks on a few live sites (in progress since 2026-11-19): share of clear automation per site, coverage, no converting or engaged sessions labelled as clear automation, small panel of real people and devices
- [ ] Publish the results, including what is missed

**Exit criterion:** field results show clear automation is labelled and real visitors are not, on every validated site.

## Phase 2 — Recognise and measure AI agents on the server (in development)

Built on the [`phase2-verifier`](https://github.com/Narrativva-Labs/visitor-verdict/tree/phase2-verifier/server) branch; not released and not on `main` yet. The branch [roadmap](https://github.com/Narrativva-Labs/visitor-verdict/blob/phase2-verifier/ROADMAP.md) is the detailed, current version.

Goal: recognise and measure AI agents and verified bots, keep their conversions and label them. Conversion routing is not implemented; any routing would use how the conversion itself is verified (paid order, confirmed lead). See the [conversion guidance](https://github.com/Narrativva-Labs/visitor-verdict/blob/phase2-verifier/docs/conversion-guidance.md).

- [x] Server verifier library ([`server/`](https://github.com/Narrativva-Labs/visitor-verdict/tree/phase2-verifier/server), 0.3.3, unpublished): Web Bot Auth / HTTP Message Signatures (RFC 9421) against operators' key directories, operators' published IP ranges, replay protection; browser evidence, claimed identity and server verification kept as separate fields
- [x] First integration: [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side/tree/agent-verification) labels GA4 hits with `vv_type` and `vv_detail`, nothing withheld; running on its live demo since 2026-11-20, where a signed ChatGPT agent session was verified
- [ ] Keep evidence and identity apart in the output: a browser hint about the operator (UI marker, user-agent token) is never reported as a verified operator
- [ ] More signing operators from public key directories (Meta Muse `muse.ai`, Browserbase, Manus, Google `agent.bot.goog`, Amazon Bedrock AgentCore when enabled), with intermediaries such as Browserbase reported as infrastructure, not as the agent
- [ ] Personal Agent Protocol (Poppy 1.0) as an optional verifier: a verified session means an agent acting for a person; a manifest or `client_id` alone is only a claim
- [ ] Agents that never load the page: orders placed through agentic checkout protocols (ACP, UCP) are measured from the shop or payment backend and sent server-side with an agent label and the protocol as the channel; other API calls (catalogue, MCP) are labelled on the server, since a browser detector cannot see them
- [ ] Longer field test on live sites
- [ ] Measure on live sites how many bot and agent conversions reach ad platforms (GA4 → Google Ads import, Conversions API), before any conversion routing
- [ ] Label conversions for Meta Conversions API and Google Ads Enhanced Conversions in server-side GTM; nothing withheld by default (see [conversion guidance](docs/conversion-guidance.md))
- [ ] Merge to `main` and release after Phase 1 meets its exit criterion

## Later (ideas, not commitments)

- GTM Community Template Gallery template (separate repository, pinned CDN build)
- Scheduled checks of official AI-agent user-agent documentation
- Behaviour signals from published agent studies (cursor teleports, typing without key events, zero-duration scroll bursts), only after a lab check against autofill, paste, keyboard navigation and assistive technology
- Transport fingerprints (JA4, HTTP/2, client hints versus user agent) where a site's own CDN or proxy already provides them
