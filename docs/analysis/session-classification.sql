-- not yet validated against a live export
-- Vanilla Server-Side + Visitor Verdict: classify sessions by the strongest vv_type and inspect current-hit vv_detail.
-- GoogleSQL script over the GA4 BigQuery export. Replace `project.analytics_XXXX` (2x, in Query 0
-- and CREATE TEMP TABLE units) and dates, then run the WHOLE script. Read-only; creates two temp tables.
-- Daily tables only (no intraday double counting); GA4 may rewrite daily tables for ~3 days.
--
-- Unit of analysis:
--   session          = (stream_id, user_pseudo_id, ga_session_id), non-denied events
--                      (user_pseudo_id IS NOT NULL, ga_session_id IS NOT NULL,
--                       COALESCE(privacy_info.analytics_storage, 'Unset') != 'No').
--                      Works both with Consent Mode ('Yes') and without Consent Mode (NULL/'Unset').
--   ping_page        = cookieless denied pings (analytics_storage = 'No', user_pseudo_id IS NULL)
--                      of ONE page, grouped by (stream_id, event_date, batch_page_id).
--                      Check Query 0 FIRST: verify batch_page_id is high-cardinality (random/timestamp `_p`)
--                      and not a small per-session counter (1, 2, 3...) that would collide across visitors;
--                      if NULL or low-cardinality, set group_pings_by_page = FALSE to fall back per event.
--                      NEVER group pings by ga_session_id: Vanilla's ping session_id is the page-load
--                      second (tracker.ts:319), so it collides across visitors.
--   unjoinable_event = anything else (missing IDs, or pings when group_pings_by_page = FALSE):
--                      strictly 1 row = 1 unit via GENERATE_UUID().
-- Ping units are reported apart and never added to sessions: for an undecided visitor who consents
-- on the same page, the pings duplicate the later full events (Vanilla README, Consent).
--
-- Rules:
--   vv_type is the collector verdict, sticky on later hits in the same session/page.
--   Take the strongest observed value, never the last or a user property:
--   pending=0, human=1, bot_suspicious=2, agent_unverified=3, bot_automation=4,
--   crawler_verified=agent_verified=5, bot_spoofed=6. Equal ranks retain the first
--   observed value (export ordering breaks ties deterministically where possible).
--   Verified unknown purpose maps to agent_verified; unknown is preserved
--   in vv_detail without inventing a user-directed or crawler role.
--   vv_detail = operator|verification|purpose|claim|browser_class|browser_phase.
--   It describes CURRENT hit evidence plus a sticky known operator. Do not treat
--   a sticky vv_type as verification of that hit or combine detail fields across hits.
--   Missing labels may reflect budget limits/early deployment and are unknown.
--
-- Caveats:
--   - Sessions spanning midnight at start_date / end_date boundaries are truncated to the date window.
--   - ecommerce.purchase_revenue is in local currency; for multi-currency properties use revenue_usd
--     (ecommerce.purchase_revenue_in_usd) or group by currency. Check distinct_purchase_currencies in Query 0.

DECLARE start_date DATE DEFAULT DATE '2026-11-20';
DECLARE end_date DATE DEFAULT DATE '2026-11-26';
DECLARE group_pings_by_page BOOL DEFAULT TRUE;
DECLARE start_suffix STRING;
DECLARE end_suffix STRING;
SET start_suffix = FORMAT_DATE('%Y%m%d', start_date);
SET end_suffix = FORMAT_DATE('%Y%m%d', end_date);

CREATE TEMP FUNCTION type_rank(v STRING) AS (
  CASE v WHEN 'pending' THEN 0 WHEN 'human' THEN 1 WHEN 'bot_suspicious' THEN 2
    WHEN 'agent_unverified' THEN 3 WHEN 'bot_automation' THEN 4
    WHEN 'crawler_verified' THEN 5 WHEN 'agent_verified' THEN 5
    WHEN 'bot_spoofed' THEN 6 END
);

