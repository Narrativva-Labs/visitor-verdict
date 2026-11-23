-- Campaign dashboard: AI agents and bots in campaigns.
-- GoogleSQL SELECT queries over the GA4 BigQuery export. No scripting, temporary
-- objects or writes: each query runs with a read-only role and can be pasted as a
-- Looker Studio BigQuery custom query.
--
-- Query A:  browser/GTM integration (event parameters traffic_class, traffic_agent,
--           traffic_agent_claim), ONE ROW PER SESSION.
-- Query B:  server collector integration (event parameters vv_type, vv_detail),
--           ONE ROW PER SESSION ONLY (denied cookieless pings are NOT mixed in,
--           preventing double-counted revenue after consent).
-- Query B2: server collector denied cookieless pings & unjoinable hits, SEPARATE
--           diagnostic query (never add its rows or revenue to Query B).
-- Rollup template at the end.
--
-- Parameters (edit in each query's params / src CTEs)
--   `your-project.analytics_123456789`  export dataset, once per src block.
--   '1234567890'                         REQUIRED: one GA4 web stream_id per src block.
--   'site'                               a free label for the property.
--   property_timezone                    property timezone for session_date (e.g. 'Europe/Prague').
--   @DS_START_DATE / @DS_END_DATE        STRING 'YYYYMMDD', inclusive. Looker Studio
--       fills them when "Enable date range parameters" is ticked on the data source;
--       bq CLI: --parameter=DS_START_DATE::20261101 --parameter=DS_END_DATE::20261114.
--       Without either, replace them with fixed strings or a rolling window, e.g.
--       FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)).
--       Queries A and B scan +/- 1 day padding around the range to recover
--       midnight-crossing sessions, then filter session_date to the exact range.
--   Test-traffic regexes in the params CTE (edit them to your own conventions).
--       NOTE for Query B / B2 (Vanilla collector): Vanilla strips query strings
--       (including ?vvp=) from page_location before forwarding, so mark Vanilla
--       test runs via utm_campaign=test_... (or qa_/e2e_/canary_) or test source/medium.
--   key_events_regex: events counted as "other key events". The export has no
--       key-event flag, so list the property's key events other than purchase and
--       generate_lead here.
--
-- Several properties in one data source: UNION ALL one src block per property, each
-- with its own site label and stream_id filter. UNION ALL needs the same types in
-- every block; if traffic-source structs differ between properties, select their
-- fields explicitly.
--
-- Semantics
--   * Session = (site, stream_id, user_pseudo_id, ga_session_id); never coalesced
--     or invented. Query A drops events without both IDs (count them with
--     bigquery.sql F2). Query B returns joinable sessions only; Query B2 returns
--     denied-ping pages and unjoinable hits separately so pre-consent /d pings
--     never double-count post-consent /e sessions or revenue.
--   * Class = strongest observation over ALL hits of the unit, not the last one:
--     A: automated > declared_agent > suspicious > human (as bigquery.sql);
--     B: agent_verified = crawler_verified > automation_verified > bot_spoofed >
--        bot_automation > agent_unverified > bot_suspicious > human > pending
--        (legacy agent_verified/intermediary also ranks 4.75; equal rank
--        keeps the first observed).
--     No class observed = 'unknown' (A) / 'missing' (B); unknown is not human.
--   * Separated class_group values (no conflated "non-human/excluded" bucket):
--     - no automation detected: human
--     - agent_user:             user-directed AI agents (declared_agent excluding
--                               server_intermediary in A; agent_verified with purpose=user_directed and
--                               agent_unverified excluding purpose=intermediary in B).
--                               Note: browser-only ua_token declarations in A also
--                               include crawlers like GPTBot/CCBot/Applebot.
--     - agent_verified_unknown_purpose (B/B2): verified agent identity without
--                               a user_directed purpose (including Poppy/unknown).
--     - automation_verified:    verified automation platforms with unknown purpose
--                               (Browserbase, Kernel, Cloudflare Browser Run,
--                               Shopify Cloudsurf): traffic_agent_claim='server_intermediary'
--                               in A; vv_type='automation_verified' or legacy
--                               agent_verified with vv_detail purpose='intermediary' in B.
--     - automation:             browser automation / spoofed bots (automated in A;
--                               bot_automation, bot_spoofed, or unverified intermediary in B).
--     - crawler:                verified crawlers (crawler_verified in B).
--     - suspicious:             uncertain evidence (suspicious in A; bot_suspicious in B).
--     - pending (B only) / unknown.
--     Browser/GTM signature/IP echo claims lack purpose; A cannot distinguish
--     verified unknown-purpose agents. Use B/B2 for that distinction.
--   * Operators: accepts all valid operator slugs (not only openai/anthropic).
--   * Labels only: nothing is excluded. Test traffic is FLAGGED (traffic_scope,
--     test_reason), not dropped. Filter it in the report.
--   * Attribution: session_traffic_source_last_click (cross-channel, google_ads_campaign,
--     then manual), then first collected_traffic_source, then utm_* of the first
--     page_location. source_basis says which one was used.
--     Note: auto-tagged Google Ads clicks (gclid) on a Vanilla property not linked
--     to Google Ads fall into '(none)' (with has_gclid=TRUE) unless UTM parameters
--     are present (verify in live BigQuery export).
--   * has_gclid: gclid/gbraid/wbraid on any hit (collected source or URL).
--   * landing_page: path of the unit's first page_location (query and fragment
--     removed; paths can still contain personal data on some sites).
--   * Revenue & conversions: ecommerce.purchase_revenue_in_usd in USD
--     (matching bigquery.sql; USD is used even within a single property), deduplicated by non-empty ecommerce.transaction_id
--     within the scanned stream (the purchase_revenue output alias is USD).
--     Un-ID'd purchases are kept; raw hit count is in
--     purchase_events. Not refund-adjusted. Purchases and leads are ALWAYS kept
--     separate; never sum purchases + leads.
--   * Daily tables only (no intraday). GA4 rewrites daily tables for up to three days.
--   * GA4 drops traffic from known bots and spiders before export. Obvious bots
--     are therefore largely absent; the labels here describe what reached GA4.

