# Traffic classification dashboard

Use [bigquery.sql](bigquery.sql) as the transformation, retaining its coverage and exclusion rules. The dashboard annotates observed traffic; it does not change GA4 collection or filter conversions.

1. Set the export dataset, property timezone, date range, test windows and optional city. Run the script in BigQuery. Inspect each result before publishing anything; raw export queries incur BigQuery costs.
2. For a recurring dashboard, adapt the script into a scheduled BigQuery job that writes each result to a separate reporting table in your own reporting dataset. Replace each terminal SELECT with `CREATE OR REPLACE TABLE ... AS SELECT ...` for a modest rolling window. Rebuild recent dates for late arrivals, preserving padding. This adaptation is required: the supplied script creates temporary tables and returns multiple results; it is not a connector-ready single SELECT. Keep export tables read-only.
3. In Looker Studio, **Create → Data source → BigQuery**, choose the billing project and one reporting table, then **Connect / Add to report**. Repeat for the other result tables. Set `day` or `session_day` to Date and as the date-range dimension. See [Google's BigQuery connector recipe](https://cloud.google.com/looker/docs/studio/connect-to-google-bigquery).
4. Add a date-range control and class controls per applicable data source. Add source/medium, channel and device controls to the corresponding charts. A city parameter applied before aggregation requires rerunning the job; a dashboard city control only filters tables containing city. Label the exclusion windows, timezone, refresh time, class rule and date basis in a text box.

Build these pages:

| Page | SQL result | Charts / metrics |
|---|---|---|
| Observed labels | A | Daily stacked event counts by event_class; label_basis and unjoinable-event coverage |
| Sessions | B | Daily sessions by session_class/class_basis; engaged sessions, pageviews/session, engagement milliseconds/session; purchasing/lead/cart sessions |
| Acquisition | C | Class × source/medium/channel table; AI referral annotation as a separate control |
| Environment | D | Class × device/browser/OS and country/city tables |
| Review | E | Candidate counts, converting candidates and long-engagement candidates; display the configured threshold |
| Coverage | F1, F2 separately | Sessions with/without detector/final events; unjoinable event counts by analytics_storage |

Sum additive counts. Recompute ratios as `SUM(engaged_sessions) / SUM(sessions)`, `SUM(pageviews) / SUM(sessions)` and `SUM(engagement_time_msec) / SUM(sessions)`; guard zero denominators and divide milliseconds by 1,000 for seconds. Never average daily rates. Purchasing/lead/cart session counts overlap; do not sum them into a unique converting-session total.

A's distinct users/sessions are not additive across class, label basis or dates. Show them only at their original daily grain (with all grouping dimensions visible), or create a new BigQuery distinct aggregation at the desired grain. Do not use their sums for scorecards. Use B for additive session totals. Event dates in A/F2 and session-start dates in B–F1 differ around midnight and report boundaries.

Keep each result at its own grain. Do not blend aggregate tables on date/class: multiple source/device rows would multiply counts. Do not sum the same sessions from B, C and D. Review E is a subset, not extra traffic. It contains no session identifiers. Restrict sharing of granular geography and suppress small cells in shared dashboard views when appropriate.

Keep `unclassified`, `(unknown)` and missing-ID events visible. A session without a detector event still has other GA4 events; fully JS-less traffic is absent. Classifications are evidence labels, AI referral sources are attribution hints, and converting/engaged candidates are not confirmed false positives. Raw BigQuery totals can differ from GA4 UI modeling; do not force them to reconcile by dropping unknowns.
