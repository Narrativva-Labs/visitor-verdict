# Conversion guidance for AI agents and bots

**Reference design; not implemented in the library or the collector.**

Recommendations as of November 2026. They are not part of the library: the verifier and the browser detector only label traffic. **By default nothing is held or excluded:** every conversion goes where it would go without Visitor Verdict, and the labels only describe it in GA4. Holding or dropping conversions for ad platforms is an optional policy that the integrator decides, best after measuring their own share of agent and bot traffic. Evidence is still thin in places; each rule says why it exists, and the open questions are listed at the end.

## The principle

Decide by **how the conversion is verified**, not only by who made it.

A Web Bot Auth signature proves which operator runs the agent (for example OpenAI). It does not prove that a real, interested person stands behind the request: anyone can drive an agent, including a spammer. A captured payment is strong verification; a submitted form is none.

## Visitor types

| Type | Source |
|---|---|
| Human | No automation evidence, no verified agent |
| Verified agent | Server verifier: `signature_valid` or `ip_match` for a user-directed agent (for example the ChatGPT agent, Claude-Agent) |
| Clear automation | Browser detector: `automated` (headless, WebDriver), no valid signature |
| Crawler | Verified or declared crawler with no intent to act (GPTBot, Googlebot, CCBot) |

Use `vv_type=agent_verified` for verified signature/IP evidence with `user_directed`
or `unknown` purpose, and `vv_type=crawler_verified` for a verified crawler.
The purpose position in `vv_detail` retains `unknown` when the role is unsettled;
inspect it to distinguish user-directed from unknown purpose. Unverified ≠ human.
An operator in `vv_detail` with claim `dom_marker` (server 0.3.5) was observed by the browser
detector from a page marker and is not verified; the type stays `agent_unverified`.

## Default: label only

Send conversions as you do today, to GA4 and to ad platforms. Report agents and automation
separately in GA4 with `vv_type` and `vv_detail`. Neither the library nor Vanilla holds,
delays or drops a conversion.

## Optional routing rules

Only if you decide to route conversions for ad platforms by verification status, this is a
starting point. Without such a decision, every cell is "send".

| Visitor | Paid order (payment captured, fraud checks passed) | Lead or sign-up, unverified | Lead verified (confirmed email, CRM qualified) |
|---|---|---|---|
| Human | Send everywhere | Send; prefer optimising on qualified leads | Send |
| Verified agent | **Send everywhere**; label in GA4 | Optional: hold from Meta and Google Ads until verified; label in GA4 | Send |
| Clear automation | Optional: send only after payment settlement and fraud review | Optional: do not send to Meta or Google Ads; label in GA4 | Send (rare; review manually) |
| Crawler | Optional: do not send (crawlers rarely convert) | Optional: do not send | Optional: do not send |

Additional rules (rules 1–3 apply with or without routing):

1. **Never send the visitor label to ad platforms.** If you route conversions, use it in server-side GTM only to decide send / wait / drop. The label stays in GA4. Reasons: data minimisation, and no platform defines a parameter for it.
2. **Omit the agent's IP from Meta `client_ip_address`.** For `action_source=website`, keep `client_user_agent` and `event_source_url`: Meta requires both for website events ([customer information parameters](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/customer-information-parameters), [server event parameters](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/server-event)). A UA describes browser context, not the customer's identity. For backend-confirmed agent orders, retain `website` when accurate; use a matching non-website `action_source` such as `other` only for genuinely non-website events and check the attribution and optimisation impact. `system_generated` describes automatic system events such as subscription renewals, not a generic backend-confirmed order. A webhook alone does not change a website purchase's action source. Use customer match data only under the site's consent and platform rules.
3. **Send orders from the server after payment confirmation, with the order ID.** Google Ads can then retract or restate a conversion after a refund or chargeback.
4. **Delete nothing in GA4.** All sessions is the headline: report conversion rate and A/B tests on all sessions. Views without agents and automation, or with them shown separately, are optional comparisons that leave the data intact. This is where most of the value lies.

## Server-side GTM reference design (optional routing)

A trusted verifying proxy runs the Node library **in front of sGTM**, retaining the
original method, raw target, trusted configured authority and separate raw header
occurrences. It overwrites all incoming X-VV-* lookalikes on every request, including
verification errors, and sets X-VV-Type, X-VV-Detail and X-VV-Route (optionally
alongside diagnostic X-VV-Verification, X-VV-Operator, X-VV-Purpose and X-VV-Claim). Route comes from trusted backend conversion status,
never a browser-supplied claim. Restrict direct access to sGTM to this authenticated
proxy. The library does not run in sGTM's sandbox.

