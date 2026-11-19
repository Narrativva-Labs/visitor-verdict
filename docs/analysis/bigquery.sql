-- GoogleSQL script. Edit parameters, then run the WHOLE script in BigQuery.
-- Read-only against the export; creates temporary tables and returns A--F.
-- Dataset identifiers cannot be bound parameters, hence validated dynamic SQL.
DECLARE export_dataset STRING DEFAULT 'your-project.analytics_123456789';
DECLARE start_date DATE DEFAULT DATE '2026-11-01';
DECLARE end_date DATE DEFAULT DATE '2026-11-17'; -- inclusive, completed daily tables
DECLARE property_timezone STRING DEFAULT 'Europe/Prague'; -- match GA4 property
DECLARE city_filter STRING DEFAULT NULL; -- e.g. 'Prague'; NULL = all cities
DECLARE long_engagement_ms INT64 DEFAULT 120000;
DECLARE padding_days INT64 DEFAULT 1; -- increase for sessions spanning >1 day
DECLARE test_windows ARRAY<STRUCT<start_ts TIMESTAMP, end_ts TIMESTAMP>> DEFAULT [];
-- Replace [] above with e.g.:
-- [STRUCT(TIMESTAMP '2026-11-12 09:00:00+00' AS start_ts,
--         TIMESTAMP '2026-11-12 10:00:00+00' AS end_ts)]
-- Windows are UTC, half-open [start,end). Exclude the WHOLE identifiable session
-- if ANY observed event overlaps a window. Unjoinable pings: exclude per event.
-- A city filter selects sessions by first observed city, pings by their own city.
-- This avoids truncating engagement/conversions within an identifiable session.

ASSERT REGEXP_CONTAINS(export_dataset, r'^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+$')
  AS 'Use project.dataset without backticks';
ASSERT start_date <= end_date AND padding_days >= 0 AS 'Invalid date range/padding';
ASSERT NOT EXISTS (SELECT 1 FROM UNNEST(test_windows) WHERE start_ts IS NULL
  OR end_ts IS NULL OR start_ts >= end_ts) AS 'Invalid test window';

-- Semantics:
-- * Session = the existing (user_pseudo_id, ga_session_id) pair; never coalesce
--   missing IDs to a shared value, invent an ID or join pre-consent pings later.
-- * Session class = latest valid FINAL detector event across observed documents;
--   fallback: latest initial/unphased detector event, then latest event parameter.
--   User properties are NOT a session fallback: they can persist from older visits.
--   This is a retrospective analysis label, not the class at conversion time.
-- * A is an EVENT-label distribution (event parameter first, user property fallback
--   explicitly marked). A user/session can appear in multiple classes and days.
-- * B--F assign each session once, to the local date of ga_session_id (epoch seconds).
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

EXECUTE IMMEDIATE FORMAT('''
CREATE TEMP TABLE raw AS
SELECT
  PARSE_DATE('%%Y%%m%%d', event_date) AS day,
  event_timestamp, event_name, user_pseudo_id,
  batch_page_id, batch_ordering_id, batch_event_index,
  (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
   FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) AS ga_session_id,
  (SELECT value.string_value FROM UNNEST(event_params)
   WHERE key = 'traffic_class' LIMIT 1) AS param_class_raw,
  (SELECT value.string_value FROM UNNEST(event_params)
   WHERE key = 'traffic_phase' LIMIT 1) AS phase,
  (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
   FROM UNNEST(event_params) WHERE key = 'traffic_score' LIMIT 1) AS traffic_score,
  (SELECT value.string_value FROM UNNEST(user_properties)
   WHERE key = 'traffic_class' LIMIT 1) AS property_class_raw,
  (SELECT value.set_timestamp_micros FROM UNNEST(user_properties)
   WHERE key = 'traffic_class' LIMIT 1) AS property_set_micros,
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
  AND platform = 'WEB'
''', export_dataset)
USING FORMAT_DATE('%Y%m%d', DATE_SUB(start_date, INTERVAL padding_days DAY)) AS scan_start,
      FORMAT_DATE('%Y%m%d', DATE_ADD(end_date, INTERVAL padding_days DAY)) AS scan_end;

CREATE TEMP TABLE normalized AS
SELECT *, valid_class(param_class_raw) AS param_class,
  valid_class(property_class_raw) AS property_class,
  EXISTS (SELECT 1 FROM UNNEST(test_windows) w
    WHERE TIMESTAMP_MICROS(event_timestamp) >= w.start_ts
      AND TIMESTAMP_MICROS(event_timestamp) < w.end_ts) AS in_test_window
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

