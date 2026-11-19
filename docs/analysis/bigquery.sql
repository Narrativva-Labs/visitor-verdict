-- GoogleSQL script. Edit parameters, then run the WHOLE script in BigQuery.
-- Read-only against the export; creates temporary tables and returns A--I plus evaluation windows.
-- Dataset identifiers cannot be bound parameters, hence validated dynamic SQL.
DECLARE export_dataset STRING DEFAULT 'your-project.analytics_123456789';
DECLARE web_stream_id STRING DEFAULT '1234567890'; -- REQUIRED: one GA4 web stream ID
DECLARE site_name STRING DEFAULT 'SET_SITE'; -- one site per invocation; do not pool streams
DECLARE deploy_date DATE DEFAULT DATE '2026-11-19'; -- actual site deployment date
DECLARE start_date DATE DEFAULT DATE '2026-11-19';
DECLARE end_date DATE DEFAULT DATE '2026-12-02'; -- inclusive (14 days); use completed tables only
DECLARE property_timezone STRING DEFAULT 'Europe/Prague';
DECLARE city_filter STRING DEFAULT NULL;
DECLARE long_engagement_ms INT64 DEFAULT 120000;
DECLARE padding_days INT64 DEFAULT 1;
DECLARE labelled_windows ARRAY<STRUCT<start_ts TIMESTAMP, end_ts TIMESTAMP, label STRING>> DEFAULT [];
-- Load windows.csv filtered to this site, e.g.
-- [STRUCT(TIMESTAMP '2026-11-20 09:00:00+00' AS start_ts,
--         TIMESTAMP '2026-11-20 09:02:00+00' AS end_ts,
--         'canary:playwright-default' AS label)]
-- Labels: panel:<cohort>, canary:<configuration>. No participant identifiers.
-- Windows are UTC, half-open [start,end). Exclude the WHOLE identifiable session
-- if ANY observed event overlaps a window. Unjoinable pings: exclude per event.
-- A city filter selects sessions by first observed city, pings by their own city.
-- This avoids truncating engagement/conversions within an identifiable session.

ASSERT REGEXP_CONTAINS(export_dataset, r'^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+$')
  AS 'Use project.dataset without backticks';
ASSERT start_date <= end_date AND padding_days >= 0 AS 'Invalid date range/padding';
ASSERT start_date >= deploy_date AS 'start_date predates detector deployment';
ASSERT web_stream_id IS NOT NULL AND web_stream_id != '' AS 'Set one web stream ID';
ASSERT NOT EXISTS (SELECT 1 FROM UNNEST(labelled_windows) WHERE start_ts IS NULL
  OR end_ts IS NULL OR start_ts >= end_ts OR label IS NULL OR label = '') AS 'Invalid test window';

-- Semantics:
-- * Session = the existing (user_pseudo_id, ga_session_id) pair; never coalesce
--   missing IDs to a shared value, invent an ID or join pre-consent pings later.
-- * Flags use valid event parameters on ANY event, including the final detector
--   event. User properties are last observed class, never exclusion evidence.
-- * first_class/last_class follow export order, not class precedence. Exclusion
--   uses ANY evidence across the session, so later human cannot erase automation.
-- * class_at_first_conversion means first purchase (not add_to_cart): its own
--   event parameter, otherwise latest preceding parameter in the same session.
--   No future label is backfilled. Exact export-order ties are ambiguous.
-- * GA4 event tags must map traffic_class to VV - current class at fire time.
--   Automatic events use shared settings captured at Google tag Initialization:
--   with storage fallback, labels may be the previous page's class from page 2.
--   First-session page_view is typically unlabelled; timing fields describe
--   exported labels, not guaranteed current-page evidence. Sites without GA4
--   event tags rely on the final detector event plus last-observed user property;
--   the property is never used here as a session-exclusion fallback.
-- * A counts event parameters only; missing remains unknown.
-- * B--F1 use the local date of ga_session_id (epoch seconds). Cohorts overlap;
--   each session contributes once within each applicable cohort.
-- * Missing IDs still contribute events in A/F2, never fabricated users/sessions.
--   Null IDs may occur in cookieless pings, but are not proof of consent denial.
-- * Daily tables only: no intraday double counting. Re-run recent dates after
--   late arrivals (GA4 updates daily tables for up to three days).
-- * Padding recovers boundary events, not unbounded sessions. Last class and
--   engagement are limited to available tables; open sessions remain provisional.
-- * Requires modern GA4 session_traffic_source_last_click fields. For old schemas
--   replace unavailable source/medium/channel expressions below with CAST(NULL AS
--   STRING); channel then stays unknown. Do not substitute first-user traffic_source.
-- * Only existing GA4 fields are read; no detector signals, fingerprint or new IDs.
-- Schema: https://support.google.com/analytics/answer/7029846?hl=en
-- Attribution: https://developers.google.com/analytics/bigquery/traffic-attribution-data

