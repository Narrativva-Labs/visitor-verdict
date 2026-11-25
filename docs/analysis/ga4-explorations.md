# GA4: reporting on labelled traffic

Visitor Verdict labels traffic; nothing is excluded from GA4. **All sessions** is the headline population. Optional comparison segments below leave the data intact. Agent-assisted sessions (`declared_agent` excluding `server_intermediary`, with **Traffic agent (event)** when an operator is known) are usually real customers using an AI agent: report them as their own segment (`agent_user`) with their purchases, revenue and leads, never merged with browser automation (`automated`) or verified automation platforms (`automation_verified`).

Two integrations exist: [server collector](#server-collector-vv_type-and-vv_detail) labels use `vv_type` / `vv_detail`, while [browser/GTM](#browser-only-integration-traffic_class) uses `traffic_class` and its evidence fields. Keep their data sources and cohorts separate.

## Server collector: `vv_type` and `vv_detail`

Register two event-scoped custom dimensions in **Admin → Data display → Custom definitions**: **Visitor type** (`vv_type`) and **Visitor detail** (`vv_detail`). Data API names are `customEvent:vv_type` / `customEvent:vv_detail`. The collector derives these from browser and server evidence; the former six-field server label format is replaced by these two parameters. This does not remove the separate browser/GTM parameters.

Early hits may be `unclassified` (formerly `pending`); a collector can retain stronger evidence for later hits without backfilling exported events. Preserve site consent handling. [The server dictionary](../conversion-guidance.md#server-labels-library-080) documents all ten types and the six `vv_detail` positions. Library 0.8.0 renames `pending` to `unclassified`, adds `crawler_unverified` (rank 3), and reclassifies IP-verified user-directed fetchers (`ChatGPT-User`, `Claude-User`, etc.) to `crawler_verified` while retaining `user_directed` in `vv_detail`; `automation_verified` stays at rank 4.75, between `bot_spoofed` (4.5) and direct verified agents/crawlers (5). `bot_spoofed` requires a cryptographic mismatch against a known valid key or a certain fresh `ip_mismatch`; expiry/replay/unknown keys alone do not qualify. Optional Poppy verification can retain unknown purpose.

### Server session segments

Import **Stream ID**, **Event name**, **Visitor type**, **Visitor detail**, acquisition dimensions and supported session/purchase metrics into Explore. Create session segments scoped to one web stream. Keep whole sessions; filtering every chart to a classification event would remove purchases and engagement.

1. **All sessions** is the headline, including missing labels and `unclassified` (or legacy `pending`).
2. Create separate diagnostic segments for `agent_verified`, `agent_unverified`, `automation_verified`, `crawler_verified`, `crawler_unverified`, `bot_automation`, `bot_spoofed` and `bot_suspicious`. These “any hit” segments can overlap; never add them together as a total.
3. For a verified user-directed agent, require `Visitor type = agent_verified` AND detail matching `^[^|]*[|][^|]*[|]user_directed[|]` **within the same event**. Unknown/missing purpose is not a user-directed customer. To obtain mutually exclusive session groups, use SQL below instead of combining UI segments.
4. Keep infrastructure separate: `automation_verified`, plus historical `agent_verified` with detail purpose `intermediary` on the same event. An operator named by `dom_marker`/`dom_host` is unverified. A known operator name alone does not establish verification.
5. Coverage: valid types match `^(human|unclassified|pending|agent_verified|automation_verified|agent_unverified|crawler_verified|crawler_unverified|bot_automation|bot_suspicious|bot_spoofed)$`. Show **With a valid type**, **Without a valid type** and **Unclassified observed** separately. Missing is not `unclassified`; neither means human. **Observed human-only** includes `human` and excludes every other valid type; it is diagnostic, never the headline.

For optional sensitivity comparisons, duplicate All sessions and set aside explicit bot/infrastructure segments; state the choices and keep agent revenue in the headline. Avoid a shared “non-human” total. For known operators, inspect the first detail position; for fresh verification, require `signature_valid` or `ip_match` in the second position. Never interpret the whole detail string as an operator name.

Headline purchase CR is purchasing sessions / sessions in the same cohort; use an additional `event_name=purchase` session condition for purchasers, with the same dates and stream. Keep purchases and leads separate. Report all revenue, with labelled breakdowns, rather than subtracting agent purchases.

Use [campaign-dashboard.sql Query B](campaign-dashboard.sql) for mutually exclusive strongest-evidence session groups, USD revenue, transaction-ID deduplication and current/legacy infrastructure priority. Query B separates `agent_verified_unknown_purpose` from `agent_user`. Query B2 keeps denied/unjoinable pings separate: never add them to session revenue, and verify page-ID cardinality before grouping pings. Boundaries use the documented scan padding; missing IDs cannot be retroactively linked to a session. [session-classification.sql](session-classification.sql) is an older diagnostic recipe with a different ranking policy; use Query B/B2 for the audited 0.6.1 segmentation.

The local `header_mismatch` diagnostic is weak header-consistency evidence, not verification, operator or purpose. It is not exported and does not change `vv_type` or the six detail positions. Proxy stripping and browser privacy policies can cause it.

## Browser-only integration: `traffic_class`

Use the web stream only, a consistent date range, and event-scoped custom dimensions registered in **Admin → Data display → Custom definitions**:

- **Traffic class (event)** (parameter `traffic_class`)
- **Traffic agent (event)** (parameter `traffic_agent`: `openai`, `anthropic` from browser markers, or any server-registry operator when server echo is present)
- **Traffic agent claim (event)** (parameter `traffic_agent_claim`: `dom_marker`, experimental `dom_host` for Claude in Chrome 1.0.107, `ua_token`, or server claims such as `server_signature`, `server_ip`, `server_intermediary`). Registering `traffic_agent_claim` is required to monitor experimental `dom_host` false positives separately and to keep `server_intermediary` (`automation_verified`) separate from user agents.
- Optionally register event-scoped `traffic_webmcp`, `traffic_phase` and `traffic_version`.

**Do not register or use a user-scoped `traffic_class` dimension.** The `traffic_class` user property was removed in GTM 1.4.1 because a last-observed value could overwrite earlier evidence and leak into subsequent sessions. Remove legacy mappings from existing tags; historical user-property values must not classify sessions. Use event-scoped dimensions together with session-level classification in SQL ([bigquery.sql](bigquery.sql) / [campaign-dashboard.sql](campaign-dashboard.sql)) or GA4 Exploration session segments.

On every other GA4 event tag (`gaawe`), map `traffic_class={{VV - current class}}`, evaluated at firing time. The imported variable preserves browser `automated`/`declared_agent`, then reads `window.__visitorVerdictServer` to prefer a verified B7 agent over browser `human`/`suspicious` (excluding crawler/intermediary). It then uses the valid browser class or startup `window.__visitorVerdictLast`, returning undefined when unavailable. See the exact logic in [GA4 reporting](../ga4-reporting.md). It never reads storage. The dedicated **VV - GA4 traffic_class** publication event uses the seven publication DLVs (`traffic_class`, `traffic_phase`, `traffic_score`, `traffic_version`, `traffic_agent`, `traffic_webmcp`, `traffic_agent_claim`), rather than the live variable, with no user property.

Container 1.4.1 (with the `agent` phase introduced in 1.1.0) sends `automated`/`declared_agent` on initial publication, the `declared_agent` escalation on the agent phase and all classes on final. Several hits can carry the same class. Use sessions with any matching hit; classification-event counts measure delivery volume, not visits or detection recall.

Optionally wire the existing Google tag to **VV - initial OR VV - timer fallback 1s** as two normal triggers, with **Once per page**, replacing its early All Pages/Initialization trigger. Add `traffic_class={{VV - current class}}` to its Shared event settings. The initial path can label the first `page_view`; fallback after one second can still be unlabelled. Shared settings capture a startup value once, so automatic events need not reflect later final evidence. There is no backfill or automatic refresh.

For CSP-sensitive sites, import the sandboxed [current-class variable template](../../gtm/templates/vv-current-class.tpl), which currently covers browser evidence only and reads `__visitorVerdict.class` and `__visitorVerdictLast`, and replace the Custom JavaScript variable's references. It has no storage/network/write/execute permissions. The detector script must still satisfy CSP. See [readiness, mappings and consent](../ga4-reporting.md). Keep the dedicated traffic_class event for event-label coverage; never mark it as a key event. Preserve site consent handling and never use pre-consent classification for advertising.

### Build whole-session segments in Explorations

1. Open **Explore → Free form**, then **Variables → Dimensions → +**. Import **Stream ID**, **Event name**, **Traffic class (event)**, **Traffic agent (event)**, **Traffic agent claim (event)**, **Session source / medium**, and **Session default channel group**. Import **Sessions**, **Engaged sessions**, **Event count** and purchase-related metrics supported by the property. Use separate tabs for incompatible combinations.
2. Under **Segments → + → Create a custom segment → Session segment**, create **All sessions** with an include condition **Stream ID = your web stream ID**. Use this stream restriction for every segment below. Keep the full session; do not apply a tab-level `event_name=traffic_class` filter, which would remove purchases and engagement events.
3. Create separate labelled breakdown segments (all scoped to the web stream):
   - **Labelled: automation** — include sessions where **Traffic class (event) exactly matches `automated`** on any event.
   - **Labelled: automation_verified (intermediary)** — include sessions where **Traffic agent claim (event) exactly matches `server_intermediary`** on any event (and exclude `automated`).
   - **Labelled: agent_user** — include sessions where **Traffic class (event) exactly matches `declared_agent`** on any event, and exclude sessions with `automated` or `traffic_agent_claim = server_intermediary`. Break down by **Traffic agent (event)** and **Traffic agent claim (event)** so experimental `dom_host` and `ua_token` (which also includes crawlers in browser-only setups) stay visible apart from `dom_marker` and verified server claims.
   - **Labelled: suspicious** — include sessions with `suspicious` on any event, excluding `automated` and `declared_agent`.
4. For optional sensitivity comparisons, duplicate **All sessions** and add an **Exclude sessions when** group matching **Traffic class (event) exactly matches `automated`** (or, for a stricter comparison that also sets aside intermediaries/agents/suspicious, use regex `^(automated|declared_agent)$` or `^(automated|declared_agent|suspicious)$`). Exclude the entire session on any occurrence; neither the last class nor any user property determines session membership. Do not exclude every `traffic_class` event regardless of value.
5. Create **Observed human-only cohort (diagnostic)** by including `human` on any event and excluding sessions containing any of the other three values. This is a labelled subset, never the headline population.
6. Create coverage segments **With any class** and **Without any class**, respectively including/excluding sessions with **Traffic class (event) matches regex `^(human|suspicious|automated|declared_agent)$`** on any event. Show both counts and their share of baseline sessions. Detector-event presence alone is not complete coverage: other events may carry class even when final delivery fails.

Use [Google's segment builder](https://support.google.com/analytics/answer/9304353?hl=en) for condition scopes. Segments are limited to available exploration data; retention, sampling and modeled UI metrics can differ from raw export. Stream scoping and the date range must match across comparisons.

### Purchases, revenue and timing

Headline **purchase conversion rate = purchasing sessions / sessions in the same cohort**. Keep **leads** (`generate_lead`) separate from **purchases** (`purchase`): never add them into a combined conversion rate. In a duplicate tab, create a purchasing subset of each session segment by adding a separate session condition group containing `event_name=purchase`. Divide that subset's Sessions by its parent cohort's Sessions; keep the same date/stream. Use these session counts rather than purchase-event counts or the count of all key events. Never require `purchase` and `traffic_class` as event names on the same event. `add_to_cart` and `generate_lead` are separate diagnostics, not headline purchase conversions.

Report purchase revenue for **All sessions**, and break it down across the separated segments (**Labelled: agent_user**, **Labelled: automation_verified**, **Labelled: automation**, **Labelled: suspicious**, and unlabelled/human). Agent-assisted purchases (`agent_user`) are real revenue and must not be merged into an "automation" or "excluded" total. Do not add revenue from missing-ID pings to identifiable-session revenue. Setting aside low-converting sessions can raise CR arithmetically; it does not prove marketing improvement.

Use [bigquery.sql](bigquery.sql) for one row per `(user_pseudo_id, ga_session_id)` in one web stream, `class_group`, flags `any_automated`, `any_automation_verified`, `any_agent_user`, `any_suspicious`, `any_dom_host`, `has_class`, `has_agent_operator`, `agent_operator`, `automation_verified_operator`, `agent_claim`, `first_class`, `last_class`, `class_at_first_conversion`, and transaction-deduplicated USD `purchase_revenue`. The `class_at_first_conversion` field means the first **purchase**: its own class parameter, otherwise the latest class before it. An automatic event parameter can be a captured initial or startup-fallback value from shared settings; this timing field describes exported labels, not verified current-page evidence. No future class or user property fills that value. UI "contains a label" segments cannot reliably reconstruct this timing. Later `human` never erases earlier automation evidence in session classification.

### Standard report comparisons

1. Open **Reports → Acquisition → Traffic acquisition → Add comparison / Create new**.
2. Select **Traffic class (event)** where compatible, choose exact match `automated` or `declared_agent` separately (avoid lumping customer agents and bots together), and keep the default baseline. Add `suspicious` as another comparison; scope the report/comparisons to the web stream.
3. Treat these as event-label comparisons. An event-scoped comparison or "does not match" filter does not guarantee exclusion of the entire session, can handle `(not set)` differently, and can leave earlier unlabelled conversions in scope. Because one page can send multiple `traffic_class` events and standard reports split mixed sessions across rows, use Exploration session segments or [bigquery.sql](bigquery.sql) for session-level counts and conversion rates. If the dimension is unavailable/incompatible, use Explore. See [comparison controls and compatibility](https://support.google.com/analytics/answer/9269518?hl=en).

### Plausibility by hour and city

To check that detected automation looks like automation, build a **Free form** exploration with the session segments from above as comparisons (e.g., **All sessions** / human baseline vs. **Labelled: automation**):

1. Rows: **Hour** (or **Date + hour (YYYYMMDDHH)** for bursts); values: **Sessions**. Human traffic should follow the site's daily rhythm; automation is usually flatter.
2. Replace the rows with **City**. Automation often concentrates in data-centre cities or `(not set)`; human traffic follows the audience.

Treat both as sanity checks, not evidence about any single session: VPNs, corporate networks and night owls exist. See the [study protocol](../study/protocol.md) for how the result is reported.

### Interpretation and coverage

`human` means **no automation detected**, `suspicious` uncertain evidence, `automated` automation evidence without a judgement of intent, and `declared_agent` an unverified claim (separated in SQL into `agent_user` vs `automation_verified` when `traffic_agent_claim = 'server_intermediary'`). Score is not a probability. Comparison cohorts retain unknown sessions; "only human" selects visits where classification and delivery worked and biases the headline. Always display coverage and suspicious traffic alongside the headline, which stays All sessions.

Missing-ID cookieless pings are separate event totals, not sessions. Never reconstruct identity or join via IP/UA. JS-less fetches usually send no GA4 event at all; blocked tags, consent settings, early pageviews and unload loss also affect coverage. Referrals from assistants can be ordinary people following links and never establish automation. Converting or engaged automation warrants review, not automatic relabelling as human.

Browser/GTM `agent_user` is a declaration group, not proof of a user-directed purpose: `server_signature`/`server_ip` echo claims do not encode that purpose. For verified-purpose reporting, use campaign-dashboard.sql Query B/B2: only `agent_verified` with `purpose=user_directed` enters `agent_user`; unknown or missing purpose enters `agent_verified_unknown_purpose`. Unverified declarations remain unverified, including UA tokens that may identify crawlers.
