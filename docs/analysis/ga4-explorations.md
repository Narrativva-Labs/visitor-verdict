# GA4: reporting on labelled traffic

Visitor Verdict labels traffic; nothing is excluded from GA4. **All sessions** is the headline population. The segments below that set labelled sessions aside (named “excluding detected …” to match the SQL cohort names) are optional comparison views; they leave the data unchanged. Agent-assisted sessions (browser `declared_agent`, with **Traffic agent (event)** when a marker named the operator; collector `agent_verified` or `agent_unverified`) are usually real customers using an agent: report them as a segment with their purchases and revenue, not as removed traffic.

Two integrations exist. The [server collector](#server-collector-vv_type-and-vv_detail) (Phase 2, Vanilla Server-Side) sends `vv_type` and `vv_detail`; the [browser-only GTM setup](#browser-only-integration-traffic_class) (Phase 1) sends `traffic_class`, `traffic_agent` and `traffic_phase`. Do not mix their cohorts.

## Server collector: `vv_type` and `vv_detail`

For the Vanilla collector integration, register exactly two **event-scoped** custom dimensions in **Admin → Data display → Custom definitions**: **Visitor type** (`vv_type`) and **Visitor detail** (`vv_detail`). The GA4 Data API names are `customEvent:vv_type` and `customEvent:vv_detail`. The six former GA4 label parameters are replaced by these two fields. The tracker still sends the browser class/phase to the collector, which computes the labels; do not map the browser fields separately to GA4.

The collector never waits for the browser detector or network verification. An early hit can be `pending`; later hits use the strongest observed type for that session. There is no backfill. `vv_detail` describes the current hit plus the sticky known operator, so it can differ from the evidence behind the sticky type.

Preserve site consent handling and never use pre-consent classification for advertising.

### Values and precedence

| `vv_type` | Meaning | Session rank |
|---|---|---|
| `pending` | No browser class or qualifying server evidence yet | 0 |
| `human` | Browser reports no automation evidence | 1 |
| `bot_suspicious` | Browser reports suspicious evidence | 2 |
| `agent_unverified` | Declared agent or server claim without verification | 3 |
| `bot_automation` | Browser reports hard automation evidence | 4 |
| `crawler_verified` | Verified operator with documented crawler purpose | 5 |
| `agent_verified` | Verified operator with user-directed, intermediary or unknown purpose; detail distinguishes them | 5 |
| `bot_spoofed` | Server reports `signature_invalid` | 6 |

Current-hit derivation uses the strongest matching rule: invalid signature, verified crawler or user-directed/unknown purpose (`crawler_verified` or `agent_verified`), browser automation, unverified claim, suspicious browser, human browser, then pending. A verified unknown purpose is neither a verified crawler nor a verified user-directed agent; it maps to `agent_verified` with `unknown` retained in detail. Invalid signatures can be expired or broken as well as forged; the label does not establish malicious intent.

Session rank is monotonic: later `human` cannot erase earlier evidence. The two verified roles have equal rank; the first observed role wins ties. Full events use `client_id + session_id`; denied pings are sticky only within their `page_id`, never across pages. Bounded in-memory retention (10,000 entries, 30-minute TTL) can expire; process restarts clear it. SQL independently takes the strongest observed type over the available export.

`vv_detail` has six pipe-separated positions, at most 100 characters:

```text
operator|verification|purpose|claim|browser_class|browser_phase
openai|signature_valid|user_directed|signature_agent|human|final
```

Unknown operator is `none`; absent positions are `-`. Verification values are `signature_valid`, `signature_invalid`, `ip_match`, `no_signature`, `none`; purpose is `user_directed`, `crawler`, `intermediary` (server 0.4.0), `unknown`; claim is `signature_agent`, `ua_token`, `dom_marker`, `none`; browser class is `human`, `suspicious`, `automated`, `declared_agent`; browser phase is `initial`, `final`, `agent`. `dom_marker` (server 0.3.5) means the browser detector observed the operator from a page marker, for example `openai|-|-|dom_marker|declared_agent|agent`: the operator is named but not verified, and the type stays `agent_unverified`. `openai` comes from OpenAI's agent overlay (confirmed in the ChatGPT desktop app's Chrome plugin); `anthropic` only from older Claude in Chrome versions, because the current extension (1.0.107, checked 22 November 2026) keeps its UI in a closed shadow root and is not detected. `intermediary` means the verified operator is signing infrastructure for other parties' agents (Browserbase): `browserbase|signature_valid|intermediary|signature_agent|human|final` is a Browserbase-hosted browser whose agent is not identified. Never forward raw claims or the diagnostic verdict to GA4. Detail can be dropped before type when the hit exceeds the body budget; missing detail does not invalidate type.

