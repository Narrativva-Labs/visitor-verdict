-- not yet validated against a live export
-- Vanilla Server-Side + Visitor Verdict: classify sessions by browser class and server verdict.
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
--   traffic_class      = browser claim, present only on hits sent after the detector published, so ANY hit
--                        in the unit counts; precedence declared_agent > automated > suspicious > human
--                        (same as visitor-verdict docs/analysis/bigquery.sql). A later human never erases it.
--   agent_verification = server verdict per HTTP request; the unit takes the STRONGEST:
--                        signature_valid > ip_match > signature_invalid > no_signature > none.
--                        Missing (NULL / "(not set)") = verification off, cache-only miss/operator unavailable,
--                        label dropped for 25 parameters/16 KiB, or hits before enabling: unknown, never "human".
--   agent_purpose      = user_directed / crawler / unknown, taken from the SAME winning verified hit
--                        as verified_operator. Query 1 and Query 2 group by that purpose; missing is unknown.
--
-- Caveats:
--   - Sessions spanning midnight at start_date / end_date boundaries are truncated to the date window.
--   - ecommerce.purchase_revenue is in local currency; for multi-currency properties use revenue_usd
--     (ecommerce.purchase_revenue_in_usd) or group by currency. Check distinct_purchase_currencies in Query 0.

DECLARE start_date DATE DEFAULT DATE '2026-11-20';
DECLARE end_date   DATE DEFAULT DATE '2026-11-26';   -- inclusive, completed daily tables only
DECLARE group_pings_by_page BOOL DEFAULT TRUE;
DECLARE start_suffix STRING;
DECLARE end_suffix   STRING;

SET start_suffix = FORMAT_DATE('%Y%m%d', start_date);
SET end_suffix   = FORMAT_DATE('%Y%m%d', end_date);

-- Query 0: what does the export hold for pings vs full events? (sanity check, run once)
SELECT
  privacy_info.analytics_storage AS analytics_storage,
  user_pseudo_id IS NULL AS no_user_pseudo_id,
  COUNT(*) AS hits,
  COUNTIF(batch_page_id IS NULL) AS hits_without_batch_page_id,
  APPROX_COUNT_DISTINCT(batch_page_id) AS distinct_batch_page_ids,
  MIN(batch_page_id) AS min_batch_page_id,
  MAX(batch_page_id) AS max_batch_page_id,
  COUNTIF(
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
     FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) IS NULL
  ) AS hits_without_ga_session_id,
  COUNTIF(EXISTS(
    SELECT 1 FROM UNNEST(event_params)
    WHERE key = 'agent_verification' AND NULLIF(TRIM(value.string_value), '') IS NOT NULL
  )) AS hits_with_agent_verification,
  COUNTIF(EXISTS(
    SELECT 1 FROM UNNEST(event_params)
    WHERE key = 'agent_purpose' AND NULLIF(TRIM(value.string_value), '') IS NOT NULL
  )) AS hits_with_agent_purpose,
  COUNTIF(EXISTS(
    SELECT 1 FROM UNNEST(event_params)
    WHERE key = 'agent_purpose' AND value.string_value IS NOT NULL
      AND value.string_value NOT IN ('user_directed', 'crawler', 'unknown')
  )) AS hits_with_unknown_purpose_value,
  COUNTIF(EXISTS(
    SELECT 1 FROM UNNEST(event_params)
    WHERE key = 'traffic_class' AND NULLIF(TRIM(value.string_value), '') IS NOT NULL
  )) AS hits_with_traffic_class,
  COUNT(DISTINCT IF(
    event_name = 'purchase',
    (SELECT NULLIF(TRIM(value.string_value), '') FROM UNNEST(event_params) WHERE key = 'currency' LIMIT 1),
    NULL
  )) AS distinct_purchase_currencies
FROM `project.analytics_XXXX.events_*`
WHERE _TABLE_SUFFIX BETWEEN start_suffix AND end_suffix
  AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^\d{8}$')
  AND platform = 'WEB'
