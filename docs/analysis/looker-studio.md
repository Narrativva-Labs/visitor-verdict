# Sessions excluding detected automation dashboard

Use [bigquery.sql](bigquery.sql) as the transformation. Set the export dataset, **one web stream ID**, timezone, date range, scan padding, optional first-observed-city filter and test windows. Run the whole script. It creates temporary tables and returns A–I plus study summary and evaluation-window outputs; for scheduled reporting, adapt each terminal SELECT to write a separate reporting table in your own dataset. Keep the export read-only, rebuild recent dates for late arrivals, and preserve session-boundary padding.

In Looker Studio, **Create → Data source → BigQuery**, choose the reporting table, then **Connect / Add to report**. Repeat per result. Set `session_day` (or event `day` for A/F2) as Date and the date-range dimension. See [Google's BigQuery connector](https://cloud.google.com/looker/docs/studio/connect-to-google-bigquery).

Collection requires `traffic_class={{VV - current class}}` on other GA4 event tags (`gaawe`), evaluated at fire time. The variable reads the validated current `window.__visitorVerdict` snapshot then the startup previous-class string `window.__visitorVerdictLast`; it never reads storage. The dedicated **VV - GA4 traffic_class** event instead maps class/phase/score/version and its class user property from the corresponding `VV - DLV …` variables.

Container 1.0.1 sends `automated`/`declared_agent` on initial publication and all classes on final. Both hits can carry the same class. Use sessions with any matching hit; classification-event counts measure delivery volume, not visits or detection recall.

Optionally wire the existing Google tag to **VV - initial OR VV - timer fallback 1s**, with **Once per page**, replacing early All Pages/Initialization triggers. Set `traffic_class={{VV - current class}}` in its Shared event settings. The initial path can label the first `page_view`; fallback may be unlabelled. Automatic events retain the Google tag's startup settings, not later final updates. For CSP-sensitive sites, use the sandboxed variable template reading `__visitorVerdict.class` and `__visitorVerdictLast`; script deployment still needs to satisfy CSP. See [setup, timing and consent](../ga4-reporting.md).

The SQL aggregates events to **one row per `(user_pseudo_id, ga_session_id)` within the selected web stream before any metrics joins or cohort expansion**. Keep flags `any_automated`, `any_declared`, `any_suspicious`, `has_class`, and the timing fields `first_class`, `last_class`, `class_at_first_conversion` in that transformation. The latter uses the first purchase's own parameter or the latest preceding class, never a later observation or user property. Automatic-event labels may be captured initial or startup-fallback values from shared settings, so timing fields describe observed exported labels, not guaranteed current-page evidence. Exact export-order ties remain ambiguous. Do not attach raw events to session metrics and sum them again.

| Page | Result | Display |
|---|---|---|
| Headline | B | **Sessions excluding detected automation**, purchasing sessions, purchase CR, purchase revenue; All sessions baseline beside it |
| Sensitivity | B | Stricter view excluding suspicious, suspicious within retained sessions, observed human-only diagnostic |
| Excluded revenue | B | Excluded detected automation sessions, purchasing sessions, purchase revenue explicitly separate |
| Acquisition | C | Cohort × source/medium/channel, assistant referral annotation separate from evidence |
| Environment | D | Cohort × first observed device/browser/OS/country/city |
| Evidence/timing review | E | Any-evidence flags, first/last class and class at first purchase; purchasing/long-engagement counts |
| Coverage | F1, F2 separately | Sessions with any valid class vs without; detector/final delivery; missing-ID event/purchase/revenue totals |
| Event labels | A | Class parameter distribution, including unclassified events; not session counts |

Set every headline chart to the **Sessions excluding detected automation** cohort, which excludes whole sessions with any automated/declared observation and retains unknown sessions. Keep suspicious visible separately within retained traffic. Sensitivity additionally excludes suspicious. Observed human-only requires class coverage and no other class and is diagnostic only. Cohorts overlap intentionally: never sum across cohorts. A later human result does not undo earlier evidence.

Use `SUM(purchasing_sessions) / SUM(sessions)` for headline purchase CR, guarding a zero denominator. Both numerator and denominator must use the **same cohort/date/stream**. Never average daily rates, divide filtered purchasers by all sessions, or use `add_to_cart` as headline conversion. Show lead/cart sessions separately. Sum purchase revenue only within the selected cohort; SQL uses exported USD purchase revenue, without transaction deduplication or refund adjustment. Removing low-converting sessions raises CR by arithmetic, not demonstrated marketing improvement.

Always show **sessions_with_class**, **sessions_without_class**, and `SUM(sessions_with_class) / SUM(sessions)` coverage alongside baseline and retained totals. Exclusion is preferable to “only human” because missing labels are unknown, not evidence for dropping a visit. A/F2 use event dates; B–F1 use session-start dates, so boundary totals differ.

Connect each result at its own grain. Do not blend B/C/D on date/cohort: multiple source/device rows multiply metrics. Either use a single result per chart or join independently aggregated session metrics one-to-one on the complete session key upstream, then aggregate. Changing pre-aggregation filters requires rerunning SQL. Record date basis, timezone, stream, refresh time, exclusions, padding and cohort rules on the report.

Keep missing-ID/cookieless pings in F2 as event-level totals, never fabricated sessions. Never join via IP/UA, coalesce missing IDs to one visitor, or retroactively link pre-consent pings. JS-less traffic is generally absent even here. Raw observed BigQuery totals can differ from GA4 modeled UI reporting.

Display labels: `human` = **no automation detected**, `suspicious` = uncertain evidence, `automated` = automation evidence rather than intent, `declared_agent` = unverified claim. Score is not a probability. User property `traffic_class` is last observed class, applies from set time and is never session-exclusion evidence. Never mark `traffic_class` as a key event.
