# Roadmap

Visitor Verdict grows in small, verified steps. Each release states what has and has not been validated; field validation on real traffic is in progress. Phase 2 development runs alongside it and is released only after Phase 1 meets its exit criterion.

## Phase 1 — Label clear automation in GA4 (current)

Goal: mark the obvious automation that GA4's built-in bot filtering lets through (headless browsers, WebDriver-driven browsers, audit and monitoring tools, self-declared agents) so it can be reported separately. Visitor Verdict labels; it never excludes data by default. It is not meant to catch operators who deliberately disguise automation, and it makes no accuracy guarantee.

- [x] Browser detector with four classes (`human`, `automated`, `suspicious`, `declared_agent`); `suspicious` is a secondary view, not part of the headline number
- [x] v1.4.1: guarded UC/BT, WK/UB corroboration fixes, explicit agent/claim clearing, and B7 server precedence in the imported current-class variable
- [x] GTM import, GA4 event, event parameter on GA4 event tags (event-scoped dimensions + SQL session classification; `traffic_class` user property removed)
- [x] Contracts, fuzz tests, synthetic browser suites, adversarial benchmark, manual human lab
- [x] CSP-friendly sandboxed variable template
- [x] v1.0.0 release (hardening, CI, pinned CDN build with SRI)
- [x] Class on the first `page_view` (Google tag fired on the detector's initial result, with a short timer fallback)
- [x] v1.1.0: agent UI markers (OpenAI agent overlay, older Claude in Chrome) as `declared_agent` with `traffic_agent`, new `agent` phase
- [x] v1.4.0: experimental host-shape check (`DH`, `traffic_agent_claim: 'dom_host'`) for Claude in Chrome 1.0.107 (observed 4/4 controlled runs vs 0/2 controls in one profile; field FP monitoring required via `traffic_agent_claim`)
- [ ] Validate `dom_host` false-positive rate in field traffic across widget/portal sites before promoting it beyond experimental status
- [x] Versioned signal registry: for each marker or token its source, version range, date last checked and status (experimental / validated / retired), so signals that agents stop emitting are retired instead of silently missing
- [ ] More agent UI markers only with a public source and a version (candidate: Genspark `#genspark-float-bar`, reported by a third party), first as evidence without changing the class
- [x] v1.3.0: WebMCP informational fields (`traffic_webmcp`: `none` | `capable` | `used`, and `traffic_webmcp_count`, capped at 255 per document for trusted `toolactivated`/`toolcancel` events); capability alone never labels a visitor; observed/page-forgeable, GA4 undercounts invocations after final
- [ ] Lightweight field validation, 2–4 weeks on a few live sites (in progress since 2026-11-19): share of clear automation per site, coverage, no converting or engaged sessions labelled as clear automation, small panel of real people and devices
- [ ] Publish the results, including what is missed

**Exit criterion:** field results show clear automation is labelled and real visitors are not, on every validated site.

## Phase 2 — Recognise and measure AI agents on the server (in development)

Developed in the separate server verifier library (`visitor-verdict-server` 0.6.1, unpublished) and server-side GTM template (`visitor-verdict-sgtm`); not released on `main` yet.

Goal: recognise and measure AI agents, verified crawlers and verified automation platforms, keep their conversions and label them. Conversion routing is not implemented; any routing would use how the conversion itself is verified (paid order, confirmed lead). See the [conversion guidance](docs/conversion-guidance.md).

- [x] Server verifier library (v0.6.1, unpublished): Web Bot Auth / HTTP Message Signatures (RFC 9421) against operators' key directories, operators' published IP ranges, replay protection; browser evidence, claimed identity and server verification kept as separate fields; `agent_verified` alone verifies identity, not purpose; SQL separates `agent_verified_unknown_purpose`; verified automation platforms (`automation_verified`: Browserbase, Kernel, Cloudflare Browser Run, Shopify Cloudsurf) kept as their own group separate from user agents and crawlers
- [x] First integration: [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side/tree/agent-verification) labels GA4 hits with `vv_type` and `vv_detail`, nothing withheld; running on its live demo since 2026-11-20, where a signed ChatGPT cloud agent session was verified as `agent_verified` (while ending `human` in the browser detector)
- [ ] Keep evidence and identity apart in the output: a browser hint about the operator (UI marker, user-agent token) is never reported as a verified operator
- [x] More signing operators from public key directories in server v0.6.1 (Meta Muse `muse.ai`, Browserbase, Kernel, Cloudflare Browser Run, Shopify Cloudsurf, Manus, Google `agent.bot.goog`), with automation platforms/intermediaries reported as `automation_verified` rather than user agents — **caveat:** 8 of 9 signing operators currently have `verifiedByCapture: false` pending live capture verification; Amazon Bedrock AgentCore remains pending/opt-in
- [x] Personal Agent Protocol (Poppy 1.0) optional verifier implemented in server v0.6.1 (`verifiedByCapture: false` — live capture verification pending; a manifest or `client_id` alone remains unverified)
- [ ] Agents that never load the page: orders placed through agentic checkout protocols (ACP, UCP) are measured from the shop or payment backend and sent server-side with an agent label and the protocol as the channel; other API calls (catalogue, MCP) are labelled on the server, since a browser detector cannot see them
- [ ] Longer field test on live sites
- [ ] Measure on live sites how many bot and agent conversions reach ad platforms (GA4 → Google Ads import, Conversions API), before any conversion routing
- [ ] Label conversions for Meta Conversions API (`custom_data`) and Google Ads custom conversion variables in server-side GTM strictly as passive reporting parameters (post-consent, never as an optimization target or exclusion); nothing withheld by default (see [conversion guidance](docs/conversion-guidance.md))
- [ ] Merge to `main` and release after Phase 1 meets its exit criterion

## Later (ideas, not commitments)

- GTM Community Template Gallery template (separate repository, pinned CDN build)
- Scheduled checks of official AI-agent user-agent documentation
- Behaviour signals from published agent studies (cursor teleports, typing without key events, zero-duration scroll bursts), only after a lab check against autofill, paste, keyboard navigation and assistive technology
- Transport fingerprints (JA4, HTTP/2, client hints versus user agent) where a site's own CDN or proxy already provides them
- Labels joined with the real business outcome (paid, cancelled, refunded order; accepted or rejected lead) from the shop or CRM backend, so reports show revenue and valid leads by visitor type. Needs the site owner's cooperation, so it comes after the label-only reports are tested; first as a one-off order export joined on `transaction_id`, a live backend connection only later