GROUP BY 1, 2
ORDER BY 1, 2;

CREATE TEMP TABLE units AS
WITH ev AS (
  SELECT
    stream_id,
    event_date,
    event_timestamp,
    event_name,
    user_pseudo_id,
    privacy_info.analytics_storage AS analytics_storage,
    batch_page_id,
    batch_ordering_id,
    batch_event_index,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
       FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) AS ga_session_id,
    (SELECT value.string_value FROM UNNEST(event_params)
       WHERE key = 'agent_verification' LIMIT 1) AS av_raw,
    (SELECT value.string_value FROM UNNEST(event_params)
       WHERE key = 'agent_operator' LIMIT 1) AS operator_raw,
    (SELECT value.string_value FROM UNNEST(event_params)
       WHERE key = 'agent_purpose' LIMIT 1) AS purpose_raw,
    (SELECT value.string_value FROM UNNEST(event_params)
       WHERE key = 'agent_claim' LIMIT 1) AS claim_raw,
    (SELECT value.string_value FROM UNNEST(event_params)
       WHERE key = 'traffic_class' LIMIT 1) AS tc_raw,
    ecommerce.transaction_id AS transaction_id,
    COALESCE(ecommerce.purchase_revenue, 0) AS purchase_revenue,
    COALESCE(ecommerce.purchase_revenue_in_usd, 0) AS purchase_revenue_in_usd
  FROM `project.analytics_XXXX.events_*`
  WHERE _TABLE_SUFFIX BETWEEN start_suffix AND end_suffix
    AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^\d{8}$')
    AND platform = 'WEB'
),
norm AS (
  SELECT *,
    -- Only the documented values count; anything else is treated as missing and reported.
    IF(av_raw IN ('signature_valid', 'ip_match', 'signature_invalid', 'no_signature', 'none'),
       av_raw, NULL) AS av,
    IF(purpose_raw IN ('user_directed', 'crawler', 'unknown'), purpose_raw, NULL) AS purpose,
    IF(tc_raw IN ('human', 'suspicious', 'automated', 'declared_agent'),
       tc_raw, NULL) AS tc,
    IF(claim_raw IN ('signature_agent', 'ua_token', 'none'),
       claim_raw, NULL) AS claim,
    NULLIF(NULLIF(NULLIF(TRIM(operator_raw), ''), '(not set)'), 'none') AS operator_clean,
    CASE
      WHEN user_pseudo_id IS NOT NULL
           AND ga_session_id IS NOT NULL
           AND COALESCE(analytics_storage, 'Unset') != 'No' THEN 'session'
      WHEN group_pings_by_page
           AND user_pseudo_id IS NULL
           AND analytics_storage = 'No'
           AND batch_page_id IS NOT NULL THEN 'ping_page'
      ELSE 'unjoinable_event'
    END AS unit_type
  FROM ev
),
keyed AS (
  SELECT *,
    CASE unit_type
      -- %T quotes strings, preventing delimiter collisions if any ID contains '|'.
      WHEN 'session'   THEN FORMAT('s|%T|%T|%T', stream_id, user_pseudo_id, ga_session_id)
      WHEN 'ping_page' THEN FORMAT('p|%T|%T|%T', stream_id, event_date, batch_page_id)
      ELSE FORMAT('e|%s', GENERATE_UUID())
    END AS unit_key
  FROM norm
),
aggregated AS (
  SELECT
    unit_type,
    unit_key,
    ANY_VALUE(stream_id) AS stream_id,
    MIN(event_date) AS first_date,
    COUNT(*) AS hits,
    COUNTIF(av IS NOT NULL) AS hits_with_verification,
    COUNTIF(tc IS NOT NULL) AS hits_with_class,
    COUNTIF(purpose IS NOT NULL) AS hits_with_purpose,
    COUNTIF(purpose_raw IS NOT NULL AND purpose IS NULL) AS hits_with_unknown_purpose_value,
    COUNTIF(
      (av_raw IS NOT NULL AND av IS NULL)
      OR (tc_raw IS NOT NULL AND tc IS NULL)
      OR (claim_raw IS NOT NULL AND claim IS NULL)
      OR (purpose_raw IS NOT NULL AND purpose IS NULL)
    ) AS hits_with_unknown_label_value,
    -- Strongest server verdict in the unit.
    CASE MAX(CASE av WHEN 'signature_valid' THEN 5 WHEN 'ip_match' THEN 4
                     WHEN 'signature_invalid' THEN 3 WHEN 'no_signature' THEN 2
                     WHEN 'none' THEN 1 END)
      WHEN 5 THEN 'signature_valid'
      WHEN 4 THEN 'ip_match'
      WHEN 3 THEN 'signature_invalid'
      WHEN 2 THEN 'no_signature'
      WHEN 1 THEN 'none'
    END AS verification,
    -- Keep role and operator paired, including when one label is missing on the winning hit.
    ARRAY_AGG(
      IF(av IN ('signature_valid', 'ip_match'),
         STRUCT(operator_clean AS operator, COALESCE(purpose, 'unknown') AS purpose), NULL) IGNORE NULLS
      ORDER BY IF(av = 'signature_valid', 0, 1), event_timestamp,
               COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0), operator_clean, purpose
      LIMIT 1
    )[SAFE_OFFSET(0)] AS verified_evidence,
    ARRAY_AGG(
      claim IGNORE NULLS
      ORDER BY CASE claim WHEN 'signature_agent' THEN 0 WHEN 'ua_token' THEN 1 ELSE 2 END,
               event_timestamp, COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0)
      LIMIT 1
    )[SAFE_OFFSET(0)] AS strongest_claim,
    COUNTIF(av = 'signature_valid') > 0 AND COUNTIF(av = 'signature_invalid') > 0
      AS mixed_signature_results,
    -- Any-hit browser class.
    CASE
      WHEN COUNTIF(tc = 'declared_agent') > 0 THEN 'declared_agent'
      WHEN COUNTIF(tc = 'automated') > 0 THEN 'automated'
      WHEN COUNTIF(tc = 'suspicious') > 0 THEN 'suspicious'
      WHEN COUNTIF(tc = 'human') > 0 THEN 'human'
      ELSE 'unknown'
    END AS browser_class,
    -- Tracks units that saw both 'human' and clear automation/declared agent (excludes 'suspicious').
    COUNTIF(tc = 'human') > 0 AND COUNTIF(tc IN ('automated', 'declared_agent')) > 0
      AS class_changed_within_unit,
    COUNTIF(event_name = 'page_view') AS pageviews,
    COUNTIF(event_name = 'purchase') AS purchases,
    COUNT(DISTINCT IF(event_name = 'purchase', NULLIF(TRIM(transaction_id), ''), NULL))
      AS unique_transactions,
    SUM(IF(event_name = 'purchase', purchase_revenue, 0)) AS revenue,
    SUM(IF(event_name = 'purchase', purchase_revenue_in_usd, 0)) AS revenue_usd,
    COUNTIF(event_name = 'generate_lead') AS leads
  FROM keyed
  GROUP BY unit_type, unit_key
)
SELECT * EXCEPT(verified_evidence),
  verified_evidence.operator AS verified_operator,
  verified_evidence.purpose AS verified_purpose
