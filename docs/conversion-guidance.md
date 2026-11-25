# Conversion guidance: label, never exclude

Decision as of 22 November 2026 (clarified 23 November 2026 for passive ad-platform reporting parameters and `automation_verified`). It replaces earlier reference designs that held unverified leads or kept some conversions away from ad platforms.

## The rule

**Visitor Verdict only labels traffic.** By default nothing is excluded, filtered, held or withheld anywhere:

- **GA4:** every event and conversion is collected and kept. Labels are event parameters (`traffic_class`, `traffic_agent`, `traffic_agent_claim`, `traffic_phase`, plus server-side `vv_type` and `vv_detail` where a server collector is used); reports compare labelled segments, they do not delete them.
- **Google Ads and Meta:** send conversions exactly as you would without Visitor Verdict. The project recommends no exception triggers, no holds and no drops based on the class. Where you also want visibility in ad-platform reporting (for example via server-side GTM), you may attach Visitor Verdict labels **strictly as passive reporting parameters** (Meta Conversions API `custom_data` or a Google Ads custom conversion variable), subject to your consent rules — **never** as an optimization/bidding target and **never** for exclusion.
- **Leads and sign-ups:** process and send them as usual. Lead quality is judged by your normal qualification (confirmed email, CRM status), not by the traffic class.

The labels are for analysis and review. Whether to change what you send to an ad platform is your own decision; it is not a default of this project.

## Why