-- Query 0: inspect ping IDs, label coverage/format and currency before grouping.
SELECT
  privacy_info.analytics_storage AS analytics_storage,
  user_pseudo_id IS NULL AS no_user_pseudo_id,
  COUNT(*) AS hits,
  COUNTIF(batch_page_id IS NULL) AS hits_without_batch_page_id,
  APPROX_COUNT_DISTINCT(batch_page_id) AS distinct_batch_page_ids,
  MIN(batch_page_id) AS min_batch_page_id,
  MAX(batch_page_id) AS max_batch_page_id,
  COUNTIF((SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
    FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) IS NULL)
    AS hits_without_ga_session_id,
  COUNTIF(EXISTS(SELECT 1 FROM UNNEST(event_params)
    WHERE key = 'vv_type' AND type_rank(value.string_value) IS NOT NULL)) AS hits_with_valid_type,
  COUNTIF(EXISTS(SELECT 1 FROM UNNEST(event_params)
    WHERE key = 'vv_type' AND type_rank(value.string_value) IS NULL)) AS hits_with_unknown_type,
  COUNTIF(EXISTS(SELECT 1 FROM UNNEST(event_params)
    WHERE key = 'vv_detail' AND LENGTH(value.string_value) <= 100
      AND ARRAY_LENGTH(SPLIT(value.string_value, '|')) = 6)) AS hits_with_detail_shape,
  COUNT(DISTINCT IF(event_name = 'purchase',
    (SELECT NULLIF(TRIM(value.string_value), '') FROM UNNEST(event_params)
      WHERE key = 'currency' LIMIT 1), NULL)) AS distinct_purchase_currencies
FROM `project.analytics_XXXX.events_*`
WHERE _TABLE_SUFFIX BETWEEN start_suffix AND end_suffix
  AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^\d{8}$') AND platform = 'WEB'
GROUP BY 1, 2 ORDER BY 1, 2;

CREATE TEMP TABLE units AS
WITH ev AS (
  SELECT stream_id, event_date, event_timestamp, event_name, user_pseudo_id,
    privacy_info.analytics_storage AS analytics_storage,
    batch_page_id, batch_ordering_id, batch_event_index,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
      FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) AS ga_session_id,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'vv_type' LIMIT 1) AS type_raw,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'vv_detail' LIMIT 1) AS detail_raw,
    ecommerce.transaction_id AS transaction_id,
    COALESCE(ecommerce.purchase_revenue, 0) AS purchase_revenue,
    COALESCE(ecommerce.purchase_revenue_in_usd, 0) AS purchase_revenue_in_usd
  FROM `project.analytics_XXXX.events_*`
  WHERE _TABLE_SUFFIX BETWEEN start_suffix AND end_suffix
    AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^\d{8}$') AND platform = 'WEB'
), parsed AS (
  SELECT *, IF(type_rank(type_raw) IS NOT NULL, type_raw, NULL) AS vv_type,
    IF(LENGTH(detail_raw) <= 100 AND ARRAY_LENGTH(SPLIT(detail_raw, '|')) = 6,
       SPLIT(detail_raw, '|'), NULL) AS parts
  FROM ev
), norm AS (
  SELECT *,
    NULLIF(NULLIF(parts[SAFE_OFFSET(0)], 'none'), '-') AS operator,
    IF(parts[SAFE_OFFSET(1)] IN ('signature_valid', 'signature_invalid', 'ip_match',
       'no_signature', 'none'), parts[SAFE_OFFSET(1)], NULL) AS verification,
    IF(parts[SAFE_OFFSET(2)] IN ('user_directed', 'crawler', 'unknown'),
       parts[SAFE_OFFSET(2)], NULL) AS purpose,
    IF(parts[SAFE_OFFSET(3)] IN ('signature_agent', 'ua_token', 'none'),
       parts[SAFE_OFFSET(3)], NULL) AS claim,
    IF(parts[SAFE_OFFSET(4)] IN ('human', 'suspicious', 'automated', 'declared_agent'),
       parts[SAFE_OFFSET(4)], NULL) AS browser_class,
    IF(parts[SAFE_OFFSET(5)] IN ('initial', 'final'), parts[SAFE_OFFSET(5)], NULL) AS browser_phase,
    CASE
      WHEN user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
        AND COALESCE(analytics_storage, 'Unset') != 'No' THEN 'session'
      WHEN group_pings_by_page AND user_pseudo_id IS NULL
        AND analytics_storage = 'No' AND batch_page_id IS NOT NULL THEN 'ping_page'
      ELSE 'unjoinable_event'
    END AS unit_type
  FROM parsed
), keyed AS (
  SELECT *, CASE unit_type
    WHEN 'session' THEN FORMAT('s|%T|%T|%T', stream_id, user_pseudo_id, ga_session_id)
    WHEN 'ping_page' THEN FORMAT('p|%T|%T|%T', stream_id, event_date, batch_page_id)
    ELSE FORMAT('e|%s', GENERATE_UUID()) END AS unit_key
  FROM norm
)
SELECT unit_type, unit_key, ANY_VALUE(stream_id) AS stream_id,
  MIN(event_date) AS first_date, COUNT(*) AS hits,
  COUNTIF(vv_type IS NOT NULL) AS hits_with_type,
  COUNTIF(parts IS NOT NULL) AS hits_with_detail,
  COUNTIF(browser_class IS NOT NULL) AS hits_with_browser_class,
  COUNTIF(type_raw IS NOT NULL AND vv_type IS NULL) AS hits_with_unknown_type,
  COUNTIF(detail_raw IS NOT NULL AND parts IS NULL) AS hits_with_malformed_detail,
  ARRAY_AGG(vv_type IGNORE NULLS ORDER BY type_rank(vv_type) DESC, event_timestamp,
    COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0), vv_type
    LIMIT 1)[SAFE_OFFSET(0)] AS strongest_type,
  -- This diagnostic evidence remains paired from one genuinely verified hit.
  ARRAY_AGG(IF(verification IN ('signature_valid', 'ip_match'),
    STRUCT(operator AS operator, purpose AS purpose, verification AS verification,
      browser_class AS browser_class, claim AS claim), NULL) IGNORE NULLS
    ORDER BY IF(verification = 'signature_valid', 0, 1), event_timestamp,
      COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0), operator, purpose
    LIMIT 1)[SAFE_OFFSET(0)] AS verified_evidence,
  COUNTIF(verification = 'signature_valid') > 0
    AND COUNTIF(verification = 'signature_invalid') > 0 AS mixed_signature_results,
  COUNTIF(browser_class = 'human') > 0
    AND COUNTIF(browser_class IN ('automated', 'declared_agent')) > 0 AS class_changed_within_unit,
  COUNTIF(event_name = 'page_view') AS pageviews,
  COUNTIF(event_name = 'purchase') AS purchases,
  COUNT(DISTINCT IF(event_name = 'purchase', NULLIF(TRIM(transaction_id), ''), NULL))
    AS unique_transactions,
  SUM(IF(event_name = 'purchase', purchase_revenue, 0)) AS revenue,
  SUM(IF(event_name = 'purchase', purchase_revenue_in_usd, 0)) AS revenue_usd,
  COUNTIF(event_name = 'generate_lead') AS leads
