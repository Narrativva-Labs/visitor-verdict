# GA4: traffic excluding detected automation

For the Vanilla collector integration, register exactly two **event-scoped** custom dimensions in **Admin → Data display → Custom definitions**: **Visitor type** (`vv_type`) and **Visitor detail** (`vv_detail`). The GA4 Data API names are `customEvent:vv_type` and `customEvent:vv_detail`. The six former GA4 label parameters are replaced by these two fields. The tracker still sends the browser class/phase to the collector, which computes the labels; do not map the browser fields separately to GA4.

The collector never waits for the browser detector or network verification. An early hit can be `pending`; later hits use the strongest observed type for that session. There is no backfill. `vv_detail` describes the current hit plus the sticky known operator, so it can differ from the evidence behind the sticky type.

Preserve site consent handling and never use pre-consent classification for advertising.

## Values and precedence

| `vv_type` | Meaning | Session rank |
|---|---|---|
| `pending` | No browser class or qualifying server evidence yet | 0 |
| `human` | Browser reports no automation evidence | 1 |
| `bot_suspicious` | Browser reports suspicious evidence | 2 |
| `agent_unverified` | Declared agent or server claim without verification | 3 |
| `bot_automation` | Browser reports hard automation evidence | 4 |
| `crawler_verified` | Verified operator with documented crawler purpose | 5 |
| `agent_verified` | Verified operator with user-directed or unknown purpose; detail distinguishes them | 5 |
| `bot_spoofed` | Server reports `signature_invalid` | 6 |

Current-hit derivation uses the strongest matching rule: invalid signature, verified crawler or user-directed/unknown purpose (`crawler_verified` or `agent_verified`), browser automation, unverified claim, suspicious browser, human browser, then pending. A verified unknown purpose is neither a verified crawler nor a verified user-directed agent; it maps to `agent_verified` with `unknown` retained in detail. Invalid signatures can be expired or broken as well as forged; the label does not establish malicious intent.

Session rank is monotonic: later `human` cannot erase earlier evidence. The two verified roles have equal rank; the first observed role wins ties. Full events use `client_id + session_id`; denied pings are sticky only within their `page_id`, never across pages. Bounded in-memory retention (10,000 entries, 30-minute TTL) can expire; process restarts clear it. SQL independently takes the strongest observed type over the available export.

`vv_detail` has six pipe-separated positions, at most 100 characters:

```text
operator|verification|purpose|claim|browser_class|browser_phase
openai|signature_valid|user_directed|signature_agent|human|final
```

Unknown operator is `none`; absent positions are `-`. Verification values are `signature_valid`, `signature_invalid`, `ip_match`, `no_signature`, `none`; purpose is `user_directed`, `crawler`, `unknown`; claim is `signature_agent`, `ua_token`, `none`; browser class is `human`, `suspicious`, `automated`, `declared_agent`; browser phase is `initial`, `final`. Never forward raw claims or the diagnostic verdict to GA4. Detail can be dropped before type when the hit exceeds the body budget; missing detail does not invalidate type.

## Build whole-session segments in Explorations

Use the web stream only and a consistent date range. Import **Stream ID**, **Event name**, **Visitor type**, **Visitor detail**, **Session source / medium**, **Session default channel group**, **Sessions**, **Engaged sessions**, **Event count** and supported purchase metrics.

1. Create an **All sessions** session segment including your web **Stream ID**. Keep the full session; filtering the whole tab to a detector event would remove purchases and engagement events.
2. Duplicate as **Sessions excluding detected agents and bots**. Exclude the entire session when **Visitor type matches regex `^(agent_|bot_|crawler_verified$)`** on any event. Keep pending/missing labels in the retained cohort and show their coverage separately.
3. Create separate diagnostic session segments for `bot_suspicious`, `agent_unverified`, `agent_verified`, `crawler_verified`, `bot_automation` and `bot_spoofed`. If the main analysis retains suspicious traffic, remove `bot_suspicious` explicitly from its exclusion expression and state that policy.
4. Create **Observed human-only (diagnostic)** by including `human` and excluding every other valid type. This selects a labelled subset and must not replace the headline population.
5. Create coverage segments **With any valid type**, **Without any valid type**, and **Pending observed**. Use `^(human|pending|agent_verified|agent_unverified|crawler_verified|bot_automation|bot_suspicious|bot_spoofed)$` for valid values. Missing is not pending and neither means human.