- **Agent-assisted purchases are real revenue.** Browser agents such as OpenAI's in-browser agent or Claude in Chrome run in a person's own browser, with that person's account and card. The person asked the agent to act. A `declared_agent` purchase with `traffic_agent` set (excluding `server_intermediary`) can be a customer buying through a tool; the browser label alone does not establish purpose. Coverage remains partial: v1.4.0 adds an experimental host-shape check (`traffic_agent_claim: 'dom_host'`) for Claude in Chrome 1.0.107 (4/4 controlled runs vs 0/2 controls in one profile, with unverified field false positives that must be monitored via `traffic_agent_claim`), while remote cloud browsers such as ChatGPT cloud agent end `human` in the browser and are recognised only on the server via HTTP Message Signatures. Agent-assisted revenue in browser-only setups is therefore a lower bound.
- **Verified automation platforms are not user agents.** Server-side verification distinguishes verified automation infrastructure (`vv_type = 'automation_verified'`, e.g., Browserbase, Kernel, Cloudflare Browser Run, Shopify Cloudsurf — or `traffic_agent_claim = 'server_intermediary'` in browser echo) whose end purpose (QA, scraping, or user-delegated automation) is unknown. Report `automation_verified` as its own group, separate from both customer user agents (`agent_user`) and crawlers (`crawler_verified`).
- **Browser labels are self-declared, unverified evidence.** A UA token or an agent UI marker is a claim, and `human` means only that no automation was detected. Neither is reliable enough to decide on its own which revenue counts.
- **A verified operator is not a verified customer.** A signature verifies the operator, not a real customer’s interest, purchase approval or payment legitimacy. Payment confirmation and fraud checks remain separate.
- **Excluding by default loses data you cannot get back.** A held or dropped conversion is gone for bidding and attribution; a labelled one can still be analysed, segmented or adjusted later.
- **Payment and fraud checks already exist.** Refunds, chargebacks and fraud review belong to the payment and order systems. Send orders from the server after payment confirmation, with their order ID, so that platforms can apply later adjustments (for example Google Ads [conversion adjustments](https://support.google.com/google-ads/answer/7686447)).
- **Unsigned traffic can still be automated.** The masked-headless negative control returned `no_signature` and `automated`; signatures do not cover all automation.

## How to report on labelled conversions

Use GA4 or the BigQuery export; see [GA4 reporting](ga4-reporting.md#reporting), [Explorations](analysis/ga4-explorations.md) and [Looker Studio / Campaign dashboard](analysis/looker-studio.md).

1. **Headline: all sessions and all revenue.** Report purchase conversion rate as purchasing sessions / sessions over all sessions. Keep purchases and leads separate; never sum `purchases + leads`.
2. **Break revenue down by separated label groups, do not subtract it or lump them together.** Show purchases, deduplicated USD revenue and leads separately for user-directed agents (`agent_user`), verified agents whose purpose is unknown (`agent_verified_unknown_purpose`), verified automation platforms (`automation_verified`), browser automation (`automation`), verified crawlers (`crawler`, server-side), uncertain traffic (`suspicious`) and unlabelled sessions (`unknown`). Agent-assisted revenue stays in the total.
3. **Use the session, not the event (and never a user property).** A session counts as labelled if any event carries the label; a later `human` does not cancel earlier evidence. Initial, agent and final hits for one page are expected duplicates.
4. **Compare rates with and without labelled sessions as a sensitivity check.** Leaving low-converting automated sessions out of a comparison raises conversion rate by arithmetic; that is not marketing improvement. Keep the same cohort in numerator and denominator.
5. **Review, do not relabel.** Converting or long-engaged `automated` sessions deserve a look (test orders, monitoring, a real person with unusual tooling); they are not automatically fraud and not automatically human.
6. **Watch agent share over time.** `traffic_phase = agent`, `traffic_agent` and `traffic_agent_claim` show how often agents act on the site, which operator, and which evidence source (`dom_marker`, experimental `dom_host`, `ua_token`, or server verification); useful for checkout and form design (for example, agents need clear labels and no hidden steps).

## What not to do

- Do not exclude, hold or drop conversions, leads or sessions by default because of `traffic_class` or `vv_type`.
- If you forward Visitor Verdict labels to ad platforms (for example via server-side GTM), send them **only as passive reporting parameters** (such as Meta Conversions API `custom_data` or a Google Ads custom conversion variable) and **only with appropriate consent**; **never** use the label as a bidding/optimization target, **never** split conversion goals for Smart Bidding / Advantage+ by label, and **never** use it to exclude conversions.
- Do not use the class to block access, deny service or make decisions about individuals.
- Do not use pre-consent classifications for advertising or send pre-consent labels to ad platforms; follow the site's consent setup (see [privacy](privacy.md#consent-and-deployment)).

For practical Meta and Google Ads setup, use the [passive reporting recipes](ad-platform-recipes.md).

## Server-side verification

Server-side verification of signed agents (Web Bot Auth / HTTP Message Signatures, published IP ranges, and optional Poppy 1.0) is provided by the [Node server library](../server/README.md) (v0.8.0), with [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side) as its first collector integration. The separate sGTM template uses IP and browser evidence without cryptographic verification. It follows the same rule: it adds labels (`agent_verified`, `agent_unverified`, `crawler_verified`, `crawler_unverified`, `automation_verified`, `bot_automation`, `bot_spoofed`, `bot_suspicious`, `human`, `unclassified`), it withholds nothing, and any label forwarded to ad platforms in sGTM is strictly a passive reporting parameter.

`agent_verified` confirms identity, not customer intent: `purpose=user_directed` enters the server SQL `agent_user` group, while unknown or missing purpose enters `agent_verified_unknown_purpose` (including verified Poppy identities). IP-verified user-directed fetchers (`ChatGPT-User`, `Claude-User`, `Perplexity-User`, `MistralAI-User`, `Kimi-User`, Google fetchers) emit `crawler_verified` while retaining `user_directed` in `vv_detail` segment 3. Server library 0.8.0 emits `automation_verified`, `crawler_unverified` and `unclassified` (replacing `pending`); SQL also accepts legacy `pending` and older `agent_verified` + `purpose=intermediary`. Browser echo `server_signature`/`server_ip` does not encode purpose, so browser-only reporting cannot make this distinction; use the collector’s `vv_detail` with Query B/B2.

### Server labels (library 0.8.0)

| `vv_type` | Meaning | Suggested collector rank |
|---|---|---|
| `unclassified` | No browser class or qualifying server evidence yet (formerly `pending`) | 0 |
| `human` | Browser reports no automation evidence; not proof of a person | 1 |
| `bot_suspicious` | Uncertain browser evidence | 2 |
| `crawler_unverified` | Unverified UA-only claim for a documented crawler or fetcher token (including untrusted IP or uncertain `ip_mismatch`) | 3 |
| `agent_unverified` | Browser declaration (`dom_marker`/`dom_host`), unverified `Signature-Agent`/`poppy_session`, unverified agent token (`Claude-Agent`/`Google-Agent`), or unknown/unmapped UA token | 3 |
| `bot_automation` | Hard browser automation evidence without stronger server evidence | 4 |
| `bot_spoofed` | Cryptographic signature mismatch against a known valid key, or certain fresh `ip_mismatch` | 4.5 |
| `automation_verified` | Verified signing infrastructure; downstream agent unknown | 4.75 |
| `agent_verified` | Verified WBA browser agent, Poppy session, or IP-verified agent token (`Claude-Agent`, `Google-Agent`) | 5 |
| `crawler_verified` | Verified crawler (`signature_valid`/`ip_match`, purpose `crawler`) or IP-verified fetcher (`ChatGPT-User`, `Claude-User`, etc.; `user_directed` stays in `vv_detail`) | 5 |

`visitorLabels` derives each hit statelessly; these ranks are collector retention/reporting guidance. On a single hit, a cryptographic mismatch yields `bot_spoofed`; valid evidence identifies crawler, infrastructure or agent before falling back to browser evidence. Expiry, replay, malformed input, unknown keys and unavailable verification are indeterminate, not proof of spoofing. A collector can retain earlier stronger evidence; the type does not prove that every subsequent hit was freshly verified. Collector retention must be bounded (the reference uses 10,000 entries and a 30-minute TTL), with expiry capped by proof lifetime; process restarts clear it. Scope full events to client/session and denied pings to page/client, never IP or cross-page identity. Live collector memory may replace equal-rank evidence; SQL independently applies its documented export-order tie break.

`vv_detail` has six pipe-separated positions, at most 100 characters:

```text
operator|verification|purpose|claim|browser_class|browser_phase
openai|signature_valid|user_directed|signature_agent|human|final
```

Verification is `signature_valid`, `signature_invalid`, `ip_match`, `no_signature` or `none` (or `-` without a verdict). Purpose is `user_directed`, `crawler`, `intermediary`, `unknown` or `-`. Claim is `signature_agent`, `ua_token`, `dom_marker`, `dom_host`, `poppy_session`, `none` or `-`; browser class is `human`, `suspicious`, `automated` or `declared_agent`; browser phase is `initial`, `final` or `agent`. Absent browser class/phase is `-`, and an unknown operator is `none`.

`dom_marker` names browser-observed UI evidence, not verification; `dom_host` preserves the experimental Claude in Chrome 1.0.107 host-shape evidence in library 0.6.1. Neither authenticates the operator. Verified Browserbase, Kernel, Cloudflare Browser Run and Shopify Cloudsurf signing infrastructure uses `automation_verified` with purpose `intermediary`; older exports may instead contain `agent_verified` + `intermediary`, which SQL assigns the same 4.75 rank. The downstream agent remains unknown.

Count retained verified identities using `agent_verified`, `crawler_verified` and `automation_verified`; count fresh per-hit verification using the detail verification segment (`signature_valid` or `ip_match`). An operator name alone is insufficient. Separate verified agents with unknown/missing purpose as `agent_verified_unknown_purpose`; only explicit `user_directed` purpose establishes that role. Optional Poppy 1.0 verifies a signed-out delegation chain, not payment approval or account/action authorization; a manifest or `client_id` alone is a claim.

Never export raw headers, claims or diagnostic verdicts. A collector can drop detail before type to meet payload limits; missing detail does not invalidate the type.

### Server-side GTM (labelling only)

The Visitor Verdict server-side GTM variable template is in development. It uses published IP rules and browser signals, without cryptographic verification. Rules come from [jsDelivr, pinned to `sgtm-rules-v1.1.1`](https://cdn.jsdelivr.net/gh/Narrativva-Labs/visitor-verdict@sgtm-rules-v1.1.1/dist/sgtm-rules.json); update the pin when adopting a reviewed feed. Use its `vv_type` and `vv_detail` output variables directly in tags; see the [ad-platform recipes](ad-platform-recipes.md). The Node verifier and its optional Poppy/signature verification are separate from this template.

### Backend orders

For backend-measured agent orders, compute the verdict on the checkout request and retain the compact label with the order. A later payment webhook or cookieless analytics ping cannot reconstruct that request’s identity. This library does not implement an order/session database or checkout integration.

## Open questions

- No platform has published a standard parameter for how agent-made conversions should be marked or sent.
- No independent study quantifies how bot or agent conversions affect Smart Bidding or Advantage+.
- Whether GA4 excludes known agents as bots, and whether Google retracts conversions from declared-agent clicks, is unverified.
- Privacy: this is not legal advice. Check the legal basis for any data you send to ad platforms with your own counsel.
