# Conversion guidance for AI agents and bots

**Reference design; not implemented in the library or the collector.**

Recommendations as of November 2026. They are not part of the library: the verifier and the browser detector only label traffic. What you send to ad platforms is the integrator's decision. Evidence is still thin in places; each rule says why it exists, and the open questions are listed at the end.

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

Use verified `agent_purpose=user_directed` to distinguish user-directed products from
`crawler`; `unknown` does not settle intent. Unverified ≠ human.

## Rules

| Visitor | Paid order (payment captured, fraud checks passed) | Lead or sign-up, unverified | Lead verified (confirmed email, CRM qualified) |
|---|---|---|---|
| Human | Send everywhere | Send; prefer optimising on qualified leads | Send |
| Verified agent | **Send everywhere**; label in GA4 | **Hold** from Meta and Google Ads until verified; label in GA4 | Send |
| Clear automation | Send only after payment settlement and fraud review | **Do not send** to Meta or Google Ads; label in GA4 | Send (rare; review manually) |
| Crawler | Never | Never | Never |

Additional rules:

1. **Never send the visitor label to ad platforms.** Use it in server-side GTM only to decide send / wait / drop. The label stays in GA4. Reasons: data minimisation, and no platform defines a parameter for it.
2. **Omit the agent's IP from Meta `client_ip_address`.** For `action_source=website`, keep `client_user_agent` and `event_source_url`: Meta requires both for website events ([customer information parameters](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/customer-information-parameters), [server event parameters](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/server-event)). A UA describes browser context, not the customer's identity. For backend-confirmed agent orders, consider a non-website `action_source` such as `system_generated` only when it truthfully describes where the event occurred; check the attribution and optimisation impact. A webhook alone does not change a website purchase's action source. Use customer match data only under the site's consent and platform rules.
3. **Send orders from the server after payment confirmation, with the order ID.** Google Ads can then retract or restate a conversion after a refund or chargeback.
4. **Delete nothing in GA4.** Report conversion rate and A/B tests with humans only, or show agents and automation separately. This is where most of the value lies.

## Server-side GTM reference design

A trusted verifying proxy runs the Node library **in front of sGTM**, strips inbound
`X-VV-*` lookalikes and sets its own `X-VV-Verification`, `X-VV-Operator`,
`X-VV-Purpose` and route headers. The library does not run in sGTM's sandbox. The sGTM
Client reads these with [getRequestHeader](https://developers.google.com/tag-platform/tag-manager/server-side/api#getrequestheader)
and exposes event-data variables; a Regex Table maps the trusted conversion status and
purpose to `send`, `hold` or `drop`. Keep all events in GA4 with their labels.

| Backend conversion state | Ads/Meta route |
|---|---|
| Paid order, payment settled and fraud checks passed | send; preserve order ID/deduplication |
| Agent-made lead not yet confirmed | hold until verified by email/CRM/backend |
| Clear automation with an unverified lead, or crawler activity | drop from advertising |
| Confirmed lead | send under the site's normal consent and quality rules |

Add exception triggers to advertising tags for hold/drop. Hold means the backend
later emits a confirmed conversion; sGTM is not a durable queue. Use
[Transformations](https://developers.google.com/tag-platform/tag-manager/server-side/transformations)
to exclude agent_verification, agent_operator, agent_purpose, agent_claim,
traffic_class and traffic_phase from Ads/Meta tags, while
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

- **Agents acting for a person produce real revenue.** Purchases need the person's approval, payment networks accept agent-initiated payments as ordinary transactions, and the merchant remains the merchant of record. Withholding them would under-report ROAS and remove real signals.
- **"No ad click, so no attribution" is false.** Meta Conversions API matches on user data (email, phone, fbp/fbc) and Google Enhanced Conversions matches hashed data to signed-in accounts. A purchase an agent makes with the customer's email can be credited to an ad that person saw or clicked, correctly.
- **Unverified leads are the real risk.** Google states that its filters do not stop invalid leads on their own and recommends form protection, double opt-in and bidding on qualified leads. Lead spam is an order of magnitude more common than agent conversions today.
- **Spam rarely signs.** Fraudulent automation hides; the server verifier does not catch it. Browser evidence, CAPTCHA and the platforms' own invalid-traffic systems remain necessary.

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
