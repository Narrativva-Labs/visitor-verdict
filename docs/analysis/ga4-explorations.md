# GA4: traffic excluding detected automation

Use the web stream only, a consistent date range, and the event-scoped **Traffic class (event)** dimension (parameter `traffic_class`). Register it in **Admin → Data display → Custom definitions**. Optionally register event-scoped `traffic_phase`. The user-scoped dimension is **last observed class**, applies from set time and can persist into later visits: never use it to exclude sessions.

On every other GA4 event tag (`gaawe`), map `traffic_class={{VV - current class}}`, evaluated at firing time. The imported variable validates `window.__visitorVerdict.class`, then `window.__visitorVerdictLast` (the previous final class captured once at detector startup), returning undefined when neither is available. It never reads storage. The dedicated **VV - GA4 traffic_class** final event uses the four publication DLVs for class/phase/score/version and the class DLV for its user property, rather than the live variable.

Wire the existing Google tag to **VV - initial OR VV - timer fallback 1s** as two normal triggers, with **Once per page**, replacing its early All Pages/Initialization trigger. Add `traffic_class={{VV - current class}}` to its Shared event settings. The initial path can label the first `page_view`; fallback after one second can still be unlabelled. Shared settings capture a startup value once, so automatic events need not reflect later final evidence. There is no backfill or automatic refresh.

For CSP-sensitive sites, import the sandboxed [current-class variable template](../../gtm/templates/vv-current-class.tpl), which reads only `__visitorVerdict.class` and `__visitorVerdictLast`, and replace the Custom JavaScript variable's references. It has no storage/network/write/execute permissions. The detector script must still satisfy CSP. See [readiness, mappings and consent](../ga4-reporting.md). Keep the dedicated final event for coverage and the last-observed user property; never mark it as a key event. Preserve site consent handling and never use pre-consent classification for advertising.

## Build whole-session segments in Explorations

1. Open **Explore → Free form**, then **Variables → Dimensions → +**. Import **Stream ID**, **Event name**, **Traffic class (event)**, **Session source / medium**, and **Session default channel group**. Import **Sessions**, **Engaged sessions**, **Event count** and purchase-related metrics supported by the property. Use separate tabs for incompatible combinations.
2. Under **Segments → + → Create a custom segment → Session segment**, create **All sessions** with an include condition **Stream ID = your web stream ID**. Use this stream restriction for every segment below. Keep the full session; do not apply a tab-level `event_name=traffic_class` filter, which would remove purchases and engagement events.
3. Duplicate the baseline as **Sessions excluding detected automation**. Add an **Exclude sessions when** group. In a **Within the same event** condition group, use **Event name exactly matches `traffic_class` AND Traffic class (event) matches regex `^(automated|declared_agent)$`**. OR this with a group where **Traffic class (event) matches regex `^(automated|declared_agent)$`**, without any event-name constraint. The second branch also catches labels on purchase/click/other events and logically subsumes the first. Exclude the entire session on any occurrence; neither the last class nor the user property determines exclusion. Do not exclude every `traffic_class` event regardless of value.
4. Save and apply the baseline and retained segment through **Segment comparisons**. Duplicate the retained segment as **Stricter sensitivity view**, extending the exclusion regex to `^(automated|declared_agent|suspicious)$`.
5. Create **Suspicious within retained sessions** by including sessions with `suspicious` on any event and retaining the automated/declared exclusion. Show this separately within retained traffic. Create **Observed human-only cohort (diagnostic)** by including `human` on any event and excluding sessions containing any of the other three values. This is a labelled subset, never the headline population.
6. Create coverage segments **With any class** and **Without any class**, respectively including/excluding sessions with **Traffic class (event) matches regex `^(human|suspicious|automated|declared_agent)$`** on any event. Show both counts and their share of baseline sessions. Detector-event presence alone is not complete coverage: other events may carry class even when final delivery fails.

