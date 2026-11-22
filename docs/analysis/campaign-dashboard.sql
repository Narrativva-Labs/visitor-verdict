-- Campaign dashboard: AI agents and bots in campaigns.
-- GoogleSQL SELECT queries over the GA4 BigQuery export. No scripting, temporary
-- objects or writes: each query runs with a read-only role and can be pasted as a
-- Looker Studio BigQuery custom query.
--
-- Query A: browser/GTM integration (event parameters traffic_class, traffic_agent).
-- Query B: server collector integration (event parameters vv_type, vv_detail).
-- Both return ONE ROW PER UNIT (session; for B also denied-ping page), so any
-- dashboard can SUM/COUNT the rows without double counting. Rollup at the end.
--
-- Parameters
--   `your-project.analytics_123456789`  export dataset, once per src block.
--   'site'                               a free label for the property.
--   @DS_START_DATE / @DS_END_DATE        STRING 'YYYYMMDD', inclusive. Looker Studio
--       fills them when "Enable date range parameters" is ticked on the data source;
--       bq CLI: --parameter=DS_START_DATE::20261101 --parameter=DS_END_DATE::20261114.
--       Without either, replace them with fixed strings or a rolling window, e.g.
--       FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)).
--   Test-traffic regexes in the params CTE (edit them to your own conventions).
--   key_events_regex: events counted as "other key events". The export has no
--       key-event flag, so list the property's key events other than purchase and
--       generate_lead here.
--
-- Several properties in one data source: UNION ALL one src block per property, each
-- with its own site label. UNION ALL needs the same types in every block; if the
-- traffic-source structs differ between properties, select their fields explicitly.
--
-- Semantics
--   * Session = (site, user_pseudo_id, ga_session_id); never coalesced or invented.
--     Query A drops events without both IDs (cookieless pings); count them with
--     bigquery.sql F2. Query B keeps them as separate unit types, never as sessions.
--   * Class = strongest observation over ALL hits of the unit, not the last one:
--     A: automated > declared_agent > suspicious > human (as bigquery.sql);
--     B: bot_spoofed > agent_verified = crawler_verified > bot_automation >
--        agent_unverified > bot_suspicious > human > pending (as
--        session-classification.sql; equal rank keeps the first observed).
--     No class observed = 'unknown' (A) / 'missing' (B); unknown is not human.
--   * Labels only: nothing is excluded. Test traffic is FLAGGED (traffic_scope,
--     test_reason), not dropped. Filter it in the report.
--   * Attribution: session_traffic_source_last_click (cross-channel, then manual),
--     then first collected_traffic_source, then utm_* of the first page_location.
--     source_basis says which one was used.
--   * has_gclid: gclid/gbraid/wbraid on any hit (collected source or URL).
--   * landing_page: path of the unit's first page_location (query and fragment
--     removed; paths can still contain personal data on some sites).
--   * Revenue: ecommerce.purchase_revenue in the property currency, summed over
--     purchase events; not deduplicated by transaction or refund-adjusted. The
--     unique_transactions column helps spot duplicates.
--   * Daily tables only (no intraday). Sessions crossing the range boundary are
--     truncated to the range. GA4 rewrites daily tables for up to three days.
--   * GA4 drops traffic from known bots and spiders before export. Obvious bots
--     are therefore largely absent; the labels here describe what reached GA4.