For a quick event-label comparison, **Visitor type begins with `agent_`** selects verified/unverified agent labels and **begins with `bot_`** selects the three bot labels. Verified crawlers require a separate `crawler_verified` condition. **Visitor detail begins with `openai|`** selects an observed or sticky known OpenAI operator. Do not equate an event-label filter with whole-session exclusion. An operator in detail need not be verified on the current hit.

Use [Google's segment builder](https://support.google.com/analytics/answer/9304353?hl=en) for condition scopes. Segments are limited to available exploration data; retention, sampling and modeled UI metrics can differ from raw export. Stream scoping and the date range must match across comparisons.

## Purchases, revenue and timing

Headline **purchase conversion rate = purchasing sessions / sessions in the same cohort**. Add a separate session condition group containing `event_name=purchase` for the purchasing subset. Divide that subset's Sessions by its parent cohort's Sessions, keeping the date/stream identical. `add_to_cart` and `generate_lead` are separate diagnostics, not headline purchase conversions.

Show excluded purchase revenue separately. Removing low-converting sessions can raise CR arithmetically; it does not prove marketing improvement. Event-scoped comparisons in standard reports do not guarantee whole-session exclusion and can leave earlier unlabelled conversions in scope; use session segments or SQL for the headline.

[session-classification.sql](session-classification.sql) reads `vv_type` and splits `vv_detail`, takes the strongest type per session, and preserves paired verified evidence from one hit. Query 0 checks label coverage, ping-page IDs and currencies; Query 1 reports session/page-unit conversion rates; Query 2 separates verified operators by purpose, including unknown purpose. Equal-rank export ties use event timestamp, batch ordering/index and a lexical fallback where ordering remains ambiguous. It is **not yet validated against a live export**; owner validation is planned for 2026-11-21. Dates bound the observed session evidence. Compare purchases with unique transactions for duplicates; USD revenue normalizes currency but does not deduplicate repeated purchases.

Missing-ID cookieless pings are separate event totals, not sessions. Never reconstruct identity or join via IP/UA. JS-less fetches usually send no GA4 event at all; blocked tags, consent settings, early pageviews and unload loss also affect coverage. Referrals from assistants can be ordinary people following links and never establish automation. Converting or engaged automation warrants review, not automatic relabelling as human.

For denied ping-page units, verify `batch_page_id` cardinality first. The SQL groups by stream, event date and page ID, never by the ping's page-load-second session ID. Disable page grouping when page IDs are missing or collide. Do not add ping-page revenue to session revenue.

## Phase 1 browser-only integration

Phase 1 browser/GTM publication remains unchanged: `traffic_class` and `traffic_phase` continue to carry the browser result. Use [the browser setup](../ga4-reporting.md) and [bigquery.sql](bigquery.sql) for that field study; it reads those browser parameters and does not interpret the collector's two-field format. In a browser-only Exploration, register **Traffic class (event)** as event-scoped and exclude whole sessions containing `automated` or `declared_agent` on any event (`^(automated|declared_agent)$`). Keep suspicious/missing coverage visible and use `^(automated|declared_agent|suspicious)$` for the stricter view. A user property is last observed class and must not determine session exclusion. Container 1.0.1 sends `automated`/`declared_agent` on initial publication and all classes on final; both hits can carry the same class, so count sessions with any matching hit, not classification events.

The GTM tag's migration to `vv_type` belongs to the next major browser version, after the Phase 1 field test; see [Roadmap](../../ROADMAP.md).
