# Labelled traffic dashboard

The dashboard labels traffic; it removes nothing. The headline is **All sessions**. Agent-assisted sessions (`agent_user`) are usually real customers: show their purchases, revenue and leads separately as a breakdown, never merged into an "automation" or "excluded" total. Verified automation platforms (`automation_verified`: Browserbase, Kernel, Cloudflare Browser Run, Shopify Cloudsurf) are kept as their own group, separate from both user agents and crawlers.

## Server collector: `vv_type` and `vv_detail`

For the Vanilla collector integration, use [session-classification.sql](session-classification.sql). Replace the dataset and dates, run Query 0 to validate ping-page IDs, currencies and coverage, then run the whole script. Adapt the terminal SELECTs into separate reporting tables for scheduled reporting; keep session units and denied ping-page units separate. The SQL was validated once against the demo property's live export on 2026-11-21.

In Looker Studio, **Create → Data source → BigQuery**, choose the reporting table, then **Connect / Add to report**. Repeat per result. See [Google's BigQuery connector](https://cloud.google.com/looker/docs/studio/connect-to-google-bigquery).

Register `vv_type` and `vv_detail` as **event-scoped** GA4 custom dimensions. Data API names are `customEvent:vv_type` and `customEvent:vv_detail`. The collector sends these two labels instead of the old six parameters. The tracker sends browser evidence to the server as before; the collector computes the two GA4 labels without waiting.

For a GA4 connector operator dimension, use:

```text
REGEXP_EXTRACT(vv_detail, '^([^|]+)')
```

`vv_detail` is `operator|verification|purpose|claim|browser_class|browser_phase`, with unknown operator `none` and absent positions `-`. It contains current-hit evidence plus the sticky known operator. A sticky type may describe stronger earlier evidence, so do not assume every detail verifies its sticky type. Use **vv_detail begins with `openai|`** for an operator event filter. Since server 0.3.5 the operator can also come from a browser page marker (claim `dom_marker`, type `agent_unverified`); a UA token never names an operator. **Count verified operators with vv_type = `agent_verified` or `crawler_verified`** (per hit: verification segment `signature_valid` or `ip_match`), and exclude purpose `intermediary` (Browserbase, signing infrastructure, server 0.4.0) when counting the agents themselves. A calculated field for the operator source:

```text
CASE WHEN vv_type IN ('agent_verified', 'crawler_verified') THEN 'verified'
     WHEN REGEXP_EXTRACT(vv_detail, '^([^|]+)') != 'none' THEN 'dom_marker'
     ELSE 'none' END
```

The complete `vv_type` dictionary is `pending`, `human`, `bot_suspicious`, `agent_unverified`, `bot_automation`, `crawler_verified`, `agent_verified`, `bot_spoofed`. In [session-classification.sql](session-classification.sql) session ranks are respectively 0, 1, 2, 3, 4, 5, 5, 6; the first role wins a rank-5 tie. This reporting rank deliberately puts `bot_spoofed` highest, so a session with any invalid signature is reported as spoofed. The collector's live sticky memory instead ranks `bot_spoofed` at 4.5, below verified identities (5), and lets fresh equal-rank evidence replace the earlier type ([server README](../../server/README.md)); a hit can therefore carry `agent_verified` in a session the query reports as `bot_spoofed`. Verified unknown purpose maps to `agent_verified` and preserves `unknown` in detail; this does not infer a user-directed role. `human` means no automation detected; a signature verifies an operator, not customer intent or purchase approval. See [GA4 setup and cohorts](ga4-explorations.md) for the value dictionary and limits.

For quick event filters, **vv_type begins with `agent_`** selects verified/unverified agent labels, **begins with `bot_`** selects bot labels, and `crawler_verified` is separate. Build comparison cohorts that set sessions aside upstream from the strongest observed type, rather than filtering only events or using a user property; the headline stays All sessions.

| Page | Source | Display |
|---|---|---|
| Headline | Query 1, session rows | **All sessions**, purchasing sessions, purchase CR and revenue; breakdown by strongest type beside it |
| Coverage | Query 1, session rows | Type/detail/browser coverage, missing and pending counts, invalid labels |
| Verified operators | Query 2, session rows | Verified operator × purpose × strongest type; unknown purpose separate |
| Denied pings | Query 1/2, ping-page rows | Page units and their purchases/revenue, separate from session totals |

Use `SUM(purchasing_units) / SUM(units)` for purchase CR with a zero-denominator guard. Both numerator and denominator must use the **same cohort/date/stream/unit type**. Never average daily rates or mix session revenue with ping-page revenue. Show purchases and unique transactions side by side; USD revenue does not deduplicate transactions or adjust refunds. Removing low-converting sessions raises CR by arithmetic, not demonstrated marketing improvement.

Connect each result at its own grain. Do not join session totals to raw events or sum overlapping cohorts. Record date basis, timezone, stream, refresh time, exclusions and cohort rules on the report. Missing labels are unknown, not a reason to label a visit human. Later human evidence does not erase a stronger earlier type.

## Browser-only integration: `traffic_class`

For the unchanged Phase 1 browser/GTM field study, [bigquery.sql](bigquery.sql) reads `traffic_class`/`traffic_phase`/`traffic_agent`. Its browser-class cohorts are distinct from the collector's combined `vv_type` cohorts. Migration of the browser tag to `vv_type` is a later major version after that field test.

Use [bigquery.sql](bigquery.sql) as the transformation. Set the export dataset, **one web stream ID**, timezone, date range, scan padding, optional first-observed-city filter and test windows. Run the whole script. It creates temporary tables and returns A–I plus study summary and evaluation-window outputs; for scheduled reporting, adapt each terminal SELECT to write a separate reporting table in your own dataset. Keep the export read-only, rebuild recent dates for late arrivals, and preserve session-boundary padding.

In Looker Studio, **Create → Data source → BigQuery**, choose the reporting table, then **Connect / Add to report**. Repeat per result. Set `session_day` (or event `day` for A/F2) as Date and the date-range dimension. See [Google's BigQuery connector](https://cloud.google.com/looker/docs/studio/connect-to-google-bigquery).

Collection requires `traffic_class={{VV - current class}}` on other GA4 event tags (`gaawe`), evaluated at fire time. The variable prefers verified B7 server agents over browser human/suspicious (excluding crawler/intermediary), preserving browser automated/declared precedence, then falls back to the startup previous-class string `window.__visitorVerdictLast`; it never reads storage. The dedicated **VV - GA4 traffic_class** event instead maps class/phase/score/version/agent/webmcp/claim (seven event DLVs) from the corresponding `VV - DLV …` variables. Version 1.4.1 sends no `traffic_class` user property; remove legacy mappings from existing tags.

Container 1.4.1 (with the `agent` phase introduced in 1.1.0) sends `automated`/`declared_agent` on initial publication, the `declared_agent` escalation on the agent phase and all classes on final. Several hits can carry the same class. Use sessions with any matching hit; classification-event counts measure delivery volume, not visits or detection recall.

Optionally wire the existing Google tag to **VV - initial OR VV - timer fallback 1s**, with **Once per page**, replacing early All Pages/Initialization triggers. Set `traffic_class={{VV - current class}}` in its Shared event settings. The initial path can label the first `page_view`; fallback may be unlabelled. Automatic events retain the Google tag's startup settings, not later final updates. For CSP-sensitive sites, use the sandboxed variable template reading `__visitorVerdict.class` and `__visitorVerdictLast`; this alternative is browser-only and has no B7 server precedence, which requires the imported Custom JavaScript variable; script deployment still needs to satisfy CSP. See [setup, timing and consent](../ga4-reporting.md).

The SQL aggregates events to **one row per `(user_pseudo_id, ga_session_id)` within the selected web stream before any metrics joins or cohort expansion**. Keep `class_group`, flags `any_automated`, `any_automation_verified`, `any_agent_user`, `any_suspicious`, `any_dom_host`, `has_class`, `has_agent_operator` (with `agent_operator`, `automation_verified_operator`, `agent_claim`), and the timing fields `first_class`, `last_class`, `class_at_first_conversion` in that transformation. The latter uses the first purchase's own parameter or the latest preceding class, never a later observation or user property. Automatic-event labels may be captured initial or startup-fallback values from shared settings, so timing fields describe observed exported labels, not guaranteed current-page evidence. Exact export-order ties remain ambiguous. Do not attach raw events to session metrics and sum them again.

| Page | Result | Display |
|---|---|---|
| Headline | B | **All sessions**, purchasing sessions, purchases, purchase CR, purchase revenue, lead sessions and leads separately; optional comparison cohorts beside it |
| Breakdowns | B, E | Separate rows/cohorts for `Labelled: agent_user`, `Labelled: automation_verified`, `Labelled: automation`, `Labelled: suspicious` and `Unclassified (unknown)`; agent-assisted breakdown by `agent_operator` and `agent_claim` from E (separating experimental `dom_host` for Claude in Chrome 1.0.107 from `dom_marker`/`ua_token`/server claims) |
| Sensitivity | B | Optional comparisons: without automation & `automation_verified`; without automation, `automation_verified` & `agent_user`; stricter (also without `suspicious`); observed human-only diagnostic |
| Acquisition | C | Cohort × source/medium/channel, assistant referral annotation separate from evidence |
| Environment | D | Cohort × first observed device/browser/OS/country/city |
| Evidence/timing review | E | `class_group`, any-evidence flags, `agent_claim`/`any_dom_host`, first/last class and class at first purchase; purchasing, lead and long-engagement counts |
| Coverage | F1, F2 separately | Sessions with any valid class vs without; detector/final delivery; missing-ID event/purchase/revenue/lead totals |
| Event labels | A | Class and `agent_claim` parameter distribution, including unclassified events; not session counts |

Set every headline chart to **All sessions**. Show the separated `Labelled: …` cohorts as breakdowns and the `Comparison: …` cohorts beside them as optional sensitivity checks; comparison cohorts retain unknown sessions. Keep `suspicious` visible separately. Observed human-only requires class coverage and no other class and is diagnostic only. Cohorts overlap intentionally: never sum across cohorts. A later human result does not undo earlier evidence.

Use `SUM(purchasing_sessions) / SUM(sessions)` for headline purchase CR and `SUM(lead_sessions) / SUM(sessions)` for lead CR, guarding a zero denominator. Both numerator and denominator must use the **same cohort/date/stream**. Never average daily rates, divide filtered purchasers by all sessions, sum `purchases + leads`, or use `add_to_cart` as headline conversion. Sum purchase revenue only within the selected cohort; SQL uses USD `ecommerce.purchase_revenue_in_usd` deduplicated by non-empty `transaction_id` within the scanned stream (not refund-adjusted). Setting aside low-converting sessions raises CR by arithmetic, not demonstrated marketing improvement.

Always show **sessions_with_class**, **sessions_without_class**, and `SUM(sessions_with_class) / SUM(sessions)` coverage alongside baseline totals. Comparison cohorts that retain unknown sessions are preferable to "only human" because missing labels are unknown, not evidence for dropping a visit. A/F2 use event dates; B–F1 use session-start dates, so boundary totals differ.

Connect each result at its own grain. Do not blend B/C/D on date/cohort: multiple source/device rows multiply metrics. Either use a single result per chart or join independently aggregated session metrics one-to-one on the complete session key upstream, then aggregate. Changing pre-aggregation filters requires rerunning SQL. Record date basis, timezone, stream, refresh time, padding and cohort rules on the report.

Keep missing-ID/cookieless pings in F2 as event-level totals, never fabricated sessions. Never join via IP/UA, coalesce missing IDs to one visitor, or retroactively link pre-consent pings. JS-less traffic is generally absent even here. Raw observed BigQuery totals can differ from GA4 modeled UI reporting.

Display labels: `human` = **no automation detected**, `suspicious` = uncertain evidence, `automated` = automation evidence rather than intent, `declared_agent` = unverified claim (separated in SQL into `agent_user` vs `automation_verified` when `traffic_agent_claim = 'server_intermediary'`). Score is not a probability. Version 1.4.1 no longer sets User Property `traffic_class`; remove legacy mappings and use event-scoped parameters and SQL session classification only. Historical user-property values must not determine session classification. Never mark `traffic_class` as a key event.

## Campaign dashboard: AI agents and bots in campaigns

[campaign-dashboard.sql](campaign-dashboard.sql) holds three plain SELECTs that run with read-only access and can be pasted as BigQuery **custom queries**:

- **Query A** — browser/GTM integration (`traffic_class`, `traffic_agent`, `traffic_agent_claim`), **one row per joinable session**.
- **Query B** — server collector integration (`vv_type`, `vv_detail`), **one row per joinable session only**. Denied cookieless pings (`/d`) are excluded from Query B so visitors who consent after a `/d` ping never double-count sessions, purchases or revenue.
- **Query B2** — server collector denied cookieless pings (`ping_page`) and unjoinable hits, as a **separate diagnostic data source**. Never union or sum Query B2 with Query B.

All queries filter to a single `stream_id` (edit `'1234567890'` per `src` block), scan `±1` day padding around `@DS_START_DATE`/`@DS_END_DATE` for session queries (A and B) to recover midnight-crossing sessions, accept all valid operator slugs (not only `openai`/`anthropic`), separate `automation_verified` (Browserbase, Kernel, Cloudflare Browser Run, Shopify Cloudsurf — both `vv_type = 'automation_verified'` and legacy `agent_verified` with `vv_detail` purpose `intermediary`, plus `traffic_agent_claim = 'server_intermediary'` in Query A) from `agent_user`, `agent_verified_unknown_purpose` and `crawler`, use server precedence (`bot_spoofed` 4.5 < `automation_verified` 4.75 < `agent_verified`/`crawler_verified` 5; legacy `agent_verified`/`intermediary` also ranks 4.75), deduplicate `purchases` and USD `purchase_revenue` by `transaction_id`, keep `purchases` and `leads` strictly separate, and include `google_ads_campaign` attribution.

**Attribution and test-traffic caveats for Vanilla (Query B / B2):**
- Vanilla strips query strings (including `?vvp=`) from `page_location` before forwarding, so mark Vanilla test traffic via `utm_campaign=test_...` (or `qa_`/`e2e_`/`canary_`) or test source/medium rather than `?vvp=`.
- Auto-tagged Google Ads clicks (`gclid`) on a Vanilla property not linked to Google Ads fall into `(none)` (with `has_gclid = TRUE`) unless UTM parameters are also present (verify in your live BigQuery export).

Columns: `site`, `stream_id`, `session_date`, `source`/`medium`/`campaign` with `source_basis`, `default_channel`, `has_gclid`, `device_category`, `landing_page`, strongest `class` and separated `class_group`, group booleans (`is_agent_user`, `is_automation_verified`, `is_automation`, `is_crawler`, `is_suspicious`), operator fields (`agent_operator`, plus `automation_verified_operator`/`agent_claim`/`any_dom_host` in A or `verified_operator`/`vv_purpose`/`is_agent_verified_unknown_purpose` in B), coverage flags, engagement, deduplicated `purchases`, raw `purchase_events`, `unique_transactions`, deduplicated USD `purchase_revenue`, `leads` and `other_key_events`. Test traffic is flagged in `traffic_scope`/`test_reason`, never dropped; edit the test regexes and `key_events_regex` in the `params` CTE.

### Create the data source

1. **Create → Data source → BigQuery → Custom query**, choose the billing project, paste Query A or Query B with your dataset, `stream_id` and `property_timezone`, tick **Enable date range parameters** (the SQL uses `@DS_START_DATE`/`@DS_END_DATE`) and **Connect**. Add Query B2 as a **separate** data source if you want a diagnostic chart of denied `/d` pings. Several properties: UNION ALL one `src` block per property with its own `site` label and `stream_id`.
2. Or create the report from a link with the [Linking API](https://developers.google.com/looker-studio/integrate/linking-api). Without `c.reportId` the default report gets one embedded data source, so no alias is needed; URL-encode every value:

```text
https://lookerstudio.google.com/reporting/create?c.mode=edit
  &r.reportName=<name>&ds.connector=bigQuery&ds.type=CUSTOM_QUERY
  &ds.billingProjectId=<billing-project>&ds.datasourceName=<name>&ds.sql=<encoded SQL>
```

The Linking API cannot tick date range parameters, so for a link replace `@DS_START_DATE`/`@DS_END_DATE` with a rolling window (for example `FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY))` and `... INTERVAL 1 DAY`) and filter with the report's date control on `session_date`. Remove comments and repeated whitespace first: very long links (about 16 kB and more) are rejected, so use one link per query, and add the second data source in the report with **Resource → Add data**. The report opens with a default table; the person who opens the link owns the report and its data source credentials.

### Calculated fields and charts

Add these fields to the Query A or Query B data source (keep `agent_user`, `agent_verified_unknown_purpose`, `automation_verified`, `automation`, `crawler` and `suspicious` separate, and never sum `purchases + leads`):

| Field | Formula |
|---|---|
| Sessions | `SUM(units)` |
| Engaged sessions | `SUM(IF(engaged, 1, 0))` |
| Purchasing sessions | `SUM(IF(purchases > 0, 1, 0))` |
| Lead sessions | `SUM(IF(leads > 0, 1, 0))` |
| Coverage | `SUM(IF(has_class, 1, 0)) / SUM(units)` |
| Pending share (B) | `SUM(IF(is_pending, 1, 0)) / SUM(units)` |
| Agent-user session share | `SUM(IF(is_agent_user, units, 0)) / SUM(units)` |
| Agent-user revenue share | `SUM(IF(is_agent_user, purchase_revenue, 0)) / SUM(purchase_revenue)` |
| Agent-user purchase share | `SUM(IF(is_agent_user, purchases, 0)) / SUM(purchases)` |
| Agent-user lead share | `SUM(IF(is_agent_user, leads, 0)) / SUM(leads)` |
| Verified unknown-purpose session share (B) | `SUM(IF(is_agent_verified_unknown_purpose, units, 0)) / SUM(units)` |
| Automation-verified session share | `SUM(IF(is_automation_verified, units, 0)) / SUM(units)` |
| Automation session share | `SUM(IF(is_automation, units, 0)) / SUM(units)` |
| Automation revenue share | `SUM(IF(is_automation, purchase_revenue, 0)) / SUM(purchase_revenue)` |
| Automation purchase share | `SUM(IF(is_automation, purchases, 0)) / SUM(purchases)` |
| Automation lead share | `SUM(IF(is_automation, leads, 0)) / SUM(leads)` |
| Crawler session share (B) | `SUM(IF(is_crawler, units, 0)) / SUM(units)` |
| Suspicious session share | `SUM(IF(is_suspicious, units, 0)) / SUM(units)` |

Six charts are enough for a first version. Put a date control, a `site` control and a `traffic_scope` control (default `real`) on top. (For Query A, optionally add an `agent_claim` control to monitor experimental `dom_host` separately.)

1. **Scorecards:** Sessions, Purchasing sessions, `purchase_revenue`, `leads`, Coverage, Agent-user revenue share, Automation revenue share, Automation-verified session share.
2. **Stacked bar by campaign** (dimension `campaign`, breakdown `class_group`): Sessions — shows `no automation detected`, `agent_user`, `agent_verified_unknown_purpose`, `automation_verified`, `automation`, `crawler`, `suspicious`, `pending` and `unknown` separately.
3. **Table by source / medium / campaign** with `class_group` as pivot: Sessions, Engaged sessions, `purchases`, `purchase_revenue`, `leads`.
4. **Table by default channel and `has_gclid`**: Sessions, Agent-user revenue share, Agent-user purchase share, Agent-user lead share, Automation revenue share, Automation purchase share, Automation lead share.
5. **Table by landing page × `class_group` × `class`**: Sessions, `purchases`, `purchase_revenue`, `leads`.
6. **Time series by `session_date`**: Coverage and Pending share (B), so a drop in labels is visible as a measurement gap rather than as zero agents. Add a separate diagnostic page connected to Query B2 if you want to monitor denied `/d` ping volume by `class_group`.

Read the numbers as labels, not removals: the headline stays all sessions. `unknown`/`missing` means no label reached the export (before deployment, blocked tag, short visit), not human. `suspicious` and `bot_suspicious` are uncertain; show them apart from the clear classes. `agent_user` sessions are usually real customers, whereas `automation_verified` identifies verified automation infrastructure whose end purpose is unknown. Browser-only Query A cannot distinguish UA-token crawlers (`GPTBot`, `CCBot`, `Applebot`) from interactive `declared_agent` hits without server verification. GA4 drops traffic from known bots and spiders before export, so obvious crawlers are absent and the denominators describe only what reached GA4. The `purchase_revenue` output is USD deduplicated by `transaction_id`, not refund-adjusted.

Browser/GTM `agent_user` is a declaration group, not proof of a user-directed purpose: `server_signature`/`server_ip` echo claims do not encode that purpose. For verified-purpose reporting, use campaign-dashboard.sql Query B/B2: only `agent_verified` with `purpose=user_directed` enters `agent_user`; unknown or missing purpose enters `agent_verified_unknown_purpose`. Unverified declarations remain unverified, including UA tokens that may identify crawlers.

Query B/B2 keeps `agent_verified` with unknown, missing or unrecognised purpose in `agent_verified_unknown_purpose`. This confirms an operator identity, not customer intent. An explicit `purpose=user_directed` is required for a verified agent to enter `agent_user`; `agent_unverified` remains a declaration group. `unique_transactions` includes only the winning `tx_rn=1` purchase, so it can be summed across sessions within the same scanned data source. Transaction deduplication is scoped to the scan: B and B2 must remain separate and repeated scans or cohorts must not be added together.