-- ============================================================================
-- Query A: browser classification (traffic_class) per session.
WITH params AS (
  SELECT
    r'[?&#]vvp=' AS test_url_regex,
    r'^(test|qa|e2e|canary)[-_]' AS test_campaign_regex,
    r'^(test|qa)$' AS test_source_regex,
    r'^(test|qa)$' AS test_medium_regex,
    r'^(click_mail|click_tel|form_submit|sign_up)$' AS key_events_regex
), src AS (
  SELECT 'site' AS site, event_date, event_timestamp, event_name, user_pseudo_id,
    event_params, batch_page_id, batch_ordering_id, batch_event_index,
    privacy_info.analytics_storage AS analytics_storage,
    ecommerce.purchase_revenue AS purchase_revenue, ecommerce.transaction_id AS transaction_id,
    device.category AS device_category,
    session_traffic_source_last_click AS ts, collected_traffic_source AS ct
  FROM `your-project.analytics_123456789.events_*`
  WHERE _TABLE_SUFFIX BETWEEN @DS_START_DATE AND @DS_END_DATE
    AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^\d{8}$') AND platform = 'WEB'
), ev AS (
  SELECT s.* EXCEPT (ts, ct),
    ts.cross_channel_campaign.source AS cc_source, ts.cross_channel_campaign.medium AS cc_medium,
    ts.cross_channel_campaign.campaign_name AS cc_campaign,
    ts.cross_channel_campaign.default_channel_group AS cc_channel,
    ts.manual_campaign.source AS mc_source, ts.manual_campaign.medium AS mc_medium,
    ts.manual_campaign.campaign_name AS mc_campaign, ct.manual_source AS ct_source,
    ct.manual_medium AS ct_medium, ct.manual_campaign_name AS ct_campaign, ct.gclid AS ct_gclid,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
      FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) AS ga_session_id,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'page_location' LIMIT 1) AS page_location,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
      FROM UNNEST(event_params) WHERE key = 'session_engaged' LIMIT 1) AS session_engaged,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
      FROM UNNEST(event_params) WHERE key = 'engagement_time_msec' LIMIT 1) AS engagement_ms,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'traffic_class' LIMIT 1) AS class_raw,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'traffic_agent' LIMIT 1) AS agent_raw
  FROM src s
), hits AS (
  SELECT ev.*,
    IF(class_raw IN ('human', 'suspicious', 'automated', 'declared_agent'), class_raw, NULL) AS class,
    IF(agent_raw IN ('openai', 'anthropic'), agent_raw, NULL) AS agent,
    REGEXP_EXTRACT(page_location, r'[?&]utm_source=([^&#]*)') AS url_source,
    REGEXP_EXTRACT(page_location, r'[?&]utm_medium=([^&#]*)') AS url_medium,
    REGEXP_EXTRACT(page_location, r'[?&]utm_campaign=([^&#]*)') AS url_campaign,
    REGEXP_CONTAINS(COALESCE(page_location, ''), p.test_url_regex) AS test_url,
    EXISTS(SELECT 1 FROM UNNEST([cc_campaign, mc_campaign, ct_campaign,
      REGEXP_EXTRACT(page_location, r'[?&]utm_campaign=([^&#]*)')]) c
      WHERE REGEXP_CONTAINS(LOWER(c), p.test_campaign_regex)) AS test_campaign,
    EXISTS(SELECT 1 FROM UNNEST([cc_source, mc_source, ct_source,
      REGEXP_EXTRACT(page_location, r'[?&]utm_source=([^&#]*)')]) c
      WHERE REGEXP_CONTAINS(LOWER(c), p.test_source_regex))
    OR EXISTS(SELECT 1 FROM UNNEST([cc_medium, mc_medium, ct_medium,
      REGEXP_EXTRACT(page_location, r'[?&]utm_medium=([^&#]*)')]) c
      WHERE REGEXP_CONTAINS(LOWER(c), p.test_medium_regex)) AS test_source_medium,
    REGEXP_CONTAINS(event_name, p.key_events_regex) AS is_key_event
  FROM ev CROSS JOIN params p
  WHERE user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
), units AS (
  SELECT site, 'session' AS unit_type,
    SUBSTR(TO_HEX(SHA256(FORMAT('%s|%s|%d', site, user_pseudo_id, ga_session_id))), 1, 16) AS unit_key,
    PARSE_DATE('%Y%m%d', MIN(event_date)) AS session_date,
    ARRAY_AGG(IF(COALESCE(cc_source, mc_source) IS NOT NULL, STRUCT(
      COALESCE(cc_source, mc_source) AS source, COALESCE(cc_medium, mc_medium) AS medium,
      COALESCE(cc_campaign, mc_campaign) AS campaign), NULL) IGNORE NULLS
      ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS last_click,
    ARRAY_AGG(IF(ct_source IS NOT NULL, STRUCT(ct_source AS source, ct_medium AS medium,
      ct_campaign AS campaign), NULL) IGNORE NULLS
      ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS collected,
    ARRAY_AGG(IF(url_source IS NOT NULL, STRUCT(url_source AS source, url_medium AS medium,
      url_campaign AS campaign), NULL) IGNORE NULLS
      ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS url_utm,
    ARRAY_AGG(cc_channel IGNORE NULLS ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)]
      AS default_channel,
    ARRAY_AGG(page_location IGNORE NULLS ORDER BY event_timestamp,
      COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0) LIMIT 1)[SAFE_OFFSET(0)]
      AS first_location,
    ARRAY_AGG(device_category IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)]
      AS device_category,
    LOGICAL_OR(ct_gclid IS NOT NULL
      OR REGEXP_CONTAINS(COALESCE(page_location, ''), r'[?&](gclid|gbraid|wbraid)=')) AS has_gclid,
    LOGICAL_OR(test_url) AS test_url, LOGICAL_OR(test_campaign) AS test_campaign,
    LOGICAL_OR(test_source_medium) AS test_source_medium,
    ARRAY_AGG(REGEXP_EXTRACT(page_location, r'[?&#]vvp=([^&#]*)') IGNORE NULLS
      ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS vvp_label,
    CASE MAX(CASE class WHEN 'automated' THEN 4 WHEN 'declared_agent' THEN 3
      WHEN 'suspicious' THEN 2 WHEN 'human' THEN 1 ELSE 0 END)
      WHEN 4 THEN 'automated' WHEN 3 THEN 'declared_agent'
      WHEN 2 THEN 'suspicious' WHEN 1 THEN 'human' ELSE 'unknown' END AS class,
    CASE WHEN COUNT(DISTINCT agent) > 1 THEN 'mixed' ELSE MAX(agent) END AS agent_operator,
    COUNTIF(class IS NOT NULL) > 0 AS has_class,
    COUNTIF(class IS NOT NULL) AS hits_with_class,
    COUNT(*) AS hits, COUNTIF(event_name = 'page_view') AS pageviews,
    LOGICAL_OR(COALESCE(session_engaged, 0) = 1) AS engaged,
    SUM(COALESCE(engagement_ms, 0)) AS engagement_ms,
    COUNTIF(event_name = 'purchase') AS purchases,
    COUNT(DISTINCT IF(event_name = 'purchase', NULLIF(TRIM(transaction_id), ''), NULL))
      AS unique_transactions,
    SUM(IF(event_name = 'purchase', COALESCE(purchase_revenue, 0), 0)) AS purchase_revenue,
    COUNTIF(event_name = 'generate_lead') AS leads,
    COUNTIF(is_key_event) AS other_key_events
  FROM hits GROUP BY site, user_pseudo_id, ga_session_id
), sessions AS (
  SELECT site, session_date, unit_type, unit_key, 1 AS units,
    IF(test_url OR test_campaign OR test_source_medium, 'test', 'real') AS traffic_scope,
    CASE WHEN test_url THEN 'vvp' WHEN test_campaign THEN 'test_campaign'
      WHEN test_source_medium THEN 'test_source_medium' END AS test_reason,
    vvp_label,
    COALESCE(last_click.source, collected.source, url_utm.source, '(none)') AS source,
    COALESCE(CASE WHEN last_click.source IS NOT NULL THEN last_click.medium
      WHEN collected.source IS NOT NULL THEN collected.medium ELSE url_utm.medium END, '(none)') AS medium,
    COALESCE(CASE WHEN last_click.source IS NOT NULL THEN last_click.campaign
      WHEN collected.source IS NOT NULL THEN collected.campaign ELSE url_utm.campaign END, '(none)') AS campaign,
    CASE WHEN last_click.source IS NOT NULL THEN 'last_click'
      WHEN collected.source IS NOT NULL THEN 'collected'
      WHEN url_utm.source IS NOT NULL THEN 'url_utm' ELSE 'unknown' END AS source_basis,
    COALESCE(default_channel, '(unknown)') AS default_channel,
    has_gclid, COALESCE(device_category, '(unknown)') AS device_category,
    COALESCE(NULLIF(REGEXP_EXTRACT(first_location, r'^https?://[^/?#]+([^?#]*)'), ''), '/')
      AS landing_page,
    class,
    CASE class WHEN 'human' THEN 'no automation detected' WHEN 'declared_agent' THEN 'agent'
      WHEN 'automated' THEN 'automation' WHEN 'suspicious' THEN 'uncertain'
      ELSE 'unknown' END AS class_group,
    class IN ('automated', 'declared_agent', 'suspicious') AS is_labelled_non_human,
    agent_operator, has_class, FALSE AS is_pending, hits_with_class, hits, pageviews,
    engaged, engagement_ms, purchases, unique_transactions, purchase_revenue, leads,
    other_key_events
  FROM units
)
SELECT * FROM sessions;

-- ============================================================================
-- Query B: server collector classification (vv_type, vv_detail) per unit.
-- unit_type: session; ping_page = denied cookieless pings of one page, grouped by
-- (event_date, batch_page_id) after checking batch_page_id with
-- session-classification.sql Query 0 (set group_pings_by_page = FALSE if it is
-- missing or a small counter); unjoinable_event = one row per remaining hit.
-- Ping units can duplicate later full events of a visitor who consents on the
-- same page: filter unit_type = 'session' for session metrics, never add them up.
WITH params AS (
  SELECT
    TRUE AS group_pings_by_page,
    r'[?&#]vvp=' AS test_url_regex,
    r'^(test|qa|e2e|canary)[-_]' AS test_campaign_regex,
    r'^(test|qa)$' AS test_source_regex,
    r'^(test|qa)$' AS test_medium_regex,
    r'^(click_mail|click_tel|form_submit|sign_up)$' AS key_events_regex
), src AS (
  SELECT 'site' AS site, event_date, event_timestamp, event_name, user_pseudo_id,
    event_params, batch_page_id, batch_ordering_id, batch_event_index,
    privacy_info.analytics_storage AS analytics_storage,
    ecommerce.purchase_revenue AS purchase_revenue, ecommerce.transaction_id AS transaction_id,
    device.category AS device_category,
    session_traffic_source_last_click AS ts, collected_traffic_source AS ct
  FROM `your-project.analytics_123456789.events_*`
  WHERE _TABLE_SUFFIX BETWEEN @DS_START_DATE AND @DS_END_DATE
    AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^\d{8}$') AND platform = 'WEB'
), ev AS (
  SELECT s.* EXCEPT (ts, ct),
    ts.cross_channel_campaign.source AS cc_source, ts.cross_channel_campaign.medium AS cc_medium,
    ts.cross_channel_campaign.campaign_name AS cc_campaign,
    ts.cross_channel_campaign.default_channel_group AS cc_channel,
    ts.manual_campaign.source AS mc_source, ts.manual_campaign.medium AS mc_medium,
    ts.manual_campaign.campaign_name AS mc_campaign, ct.manual_source AS ct_source,
    ct.manual_medium AS ct_medium, ct.manual_campaign_name AS ct_campaign, ct.gclid AS ct_gclid,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
      FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) AS ga_session_id,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'page_location' LIMIT 1) AS page_location,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
      FROM UNNEST(event_params) WHERE key = 'session_engaged' LIMIT 1) AS session_engaged,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
      FROM UNNEST(event_params) WHERE key = 'engagement_time_msec' LIMIT 1) AS engagement_ms,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'vv_type' LIMIT 1) AS type_raw,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'vv_detail' LIMIT 1) AS detail_raw
  FROM src s
), parsed AS (
  SELECT ev.*,
    CASE type_raw WHEN 'pending' THEN 0 WHEN 'human' THEN 1 WHEN 'bot_suspicious' THEN 2
      WHEN 'agent_unverified' THEN 3 WHEN 'bot_automation' THEN 4
      WHEN 'crawler_verified' THEN 5 WHEN 'agent_verified' THEN 5
      WHEN 'bot_spoofed' THEN 6 END AS type_rank,
    IF(LENGTH(detail_raw) <= 100 AND ARRAY_LENGTH(SPLIT(detail_raw, '|')) = 6,
      SPLIT(detail_raw, '|'), NULL) AS parts,
    CASE
      WHEN user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
        AND COALESCE(analytics_storage, 'Unset') != 'No' THEN 'session'
      WHEN p.group_pings_by_page AND user_pseudo_id IS NULL
        AND analytics_storage = 'No' AND batch_page_id IS NOT NULL THEN 'ping_page'
      ELSE 'unjoinable_event' END AS unit_type
  FROM ev CROSS JOIN params p
), hits AS (
  SELECT parsed.*,
    IF(type_rank IS NOT NULL, type_raw, NULL) AS vv_type,
    NULLIF(NULLIF(parts[SAFE_OFFSET(0)], 'none'), '-') AS operator,
    IF(parts[SAFE_OFFSET(1)] IN ('signature_valid', 'ip_match'), TRUE, FALSE) AS verified_hit,
    CASE unit_type
      WHEN 'session' THEN FORMAT('s|%s|%s|%d', site, user_pseudo_id, ga_session_id)
      WHEN 'ping_page' THEN FORMAT('p|%s|%s|%d', site, event_date, batch_page_id)
      ELSE FORMAT('e|%s', GENERATE_UUID()) END AS raw_key,
    REGEXP_EXTRACT(page_location, r'[?&]utm_source=([^&#]*)') AS url_source,
    REGEXP_EXTRACT(page_location, r'[?&]utm_medium=([^&#]*)') AS url_medium,
    REGEXP_EXTRACT(page_location, r'[?&]utm_campaign=([^&#]*)') AS url_campaign,
    REGEXP_CONTAINS(COALESCE(page_location, ''), p.test_url_regex) AS test_url,
    EXISTS(SELECT 1 FROM UNNEST([cc_campaign, mc_campaign, ct_campaign,
      REGEXP_EXTRACT(page_location, r'[?&]utm_campaign=([^&#]*)')]) c
      WHERE REGEXP_CONTAINS(LOWER(c), p.test_campaign_regex)) AS test_campaign,
    EXISTS(SELECT 1 FROM UNNEST([cc_source, mc_source, ct_source,
      REGEXP_EXTRACT(page_location, r'[?&]utm_source=([^&#]*)')]) c
      WHERE REGEXP_CONTAINS(LOWER(c), p.test_source_regex))
    OR EXISTS(SELECT 1 FROM UNNEST([cc_medium, mc_medium, ct_medium,
      REGEXP_EXTRACT(page_location, r'[?&]utm_medium=([^&#]*)')]) c
      WHERE REGEXP_CONTAINS(LOWER(c), p.test_medium_regex)) AS test_source_medium,
    REGEXP_CONTAINS(event_name, p.key_events_regex) AS is_key_event
  FROM parsed CROSS JOIN params p
), units AS (
  SELECT site, unit_type, SUBSTR(TO_HEX(SHA256(raw_key)), 1, 16) AS unit_key,
    PARSE_DATE('%Y%m%d', MIN(event_date)) AS session_date,
    ARRAY_AGG(IF(COALESCE(cc_source, mc_source) IS NOT NULL, STRUCT(
      COALESCE(cc_source, mc_source) AS source, COALESCE(cc_medium, mc_medium) AS medium,
      COALESCE(cc_campaign, mc_campaign) AS campaign), NULL) IGNORE NULLS
      ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS last_click,
    ARRAY_AGG(IF(ct_source IS NOT NULL, STRUCT(ct_source AS source, ct_medium AS medium,
      ct_campaign AS campaign), NULL) IGNORE NULLS
      ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS collected,
    ARRAY_AGG(IF(url_source IS NOT NULL, STRUCT(url_source AS source, url_medium AS medium,
      url_campaign AS campaign), NULL) IGNORE NULLS
      ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS url_utm,
    ARRAY_AGG(cc_channel IGNORE NULLS ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)]
      AS default_channel,
    ARRAY_AGG(page_location IGNORE NULLS ORDER BY event_timestamp,
      COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0) LIMIT 1)[SAFE_OFFSET(0)]
      AS first_location,
    ARRAY_AGG(device_category IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)]
      AS device_category,
    LOGICAL_OR(ct_gclid IS NOT NULL
      OR REGEXP_CONTAINS(COALESCE(page_location, ''), r'[?&](gclid|gbraid|wbraid)=')) AS has_gclid,
    LOGICAL_OR(test_url) AS test_url, LOGICAL_OR(test_campaign) AS test_campaign,
    LOGICAL_OR(test_source_medium) AS test_source_medium,
    ARRAY_AGG(REGEXP_EXTRACT(page_location, r'[?&#]vvp=([^&#]*)') IGNORE NULLS
      ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS vvp_label,
    ARRAY_AGG(vv_type IGNORE NULLS ORDER BY type_rank DESC, event_timestamp,
      COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0), vv_type
      LIMIT 1)[SAFE_OFFSET(0)] AS vv_type,
    CASE WHEN COUNT(DISTINCT operator) > 1 THEN 'mixed' ELSE MAX(operator) END AS agent_operator,
    CASE WHEN COUNT(DISTINCT IF(verified_hit, operator, NULL)) > 1 THEN 'mixed'
      ELSE MAX(IF(verified_hit, operator, NULL)) END AS verified_operator,
    COUNTIF(vv_type IS NOT NULL) AS hits_with_class,
    COUNTIF(vv_type = 'pending') > 0 AS any_pending,
    COUNT(*) AS hits, COUNTIF(event_name = 'page_view') AS pageviews,
    LOGICAL_OR(COALESCE(session_engaged, 0) = 1) AS engaged,
    SUM(COALESCE(engagement_ms, 0)) AS engagement_ms,
    COUNTIF(event_name = 'purchase') AS purchases,
    COUNT(DISTINCT IF(event_name = 'purchase', NULLIF(TRIM(transaction_id), ''), NULL))
      AS unique_transactions,
    SUM(IF(event_name = 'purchase', COALESCE(purchase_revenue, 0), 0)) AS purchase_revenue,
    COUNTIF(event_name = 'generate_lead') AS leads,
    COUNTIF(is_key_event) AS other_key_events
  FROM hits GROUP BY site, unit_type, raw_key
), sessions AS (
  SELECT site, session_date, unit_type, unit_key, 1 AS units,
    IF(test_url OR test_campaign OR test_source_medium, 'test', 'real') AS traffic_scope,
    CASE WHEN test_url THEN 'vvp' WHEN test_campaign THEN 'test_campaign'
      WHEN test_source_medium THEN 'test_source_medium' END AS test_reason,
    vvp_label,
    COALESCE(last_click.source, collected.source, url_utm.source, '(none)') AS source,
    COALESCE(CASE WHEN last_click.source IS NOT NULL THEN last_click.medium
      WHEN collected.source IS NOT NULL THEN collected.medium ELSE url_utm.medium END, '(none)') AS medium,
    COALESCE(CASE WHEN last_click.source IS NOT NULL THEN last_click.campaign
      WHEN collected.source IS NOT NULL THEN collected.campaign ELSE url_utm.campaign END, '(none)') AS campaign,
    CASE WHEN last_click.source IS NOT NULL THEN 'last_click'
      WHEN collected.source IS NOT NULL THEN 'collected'
      WHEN url_utm.source IS NOT NULL THEN 'url_utm' ELSE 'unknown' END AS source_basis,
    COALESCE(default_channel, '(unknown)') AS default_channel,
    has_gclid, COALESCE(device_category, '(unknown)') AS device_category,
    COALESCE(NULLIF(REGEXP_EXTRACT(first_location, r'^https?://[^/?#]+([^?#]*)'), ''), '/')
      AS landing_page,
    COALESCE(vv_type, 'missing') AS class,
    CASE WHEN vv_type = 'human' THEN 'no automation detected'
      WHEN vv_type LIKE 'agent_%' THEN 'agent' WHEN vv_type = 'crawler_verified' THEN 'crawler'
      WHEN vv_type = 'bot_suspicious' THEN 'uncertain' WHEN vv_type LIKE 'bot_%' THEN 'automation'
      WHEN vv_type = 'pending' THEN 'pending' ELSE 'unknown' END AS class_group,
    COALESCE(vv_type NOT IN ('human', 'pending'), FALSE) AS is_labelled_non_human,
    agent_operator, verified_operator,
    vv_type IS NOT NULL AND vv_type != 'pending' AS has_class,
    COALESCE(vv_type = 'pending', FALSE) AS is_pending, any_pending, hits_with_class, hits, pageviews,
    engaged, engagement_ms, purchases, unique_transactions, purchase_revenue, leads,
    other_key_events
  FROM units
)
SELECT * FROM sessions;

