# Conversion guidance: label, never exclude

Decision as of 22 November 2026. It replaces earlier reference designs that held unverified leads or kept some conversions away from ad platforms.

## The rule

**Visitor Verdict only labels traffic.** By default nothing is excluded, filtered, held or withheld anywhere:

- **GA4:** every event and conversion is collected and kept. Labels are event parameters (browser: `traffic_class`, `traffic_agent`, `traffic_phase`; server collector: `vv_type`, `vv_detail`); reports compare labelled segments, they do not delete them.
- **Google Ads and Meta:** send conversions exactly as you would without Visitor Verdict. The project recommends no exception triggers, no holds and no drops based on the class or the server label.
- **Leads and sign-ups:** process and send them as usual. Lead quality is judged by your normal qualification (confirmed email, CRM status), not by the traffic class.

The labels are for analysis and review. Whether to change what you send to an ad platform is your own decision; it is not a default of this project.

## Why

- **Agent-assisted purchases are real revenue.** Browser agents such as OpenAI's in-browser agent (or Claude in Chrome) run in a person's own browser, with that person's account and card. The person asked the agent to act. A `declared_agent` purchase with `traffic_agent` set is a customer buying through a tool. Detection is partial: current Claude in Chrome (1.0.107) hides its UI in a closed shadow root and is not labelled, so agent-assisted revenue is a lower bound.
- **The browser labels are self-declared, unverified evidence.** A UA token or an agent UI marker is a claim, and `human` means only that no automation was detected. Neither is reliable enough to decide on its own which revenue counts.
- **A verified operator is not a verified customer.** A Web Bot Auth signature proves which operator runs the agent (for example OpenAI). It does not prove that a real, interested person stands behind the request, nor purchase approval or payment legitimacy. A captured payment is strong verification of an order; a submitted form is none.
- **Excluding by default loses data you cannot get back.** A held or dropped conversion is gone for bidding and attribution; a labelled one can still be analysed, segmented or adjusted later.
- **Payment and fraud checks already exist.** Refunds, chargebacks and fraud review belong to the payment and order systems. Send orders from the server after payment confirmation, with their order ID, so that platforms can apply later adjustments (for example Google Ads [conversion adjustments](https://support.google.com/google-ads/answer/7686447)).
- **Unsigned traffic can still be automated.** The masked-headless negative control returned `no_signature` and `automated`; signatures do not cover all automation.

## How to report on labelled conversions

Use GA4 or the BigQuery export; see [GA4 reporting](ga4-reporting.md#reporting) and [analysis](analysis/ga4-explorations.md).

1. **Headline: all sessions and all revenue.** Report purchase conversion rate as purchasing sessions / sessions over all sessions.
2. **Break revenue down by label, do not subtract it.** Show purchases and revenue for agent-assisted sessions (`declared_agent`, with `traffic_agent` when known; with the server collector `agent_verified` and `agent_unverified`), sessions with `automated` evidence, `suspicious` sessions and unlabelled sessions. Agent-assisted revenue stays in the total.
3. **Use the session, not the event.** A session counts as labelled if any event carries the label; a later `human` does not cancel earlier evidence. Initial, agent and final hits for one page are expected duplicates.
4. **Compare rates with and without labelled sessions as a sensitivity check.** Leaving low-converting automated sessions out of a comparison raises conversion rate by arithmetic; that is not marketing improvement. Keep the same cohort in numerator and denominator.
5. **Review, do not relabel.** Converting or long-engaged `automated` sessions deserve a look (test orders, monitoring, a real person with unusual tooling); they are not automatically fraud and not automatically human.
6. **Watch agent share over time.** `traffic_phase = agent` and `traffic_agent` show how often agents act on the site and which operator; useful for checkout and form design (for example, agents need clear labels and no hidden steps).

## What not to do

- Do not exclude, hold or drop conversions, leads or sessions by default because of `traffic_class` or `vv_type`.
- Do not send the visitor label itself to ad platforms; no platform defines a parameter for it and it is not needed there.
- Do not use the class to block access, deny service or make decisions about individuals.
- Do not use pre-consent classifications for advertising; follow the site's consent setup (see [privacy](privacy.md#consent-and-deployment)).

## Server-side verification

Server-side verification of signed agents (Web Bot Auth, published IP ranges) is in development on the [`phase2-verifier`](https://github.com/Narrativva-Labs/visitor-verdict/tree/phase2-verifier/server) branch. It follows the same rule: it adds labels, it withholds nothing. Neither the [server library](../server/README.md) nor its first integration, [Vanilla Server-Side](https://github.com/Narrativva-Labs/vanilla-server-side/tree/agent-verification), holds, delays or drops a hit or a conversion.

### Server labels

| Visitor | Server label |
|---|---|
| Verified agent or verified operator | `vv_type=agent_verified`: `signature_valid` or `ip_match` with `user_directed` or `unknown` purpose (for example the ChatGPT agent, Claude-Agent) |
| Verified crawler | `vv_type=crawler_verified`: `signature_valid` or `ip_match` with `crawler` purpose (GPTBot, Googlebot, CCBot) |
| Clear automation | `vv_type=bot_automation`: browser `automated`, no valid signature |
| Invalid signature | `vv_type=bot_spoofed`: a presented signature failed (expired, broken or forged) |
| Unverified agent | `vv_type=agent_unverified`: browser `declared_agent` or an unverified UA / Signature-Agent claim |
| Human | `vv_type=human`: no automation evidence, no verified agent |

**Count verified operators with `vv_type=agent_verified` or `crawler_verified`** (equivalently, the verification segment of `vv_detail` is `signature_valid` or `ip_match`). An operator name in `vv_detail` alone is not verification: with claim `dom_marker` it was observed by the browser detector from a page marker, and with `ua_token` or `signature_agent` and no verification it is a claim. The purpose position retains `unknown` when the role is unsettled. Unverified ≠ human.

### Server-side GTM (labelling only)

A trusted verifying proxy runs the Node library **in front of sGTM**, retaining the
original method, raw target, trusted configured authority and separate raw header
occurrences. It overwrites all incoming X-VV-* lookalikes on every request, including
verification errors, and sets X-VV-Type and X-VV-Detail. Restrict direct access to sGTM
to this authenticated proxy. The library does not run in sGTM's sandbox.

The built-in GA4 Client does not copy these headers to Event Data automatically.
Create **Request Header** variables for the X-VV-* fields (or use a custom Client
with [getRequestHeader](https://developers.google.com/tag-platform/tag-manager/server-side/api#getrequestheader)),
and an **Augment Event** Transformation to populate only `vv_type` and `vv_detail` for the GA4 tag.
Compute them in the trusted proxy with `visitorLabels({ verdict, browserClass, browserPhase, browserAgent })`.
Register both as event-scoped custom dimensions; the GA4 Data API names are
`customEvent:vv_type` and `customEvent:vv_detail`. `vv_detail` has the format
`operator|verification|purpose|claim|browser_class|browser_phase` (at most 100 characters).
The browser class and phase are inputs to the proxy, not separate GA4 label parameters.

Verification happens before sGTM because getRequestHeader joins repeated field lines
with comma-space. It cannot reconstruct their original occurrences for RFC 9421 ;bs,
which wraps each occurrence separately. Do not call a verifier from sGTM using joined
headers and claim equivalence to rawHeaders. This reference does not ship a separate
HTTP-callout adapter or an sGTM template.

Advertising tags send as without Visitor Verdict: add no exception triggers based on the
labels. Use [Transformations](https://developers.google.com/tag-platform/tag-manager/server-side/transformations)
to exclude `vv_type` and `vv_detail` (and any legacy visitor label fields) from Ads/Meta
tags, while leaving the GA4 labels available. Transformations change only Event Data;
**verify the outgoing request in sGTM preview** to confirm the labels do not leave.

For agent orders measured from the backend (for example agentic checkout), compute the
verdict on the **checkout request in the shop backend** and store the compact label with
the order; a later payment webhook or cookieless analytics ping cannot reconstruct that
request's identity. No session database or backend integration is implemented here or in
Vanilla; Vanilla sends directly to GA4.

## Sources

- Meta, [Conversions API best practices](https://developers.facebook.com/docs/marketing-api/conversions-api/best-practices)
- Google Ads Help: [Enhanced conversions](https://support.google.com/google-ads/answer/9888656), [invalid traffic and conversions](https://support.google.com/google-ads/answer/11182074), [conversion adjustments](https://support.google.com/google-ads/answer/7686447)
- [Stripe, Agentic Commerce Protocol](https://docs.stripe.com/agentic-commerce/protocol); [Google Merchant Center, agentic checkout](https://support.google.com/merchants/answer/16837055); [AP2 core concepts](https://ap2-protocol.org/topics/core-concepts)
- [DataDome, agent trust](https://datadome.co/agent-trust-management/building-complete-agent-trust/): valid agent identity does not imply legitimate intent
- Own measurement: [field observations](../research/agents-and-tells.md#field-observations-v10-2026-11-19)

## Open questions

- No platform has published how agent-made conversions should be marked or sent.
- No independent study quantifies how bot or agent conversions affect Smart Bidding or Advantage+.
- Whether GA4 excludes known agents as bots, and whether Google retracts conversions from declared-agent clicks, is unverified.
- Privacy: this is not legal advice. Check the legal basis for any data you send to ad platforms with your own counsel.