CREATE TEMP FUNCTION valid_class(v STRING) AS
  (IF(v IN ('human', 'suspicious', 'automated', 'declared_agent'), v, NULL));

-- Two-sided 95% Wilson score interval. Undefined for n=0; never use
-- weighted pseudo-counts here. Reference: NIST prc241 (linked in protocol).
CREATE TEMP FUNCTION wilson(k FLOAT64, n FLOAT64) AS (
  STRUCT(
    IF(n > 0, GREATEST(0.0, (k/n + 3.841458820694124/(2*n)
      - 1.959963984540054*SQRT((k/n)*(1-k/n)/n + 3.841458820694124/(4*n*n)))
      / (1+3.841458820694124/n)), NULL) AS lo,
    IF(n > 0, LEAST(1.0, (k/n + 3.841458820694124/(2*n)
      + 1.959963984540054*SQRT((k/n)*(1-k/n)/n + 3.841458820694124/(4*n*n)))
      / (1+3.841458820694124/n)), NULL) AS hi));

EXECUTE IMMEDIATE FORMAT('''
CREATE TEMP TABLE raw AS
SELECT
  stream_id, @site AS site,
  (SELECT value.string_value FROM UNNEST(event_params)
   WHERE key = 'traffic_version' LIMIT 1) AS traffic_version,
  -- Query and fragment discarded; paths stay restricted (may contain PII).
  COALESCE(REGEXP_EXTRACT((SELECT value.string_value FROM UNNEST(event_params)
    WHERE key = 'page_location' LIMIT 1), r'^https?://[^/?#]+([^?#]*)'), '') AS page_path,
  PARSE_DATE('%%Y%%m%%d', event_date) AS day,
  event_timestamp, event_name, user_pseudo_id,
  batch_page_id, batch_ordering_id, batch_event_index,
  COALESCE(ecommerce.purchase_revenue_in_usd, 0) AS purchase_revenue_usd,
  (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
   FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) AS ga_session_id,
  (SELECT value.string_value FROM UNNEST(event_params)
   WHERE key = 'traffic_class' LIMIT 1) AS param_class_raw,
  (SELECT value.string_value FROM UNNEST(event_params)
   WHERE key = 'traffic_phase' LIMIT 1) AS phase,
  (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
   FROM UNNEST(event_params) WHERE key = 'traffic_score' LIMIT 1) AS traffic_score,
  COALESCE((SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
   FROM UNNEST(event_params) WHERE key = 'engagement_time_msec' LIMIT 1), 0)
    AS engagement_ms,
  COALESCE((SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
   FROM UNNEST(event_params) WHERE key = 'session_engaged' LIMIT 1), 0) = 1
    AS is_engaged,
  session_traffic_source_last_click.cross_channel_campaign.source AS attributed_source,
  session_traffic_source_last_click.cross_channel_campaign.medium AS attributed_medium,
  session_traffic_source_last_click.cross_channel_campaign.default_channel_group
    AS default_channel,
  session_traffic_source_last_click.manual_campaign.source AS manual_source,
  session_traffic_source_last_click.manual_campaign.medium AS manual_medium,
  collected_traffic_source.manual_source AS collected_source,
  collected_traffic_source.manual_medium AS collected_medium,
  -- Keep only hostname, not the referrer URL, for an optional referral annotation.
  NET.HOST((SELECT value.string_value FROM UNNEST(event_params)
    WHERE key = 'page_referrer' LIMIT 1)) AS referrer_host,
  device.category AS device_category, device.web_info.browser AS browser,
  device.operating_system AS operating_system, geo.country AS country,
  geo.city AS city, privacy_info.analytics_storage AS analytics_storage
FROM `%s.events_*`
WHERE _TABLE_SUFFIX BETWEEN @scan_start AND @scan_end
  AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^[0-9]{8}$')
  AND platform = 'WEB' AND stream_id = @web_stream_id
''', export_dataset)
USING FORMAT_DATE('%Y%m%d', DATE_SUB(start_date, INTERVAL padding_days DAY)) AS scan_start,
      FORMAT_DATE('%Y%m%d', DATE_ADD(end_date, INTERVAL padding_days DAY)) AS scan_end,
      web_stream_id AS web_stream_id, site_name AS site;