CREATE TEMP TABLE session_rollup AS
SELECT user_pseudo_id, ga_session_id,
  DATE(TIMESTAMP_SECONDS(ga_session_id), property_timezone) AS session_day,
  COALESCE(
    ARRAY_AGG(IF(event_name = 'traffic_class' AND phase = 'final', param_class, NULL)
      IGNORE NULLS ORDER BY event_timestamp DESC, batch_page_id DESC,
      batch_ordering_id DESC, batch_event_index DESC LIMIT 1)[SAFE_OFFSET(0)],
    ARRAY_AGG(IF(event_name = 'traffic_class', param_class, NULL)
      IGNORE NULLS ORDER BY event_timestamp DESC, batch_page_id DESC,
      batch_ordering_id DESC, batch_event_index DESC LIMIT 1)[SAFE_OFFSET(0)],
    ARRAY_AGG(param_class IGNORE NULLS ORDER BY event_timestamp DESC,
      batch_page_id DESC, batch_ordering_id DESC, batch_event_index DESC
      LIMIT 1)[SAFE_OFFSET(0)], 'unclassified') AS session_class,
  CASE
    WHEN COUNTIF(event_name = 'traffic_class' AND phase = 'final'
      AND param_class IS NOT NULL) > 0 THEN 'final_detector'
    WHEN COUNTIF(event_name = 'traffic_class' AND param_class IS NOT NULL) > 0
      THEN 'initial_or_unphased_detector'
    WHEN COUNTIF(param_class IS NOT NULL) > 0 THEN 'other_event_parameter'
    ELSE 'unclassified' END AS class_basis,
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
FROM events
WHERE user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
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

-- A. Daily observed class distribution. Counts are distinct within each row,
-- NOT additive across classes/bases/days. Users = pseudo IDs, not GA4 Active users.
-- Explicit property fallback shows coverage but can be stale. No backfilling
-- earlier events from a later final class. Events missing both labels stay unknown.
WITH labeled AS (
SELECT *, COALESCE(param_class, property_class, 'unclassified') AS event_class,
  CASE WHEN param_class IS NOT NULL THEN 'event_parameter'
       WHEN property_class IS NOT NULL THEN 'user_property_fallback'
       ELSE 'missing' END AS label_basis
FROM events WHERE day BETWEEN start_date AND end_date
), ranked AS (
SELECT *, ROW_NUMBER() OVER (
  PARTITION BY day, event_class, label_basis, user_pseudo_id, ga_session_id
  ORDER BY event_timestamp) AS session_event_rank
FROM labeled
)
SELECT day, event_class, label_basis,
  COUNT(*) AS events, COUNT(DISTINCT user_pseudo_id) AS observed_users,
  COUNTIF(user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
    AND session_event_rank = 1) AS observed_sessions,
  COUNTIF(user_pseudo_id IS NULL) AS events_without_user_id,
  COUNTIF(user_pseudo_id IS NULL OR ga_session_id IS NULL) AS unjoinable_events
FROM ranked
GROUP BY day, event_class, label_basis ORDER BY day, event_class, label_basis;

-- B. One retrospective label per session; final coverage/fallback kept visible.
-- Engagement is SUM of exported increments, not wall-clock duration. Engaged
-- sessions use exported session_engaged, not a reconstructed ten-second rule.
-- Named conversions are raw event counts even if not marked as GA4 key events.
-- Purchase counts are not transaction-ID deduplicated or refund-adjusted.
SELECT session_day, session_class, class_basis, COUNT(*) AS sessions,
  COUNTIF(engaged) AS engaged_sessions,
  SAFE_DIVIDE(COUNTIF(engaged), COUNT(*)) AS engagement_rate,
  SUM(engagement_ms) AS engagement_time_msec,
  SAFE_DIVIDE(SUM(engagement_ms), COUNT(*)) AS engagement_ms_per_session,
  SUM(pageviews) AS pageviews,
  SAFE_DIVIDE(SUM(pageviews), COUNT(*)) AS pageviews_per_session,
  SUM(purchases) AS purchase_events, SUM(leads) AS generate_lead_events,
  SUM(carts) AS add_to_cart_events,
  COUNTIF(purchases > 0) AS purchasing_sessions,
  COUNTIF(leads > 0) AS lead_sessions, COUNTIF(carts > 0) AS cart_sessions
