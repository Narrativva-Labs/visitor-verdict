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
- **Excluding by default loses data you cannot get back.** A held or dropped conversion is gone for bidding and attribution; a labelled one can still be analysed, segmented or adjusted later.
- **Payment and fraud checks already exist.** Refunds, chargebacks and fraud review belong to the payment and order systems. Send orders with their order ID so that platforms can apply later adjustments (for example Google Ads [conversion adjustments](https://support.google.com/google-ads/answer/7686447)).

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

## Server-side verification

Server-side verification of signed agents (Web Bot Auth / HTTP Message Signatures, published IP ranges, and optional Poppy 1.0) is developed in the server verifier library (v0.6.1, integrated into [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side) and server-side GTM). It follows the same rule: it adds labels (`agent_verified`, `agent_unverified`, `crawler_verified`, `automation_verified`, `bot_automation`, `bot_spoofed`, `bot_suspicious`, `human`, `pending`), it withholds nothing, and any label forwarded to ad platforms in sGTM is strictly a passive reporting parameter.

`agent_verified` confirms identity, not customer intent: `purpose=user_directed` enters the server SQL `agent_user` group, while unknown or missing purpose enters `agent_verified_unknown_purpose` (including verified Poppy identities). Server library 0.6.1 emits `automation_verified`; SQL also accepts older `agent_verified` + `purpose=intermediary` at the same infrastructure priority. Browser echo `server_signature`/`server_ip` does not encode purpose, so browser-only reporting cannot make this distinction; use the collector’s `vv_detail` with Query B/B2.

## Open questions

- No platform has published a standard parameter for how agent-made conversions should be marked or sent.
- No independent study quantifies how bot or agent conversions affect Smart Bidding or Advantage+.
- Privacy: this is not legal advice. Check the legal basis for any data you send to ad platforms with your own counsel.