CREATE TEMP TABLE normalized AS
SELECT *, valid_class(param_class_raw) AS param_class,
  EXISTS (SELECT 1 FROM UNNEST(labelled_windows) w
    WHERE TIMESTAMP_MICROS(event_timestamp) >= w.start_ts
      AND TIMESTAMP_MICROS(event_timestamp) < w.end_ts) AS in_test_window,
  ARRAY(SELECT DISTINCT w.label FROM UNNEST(labelled_windows) w
    WHERE TIMESTAMP_MICROS(event_timestamp) >= w.start_ts
      AND TIMESTAMP_MICROS(event_timestamp) < w.end_ts) AS evaluation_labels
FROM raw;

CREATE TEMP TABLE session_scope AS
SELECT user_pseudo_id, ga_session_id,
  LOGICAL_OR(in_test_window) AS exclude_test,
  ARRAY_AGG(STRUCT(city) ORDER BY event_timestamp, batch_page_id,
    batch_ordering_id, batch_event_index LIMIT 1)[OFFSET(0)].city AS first_city
FROM normalized
WHERE user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
GROUP BY user_pseudo_id, ga_session_id;

CREATE TEMP TABLE events AS
SELECT n.* FROM normalized n
LEFT JOIN session_scope s USING (user_pseudo_id, ga_session_id)
WHERE CASE WHEN n.user_pseudo_id IS NOT NULL AND n.ga_session_id IS NOT NULL
  THEN NOT s.exclude_test AND (city_filter IS NULL OR s.first_city = city_filter)
  ELSE NOT n.in_test_window AND (city_filter IS NULL OR n.city = city_filter) END;

