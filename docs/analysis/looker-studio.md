# Labelled traffic dashboard

The dashboard labels traffic; it removes nothing. The headline is **All sessions**. Cohorts that set labelled sessions aside keep their SQL names (“Sessions excluding detected automation”) and are optional comparison views. Agent-assisted sessions are usually real customers; show their purchases and revenue as a breakdown, not as a deduction.

## Server collector: `vv_type` and `vv_detail`

For the Vanilla collector integration, use [session-classification.sql](session-classification.sql). Replace the dataset and dates, run Query 0 to validate ping-page IDs, currencies and coverage, then run the whole script. Adapt the terminal SELECTs into separate reporting tables for scheduled reporting; keep session units and denied ping-page units separate. The SQL was validated once against the demo property's live export on 2026-11-21.

In Looker Studio, **Create → Data source → BigQuery**, choose the reporting table, then **Connect / Add to report**. Repeat per result. See [Google's BigQuery connector](https://cloud.google.com/looker/docs/studio/connect-to-google-bigquery).

Register `vv_type` and `vv_detail` as **event-scoped** GA4 custom dimensions. Data API names are `customEvent:vv_type` and `customEvent:vv_detail`. The collector sends these two labels instead of the old six parameters. The tracker sends browser evidence to the server as before; the collector computes the two GA4 labels without waiting.

For a GA4 connector operator dimension, use:

```text
REGEXP_EXTRACT(vv_detail, '^([^|]+)')
```

`vv_detail` is `operator|verification|purpose|claim|browser_class|browser_phase`, with unknown operator `none` and absent positions `-`. It contains current-hit evidence plus the sticky known operator. A sticky type may describe stronger earlier evidence, so do not assume every detail verifies its sticky type. Use **vv_detail begins with `openai|`** for an operator event filter. Since server 0.3.5 the operator can also come from a browser page marker (claim `dom_marker`, type `agent_unverified`); add **vv_type = `agent_verified`** when only verified operators count.

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

Collection requires `traffic_class={{VV - current class}}` on other GA4 event tags (`gaawe`), evaluated at fire time. The variable reads the validated current `window.__visitorVerdict` snapshot then the startup previous-class string `window.__visitorVerdictLast`; it never reads storage. The dedicated **VV - GA4 traffic_class** event instead maps class/phase/score/version/agent (five DLVs) and its class user property from the corresponding `VV - DLV …` variables.

Container 1.1.0 sends `automated`/`declared_agent` on initial publication, the `declared_agent` escalation on the agent phase and all classes on final. Several hits can carry the same class. Use sessions with any matching hit; classification-event counts measure delivery volume, not visits or detection recall.

Optionally wire the existing Google tag to **VV - initial OR VV - timer fallback 1s**, with **Once per page**, replacing early All Pages/Initialization triggers. Set `traffic_class={{VV - current class}}` in its Shared event settings. The initial path can label the first `page_view`; fallback may be unlabelled. Automatic events retain the Google tag's startup settings, not later final updates. For CSP-sensitive sites, use the sandboxed variable template reading `__visitorVerdict.class` and `__visitorVerdictLast`; script deployment still needs to satisfy CSP. See [setup, timing and consent](../ga4-reporting.md).

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

Display labels: `human` = **no automation detected**, `suspicious` = uncertain evidence, `automated` = automation evidence rather than intent, `declared_agent` = unverified claim. Score is not a probability. User property `traffic_class` is last observed class, applies from set time and is never session-exclusion evidence. Never mark `traffic_class` as a key event.
