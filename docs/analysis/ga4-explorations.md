# GA4: reporting on labelled traffic

Visitor Verdict labels traffic; nothing is excluded from GA4. **All sessions** is the headline population. The segments below that set labelled sessions aside (named “excluding detected automation” to match the SQL cohort names) are optional comparison views; they leave the data unchanged. Agent-assisted sessions (`declared_agent`, with **Traffic agent (event)** when a marker named the operator) are usually real customers using a browser agent: report them as a segment with their purchases and revenue, not as removed traffic.

Use the web stream only, a consistent date range, and the event-scoped **Traffic class (event)** dimension (parameter `traffic_class`). Register it in **Admin → Data display → Custom definitions**. Register event-scoped **Traffic agent (event)** (parameter `traffic_agent`: `openai`, or `anthropic` for older Claude in Chrome versions; current Claude in Chrome is not detected). Optionally register event-scoped `traffic_phase`. Version 1.4.1 sets no traffic_class User Property. Remove legacy mappings; old user-scoped values may persist and must not determine session classification.

On every other GA4 event tag (`gaawe`), map `traffic_class={{VV - current class}}`, evaluated at firing time. The imported variable prefers a verified B7 server agent over browser human/suspicious, excluding crawler/intermediary; browser automated/declared has precedence. It falls back to `window.__visitorVerdictLast` and then undefined. See the exact logic in [GA4 reporting](../ga4-reporting.md). It never reads storage. The dedicated **VV - GA4 traffic_class** publication event uses the seven publication DLVs for class/phase/score/version/agent/webmcp/claim as event parameters only, rather than the live variable.

Container 1.1.0 sends `automated`/`declared_agent` on initial publication, the `declared_agent` escalation on the agent phase and all classes on final. Several hits can carry the same class. Use sessions with any matching hit; classification-event counts measure delivery volume, not visits or detection recall.

Optionally wire the existing Google tag to **VV - initial OR VV - timer fallback 1s** as two normal triggers, with **Once per page**, replacing its early All Pages/Initialization trigger. Add `traffic_class={{VV - current class}}` to its Shared event settings. The initial path can label the first `page_view`; fallback after one second can still be unlabelled. Shared settings capture a startup value once, so automatic events need not reflect later final evidence. There is no backfill or automatic refresh.

For CSP-sensitive sites, import the sandboxed [current-class variable template](../../gtm/templates/vv-current-class.tpl), which currently covers browser evidence only and reads `__visitorVerdict.class` and `__visitorVerdictLast`, and replace the Custom JavaScript variable's references. It has no storage/network/write/execute permissions. The detector script must still satisfy CSP. See [readiness, mappings and consent](../ga4-reporting.md). Keep the dedicated traffic_class event for event-label coverage; never mark it as a key event. Preserve site consent handling and never use pre-consent classification for advertising.

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

Report purchase revenue for **All sessions**, and break it down into the retained and **Excluded detected automation** session segments. The latter contains sessions with automated/declared evidence on any event, including agent-assisted purchases, which are real revenue. Do not add revenue from missing-ID pings to identifiable-session revenue. Removing low-converting sessions can raise CR arithmetically; it does not prove marketing improvement.

Use [bigquery.sql](bigquery.sql) for one row per `(user_pseudo_id, ga_session_id)` in one web stream, flags `any_automated`, `any_declared`, `any_suspicious`, `has_class`, `has_agent_operator`, `agent_operator`, `first_class`, `last_class`, and `class_at_first_conversion`. The last field means the first **purchase**: its own class parameter, otherwise the latest class before it. An automatic event parameter can be a captured initial or startup-fallback value from shared settings; this timing field describes exported labels, not verified current-page evidence. No future class or user property fills that value. UI “contains a label” segments cannot reliably reconstruct this timing. Later `human` never erases earlier automation evidence for session exclusion.

## Standard report comparisons

1. Open **Reports → Acquisition → Traffic acquisition → Add comparison / Create new**.
2. Select **Traffic class (event)** where compatible, choose exact match `automated` or `declared_agent` (multiple values use OR), and keep the default baseline. Add `suspicious` as another comparison; scope the report/comparisons to the web stream.
3. Treat these as event-label comparisons. An event-scoped comparison or “does not match” filter does not guarantee exclusion of the entire session, can handle `(not set)` differently, and can leave earlier unlabelled conversions in scope. Do not label it “sessions excluding detected automation”. Use the Exploration session segments or SQL for that comparison view. If the dimension is unavailable/incompatible, use Explore. See [comparison controls and compatibility](https://support.google.com/analytics/answer/9269518?hl=en).

## Plausibility by hour and city

To check that detected automation looks like automation, build a **Free form** exploration with the session segments from above as comparisons (retained traffic vs. **Excluded detected automation**):

1. Rows: **Hour** (or **Date + hour (YYYYMMDDHH)** for bursts); values: **Sessions**. Human traffic should follow the site's daily rhythm; automation is usually flatter.
2. Replace the rows with **City**. Automation often concentrates in data-centre cities or `(not set)`; human traffic follows the audience.

Treat both as sanity checks, not evidence about any single session: VPNs, corporate networks and night owls exist. See the [study protocol](../study/protocol.md) for how the result is reported.

## Interpretation and coverage

`human` means **no automation detected**, `suspicious` uncertain evidence, `automated` automation evidence without a judgement of intent, and `declared_agent` an unverified claim. Score is not a probability. Exclusion keeps unknown sessions; “only human” selects visits where classification and delivery worked and biases the headline. Always display coverage and suspicious traffic alongside the headline, which stays All sessions.

Missing-ID cookieless pings are separate event totals, not sessions. Never reconstruct identity or join via IP/UA. JS-less fetches usually send no GA4 event at all; blocked tags, consent settings, early pageviews and unload loss also affect coverage. Referrals from assistants can be ordinary people following links and never establish automation. Converting or engaged automation warrants review, not automatic relabelling as human.