-- Forward fill only within an identifiable session. The purchase's own valid
-- parameter takes precedence because CURRENT ROW is included. No user property.
CREATE TEMP TABLE ordered_events AS
SELECT *, LAST_VALUE(param_class IGNORE NULLS) OVER (
  PARTITION BY user_pseudo_id, ga_session_id
  ORDER BY event_timestamp, batch_page_id, batch_ordering_id, batch_event_index
  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS class_as_of_event
FROM events
WHERE user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL;

CREATE TEMP TABLE session_rollup AS
SELECT user_pseudo_id, ga_session_id,
  ANY_VALUE(site) AS site, ANY_VALUE(stream_id) AS stream_id,
  CASE WHEN COUNT(DISTINCT traffic_version) > 1 THEN 'mixed'
       ELSE COALESCE(MAX(traffic_version), 'unknown') END AS traffic_version,
  COUNTIF(traffic_version IS NULL) > 0 AS has_unversioned_events,
  COUNT(DISTINCT param_class) > 1 AS class_transition,
  CASE MAX(CASE param_class WHEN 'declared_agent' THEN 4 WHEN 'automated' THEN 3
    WHEN 'suspicious' THEN 2 WHEN 'human' THEN 1 ELSE 0 END)
    WHEN 4 THEN 'declared_agent' WHEN 3 THEN 'automated'
    WHEN 2 THEN 'suspicious' WHEN 1 THEN 'human' ELSE 'unknown' END AS worst_class,
  DATE(TIMESTAMP_SECONDS(ga_session_id), property_timezone) AS session_day,
  COUNTIF(param_class = 'automated') > 0 AS any_automated,
  COUNTIF(param_class = 'declared_agent') > 0 AS any_declared,
  COUNTIF(param_class = 'suspicious') > 0 AS any_suspicious,
  COUNTIF(param_class IS NOT NULL) > 0 AS has_class,
  ARRAY_AGG(param_class IGNORE NULLS ORDER BY event_timestamp, batch_page_id,
    batch_ordering_id, batch_event_index LIMIT 1)[SAFE_OFFSET(0)] AS first_class,
  ARRAY_AGG(param_class IGNORE NULLS ORDER BY event_timestamp DESC, batch_page_id DESC,
    batch_ordering_id DESC, batch_event_index DESC LIMIT 1)[SAFE_OFFSET(0)] AS last_class,
  ARRAY_AGG(IF(event_name = 'purchase', STRUCT(class_as_of_event AS class), NULL)
    IGNORE NULLS ORDER BY event_timestamp, batch_page_id, batch_ordering_id,
    batch_event_index LIMIT 1)[SAFE_OFFSET(0)].class AS class_at_first_conversion,
  SUM(IF(event_name = 'purchase', purchase_revenue_usd, 0)) AS purchase_revenue_usd,
  COUNTIF(event_name = 'traffic_class') > 0 AS has_detector_event,
  COUNTIF(event_name = 'traffic_class' AND phase = 'final') > 0 AS has_final_event,
  LOGICAL_OR(is_engaged) AS engaged,
  SUM(engagement_ms) AS engagement_ms,
  COUNT(*) AS events, COUNTIF(event_name = 'page_view') AS pageviews,
  COUNTIF(event_name = 'purchase') AS purchases,
  COUNTIF(event_name = 'generate_lead') AS leads,
  COUNTIF(event_name = 'add_to_cart') AS carts,
  -- Keep session attribution and simple observed fallback separate.
  ARRAY_AGG(IF(attributed_source IS NOT NULL OR manual_source IS NOT NULL,
    STRUCT(COALESCE(attributed_source, manual_source) AS source,
      COALESCE(attributed_medium, manual_medium) AS medium), NULL)
    IGNORE NULLS ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS attributed,
  ARRAY_AGG(IF(collected_source IS NOT NULL,
    STRUCT(collected_source AS source, collected_medium AS medium), NULL)
    IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS collected,
  ARRAY_AGG(default_channel IGNORE NULLS ORDER BY event_timestamp DESC
    LIMIT 1)[SAFE_OFFSET(0)] AS default_channel,
  ARRAY_AGG(STRUCT(device_category, browser, operating_system, country, city,
    referrer_host) ORDER BY event_timestamp, batch_page_id, batch_ordering_id,
    batch_event_index LIMIT 1)[OFFSET(0)] AS first_observed
FROM ordered_events
GROUP BY user_pseudo_id, ga_session_id;

CREATE TEMP TABLE sessions AS
SELECT *,
  COALESCE(attributed.source, collected.source, '(unknown)') AS source,
  COALESCE(IF(attributed.source IS NOT NULL, attributed.medium, collected.medium),
    '(unknown)') AS medium,
  COALESCE(default_channel, '(unknown)') AS session_default_channel,
  CASE WHEN attributed.source IS NOT NULL THEN 'exported_session_attribution'
       WHEN collected.source IS NOT NULL THEN 'first_collected_source_fallback'
       ELSE 'unknown' END AS source_basis,
  -- Editable annotation of referring domains, not an AI/agent identity test.
  -- Referrer alone never supplies source/medium or Google's channel group.
  REGEXP_CONTAINS(LOWER(COALESCE(attributed.source, collected.source, '')),
    r'(^|[./])(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|copilot\.microsoft\.com|gemini\.google\.com|you\.com|chat\.mistral\.ai)([/:]|$)')
  OR REGEXP_CONTAINS(LOWER(COALESCE(first_observed.referrer_host, '')),
    r'(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|copilot\.microsoft\.com|gemini\.google\.com|you\.com|chat\.mistral\.ai)$')
    AS ai_referral_annotation
FROM session_rollup
WHERE session_day BETWEEN start_date AND end_date;

-- One row per session already contains metrics BEFORE any cohort expansion or
-- reporting joins. Never join raw event rows to sessions and re-sum these metrics.
-- Cohorts overlap intentionally: do not sum them into an all-traffic total.
CREATE TEMP TABLE cohort_sessions AS
SELECT s.*, cohort
FROM sessions s CROSS JOIN UNNEST([
  'All sessions',
  IF(NOT any_automated AND NOT any_declared,
     'Sessions excluding detected automation', NULL),
  IF(NOT any_automated AND NOT any_declared AND NOT any_suspicious,
     'Stricter sensitivity view', NULL),
  IF(has_class AND NOT any_automated AND NOT any_declared AND NOT any_suspicious,
     'Observed human-only cohort (diagnostic)', NULL),
  IF(NOT any_automated AND NOT any_declared AND any_suspicious,
     'Suspicious within retained sessions', NULL),
  IF(any_automated OR any_declared, 'Excluded detected automation', NULL)
]) AS cohort WHERE cohort IS NOT NULL;

-- A. Event-label coverage; user property is deliberately not a fallback.
SELECT site, stream_id, traffic_version, day, COALESCE(param_class, 'unclassified') AS event_class,
  COUNT(*) AS events,
  COUNTIF(user_pseudo_id IS NULL OR ga_session_id IS NULL) AS unjoinable_events
FROM events WHERE day BETWEEN start_date AND end_date
GROUP BY site, stream_id, traffic_version, day, event_class ORDER BY day, event_class;

-- B. Headline sessions excluding detected automation, alongside baseline,
-- sensitivity and diagnostics. Purchase conversion uses the SAME cohort.
-- Revenue is exported USD purchase revenue, not transaction-deduplicated or
-- refund-adjusted. Excluded revenue is its own cohort, not silently discarded.
SELECT site, stream_id, traffic_version, session_day, cohort, COUNT(*) AS sessions,
  COUNTIF(purchases > 0) AS purchasing_sessions,
  SAFE_DIVIDE(COUNTIF(purchases > 0), COUNT(*)) AS purchase_conversion_rate,
  SUM(purchase_revenue_usd) AS purchase_revenue_usd,
  COUNTIF(has_class) AS sessions_with_class,
  COUNTIF(NOT has_class) AS sessions_without_class,
  SAFE_DIVIDE(COUNTIF(has_class), COUNT(*)) AS class_coverage,
  COUNTIF(any_suspicious) AS suspicious_sessions,
  COUNTIF(engaged) AS engaged_sessions,
  SUM(engagement_ms) AS engagement_time_msec, SUM(pageviews) AS pageviews,
  COUNTIF(leads > 0) AS lead_sessions, COUNTIF(carts > 0) AS cart_sessions
FROM cohort_sessions GROUP BY site, stream_id, traffic_version, session_day, cohort ORDER BY session_day, cohort;

-- C. Acquisition at session grain; referrals annotate attribution, not identity.
SELECT site, stream_id, traffic_version, session_day, cohort, source, medium, session_default_channel,
  source_basis, ai_referral_annotation, COUNT(*) AS sessions,
  COUNTIF(purchases > 0) AS purchasing_sessions,
  SAFE_DIVIDE(COUNTIF(purchases > 0), COUNT(*)) AS purchase_conversion_rate,
  SUM(purchase_revenue_usd) AS purchase_revenue_usd
FROM cohort_sessions GROUP BY site, stream_id, traffic_version, session_day, cohort, source, medium,
  session_default_channel, source_basis, ai_referral_annotation;

-- D. First observed environment; geography is not automation evidence.
SELECT site, stream_id, traffic_version, session_day, cohort, first_observed.device_category AS device_category,
  first_observed.browser AS browser, first_observed.operating_system AS operating_system,
  first_observed.country AS country, first_observed.city AS city,
  COUNT(*) AS sessions, COUNTIF(purchases > 0) AS purchasing_sessions,
  SUM(purchase_revenue_usd) AS purchase_revenue_usd
FROM cohort_sessions GROUP BY site, stream_id, traffic_version, session_day, cohort, device_category, browser,
  operating_system, country, city;

-- E. Evidence and conversion timing diagnostics, not proof of false positives.
-- Exports no session identifiers. NULL first-purchase class stays unknown;
-- sessions without a purchase can also have NULL, so keep purchasing_sessions.
SELECT site, stream_id, traffic_version, session_day, any_automated, any_declared, any_suspicious, has_class,
  first_class, last_class, class_at_first_conversion, COUNT(*) AS sessions,
  COUNTIF(purchases > 0) AS purchasing_sessions,
  COUNTIF(engagement_ms >= long_engagement_ms) AS long_engagement_sessions,
  SUM(purchase_revenue_usd) AS purchase_revenue_usd
FROM sessions GROUP BY site, stream_id, traffic_version, session_day, any_automated, any_declared, any_suspicious,
  has_class, first_class, last_class, class_at_first_conversion;

-- F1. Coverage = ANY valid class parameter, not merely detector-event presence.
SELECT site, stream_id, traffic_version, session_day, has_class, has_detector_event, has_final_event,
  COUNT(*) AS sessions, COUNTIF(purchases > 0) AS purchasing_sessions
FROM sessions GROUP BY site, stream_id, traffic_version, session_day, has_class, has_detector_event, has_final_event;

-- F2. Missing-ID / cookieless pings separately, at event grain only. Missing IDs
-- do not prove consent denial. NEVER join via IP/UA, invent IDs, or merge into
-- session denominators. Revenue here is separate from joinable-session revenue.
SELECT site, stream_id, traffic_version, day, analytics_storage, user_pseudo_id IS NULL AS missing_user_id,
  ga_session_id IS NULL AS missing_session_id, COUNT(*) AS events,
  COUNTIF(event_name = 'traffic_class') AS detector_events,
  COUNTIF(param_class IS NOT NULL) AS events_with_class_parameter,
  COUNTIF(event_name = 'purchase') AS purchase_events,
  SUM(IF(event_name = 'purchase', purchase_revenue_usd, 0)) AS purchase_revenue_usd
FROM events
WHERE day BETWEEN start_date AND end_date
  AND (user_pseudo_id IS NULL OR ga_session_id IS NULL)
GROUP BY site, stream_id, traffic_version, day, analytics_storage, missing_user_id, missing_session_id;

-- JS-less fetches usually send no GA4 event at all. Blocked tags, deployment gaps
-- and pagehide loss also limit coverage. Scan padding is finite; first/last and
-- flags are provisional for open/boundary sessions. Increase padding if needed.
-- Rebuild recent dates for late arrivals; daily export is observed, not modeled.
-- A rise in CR after exclusions is arithmetic, not evidence of marketing lift.

-- Study headline: one invocation per site/stream and date interval. Worst class
-- is precedence, not last label. Unknown sessions remain in every denominator.
-- Missing-version events are reported, never silently filtered from coverage.
SELECT site, stream_id, traffic_version, worst_class, class_transition,
  COUNT(*) AS sessions
FROM sessions
GROUP BY site, stream_id, traffic_version, worst_class, class_transition;

WITH counts AS (
  SELECT s.site, s.stream_id,
    IF(GROUPING(s.traffic_version) = 1, '(all versions)', s.traffic_version) AS traffic_version,
    COUNT(*) AS n,
    COUNTIF(any_automated OR any_declared) AS clear_k,
    COUNTIF(has_class) AS coverage_k,
    COUNTIF(has_unversioned_events) AS sessions_with_unversioned_events,
    COUNTIF(engaged) AS engaged_n,
    COUNTIF(engaged AND (any_automated OR any_declared)) AS engaged_clear_k,
    COUNTIF(purchases > 0) AS converting_n,
    COUNTIF(purchases > 0 AND (any_automated OR any_declared)) AS converting_clear_k,
    COUNTIF(any_suspicious AND NOT any_automated AND NOT any_declared) AS suspicious_only_k
  FROM sessions s GROUP BY GROUPING SETS ((s.site, s.stream_id),
    (s.site, s.stream_id, s.traffic_version))
)
SELECT *, n - coverage_k AS without_class,
  SAFE_DIVIDE(clear_k, n) AS clear_share, wilson(clear_k, n) AS clear_ci95,
  SAFE_DIVIDE(coverage_k, n) AS coverage, wilson(coverage_k, n) AS coverage_ci95,
  SAFE_DIVIDE(engaged_clear_k, engaged_n) AS engaged_clear_rate,
  wilson(engaged_clear_k, engaged_n) AS engaged_clear_ci95,
  SAFE_DIVIDE(converting_clear_k, converting_n) AS converting_clear_rate,
  wilson(converting_clear_k, converting_n) AS converting_clear_ci95
FROM counts;

-- G. Page-level coverage diagnostic. Existing GA4 batch_page_id is used ONLY
-- inside an existing identifiable session; never synthesize a document ID from
-- a URL or join cookieless pings. Repeated paths are not merged into pages.
-- This is observable GA4 page coverage, not all actual website page loads.
CREATE TEMP TABLE observed_pages AS
SELECT site, stream_id, user_pseudo_id, ga_session_id, batch_page_id,
  CASE WHEN COUNT(DISTINCT traffic_version) > 1 THEN 'mixed'
    ELSE COALESCE(MAX(traffic_version), 'unknown') END AS traffic_version,
  ARRAY_AGG(page_path ORDER BY event_timestamp LIMIT 1)[OFFSET(0)] AS page_path,
  COUNTIF(event_name = 'page_view') AS pageviews,
  COUNTIF(param_class IS NOT NULL) > 0 AS any_class,
  COUNTIF(event_name = 'traffic_class' AND phase = 'final'
    AND param_class IS NOT NULL) > 0 AS final_class
FROM events WHERE day BETWEEN start_date AND end_date
  AND user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
  AND batch_page_id IS NOT NULL
GROUP BY site, stream_id, user_pseudo_id, ga_session_id, batch_page_id;

SELECT site, stream_id, traffic_version, COUNT(*) AS observed_pages,
  COUNTIF(pageviews > 0) AS pages_with_page_view,
  COUNTIF(any_class) AS pages_with_any_class,
  COUNTIF(final_class) AS pages_with_final_class,
  wilson(COUNTIF(any_class), COUNT(*)) AS any_class_ci95
FROM observed_pages GROUP BY site, stream_id, traffic_version;

SELECT site, stream_id, day, COUNTIF(event_name = 'page_view') AS pageviews,
  COUNTIF(event_name = 'page_view' AND (user_pseudo_id IS NULL
    OR ga_session_id IS NULL OR batch_page_id IS NULL)) AS unassignable_pageviews
FROM events WHERE day BETWEEN start_date AND end_date
GROUP BY site, stream_id, day;

-- H. Event-grain score histogram (initial and final kept separate). Sentinel
-- 100 is hard/declared/inherited evidence, NOT a calibrated probability.
-- Session engagement/purchase are associations, never ground truth.
SELECT e.site, e.stream_id, COALESCE(e.traffic_version, 'unknown') AS traffic_version,
  e.phase, COALESCE(e.param_class, 'unknown') AS traffic_class, e.traffic_score,
  s.engaged, s.purchases > 0 AS purchasing, COUNT(*) AS detector_events
FROM events e LEFT JOIN sessions s USING (user_pseudo_id, ga_session_id)
WHERE e.day BETWEEN start_date AND end_date AND e.event_name = 'traffic_class'
GROUP BY e.site, e.stream_id, COALESCE(e.traffic_version, 'unknown'), e.phase,
  COALESCE(e.param_class, 'unknown'),
  e.traffic_score, s.engaged, purchasing;
-- No threshold counterfactual: class depends on families and direct rules too.
-- Aggregate scores cannot reconstruct the result at another threshold.

-- I. Engagement strata: review flags, never declare engaged traffic human.
SELECT site, stream_id, traffic_version, engaged, purchases > 0 AS purchasing,
  COUNT(*) AS n, COUNTIF(any_automated OR any_declared) AS clear_k,
  wilson(COUNTIF(any_automated OR any_declared), COUNT(*)) AS clear_ci95,
  COUNTIF(any_suspicious AND NOT any_automated AND NOT any_declared) AS suspicious_only_k,
  COUNTIF(NOT has_class) AS unknown_k
FROM sessions GROUP BY site, stream_id, traffic_version, engaged, purchasing;

-- Evaluation cohorts: normalized retains window events excluded from A--I.
-- LEFT JOIN preserves windows with zero delivery. These are event counts, not
-- run recall: the CSV supplies attempted-run denominators. Background traffic
-- in public windows can contaminate matches; adjudicate with the protocol.
SELECT site_name AS site, web_stream_id AS stream_id, w.start_ts, w.end_ts, w.label,
  COUNT(n.event_timestamp) AS observed_events,
  COUNTIF(n.event_name = 'traffic_class') AS detector_events,
  COUNTIF(n.event_name = 'traffic_class' AND n.param_class IS NOT NULL) AS classified_events,
  COUNTIF(n.event_name = 'traffic_class' AND n.param_class IN
    ('automated', 'declared_agent')) AS clear_events,
  COUNTIF(n.event_name = 'traffic_class' AND n.param_class = 'suspicious') AS suspicious_events,
  COUNTIF(n.event_name = 'traffic_class' AND n.param_class = 'human') AS human_events,
  COUNTIF(n.event_name = 'traffic_class' AND n.phase = 'final') AS final_events,
  ARRAY_AGG(DISTINCT n.traffic_version IGNORE NULLS) AS observed_versions
FROM UNNEST(labelled_windows) w LEFT JOIN normalized n
  ON TIMESTAMP_MICROS(n.event_timestamp) >= w.start_ts
 AND TIMESTAMP_MICROS(n.event_timestamp) < w.end_ts
GROUP BY w.start_ts, w.end_ts, w.label;