FROM aggregated;

CREATE TEMP TABLE classified AS
SELECT *,
  CASE
    -- README combination table rows, plus the combinations it does not list.
    WHEN verification IN ('signature_valid', 'ip_match') AND browser_class = 'human'
      THEN '1 verified operator, looks human'
    WHEN verification IN ('signature_valid', 'ip_match') AND browser_class = 'declared_agent'
      THEN '2 verified declared agent/bot'
    WHEN verification IN ('signature_valid', 'ip_match') AND browser_class = 'automated'
      THEN '2b verified operator, clear browser automation'
    WHEN verification IN ('signature_valid', 'ip_match') AND browser_class = 'suspicious'
      THEN '7v suspicious, verified operator (secondary view)'
    WHEN verification IN ('signature_valid', 'ip_match')
      THEN '2c verified operator, no browser class'
    WHEN verification = 'signature_invalid'
      THEN '6 invalid signature (forged, expired or broken)'
    WHEN browser_class = 'declared_agent' AND verification = 'no_signature'
      THEN '4 declared, not verified (false claim OR operator without verification data)'
    WHEN browser_class = 'declared_agent'
      THEN '4b declared, server verdict none/unknown'
    WHEN browser_class = 'automated'
      THEN '3 bot / scraper (clear automation)'
    WHEN browser_class = 'suspicious'
      THEN '7 suspicious (secondary view)'
    WHEN browser_class = 'human' AND verification = 'no_signature'
      THEN '5 human (or well-masked bot)'
    WHEN browser_class = 'human'
      THEN '5b human, server verdict none/unknown'
    ELSE '8 no browser class (detector absent or only early hits)'
  END AS segment