-- ============================================================================
-- Query A: browser classification (traffic_class, traffic_agent, traffic_agent_claim)
-- per joinable session.
WITH params AS (
  SELECT
    'Europe/Prague' AS property_timezone,
    r'[?&#]vvp=' AS test_url_regex,
    r'^(test|qa|e2e|canary)[-_]' AS test_campaign_regex,
    r'^(test|qa)$' AS test_source_regex,
    r'^(test|qa)$' AS test_medium_regex,
    r'^(click_mail|click_tel|form_submit|sign_up)$' AS key_events_regex
), src AS (
  SELECT 'site' AS site, stream_id, event_date, event_timestamp, event_name, user_pseudo_id,
    event_params, batch_page_id, batch_ordering_id, batch_event_index,
    privacy_info.analytics_storage AS analytics_storage,
    ecommerce.purchase_revenue_in_usd AS purchase_revenue,
    NULLIF(TRIM(ecommerce.transaction_id), '') AS transaction_id,
    device.category AS device_category,
    session_traffic_source_last_click AS ts, collected_traffic_source AS ct
  FROM `your-project.analytics_123456789.events_*`
  WHERE _TABLE_SUFFIX BETWEEN
      FORMAT_DATE('%Y%m%d', DATE_SUB(PARSE_DATE('%Y%m%d', @DS_START_DATE), INTERVAL 1 DAY))
      AND FORMAT_DATE('%Y%m%d', DATE_ADD(PARSE_DATE('%Y%m%d', @DS_END_DATE), INTERVAL 1 DAY))
    AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^\d{8}$')
    AND platform = 'WEB'
    AND stream_id = '1234567890'
), ev AS (
  SELECT s.* EXCEPT (ts, ct),
    ts.cross_channel_campaign.source AS cc_source, ts.cross_channel_campaign.medium AS cc_medium,
    ts.cross_channel_campaign.campaign_name AS cc_campaign,
    ts.cross_channel_campaign.default_channel_group AS cc_channel,
    ts.google_ads_campaign.campaign_name AS gads_campaign,
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
      WHERE key = 'traffic_agent' LIMIT 1) AS agent_raw,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'traffic_agent_claim' LIMIT 1) AS claim_raw
  FROM src s
), hits AS (
  SELECT ev.*, p.property_timezone,
    IF(class_raw IN ('human', 'suspicious', 'automated', 'declared_agent'), class_raw, NULL) AS class,
    IF(REGEXP_CONTAINS(LOWER(TRIM(agent_raw)), r'^[a-z0-9][a-z0-9_-]{0,63}$')
       AND LOWER(TRIM(agent_raw)) NOT IN ('none', 'unknown', 'null', 'undefined'),
      LOWER(TRIM(agent_raw)), NULL) AS agent,
    IF(REGEXP_CONTAINS(LOWER(TRIM(claim_raw)), r'^[a-z][a-z0-9_]{0,63}$')
       AND LOWER(TRIM(claim_raw)) NOT IN ('none', 'unknown', 'null', 'undefined'),
      LOWER(TRIM(claim_raw)), NULL) AS agent_claim,
    ROW_NUMBER() OVER (
      PARTITION BY site, stream_id, IF(event_name = 'purchase', transaction_id, NULL)
      ORDER BY event_timestamp, COALESCE(batch_page_id, 0),
        COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0)
    ) AS tx_rn,
    REGEXP_EXTRACT(page_location, r'[?&]utm_source=([^&#]*)') AS url_source,
    REGEXP_EXTRACT(page_location, r'[?&]utm_medium=([^&#]*)') AS url_medium,
    REGEXP_EXTRACT(page_location, r'[?&]utm_campaign=([^&#]*)') AS url_campaign,
    REGEXP_CONTAINS(COALESCE(page_location, ''), p.test_url_regex) AS test_url,
    EXISTS(SELECT 1 FROM UNNEST([cc_campaign, gads_campaign, mc_campaign, ct_campaign,
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
  SELECT site, stream_id, 'session' AS unit_type,
    SUBSTR(TO_HEX(SHA256(FORMAT('%s|%s|%s|%d', site, stream_id, user_pseudo_id, ga_session_id))), 1, 16) AS unit_key,
    DATE(TIMESTAMP_SECONDS(ga_session_id), ANY_VALUE(property_timezone)) AS session_date,
    ARRAY_AGG(IF(COALESCE(cc_source, mc_source, gads_campaign) IS NOT NULL, STRUCT(
      COALESCE(cc_source, mc_source, IF(gads_campaign IS NOT NULL, 'google', NULL)) AS source,
      COALESCE(cc_medium, mc_medium, IF(gads_campaign IS NOT NULL, 'cpc', NULL)) AS medium,
      COALESCE(NULLIF(cc_campaign, '(not set)'), gads_campaign, mc_campaign) AS campaign), NULL) IGNORE NULLS
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
    COUNTIF(class = 'automated') > 0 AS any_automated,
    COUNTIF(agent_claim = 'server_intermediary') > 0 AS any_automation_verified,
    COUNTIF(class = 'declared_agent' AND COALESCE(agent_claim, '') != 'server_intermediary') > 0
      AS any_agent_user,
    COUNTIF(class = 'suspicious') > 0 AS any_suspicious,
    COUNTIF(agent_claim = 'dom_host') > 0 AS any_dom_host,
    CASE WHEN COUNT(DISTINCT IF(COALESCE(agent_claim, '') != 'server_intermediary', agent, NULL)) > 1
      THEN 'mixed'
      ELSE MAX(IF(COALESCE(agent_claim, '') != 'server_intermediary', agent, NULL)) END AS agent_operator,
    CASE WHEN COUNT(DISTINCT IF(agent_claim = 'server_intermediary', agent, NULL)) > 1
      THEN 'mixed'
      ELSE MAX(IF(agent_claim = 'server_intermediary', agent, NULL)) END AS automation_verified_operator,
    CASE WHEN COUNT(DISTINCT agent_claim) > 1 THEN 'mixed' ELSE MAX(agent_claim) END AS agent_claim,
    COUNTIF(class IS NOT NULL) > 0 AS has_class,
    COUNTIF(class IS NOT NULL) AS hits_with_class,
    COUNT(*) AS hits, COUNTIF(event_name = 'page_view') AS pageviews,
    LOGICAL_OR(COALESCE(session_engaged, 0) = 1) AS engaged,
    SUM(COALESCE(engagement_ms, 0)) AS engagement_ms,
    COUNTIF(event_name = 'purchase' AND (transaction_id IS NULL OR tx_rn = 1)) AS purchases,
    COUNTIF(event_name = 'purchase') AS purchase_events,
    COUNT(DISTINCT IF(event_name = 'purchase' AND tx_rn = 1, transaction_id, NULL)) AS unique_transactions,
    SUM(IF(event_name = 'purchase' AND (transaction_id IS NULL OR tx_rn = 1),
      COALESCE(purchase_revenue, 0), 0)) AS purchase_revenue,
    COUNTIF(event_name = 'generate_lead') AS leads,
    COUNTIF(is_key_event) AS other_key_events
  FROM hits GROUP BY site, stream_id, user_pseudo_id, ga_session_id
), classified AS (
  SELECT *,
    CASE
      WHEN any_automated THEN 'automation'
      WHEN any_automation_verified THEN 'automation_verified'
      WHEN any_agent_user THEN 'agent_user'
      WHEN any_suspicious THEN 'suspicious'
      WHEN class = 'human' THEN 'no automation detected'
      ELSE 'unknown' END AS class_group
  FROM units
  WHERE session_date BETWEEN PARSE_DATE('%Y%m%d', @DS_START_DATE)
    AND PARSE_DATE('%Y%m%d', @DS_END_DATE)
), sessions AS (
  SELECT site, stream_id, session_date, unit_type, unit_key, 1 AS units,
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
    class, class_group,
    class_group = 'agent_user' AS is_agent_user,
    class_group = 'automation_verified' AS is_automation_verified,
    class_group = 'automation' AS is_automation,
    FALSE AS is_crawler,
    class_group = 'suspicious' AS is_suspicious,
    agent_operator, automation_verified_operator, agent_claim, any_dom_host,
    has_class, FALSE AS is_pending, hits_with_class, hits, pageviews,
    engaged, engagement_ms, purchases, purchase_events, unique_transactions, purchase_revenue,
    leads, other_key_events
  FROM classified
)
SELECT * FROM sessions;

-- ============================================================================
-- Query B: server collector classification (vv_type, vv_detail) — SESSIONS ONLY.
-- Denied cookieless pings (/d) are excluded here and reported separately by
-- Query B2 below so visitors who consent after a /d ping never double-count
-- sessions or revenue.
-- Test traffic in Vanilla: Vanilla strips ?vvp= from page_location, so mark
-- test runs with utm_campaign=test_... (or qa_/e2e_/canary_) or test source/medium.
WITH params AS (
  SELECT
    'Europe/Prague' AS property_timezone,
    r'^(test|qa|e2e|canary)[-_]' AS test_campaign_regex,
    r'^(test|qa)$' AS test_source_regex,
    r'^(test|qa)$' AS test_medium_regex,
    r'^(click_mail|click_tel|form_submit|sign_up)$' AS key_events_regex
), src AS (
  SELECT 'site' AS site, stream_id, event_date, event_timestamp, event_name, user_pseudo_id,
    event_params, batch_page_id, batch_ordering_id, batch_event_index,
    privacy_info.analytics_storage AS analytics_storage,
    ecommerce.purchase_revenue_in_usd AS purchase_revenue,
    NULLIF(TRIM(ecommerce.transaction_id), '') AS transaction_id,
    device.category AS device_category,
    session_traffic_source_last_click AS ts, collected_traffic_source AS ct
  FROM `your-project.analytics_123456789.events_*`
  WHERE _TABLE_SUFFIX BETWEEN
      FORMAT_DATE('%Y%m%d', DATE_SUB(PARSE_DATE('%Y%m%d', @DS_START_DATE), INTERVAL 1 DAY))
      AND FORMAT_DATE('%Y%m%d', DATE_ADD(PARSE_DATE('%Y%m%d', @DS_END_DATE), INTERVAL 1 DAY))
    AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^\d{8}$')
    AND platform = 'WEB'
    AND stream_id = '1234567890'
), ev AS (
  SELECT s.* EXCEPT (ts, ct),
    ts.cross_channel_campaign.source AS cc_source, ts.cross_channel_campaign.medium AS cc_medium,
    ts.cross_channel_campaign.campaign_name AS cc_campaign,
    ts.cross_channel_campaign.default_channel_group AS cc_channel,
    ts.google_ads_campaign.campaign_name AS gads_campaign,
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
  SELECT ev.*, p.property_timezone,
    -- Server precedence: spoofed 4.5 < intermediary 4.75 < agent/crawler 5.
    -- Legacy agent_verified/intermediary has the infrastructure rank too.
    CASE type_raw
      WHEN 'pending' THEN 0
      WHEN 'human' THEN 1
      WHEN 'bot_suspicious' THEN 2
      WHEN 'agent_unverified' THEN 3
      WHEN 'bot_automation' THEN 4
      WHEN 'bot_spoofed' THEN 4.5
      WHEN 'automation_verified' THEN 4.75
      WHEN 'crawler_verified' THEN 5
      WHEN 'agent_verified' THEN
        IF(LENGTH(detail_raw) <= 100 AND ARRAY_LENGTH(SPLIT(detail_raw, '|')) = 6
          AND LOWER(TRIM(SPLIT(detail_raw, '|')[SAFE_OFFSET(2)])) = 'intermediary', 4.75, 5)
    END AS type_rank,
    IF(LENGTH(detail_raw) <= 100 AND ARRAY_LENGTH(SPLIT(detail_raw, '|')) = 6,
      SPLIT(detail_raw, '|'), NULL) AS parts
  FROM ev CROSS JOIN params p
  WHERE user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
    AND COALESCE(analytics_storage, 'Unset') != 'No'
), hits AS (
  SELECT parsed.*,
    IF(type_rank IS NOT NULL, type_raw, NULL) AS vv_type,
    IF(REGEXP_CONTAINS(LOWER(TRIM(parts[SAFE_OFFSET(0)])), r'^[a-z0-9][a-z0-9_-]{0,63}$')
       AND LOWER(TRIM(parts[SAFE_OFFSET(0)])) NOT IN ('none', 'unknown', 'null'),
      LOWER(TRIM(parts[SAFE_OFFSET(0)])), NULL) AS operator,
    IF(parts[SAFE_OFFSET(1)] IN ('signature_valid', 'ip_match'), TRUE, FALSE) AS verified_hit,
    NULLIF(NULLIF(LOWER(TRIM(parts[SAFE_OFFSET(2)])), 'none'), '-') AS vv_purpose,
    ROW_NUMBER() OVER (
      PARTITION BY site, stream_id, IF(event_name = 'purchase', transaction_id, NULL)
      ORDER BY event_timestamp, COALESCE(batch_page_id, 0),
        COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0)
    ) AS tx_rn,
    REGEXP_EXTRACT(page_location, r'[?&]utm_source=([^&#]*)') AS url_source,
    REGEXP_EXTRACT(page_location, r'[?&]utm_medium=([^&#]*)') AS url_medium,
    REGEXP_EXTRACT(page_location, r'[?&]utm_campaign=([^&#]*)') AS url_campaign,
    EXISTS(SELECT 1 FROM UNNEST([cc_campaign, gads_campaign, mc_campaign, ct_campaign,
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
  SELECT site, stream_id, 'session' AS unit_type,
    SUBSTR(TO_HEX(SHA256(FORMAT('s|%s|%s|%s|%d', site, stream_id, user_pseudo_id, ga_session_id))), 1, 16)
      AS unit_key,
    DATE(TIMESTAMP_SECONDS(ga_session_id), ANY_VALUE(property_timezone)) AS session_date,
    ARRAY_AGG(IF(COALESCE(cc_source, mc_source, gads_campaign) IS NOT NULL, STRUCT(
      COALESCE(cc_source, mc_source, IF(gads_campaign IS NOT NULL, 'google', NULL)) AS source,
      COALESCE(cc_medium, mc_medium, IF(gads_campaign IS NOT NULL, 'cpc', NULL)) AS medium,
      COALESCE(NULLIF(cc_campaign, '(not set)'), gads_campaign, mc_campaign) AS campaign), NULL) IGNORE NULLS
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
    LOGICAL_OR(test_campaign) AS test_campaign,
    LOGICAL_OR(test_source_medium) AS test_source_medium,
    ARRAY_AGG(IF(vv_type IS NOT NULL, STRUCT(vv_type, vv_purpose), NULL) IGNORE NULLS
      ORDER BY type_rank DESC, event_timestamp,
        COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0), vv_type
      LIMIT 1)[SAFE_OFFSET(0)] AS winning_label,
    CASE WHEN COUNT(DISTINCT operator) > 1 THEN 'mixed' ELSE MAX(operator) END AS agent_operator,
    CASE WHEN COUNT(DISTINCT IF(verified_hit, operator, NULL)) > 1 THEN 'mixed'
      ELSE MAX(IF(verified_hit, operator, NULL)) END AS verified_operator,
    COUNTIF(vv_type IS NOT NULL) AS hits_with_class,
    COUNTIF(vv_type = 'pending') > 0 AS any_pending,
    COUNT(*) AS hits, COUNTIF(event_name = 'page_view') AS pageviews,
    LOGICAL_OR(COALESCE(session_engaged, 0) = 1) AS engaged,
    SUM(COALESCE(engagement_ms, 0)) AS engagement_ms,
    COUNTIF(event_name = 'purchase' AND (transaction_id IS NULL OR tx_rn = 1)) AS purchases,
    COUNTIF(event_name = 'purchase') AS purchase_events,
    COUNT(DISTINCT IF(event_name = 'purchase' AND tx_rn = 1, transaction_id, NULL)) AS unique_transactions,
    SUM(IF(event_name = 'purchase' AND (transaction_id IS NULL OR tx_rn = 1),
      COALESCE(purchase_revenue, 0), 0)) AS purchase_revenue,
    COUNTIF(event_name = 'generate_lead') AS leads,
    COUNTIF(is_key_event) AS other_key_events
  FROM hits GROUP BY site, stream_id, user_pseudo_id, ga_session_id
), classified AS (
  SELECT *,
    COALESCE(
      IF(winning_label.vv_type = 'agent_verified' AND winning_label.vv_purpose = 'intermediary',
        'automation_verified', winning_label.vv_type),
      'missing') AS class,
    COALESCE(winning_label.vv_type, 'missing') AS vv_type_raw,
    winning_label.vv_purpose AS vv_purpose,
    CASE
      WHEN winning_label.vv_type = 'human' THEN 'no automation detected'
      WHEN winning_label.vv_type = 'automation_verified'
        OR (winning_label.vv_type = 'agent_verified' AND winning_label.vv_purpose = 'intermediary')
        THEN 'automation_verified'
      WHEN winning_label.vv_type = 'agent_unverified' AND winning_label.vv_purpose = 'intermediary'
        THEN 'automation'
      WHEN winning_label.vv_type = 'agent_verified' AND winning_label.vv_purpose = 'user_directed'
        THEN 'agent_user'
      WHEN winning_label.vv_type = 'agent_verified' THEN 'agent_verified_unknown_purpose'
      WHEN winning_label.vv_type = 'agent_unverified' THEN 'agent_user'
      WHEN winning_label.vv_type = 'crawler_verified' THEN 'crawler'
      WHEN winning_label.vv_type IN ('bot_automation', 'bot_spoofed') THEN 'automation'
      WHEN winning_label.vv_type = 'bot_suspicious' THEN 'suspicious'
      WHEN winning_label.vv_type = 'pending' THEN 'pending'
      ELSE 'unknown' END AS class_group
  FROM units
  WHERE session_date BETWEEN PARSE_DATE('%Y%m%d', @DS_START_DATE)
    AND PARSE_DATE('%Y%m%d', @DS_END_DATE)
), sessions AS (
  SELECT site, stream_id, session_date, unit_type, unit_key, 1 AS units,
    IF(test_campaign OR test_source_medium, 'test', 'real') AS traffic_scope,
    CASE WHEN test_campaign THEN 'test_campaign'
      WHEN test_source_medium THEN 'test_source_medium' END AS test_reason,
    CAST(NULL AS STRING) AS vvp_label,
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
    class, vv_type_raw, vv_purpose, class_group,
    class_group = 'agent_user' AS is_agent_user,
    class_group = 'automation_verified' AS is_automation_verified,
    class_group = 'automation' AS is_automation,
    class_group = 'crawler' AS is_crawler,
    class_group = 'agent_verified_unknown_purpose' AS is_agent_verified_unknown_purpose,
    class_group = 'suspicious' AS is_suspicious,
    agent_operator, verified_operator,
    winning_label.vv_type IS NOT NULL AND winning_label.vv_type != 'pending' AS has_class,
    COALESCE(winning_label.vv_type = 'pending', FALSE) AS is_pending, any_pending,
    hits_with_class, hits, pageviews,
    engaged, engagement_ms, purchases, purchase_events, unique_transactions, purchase_revenue,
    leads, other_key_events
  FROM classified
)
SELECT * FROM sessions;

-- ============================================================================
-- Query B2: server collector denied cookieless pings (/d) and unjoinable hits.
-- SEPARATE diagnostic data source: NEVER union or sum with Query B sessions!
-- A visitor who initially sends a /d ping and then consents sends /e hits in
-- Query B; summing B and B2 would double-count visits and revenue.
-- Set group_pings_by_page = FALSE if batch_page_id is missing or a small counter
-- in your property (verify in the Vanilla Server-Side session-classification check).
WITH params AS (
  SELECT
    TRUE AS group_pings_by_page,
    r'^(test|qa|e2e|canary)[-_]' AS test_campaign_regex,
    r'^(test|qa)$' AS test_source_regex,
    r'^(test|qa)$' AS test_medium_regex,
    r'^(click_mail|click_tel|form_submit|sign_up)$' AS key_events_regex
), src AS (
  SELECT 'site' AS site, stream_id, event_date, event_timestamp, event_name, user_pseudo_id,
    event_params, batch_page_id, batch_ordering_id, batch_event_index,
    privacy_info.analytics_storage AS analytics_storage,
    ecommerce.purchase_revenue_in_usd AS purchase_revenue,
    NULLIF(TRIM(ecommerce.transaction_id), '') AS transaction_id,
    device.category AS device_category,
    session_traffic_source_last_click AS ts, collected_traffic_source AS ct
  FROM `your-project.analytics_123456789.events_*`
  WHERE _TABLE_SUFFIX BETWEEN @DS_START_DATE AND @DS_END_DATE
    AND REGEXP_CONTAINS(_TABLE_SUFFIX, r'^\d{8}$')
    AND platform = 'WEB'
    AND stream_id = '1234567890'
), ev AS (
  SELECT s.* EXCEPT (ts, ct),
    ts.cross_channel_campaign.source AS cc_source, ts.cross_channel_campaign.medium AS cc_medium,
    ts.cross_channel_campaign.campaign_name AS cc_campaign,
    ts.cross_channel_campaign.default_channel_group AS cc_channel,
    ts.google_ads_campaign.campaign_name AS gads_campaign,
    ts.manual_campaign.source AS mc_source, ts.manual_campaign.medium AS mc_medium,
    ts.manual_campaign.campaign_name AS mc_campaign, ct.manual_source AS ct_source,
    ct.manual_medium AS ct_medium, ct.manual_campaign_name AS ct_campaign, ct.gclid AS ct_gclid,
    (SELECT COALESCE(value.int_value, SAFE_CAST(value.string_value AS INT64))
      FROM UNNEST(event_params) WHERE key = 'ga_session_id' LIMIT 1) AS ga_session_id,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'page_location' LIMIT 1) AS page_location,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'vv_type' LIMIT 1) AS type_raw,
    (SELECT value.string_value FROM UNNEST(event_params)
      WHERE key = 'vv_detail' LIMIT 1) AS detail_raw
  FROM src s
), parsed AS (
  SELECT ev.*,
    CASE type_raw
      WHEN 'pending' THEN 0
      WHEN 'human' THEN 1
      WHEN 'bot_suspicious' THEN 2
      WHEN 'agent_unverified' THEN 3
      WHEN 'bot_automation' THEN 4
      WHEN 'bot_spoofed' THEN 4.5
      WHEN 'automation_verified' THEN 4.75
      WHEN 'crawler_verified' THEN 5
      WHEN 'agent_verified' THEN
        IF(LENGTH(detail_raw) <= 100 AND ARRAY_LENGTH(SPLIT(detail_raw, '|')) = 6
          AND LOWER(TRIM(SPLIT(detail_raw, '|')[SAFE_OFFSET(2)])) = 'intermediary', 4.75, 5)
    END AS type_rank,
    IF(LENGTH(detail_raw) <= 100 AND ARRAY_LENGTH(SPLIT(detail_raw, '|')) = 6,
      SPLIT(detail_raw, '|'), NULL) AS parts,
    CASE
      WHEN p.group_pings_by_page AND user_pseudo_id IS NULL
        AND analytics_storage = 'No' AND batch_page_id IS NOT NULL THEN 'ping_page'
      ELSE 'unjoinable_event' END AS unit_type
  FROM ev CROSS JOIN params p
  WHERE NOT (user_pseudo_id IS NOT NULL AND ga_session_id IS NOT NULL
    AND COALESCE(analytics_storage, 'Unset') != 'No')
), hits AS (
  SELECT parsed.*,
    IF(type_rank IS NOT NULL, type_raw, NULL) AS vv_type,
    IF(REGEXP_CONTAINS(LOWER(TRIM(parts[SAFE_OFFSET(0)])), r'^[a-z0-9][a-z0-9_-]{0,63}$')
       AND LOWER(TRIM(parts[SAFE_OFFSET(0)])) NOT IN ('none', 'unknown', 'null'),
      LOWER(TRIM(parts[SAFE_OFFSET(0)])), NULL) AS operator,
    IF(parts[SAFE_OFFSET(1)] IN ('signature_valid', 'ip_match'), TRUE, FALSE) AS verified_hit,
    NULLIF(NULLIF(LOWER(TRIM(parts[SAFE_OFFSET(2)])), 'none'), '-') AS vv_purpose,
    CASE unit_type
      WHEN 'ping_page' THEN FORMAT('p|%s|%s|%s|%d', site, stream_id, event_date, batch_page_id)
      ELSE FORMAT('e|%s', GENERATE_UUID()) END AS raw_key,
    ROW_NUMBER() OVER (
      PARTITION BY site, stream_id, IF(event_name = 'purchase', transaction_id, NULL)
      ORDER BY event_timestamp, COALESCE(batch_page_id, 0),
        COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0)
    ) AS tx_rn,
    REGEXP_EXTRACT(page_location, r'[?&]utm_source=([^&#]*)') AS url_source,
    REGEXP_EXTRACT(page_location, r'[?&]utm_medium=([^&#]*)') AS url_medium,
    REGEXP_EXTRACT(page_location, r'[?&]utm_campaign=([^&#]*)') AS url_campaign,
    EXISTS(SELECT 1 FROM UNNEST([cc_campaign, gads_campaign, mc_campaign, ct_campaign,
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
  SELECT site, stream_id, unit_type, SUBSTR(TO_HEX(SHA256(raw_key)), 1, 16) AS unit_key,
    PARSE_DATE('%Y%m%d', MIN(event_date)) AS event_day,
    ARRAY_AGG(IF(COALESCE(cc_source, mc_source, gads_campaign) IS NOT NULL, STRUCT(
      COALESCE(cc_source, mc_source, IF(gads_campaign IS NOT NULL, 'google', NULL)) AS source,
      COALESCE(cc_medium, mc_medium, IF(gads_campaign IS NOT NULL, 'cpc', NULL)) AS medium,
      COALESCE(NULLIF(cc_campaign, '(not set)'), gads_campaign, mc_campaign) AS campaign), NULL) IGNORE NULLS
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
    LOGICAL_OR(test_campaign) AS test_campaign,
    LOGICAL_OR(test_source_medium) AS test_source_medium,
    ARRAY_AGG(IF(vv_type IS NOT NULL, STRUCT(vv_type, vv_purpose), NULL) IGNORE NULLS
      ORDER BY type_rank DESC, event_timestamp,
        COALESCE(batch_ordering_id, 0), COALESCE(batch_event_index, 0), vv_type
      LIMIT 1)[SAFE_OFFSET(0)] AS winning_label,
    CASE WHEN COUNT(DISTINCT operator) > 1 THEN 'mixed' ELSE MAX(operator) END AS agent_operator,
    CASE WHEN COUNT(DISTINCT IF(verified_hit, operator, NULL)) > 1 THEN 'mixed'
      ELSE MAX(IF(verified_hit, operator, NULL)) END AS verified_operator,
    COUNTIF(vv_type IS NOT NULL) AS hits_with_class,
    COUNTIF(vv_type = 'pending') > 0 AS any_pending,
    COUNT(*) AS hits, COUNTIF(event_name = 'page_view') AS pageviews,
    COUNTIF(event_name = 'purchase' AND (transaction_id IS NULL OR tx_rn = 1)) AS purchases,
    COUNTIF(event_name = 'purchase') AS purchase_events,
    COUNT(DISTINCT IF(event_name = 'purchase' AND tx_rn = 1, transaction_id, NULL)) AS unique_transactions,
    SUM(IF(event_name = 'purchase' AND (transaction_id IS NULL OR tx_rn = 1),
      COALESCE(purchase_revenue, 0), 0)) AS purchase_revenue,
    COUNTIF(event_name = 'generate_lead') AS leads,
    COUNTIF(is_key_event) AS other_key_events
  FROM hits GROUP BY site, stream_id, unit_type, raw_key
), classified AS (
  SELECT *,
    COALESCE(
      IF(winning_label.vv_type = 'agent_verified' AND winning_label.vv_purpose = 'intermediary',
        'automation_verified', winning_label.vv_type),
      'missing') AS class,
    COALESCE(winning_label.vv_type, 'missing') AS vv_type_raw,
    winning_label.vv_purpose AS vv_purpose,
    CASE
      WHEN winning_label.vv_type = 'human' THEN 'no automation detected'
      WHEN winning_label.vv_type = 'automation_verified'
        OR (winning_label.vv_type = 'agent_verified' AND winning_label.vv_purpose = 'intermediary')
        THEN 'automation_verified'
      WHEN winning_label.vv_type = 'agent_unverified' AND winning_label.vv_purpose = 'intermediary'
        THEN 'automation'
      WHEN winning_label.vv_type = 'agent_verified' AND winning_label.vv_purpose = 'user_directed'
        THEN 'agent_user'
      WHEN winning_label.vv_type = 'agent_verified' THEN 'agent_verified_unknown_purpose'
      WHEN winning_label.vv_type = 'agent_unverified' THEN 'agent_user'
      WHEN winning_label.vv_type = 'crawler_verified' THEN 'crawler'
      WHEN winning_label.vv_type IN ('bot_automation', 'bot_spoofed') THEN 'automation'
      WHEN winning_label.vv_type = 'bot_suspicious' THEN 'suspicious'
      WHEN winning_label.vv_type = 'pending' THEN 'pending'
      ELSE 'unknown' END AS class_group
  FROM units
)
SELECT site, stream_id, event_day, unit_type, unit_key, 1 AS units,
  IF(test_campaign OR test_source_medium, 'test', 'real') AS traffic_scope,
  CASE WHEN test_campaign THEN 'test_campaign'
    WHEN test_source_medium THEN 'test_source_medium' END AS test_reason,
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
  class, vv_type_raw, vv_purpose, class_group,
  class_group = 'agent_user' AS is_agent_user,
  class_group = 'automation_verified' AS is_automation_verified,
  class_group = 'automation' AS is_automation,
  class_group = 'crawler' AS is_crawler,
  class_group = 'agent_verified_unknown_purpose' AS is_agent_verified_unknown_purpose,
  class_group = 'suspicious' AS is_suspicious,
  agent_operator, verified_operator,
  winning_label.vv_type IS NOT NULL AND winning_label.vv_type != 'pending' AS has_class,
  COALESCE(winning_label.vv_type = 'pending', FALSE) AS is_pending, any_pending,
  hits_with_class, hits, pageviews,
  purchases, purchase_events, unique_transactions, purchase_revenue, leads, other_key_events
FROM classified;

-- ============================================================================
-- Rollup outside Looker Studio: replace the final `SELECT * FROM sessions;` of
-- Query A or B with the SELECT below. One row per site x stream x scope x
-- dimension value x class_group x class; share_* = share of that dimension
-- value's total. Purchases and leads are reported separately, never summed.
-- Never add rows of different `dimension` values together (each repeats all units).
--
-- SELECT site, stream_id, traffic_scope, unit_type, d.dimension, d.value, class_group, class,
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
-- GROUP BY site, stream_id, traffic_scope, unit_type, d.dimension, d.value, class_group, class
-- WINDOW w AS (PARTITION BY site, stream_id, traffic_scope, unit_type, d.dimension, d.value)
-- ORDER BY site, stream_id, traffic_scope, unit_type, d.dimension, d.value, units DESC;