### Build whole-session segments in Explorations

Use the web stream only and a consistent date range. Import **Stream ID**, **Event name**, **Visitor type**, **Visitor detail**, **Session source / medium**, **Session default channel group**, **Sessions**, **Engaged sessions**, **Event count** and supported purchase metrics.

1. Create an **All sessions** session segment including your web **Stream ID**. Keep the full session; filtering the whole tab to a detector event would remove purchases and engagement events.
2. Optionally duplicate as a comparison view **Sessions excluding detected agents and bots**. Exclude the entire session when **Visitor type matches regex `^(agent_|bot_|crawler_verified$)`** on any event. Keep pending/missing labels in the retained cohort and show their coverage separately.
3. Create separate diagnostic session segments for `bot_suspicious`, `agent_unverified`, `agent_verified`, `crawler_verified`, `bot_automation` and `bot_spoofed`. If the main analysis retains suspicious traffic, remove `bot_suspicious` explicitly from its exclusion expression and state that policy.
4. Create **Observed human-only (diagnostic)** by including `human` and excluding every other valid type. This selects a labelled subset and must not replace the headline population.
5. Create coverage segments **With any valid type**, **Without any valid type**, and **Pending observed**. Use `^(human|pending|agent_verified|agent_unverified|crawler_verified|bot_automation|bot_suspicious|bot_spoofed)$` for valid values. Missing is not pending and neither means human.

For a quick event-label comparison, **Visitor type begins with `agent_`** selects verified/unverified agent labels and **begins with `bot_`** selects the three bot labels. Verified crawlers require a separate `crawler_verified` condition. **Visitor detail begins with `openai|`** selects an observed or sticky known OpenAI operator, verified or named by a page marker. **Count verified operators with Visitor type `agent_verified` or `crawler_verified`** (per hit: verification segment `signature_valid` or `ip_match`); an operator with `agent_unverified` was named by a page marker, and a UA token never names one. Exclude purpose `intermediary` when counting the agents themselves. Do not equate an event-label filter with whole-session exclusion.