FROM sessions GROUP BY session_day, session_class, class_basis
ORDER BY session_day, session_class, class_basis;

-- C. Source / medium / exported session default channel; AI referral annotation.
-- Missing attribution stays unknown, never inferred as Direct. A human clicking
-- an assistant link can be human; declared_agent need not have an AI referrer.
SELECT session_day, session_class, source, medium, session_default_channel,
  source_basis, ai_referral_annotation, COUNT(*) AS sessions,
  COUNTIF(engaged) AS engaged_sessions,
  COUNTIF(purchases > 0 OR leads > 0 OR carts > 0) AS converting_sessions
FROM sessions GROUP BY session_day, session_class, source, medium,
  session_default_channel, source_basis, ai_referral_annotation
ORDER BY session_day, sessions DESC;

-- D. Device / browser / OS / geo: first observed event per session.
-- Roll up dimensions as needed; geo reflects GA4 estimates, not verified location.
SELECT session_day, session_class, first_observed.device_category AS device_category,
  first_observed.browser AS browser, first_observed.operating_system AS operating_system,
  first_observed.country AS country, first_observed.city AS city,
  COUNT(*) AS sessions, COUNTIF(engaged) AS engaged_sessions,
  COUNTIF(purchases > 0 OR leads > 0 OR carts > 0) AS converting_sessions
FROM sessions GROUP BY session_day, session_class, device_category, browser,
  operating_system, country, city ORDER BY session_day, sessions DESC;

-- E. Potential false positives: aggregate review queue, no exported session IDs.
-- Bots can convert and engage; a conversion/long engagement is review evidence,
-- NOT ground truth. Also inspect timing: conversion may precede classification.
SELECT session_day, session_class, class_basis, source, medium,
  first_observed.device_category AS device_category, COUNT(*) AS review_sessions,
  COUNTIF(purchases > 0 OR leads > 0 OR carts > 0) AS converting_sessions,
  COUNTIF(engagement_ms >= long_engagement_ms) AS long_engagement_sessions,
  SUM(engagement_ms) AS engagement_time_msec,
  SUM(purchases) AS purchase_events, SUM(leads) AS generate_lead_events,
  SUM(carts) AS add_to_cart_events
FROM sessions
WHERE session_class IN ('suspicious', 'automated')
  AND (purchases > 0 OR leads > 0 OR carts > 0 OR engagement_ms >= long_engagement_ms)
GROUP BY session_day, session_class, class_basis, source, medium, device_category
ORDER BY review_sessions DESC;

-- F1. Detector coverage in OBSERVED, joinable GA4 sessions. This is independent
-- of whether page_view/other events carry traffic_class or a user property exists.
SELECT session_day, has_detector_event, has_final_event, COUNT(*) AS sessions,
  SUM(events) AS events, COUNTIF(engaged) AS engaged_sessions,
  SUM(engagement_ms) AS engagement_time_msec, SUM(pageviews) AS pageviews,
  COUNTIF(purchases > 0 OR leads > 0 OR carts > 0) AS converting_sessions
FROM sessions GROUP BY session_day, has_detector_event, has_final_event
ORDER BY session_day, has_detector_event, has_final_event;

-- F2. Separate event-level coverage for pings that cannot form sessions. Do not
-- claim that other events on such pings belong to a visit with/without a detector.
SELECT day, analytics_storage, user_pseudo_id IS NULL AS missing_user_id,
  ga_session_id IS NULL AS missing_session_id, COUNT(*) AS events,
  COUNTIF(event_name = 'traffic_class') AS detector_events,
  COUNTIF(event_name = 'traffic_class' AND phase = 'final') AS final_detector_events,
  COUNTIF(param_class IS NOT NULL) AS events_with_class_parameter
FROM events
WHERE day BETWEEN start_date AND end_date
  AND (user_pseudo_id IS NULL OR ga_session_id IS NULL)
GROUP BY day, analytics_storage, missing_user_id, missing_session_id
ORDER BY day, analytics_storage;

-- Coverage limits: a JS-less fetch normally sends NO GA4 event, so it cannot
-- appear even in F1's 'no detector' cohort. Use separately governed server/CDN
-- aggregates to assess that blind spot. No detector event can also mean blocked
-- tags, consent configuration, failed pagehide delivery, or a deployment gap.
-- Short visits are not automatically missing: final fires on pagehide OR after
-- 8 seconds VISIBLE time; GA4 delivery is separate and not guaranteed.
-- BigQuery raw observed counts need not match GA4 modeled/thresholded reports.