The built-in GA4 Client does not copy these headers to Event Data automatically.
Create **Request Header** variables for the X-VV-* fields (or use a custom Client
with [getRequestHeader](https://developers.google.com/tag-platform/tag-manager/server-side/api#getrequestheader)).
Use those variables directly for trigger conditions, and an **Augment Event**
Transformation to populate only `vv_type` and `vv_detail` for the GA4 tag.
Compute them in the trusted proxy with `visitorLabels({ verdict, browserClass, browserPhase, browserAgent })`,
and expose their trusted values to the transformation. Register both as event-scoped
custom dimensions; the GA4 Data API names are `customEvent:vv_type` and
`customEvent:vv_detail`. `vv_detail` has the format
`operator|verification|purpose|claim|browser_class|browser_phase` (at most 100 characters).
The browser class and phase are inputs to the proxy, not separate GA4 label parameters.
A Regex Table takes one input: read the trusted X-VV-Route and map it to send/hold/drop;
its default output is send.
Do not expect Transformations to alter trigger conditions. Keep all events in GA4 with their labels.

Verification happens before sGTM because getRequestHeader joins repeated field lines
with comma-space. It cannot reconstruct their original occurrences for RFC 9421 ;bs,
which wraps each occurrence separately. Do not call a verifier from sGTM using joined
headers and claim equivalence to rawHeaders. Proxy verification avoids that loss;
this reference does not ship a separate HTTP-callout adapter.

| Backend conversion state | Ads/Meta route |
|---|---|
| Paid order, payment settled and fraud checks passed | send; preserve order ID/deduplication |
| Agent-made lead not yet confirmed | hold until verified by email/CRM/backend |
| Clear automation with an unverified lead, or crawler activity | drop from advertising |
| Confirmed lead | send under the site's normal consent and quality rules |

Add exception triggers to advertising tags only for the hold/drop values you chose;
missing or unknown routes send, as without routing. Hold means the backend
later emits a confirmed conversion; sGTM is not a durable queue. Use
[Transformations](https://developers.google.com/tag-platform/tag-manager/server-side/transformations)
to exclude `vv_type` and `vv_detail` (and any legacy visitor label fields)
from Ads/Meta tags, while
leaving GA4 labels available. Omit the agent's IP for Meta, but preserve required
website UA/source-URL fields as in rule 2. Transformations change only Event Data;
a CAPI tag template may fall back to getRemoteAddress() or getRequestHeader('user-agent').
Excluding ip_override/user_agent therefore does not guarantee what leaves the tag.
**Verify the outgoing CAPI request in sGTM preview**, including user_data, action_source
and event_source_url; configure the actual template's fallback behavior explicitly.

Compute the verdict on the **checkout request in the shop backend**, store the compact
verdict/purpose with the order, and combine it with backend paid-order/verified-lead
status. A later payment webhook or cookieless analytics ping cannot reconstruct that
request's identity. No session database, backend confirmation, conversion holding or
advertising routing is implemented here or in Vanilla; Vanilla sends directly to GA4.

## Why

- **Settled orders can represent real revenue.** Use backend payment settlement and merchant fraud checks to establish this. An operator signature alone proves neither purchase approval nor payment legitimacy.
- **Attribution remains unverified here.** Customer matching may connect a purchase in a separate agent browser to an earlier eligible ad interaction, subject to consent, match quality and platform rules. It does not create an ad interaction. This project has not measured attribution or credit rates for agent purchases.
- **Unverified leads need qualification.** A form submission or a valid operator signature does not establish lead quality. No comparative rate of lead spam versus agent conversions has been measured here.
- **Unsigned traffic can still be automated.** The masked-headless negative control returned `no_signature` and `automated`; signatures do not cover all automation. No relationship between signing and spam prevalence has been measured here.

## Sources

- Meta, [Conversions API best practices](https://developers.facebook.com/docs/marketing-api/conversions-api/best-practices)
- Google Ads Help: [Enhanced conversions](https://support.google.com/google-ads/answer/9888656), [lead form best practices](https://support.google.com/google-ads/answer/13489421), [invalid traffic and conversions](https://support.google.com/google-ads/answer/11182074), [conversion adjustments](https://support.google.com/google-ads/answer/7686447), [data exclusions](https://support.google.com/google-ads/answer/10370710)
- [Stripe, Agentic Commerce Protocol](https://docs.stripe.com/agentic-commerce/protocol); [Google Merchant Center, agentic checkout](https://support.google.com/merchants/answer/16837055); [AP2 core concepts](https://ap2-protocol.org/topics/core-concepts)
- [Visa Trusted Agent Protocol](https://corporate.visa.com/en/sites/visa-perspectives/press-releases/visa-unveils-trusted-agent-protocol-for-ai-commerce.html); [Mastercard agentic commerce framework](https://www.mastercard.com/us/en/news-and-trends/stories/2025/agentic-commerce-framework.html); [Cloudflare, secure agentic commerce](https://blog.cloudflare.com/secure-agentic-commerce/)
- [DataDome, agent trust](https://datadome.co/agent-trust-management/building-complete-agent-trust/): valid agent identity does not imply legitimate intent
- Own measurement: [field observations](../research/agents-and-tells.md#field-observations-v10-2026-11-19)

## Open questions

- No independent study quantifies how fake conversions affect Smart Bidding or Advantage+.
- No platform has published how to mark or send conversions made by an agent.
- Whether GA4 excludes known agents as bots, and whether Google retracts conversions from declared-agent clicks, is unverified.
- Privacy: this is not legal advice. Check the legal basis for any data you send to ad platforms with your own counsel.