Use [Google's segment builder](https://support.google.com/analytics/answer/9304353?hl=en) for condition scopes. Segments are limited to available exploration data; retention, sampling and modeled UI metrics can differ from raw export. Stream scoping and the date range must match across comparisons.

### Purchases, revenue and timing

Headline **purchase conversion rate = purchasing sessions / sessions in the same cohort**. Add a separate session condition group containing `event_name=purchase` for the purchasing subset. Divide that subset's Sessions by its parent cohort's Sessions, keeping the date/stream identical. `add_to_cart` and `generate_lead` are separate diagnostics, not headline purchase conversions.

Report purchase revenue for **All sessions**, and break it down by strongest type; the agent segments contain agent-assisted purchases, which are real revenue. Removing low-converting sessions can raise CR arithmetically; it does not prove marketing improvement. Event-scoped comparisons in standard reports do not guarantee whole-session exclusion and can leave earlier unlabelled conversions in scope; use session segments or SQL for comparison views.

[session-classification.sql](session-classification.sql) reads `vv_type` and splits `vv_detail`, takes the strongest type per session, and preserves paired verified evidence from one hit. Query 0 checks label coverage, ping-page IDs and currencies; Query 1 reports session/page-unit conversion rates; Query 2 separates verified operators by purpose, including unknown purpose. Equal-rank export ties use event timestamp, batch ordering/index and a lexical fallback where ordering remains ambiguous. It was validated once against the demo property's live export on 2026-11-21. Dates bound the observed session evidence. Compare purchases with unique transactions for duplicates; USD revenue normalizes currency but does not deduplicate repeated purchases.

For denied ping-page units, verify `batch_page_id` cardinality first. The SQL groups by stream, event date and page ID, never by the ping's page-load-second session ID. Disable page grouping when page IDs are missing or collide. Do not add ping-page revenue to session revenue.

## Browser-only integration: `traffic_class`

Phase 1 browser/GTM publication is unchanged by the server collector. [bigquery.sql](bigquery.sql) reads these browser parameters and does not interpret the collector's two-field format. The GTM tag's migration to `vv_type` belongs to the next major browser version, after the Phase 1 field test; see [Roadmap](../../ROADMAP.md).

Use the web stream only, a consistent date range, and the event-scoped **Traffic class (event)** dimension (parameter `traffic_class`). Register it in **Admin → Data display → Custom definitions**. Register event-scoped **Traffic agent (event)** (parameter `traffic_agent`: `openai`, or `anthropic` for older Claude in Chrome versions; current Claude in Chrome is not detected). Optionally register event-scoped `traffic_phase`. The user-scoped dimension is **last observed class**, applies from set time and can persist into later visits: never use it to exclude sessions.

On every other GA4 event tag (`gaawe`), map `traffic_class={{VV - current class}}`, evaluated at firing time. The imported variable validates `window.__visitorVerdict.class`, then `window.__visitorVerdictLast` (the previous final class captured once at detector startup), returning undefined when neither is available. It never reads storage. The dedicated **VV - GA4 traffic_class** publication event uses the five publication DLVs for class/phase/score/version/agent and the class DLV for its user property, rather than the live variable.

Container 1.1.0 sends `automated`/`declared_agent` on initial publication, the `declared_agent` escalation on the agent phase and all classes on final. Several hits can carry the same class. Use sessions with any matching hit; classification-event counts measure delivery volume, not visits or detection recall.

Optionally wire the existing Google tag to **VV - initial OR VV - timer fallback 1s** as two normal triggers, with **Once per page**, replacing its early All Pages/Initialization trigger. Add `traffic_class={{VV - current class}}` to its Shared event settings. The initial path can label the first `page_view`; fallback after one second can still be unlabelled. Shared settings capture a startup value once, so automatic events need not reflect later final evidence. There is no backfill or automatic refresh.

For CSP-sensitive sites, import the sandboxed [current-class variable template](../../gtm/templates/vv-current-class.tpl), which reads only `__visitorVerdict.class` and `__visitorVerdictLast`, and replace the Custom JavaScript variable's references. It has no storage/network/write/execute permissions. The detector script must still satisfy CSP. See [readiness, mappings and consent](../ga4-reporting.md). Keep the dedicated traffic_class event for coverage and the last-observed user property; never mark it as a key event. Preserve site consent handling and never use pre-consent classification for advertising.

### Build whole-session segments in Explorations

1. Open **Explore → Free form**, then **Variables → Dimensions → +**. Import **Stream ID**, **Event name**, **Traffic class (event)**, **Session source / medium**, and **Session default channel group**. Import **Sessions**, **Engaged sessions**, **Event count** and purchase-related metrics supported by the property. Use separate tabs for incompatible combinations.
2. Under **Segments → + → Create a custom segment → Session segment**, create **All sessions** with an include condition **Stream ID = your web stream ID**. Use this stream restriction for every segment below. Keep the full session; do not apply a tab-level `event_name=traffic_class` filter, which would remove purchases and engagement events.
3. Duplicate the baseline as **Sessions excluding detected automation**. Add an **Exclude sessions when** group. In a **Within the same event** condition group, use **Event name exactly matches `traffic_class` AND Traffic class (event) matches regex `^(automated|declared_agent)$`**. OR this with a group where **Traffic class (event) matches regex `^(automated|declared_agent)$`**, without any event-name constraint. The second branch also catches labels on purchase/click/other events and logically subsumes the first. Exclude the entire session on any occurrence; neither the last class nor the user property determines exclusion. Do not exclude every `traffic_class` event regardless of value.
4. Save and apply the baseline and retained segment through **Segment comparisons**. Duplicate the retained segment as **Stricter sensitivity view**, extending the exclusion regex to `^(automated|declared_agent|suspicious)$`.
5. Create **Suspicious within retained sessions** by including sessions with `suspicious` on any event and retaining the automated/declared exclusion. Show this separately within retained traffic. Create **Observed human-only cohort (diagnostic)** by including `human` on any event and excluding sessions containing any of the other three values. This is a labelled subset, never the headline population.
6. Create coverage segments **With any class** and **Without any class**, respectively including/excluding sessions with **Traffic class (event) matches regex `^(human|suspicious|automated|declared_agent)$`** on any event. Show both counts and their share of baseline sessions. Detector-event presence alone is not complete coverage: other events may carry class even when final delivery fails.

Use [Google's segment builder](https://support.google.com/analytics/answer/9304353?hl=en) for condition scopes. Segments are limited to available exploration data; retention, sampling and modeled UI metrics can differ from raw export. Stream scoping and the date range must match across comparisons.

### Purchases, revenue and timing

Headline **purchase conversion rate = purchasing sessions / sessions in the same cohort**. In a duplicate tab, create a purchasing subset of each session segment by adding a separate session condition group containing `event_name=purchase`. Divide that subset's Sessions by its parent cohort's Sessions; keep the same date/stream. Use these session counts rather than purchase-event counts or the count of all key events. Never require purchase and `traffic_class` as event names on the same event. `add_to_cart` and `generate_lead` are separate diagnostics, not headline purchase conversions.

Report purchase revenue for **All sessions**, and break it down into the retained and **Excluded detected automation** session segments. The latter contains sessions with automated/declared evidence on any event, including agent-assisted purchases, which are real revenue. Do not add revenue from missing-ID pings to identifiable-session revenue. Removing low-converting sessions can raise CR arithmetically; it does not prove marketing improvement.

Use [bigquery.sql](bigquery.sql) for one row per `(user_pseudo_id, ga_session_id)` in one web stream, flags `any_automated`, `any_declared`, `any_suspicious`, `has_class`, `has_agent_operator`, `agent_operator`, `first_class`, `last_class`, and `class_at_first_conversion`. The last field means the first **purchase**: its own class parameter, otherwise the latest class before it. An automatic event parameter can be a captured initial or startup-fallback value from shared settings; this timing field describes exported labels, not verified current-page evidence. No future class or user property fills that value. UI “contains a label” segments cannot reliably reconstruct this timing. Later `human` never erases earlier automation evidence for session exclusion.

### Standard report comparisons

1. Open **Reports → Acquisition → Traffic acquisition → Add comparison / Create new**.
2. Select **Traffic class (event)** where compatible, choose exact match `automated` or `declared_agent` (multiple values use OR), and keep the default baseline. Add `suspicious` as another comparison; scope the report/comparisons to the web stream.
3. Treat these as event-label comparisons. An event-scoped comparison or “does not match” filter does not guarantee exclusion of the entire session, can handle `(not set)` differently, and can leave earlier unlabelled conversions in scope. Do not label it “sessions excluding detected automation”. Use the Exploration session segments or SQL for that comparison view. If the dimension is unavailable/incompatible, use Explore. See [comparison controls and compatibility](https://support.google.com/analytics/answer/9269518?hl=en).

### Plausibility by hour and city

To check that detected automation looks like automation, build a **Free form** exploration with the session segments from above as comparisons (retained traffic vs. **Excluded detected automation**):

1. Rows: **Hour** (or **Date + hour (YYYYMMDDHH)** for bursts); values: **Sessions**. Human traffic should follow the site's daily rhythm; automation is usually flatter.
2. Replace the rows with **City**. Automation often concentrates in data-centre cities or `(not set)`; human traffic follows the audience.

Treat both as sanity checks, not evidence about any single session: VPNs, corporate networks and night owls exist. See the [study protocol](../study/protocol.md) for how the result is reported.

### Interpretation and coverage

`human` means **no automation detected**, `suspicious` uncertain evidence, `automated` automation evidence without a judgement of intent, and `declared_agent` an unverified claim. Score is not a probability. Exclusion keeps unknown sessions; “only human” selects visits where classification and delivery worked and biases the headline. Always display coverage and suspicious traffic alongside the headline, which stays All sessions.

Missing-ID cookieless pings are separate event totals, not sessions. Never reconstruct identity or join via IP/UA. JS-less fetches usually send no GA4 event at all; blocked tags, consent settings, early pageviews and unload loss also affect coverage. Referrals from assistants can be ordinary people following links and never establish automation. Converting or engaged automation warrants review, not automatic relabelling as human.