FROM keyed GROUP BY unit_type, unit_key;

-- Query 1: strongest type per unit, with whole-session purchasing denominators.
-- Missing types stay separate from pending; neither is positive human evidence.
SELECT unit_type, COALESCE(strongest_type, 'missing') AS vv_type,
  COUNT(*) AS units, SUM(hits) AS hits, SUM(pageviews) AS pageviews,
  COUNTIF(purchases > 0) AS purchasing_units, SUM(purchases) AS purchases,
  SUM(unique_transactions) AS unique_transactions,
  ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(revenue_usd), 2) AS revenue_usd,
  COUNTIF(leads > 0) AS lead_units,
  ROUND(SAFE_DIVIDE(COUNTIF(purchases > 0), COUNT(*)), 4) AS purchase_conversion_rate,
  ROUND(SAFE_DIVIDE(SUM(hits_with_type), SUM(hits)), 3) AS type_coverage_of_hits,
  ROUND(SAFE_DIVIDE(SUM(hits_with_detail), SUM(hits)), 3) AS detail_coverage_of_hits,
  ROUND(SAFE_DIVIDE(SUM(hits_with_browser_class), SUM(hits)), 3) AS browser_class_coverage_of_hits,
  SUM(hits_with_unknown_type) AS hits_with_unknown_type,
  SUM(hits_with_malformed_detail) AS hits_with_malformed_detail,
  COUNTIF(class_changed_within_unit) AS units_human_and_automation,
  COUNTIF(mixed_signature_results) AS units_valid_and_invalid_signature
FROM units GROUP BY 1, 2
ORDER BY CASE unit_type WHEN 'session' THEN 0 WHEN 'ping_page' THEN 1 ELSE 2 END, vv_type;

-- Query 2: observed verified evidence, including unknown purpose (agent_verified on that hit).
-- Current detail is not guaranteed to explain the session's sticky strongest_type.
SELECT unit_type, strongest_type AS vv_type,
  verified_evidence.operator AS verified_operator,
  verified_evidence.purpose AS verified_purpose,
  verified_evidence.verification AS verification,
  verified_evidence.browser_class AS browser_class,
  verified_evidence.claim AS claim,
  COUNT(*) AS units, COUNTIF(purchases > 0) AS purchasing_units,
  SUM(unique_transactions) AS unique_transactions,
  ROUND(SUM(revenue), 2) AS revenue, ROUND(SUM(revenue_usd), 2) AS revenue_usd,
  COUNTIF(leads > 0) AS lead_units
FROM units WHERE verified_evidence IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7 ORDER BY units DESC;