Use [Google's segment builder](https://support.google.com/analytics/answer/9304353?hl=en) for condition scopes. Segments are limited to available exploration data; retention, sampling and modeled UI metrics can differ from raw export. Stream scoping and the date range must match across comparisons.

## Purchases, revenue and timing

Headline **purchase conversion rate = purchasing sessions / sessions in the same cohort**. In a duplicate tab, create a purchasing subset of each session segment by adding a separate session condition group containing `event_name=purchase`. Divide that subset's Sessions by its parent cohort's Sessions; keep the same date/stream. Use these session counts rather than purchase-event counts or the count of all key events. Never require purchase and `traffic_class` as event names on the same event. `add_to_cart` and `generate_lead` are separate diagnostics, not headline purchase conversions.

Show purchase revenue in retained and **Excluded detected automation** session segments separately. The excluded segment includes sessions with automated/declared evidence on any event. Do not add revenue from missing-ID pings to identifiable-session revenue. Removing low-converting sessions can raise CR arithmetically; it does not prove marketing improvement.

Use [bigquery.sql](bigquery.sql) for one row per `(user_pseudo_id, ga_session_id)` in one web stream, flags `any_automated`, `any_declared`, `any_suspicious`, `has_class`, `first_class`, `last_class`, and `class_at_first_conversion`. The last field means the first **purchase**: its own class parameter, otherwise the latest class before it. An automatic event parameter can be a captured initial or startup-fallback value from shared settings; this timing field describes exported labels, not verified current-page evidence. No future class or user property fills that value. UI “contains a label” segments cannot reliably reconstruct this timing. Later `human` never erases earlier automation evidence for session exclusion.

## Standard report comparisons

1. Open **Reports → Acquisition → Traffic acquisition → Add comparison / Create new**.
2. Select **Traffic class (event)** where compatible, choose exact match `automated` or `declared_agent` (multiple values use OR), and keep the default baseline. Add `suspicious` as another comparison; scope the report/comparisons to the web stream.
3. Treat these as event-label comparisons. An event-scoped comparison or “does not match” filter does not guarantee exclusion of the entire session, can handle `(not set)` differently, and can leave earlier unlabelled conversions in scope. Do not label it “sessions excluding detected automation”. Use the Exploration session segments or SQL for that headline. If the dimension is unavailable/incompatible, use Explore. See [comparison controls and compatibility](https://support.google.com/analytics/answer/9269518?hl=en).

## Plausibility by hour and city

To check that detected automation looks like automation, build a **Free form** exploration with the session segments from above as comparisons (retained traffic vs. **Excluded detected automation**):

1. Rows: **Hour** (or **Date + hour (YYYYMMDDHH)** for bursts); values: **Sessions**. Human traffic should follow the site's daily rhythm; automation is usually flatter.
2. Replace the rows with **City**. Automation often concentrates in data-centre cities or `(not set)`; human traffic follows the audience.

Treat both as sanity checks, not evidence about any single session: VPNs, corporate networks and night owls exist. See the [study protocol](../study/protocol.md) for how the result is reported.

## Interpretation and coverage

`human` means **no automation detected**, `suspicious` uncertain evidence, `automated` automation evidence without a judgement of intent, and `declared_agent` an unverified claim. Score is not a probability. Exclusion keeps unknown sessions; “only human” selects visits where classification and delivery worked and biases the headline. Always display coverage and suspicious traffic alongside the headline.

Missing-ID cookieless pings are separate event totals, not sessions. Never reconstruct identity or join via IP/UA. JS-less fetches usually send no GA4 event at all; blocked tags, consent settings, early pageviews and unload loss also affect coverage. Referrals from assistants can be ordinary people following links and never establish automation. Converting or engaged automation warrants review, not automatic relabelling as human.

## Server-verdict session segments (Vanilla reference)

Register agent_verification, agent_operator, agent_purpose, agent_claim, traffic_class
and traffic_phase as event-scoped dimensions. Use session segments scoped to the same
web stream and date range; include evidence on any hit in the session, not just its last hit.

1. **Verified, looks human:** signature_valid/ip_match and browser class human.
2. **Verified declared agent/bot:** signature_valid/ip_match and declared_agent; show
   automated/suspicious and absent browser-class variants separately. Split by agent_purpose.
3. **Clear automation, unverified:** automated without a verified server verdict.
4. **Declared, not verified:** declared_agent with no_signature; false claims and operators
   without supported evidence both belong here. none/missing is a separate unknown subgroup.
5. **Human-looking, unverified:** human with no_signature; this includes well-masked bots.

Also show signature_invalid, suspicious and missing browser class as diagnostic cohorts;
none/(not set) are not proof of humanity. Report label coverage alongside conversion rates.
[session-classification.sql](session-classification.sql) implements these five families plus
diagnostic subgroups. It is **not yet validated against a live export**; owner validation is
planned for 2026-11-21. Run Query 0 first to check batch_page_id cardinality and currency;
disable page grouping if IDs are missing or collide. Denied pings are separate page units
grouped by stream_id, event_date and batch_page_id, never sessions grouped by ga_session_id
(a page-load second that collides between visitors). Do not add ping-page revenue to session
revenue. Compare purchases with unique_transactions for duplicates; revenue_usd normalizes
currency but does not deduplicate repeated purchases.