FROM units;

-- Query 1: units per segment and verified purpose (crawlers, user-directed, unknown stay apart).
-- Read session rows as the headline; ping rows are a separate world.
SELECT
  unit_type,
  segment,
  verified_purpose,
  COUNT(*) AS units,
  SUM(hits) AS hits,
  SUM(pageviews) AS pageviews,
  COUNTIF(purchases > 0) AS purchasing_units,
  SUM(purchases) AS purchases,
  SUM(unique_transactions) AS unique_transactions,
  ROUND(SUM(revenue), 2) AS revenue,
  ROUND(SUM(revenue_usd), 2) AS revenue_usd,
  COUNTIF(leads > 0) AS lead_units,
  ROUND(SAFE_DIVIDE(COUNTIF(purchases > 0), COUNT(*)), 4) AS purchase_conversion_rate,
  ROUND(SAFE_DIVIDE(SUM(hits_with_class), SUM(hits)), 3) AS class_coverage_of_hits,
  ROUND(SAFE_DIVIDE(SUM(hits_with_verification), SUM(hits)), 3) AS verification_coverage_of_hits,
  COUNTIF(verification IS NULL) AS units_without_server_verdict,
  COUNTIF(class_changed_within_unit) AS units_human_and_automation,
  COUNTIF(mixed_signature_results) AS units_valid_and_invalid_signature,
  SUM(hits_with_unknown_label_value) AS hits_with_unknown_label_value,
  SUM(hits_with_unknown_purpose_value) AS hits_with_unknown_purpose_value,
  ROUND(SAFE_DIVIDE(SUM(hits_with_purpose), SUM(hits)), 3) AS purpose_coverage_of_hits,
  ARRAY_TO_STRING(ARRAY_AGG(DISTINCT verified_operator IGNORE NULLS ORDER BY verified_operator), ', ')
    AS verified_operators
FROM classified
GROUP BY unit_type, segment, verified_purpose
ORDER BY CASE unit_type WHEN 'session' THEN 0 WHEN 'ping_page' THEN 1 ELSE 2 END, segment, verified_purpose;

-- Query 2: verified operators by purpose and claim (sessions and ping pages kept apart).
SELECT
  unit_type,
  verified_operator,
  verified_purpose,
  strongest_claim,
  verification,
  browser_class,
  COUNT(*) AS units,
  COUNTIF(purchases > 0) AS purchasing_units,
  SUM(unique_transactions) AS unique_transactions,
  ROUND(SUM(revenue), 2) AS revenue,
  ROUND(SUM(revenue_usd), 2) AS revenue_usd,
  COUNTIF(leads > 0) AS lead_units
FROM classified
WHERE verification IN ('signature_valid', 'ip_match')
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY units DESC;