-- ============================================================================
-- Rollup outside Looker Studio: replace the final `SELECT * FROM sessions;` of
-- Query A or B with the SELECT below. One row per site × scope × unit type ×
-- dimension value × class; share_* = share of that dimension value's total.
-- Never add rows of different `dimension` values together (each repeats all units).
--
-- SELECT site, traffic_scope, unit_type, d.dimension, d.value, class_group, class,
--   SUM(units) AS units, COUNTIF(engaged) AS engaged_units,
--   COUNTIF(has_class) AS units_with_class, COUNTIF(is_pending) AS pending_units,
--   SUM(purchases) AS purchases, COUNTIF(purchases > 0) AS purchasing_units,
--   SUM(unique_transactions) AS unique_transactions,
--   ROUND(SUM(purchase_revenue), 2) AS purchase_revenue,
--   SUM(leads) AS leads, COUNTIF(leads > 0) AS lead_units,
--   SUM(other_key_events) AS other_key_events,
--   ROUND(SAFE_DIVIDE(SUM(units), SUM(SUM(units)) OVER w), 4) AS share_of_units,
--   ROUND(SAFE_DIVIDE(SUM(purchases), SUM(SUM(purchases)) OVER w), 4) AS share_of_purchases,
--   ROUND(SAFE_DIVIDE(SUM(purchase_revenue), SUM(SUM(purchase_revenue)) OVER w), 4) AS share_of_revenue,
--   ROUND(SAFE_DIVIDE(SUM(leads), SUM(SUM(leads)) OVER w), 4) AS share_of_leads
-- FROM sessions, UNNEST([
--   STRUCT('total' AS dimension, '(all)' AS value),
--   STRUCT('campaign', FORMAT('%s / %s / %s', source, medium, campaign)),
--   STRUCT('channel', default_channel),
--   STRUCT('landing_page', landing_page)]) d
-- GROUP BY site, traffic_scope, unit_type, d.dimension, d.value, class_group, class
-- WINDOW w AS (PARTITION BY site, traffic_scope, unit_type, d.dimension, d.value)
-- ORDER BY site, traffic_scope, unit_type, d.dimension, d.value, units DESC;
