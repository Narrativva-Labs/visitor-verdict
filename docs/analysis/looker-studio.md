# Labelled traffic dashboard

The dashboard labels traffic; it removes nothing. The headline is **All sessions**. Cohorts that set labelled sessions aside keep their SQL names (“Sessions excluding detected automation”) and are optional comparison views. Agent-assisted sessions are usually real customers; show their purchases and revenue as a breakdown, not as a deduction.

Use [bigquery.sql](bigquery.sql) as the transformation. Set the export dataset, **one web stream ID**, timezone, date range, scan padding, optional first-observed-city filter and test windows. Run the whole script. It creates temporary tables and returns A–I plus study summary and evaluation-window outputs; for scheduled reporting, adapt each terminal SELECT to write a separate reporting table in your own dataset. Keep the export read-only, rebuild recent dates for late arrivals, and preserve session-boundary padding.

In Looker Studio, **Create → Data source → BigQuery**, choose the reporting table, then **Connect / Add to report**. Repeat per result. Set `session_day` (or event `day` for A/F2) as Date and the date-range dimension. See [Google's BigQuery connector](https://cloud.google.com/looker/docs/studio/connect-to-google-bigquery).

Collection requires `traffic_class={{VV - current class}}` on other GA4 event tags (`gaawe`), evaluated at fire time. The variable prefers verified B7 server agents over browser human/suspicious (excluding crawler/intermediary), preserving browser automated/declared precedence, then falls back to the startup previous-class string `window.__visitorVerdictLast`; it never reads storage. The dedicated **VV - GA4 traffic_class** event instead maps class/phase/score/version/agent/webmcp/claim (seven event DLVs) from the corresponding `VV - DLV …` variables.

Container 1.1.0 sends `automated`/`declared_agent` on initial publication, the `declared_agent` escalation on the agent phase and all classes on final. Several hits can carry the same class. Use sessions with any matching hit; classification-event counts measure delivery volume, not visits or detection recall.

Optionally wire the existing Google tag to **VV - initial OR VV - timer fallback 1s**, with **Once per page**, replacing early All Pages/Initialization triggers. Set `traffic_class={{VV - current class}}` in its Shared event settings. The initial path can label the first `page_view`; fallback may be unlabelled. Automatic events retain the Google tag's startup settings, not later final updates. For CSP-sensitive sites, use the sandboxed variable template reading `__visitorVerdict.class` and `__visitorVerdictLast`; this alternative is browser-only and has no B7 server precedence, which requires the imported Custom JavaScript variable; script deployment still needs to satisfy CSP. See [setup, timing and consent](../ga4-reporting.md).

The SQL aggregates events to **one row per `(user_pseudo_id, ga_session_id)` within the selected web stream before any metrics joins or cohort expansion**. Keep flags `any_automated`, `any_declared`, `any_suspicious`, `has_class`, `has_agent_operator` (with `agent_operator`), and the timing fields `first_class`, `last_class`, `class_at_first_conversion` in that transformation. The latter uses the first purchase's own parameter or the latest preceding class, never a later observation or user property. Automatic-event labels may be captured initial or startup-fallback values from shared settings, so timing fields describe observed exported labels, not guaranteed current-page evidence. Exact export-order ties remain ambiguous. Do not attach raw events to session metrics and sum them again.

| Page | Result | Display |
|---|---|---|
| Headline | B | **All sessions**, purchasing sessions, purchase CR, purchase revenue; Sessions excluding detected automation beside it as a comparison |
| Sensitivity | B | Stricter view excluding suspicious, suspicious within retained sessions, observed human-only diagnostic |
| Labelled revenue | B, E | Excluded detected automation sessions (automated and agent-assisted), purchasing sessions, purchase revenue as a breakdown of the total; agent-assisted by `agent_operator` from E (a lower bound: current Claude in Chrome is not detected) |
| Acquisition | C | Cohort × source/medium/channel, assistant referral annotation separate from evidence |
| Environment | D | Cohort × first observed device/browser/OS/country/city |
| Evidence/timing review | E | Any-evidence flags, first/last class and class at first purchase; purchasing/long-engagement counts |
| Coverage | F1, F2 separately | Sessions with any valid class vs without; detector/final delivery; missing-ID event/purchase/revenue totals |
| Event labels | A | Class parameter distribution, including unclassified events; not session counts |

Set every headline chart to **All sessions**. Show the **Sessions excluding detected automation** cohort beside it as a comparison; it sets aside whole sessions with any automated/declared observation and retains unknown sessions. Keep suspicious visible separately within retained traffic. Sensitivity additionally excludes suspicious. Observed human-only requires class coverage and no other class and is diagnostic only. Cohorts overlap intentionally: never sum across cohorts. A later human result does not undo earlier evidence.

Use `SUM(purchasing_sessions) / SUM(sessions)` for headline purchase CR, guarding a zero denominator. Both numerator and denominator must use the **same cohort/date/stream**. Never average daily rates, divide filtered purchasers by all sessions, or use `add_to_cart` as headline conversion. Show lead/cart sessions separately. Sum purchase revenue only within the selected cohort; SQL uses exported USD purchase revenue, without transaction deduplication or refund adjustment. Removing low-converting sessions raises CR by arithmetic, not demonstrated marketing improvement.

Always show **sessions_with_class**, **sessions_without_class**, and `SUM(sessions_with_class) / SUM(sessions)` coverage alongside baseline and retained totals. Exclusion is preferable to “only human” because missing labels are unknown, not evidence for dropping a visit. A/F2 use event dates; B–F1 use session-start dates, so boundary totals differ.

Connect each result at its own grain. Do not blend B/C/D on date/cohort: multiple source/device rows multiply metrics. Either use a single result per chart or join independently aggregated session metrics one-to-one on the complete session key upstream, then aggregate. Changing pre-aggregation filters requires rerunning SQL. Record date basis, timezone, stream, refresh time, exclusions, padding and cohort rules on the report.

Keep missing-ID/cookieless pings in F2 as event-level totals, never fabricated sessions. Never join via IP/UA, coalesce missing IDs to one visitor, or retroactively link pre-consent pings. JS-less traffic is generally absent even here. Raw observed BigQuery totals can differ from GA4 modeled UI reporting.

Display labels: `human` = **no automation detected**, `suspicious` = uncertain evidence, `automated` = automation evidence rather than intent, `declared_agent` = unverified claim. Score is not a probability. Version 1.4.1 no longer sets User Property `traffic_class`; remove legacy tag mappings and use event evidence. Historical user-property values must not determine session classification. Never mark `traffic_class` as a key event.

## Campaign dashboard: AI agents and bots in campaigns

[campaign-dashboard.sql](campaign-dashboard.sql) holds two plain SELECTs that run with read-only access and can be pasted as BigQuery **custom queries**: Query A for the browser integration (`traffic_class`, `traffic_agent`), Query B for the server collector (`vv_type`, `vv_detail`). Each returns **one row per unit** (session; Query B also denied-ping pages and unjoinable hits, see `unit_type`), so Looker Studio can sum rows without double counting. Columns: site, `session_date`, source/medium/campaign with `source_basis`, default channel, `has_gclid`, device, landing page, strongest `class` and `class_group`, agent operator, coverage flags, engagement, purchases, unique transactions, revenue, leads and other key events. Test traffic is flagged in `traffic_scope`/`test_reason`, never dropped; edit the test regexes and `key_events_regex` in the `params` CTE.

### Create the data source

1. **Create → Data source → BigQuery → Custom query**, choose the billing project, paste Query A or B with your dataset, tick **Enable date range parameters** (the SQL uses `@DS_START_DATE`/`@DS_END_DATE`) and **Connect**. Several properties: UNION ALL one `src` block per property with its own site label.
2. Or create the report from a link with the [Linking API](https://developers.google.com/looker-studio/integrate/linking-api). Without `c.reportId` the default report gets one embedded data source, so no alias is needed; URL-encode every value:

```text
https://lookerstudio.google.com/reporting/create?c.mode=edit
  &r.reportName=<name>&ds.connector=bigQuery&ds.type=CUSTOM_QUERY
  &ds.billingProjectId=<billing-project>&ds.datasourceName=<name>&ds.sql=<encoded SQL>
```

The Linking API cannot tick date range parameters, so for a link replace `@DS_START_DATE`/`@DS_END_DATE` with a rolling window (for example `FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY))` and `... INTERVAL 1 DAY`) and filter with the report's date control on `session_date`. Remove comments and repeated whitespace first: very long links (about 16 kB and more) are rejected, so use one link per query, and add the second data source in the report with **Resource → Add data**. The report opens with a default table; the person who opens the link owns the report and its data source credentials.

### Calculated fields and charts

Add these fields to the data source (Query B: filter `unit_type = session` for session metrics; ping pages are shown separately, never added):

| Field | Formula |
|---|---|
| Units | `SUM(units)` |
| Engaged | `SUM(IF(engaged, 1, 0))` |
| Purchasing units | `SUM(IF(purchases > 0, 1, 0))` |
| Coverage | `SUM(IF(has_class, 1, 0)) / SUM(units)` |
| Pending share (B) | `SUM(IF(is_pending, 1, 0)) / SUM(units)` |
| Labelled non-human revenue share | `SUM(IF(is_labelled_non_human, purchase_revenue, 0)) / SUM(purchase_revenue)` |
| Labelled non-human conversion share | `SUM(IF(is_labelled_non_human, purchases + leads, 0)) / SUM(purchases + leads)` |

Six charts are enough for a first version. Put a date control, a `site` control and a `traffic_scope` control (default `real`) on top.

1. **Scorecards:** Units, Purchasing units, purchase revenue, leads, Coverage, Labelled non-human revenue share.
2. **Stacked bar by campaign** (dimension `campaign`, breakdown `class_group`): Units.
3. **Table by source / medium / campaign** with `class_group` as pivot: Units, Engaged, purchases, purchase revenue, leads.
4. **Table by default channel and `has_gclid`**: Units, Labelled non-human conversion share, Labelled non-human revenue share.
5. **Table by landing page × class**: Units, purchases, leads.
6. **Time series by `session_date`**: Coverage and Pending share, so a drop in labels is visible as a measurement gap rather than as zero agents.

Read the numbers as labels, not removals: the headline stays all units. `unknown`/`missing` means no label reached the export (before deployment, blocked tag, short visit), not human. `suspicious` and `bot_suspicious` are uncertain; show them apart from the clear classes. Agent-assisted sessions are usually real customers. GA4 drops traffic from known bots and spiders before export, so obvious crawlers are absent and the denominators describe only what reached GA4. Revenue is property-currency purchase revenue, not deduplicated or refund-adjusted.
