# Visitor type and conversion dashboard

For the Vanilla collector integration, use [session-classification.sql](session-classification.sql). Replace the dataset and dates, run Query 0 to validate ping-page IDs, currencies and coverage, then run the whole script. Adapt the terminal SELECTs into separate reporting tables for scheduled reporting; keep session units and denied ping-page units separate. The SQL has not yet been validated against a live export.

In Looker Studio, **Create → Data source → BigQuery**, choose the reporting table, then **Connect / Add to report**. Repeat per result. See [Google's BigQuery connector](https://cloud.google.com/looker/docs/studio/connect-to-google-bigquery).

Register `vv_type` and `vv_detail` as **event-scoped** GA4 custom dimensions. Data API names are `customEvent:vv_type` and `customEvent:vv_detail`. The collector sends these two labels instead of the old six parameters. The tracker sends browser evidence to the server as before; the collector computes the two GA4 labels without waiting.

For a GA4 connector operator dimension, use:

```text
REGEXP_EXTRACT(vv_detail, '^([^|]+)')
```

`vv_detail` is `operator|verification|purpose|claim|browser_class|browser_phase`, with unknown operator `none` and absent positions `-`. It contains current-hit evidence plus the sticky known operator. A sticky type may describe stronger earlier evidence, so do not assume every detail verifies its sticky type. Use **vv_detail begins with `openai|`** for an operator event filter.

The complete `vv_type` dictionary is `pending`, `human`, `bot_suspicious`, `agent_unverified`, `bot_automation`, `crawler_verified`, `agent_verified`, `bot_spoofed`. Session ranks are respectively 0, 1, 2, 3, 4, 5, 5, 6; the first role wins a rank-5 tie. Verified unknown purpose maps to `pending` and preserves positive verification in detail. `human` means no automation detected; a signature verifies an operator, not customer intent or purchase approval. See [GA4 setup and cohorts](ga4-explorations.md) for the value dictionary and limits.

For quick event filters, **vv_type begins with `agent_`** selects verified/unverified agent labels, **begins with `bot_`** selects bot labels, and `crawler_verified` is separate. Build headline session exclusions upstream from the strongest observed type, rather than filtering only events or using a user property.

| Page | Source | Display |
|---|---|---|
| Headline | Query 1, session rows | Sessions, purchasing sessions, purchase CR and revenue by strongest type; all-sessions baseline |
| Coverage | Query 1, session rows | Type/detail/browser coverage, missing and pending counts, invalid labels |
| Verified operators | Query 2, session rows | Verified operator × purpose × strongest type; unknown purpose separate |
| Denied pings | Query 1/2, ping-page rows | Page units and their purchases/revenue, separate from session totals |

Use `SUM(purchasing_units) / SUM(units)` for purchase CR with a zero-denominator guard. Both numerator and denominator must use the **same cohort/date/stream/unit type**. Never average daily rates or mix session revenue with ping-page revenue. Show purchases and unique transactions side by side; USD revenue does not deduplicate transactions or adjust refunds. Removing low-converting sessions raises CR by arithmetic, not demonstrated marketing improvement.

Connect each result at its own grain. Do not join session totals to raw events or sum overlapping cohorts. Record date basis, timezone, stream, refresh time, exclusions and cohort rules on the report. Missing labels are unknown, not a reason to label a visit human. Later human evidence does not erase a stronger earlier type.

Keep missing-ID/cookieless pings in F2 as event-level totals, never fabricated sessions. Never join via IP/UA, coalesce missing IDs to one visitor, or retroactively link pre-consent pings. JS-less traffic is generally absent even here. Raw observed BigQuery totals can differ from GA4 modeled UI reporting.

For the unchanged Phase 1 browser/GTM field study, [bigquery.sql](bigquery.sql) still reads `traffic_class`/`traffic_phase` and returns A–I and evaluation windows. Its browser-class cohorts are distinct from the collector's combined `vv_type` cohorts. Use that query's separate result grains and session padding as documented in its comments. Migration of the browser tag to `vv_type` is a later major version after that field test.
