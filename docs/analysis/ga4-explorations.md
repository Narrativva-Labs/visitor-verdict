# Traffic classification in GA4

Annotate and compare first. Keep collection and conversion tags running; do not create GA4 data filters or advertising audiences from these labels. Record deployment/configuration changes, consent changes and test windows in analysis notes. Test exclusions below affect analysis only.

## Register and verify

1. Open **Admin → Data display → Custom definitions → Create custom dimension**. Create both definitions:

   | Name | Scope | Collected field |
   |---|---|---|
   | Traffic class (event) | Event | Event parameter `traffic_class` |
   | Traffic class (user) | User | User property `traffic_class` |

2. Allow 24–48 hours for reporting. Registration does not backfill earlier UI data; BigQuery can read parameters already exported without registration. Check a controlled visit in DebugView: `traffic_class`, `traffic_phase=final`, numeric `traffic_score`, and the user property. Keep detector `debug: false`; use GA4's debug tooling rather than exporting detector signal codes.
3. The supplied GTM setup sends **final only**, once per document. The detector also publishes initial locally. Final runs after eight visible seconds **or on pagehide**; early exits can send it. A missing event does not establish a visit shorter than eight seconds.

The event dimension labels that event. Earlier `page_view` or conversion events may lack it. The user dimension reflects the property associated with events after it was set; it can persist and change across visits. Neither definition creates a final-session dimension or retroactively labels earlier events. See [Google's custom-definition guidance](https://support.google.com/analytics/answer/14240153?hl=en).

## 1. Event-label distribution

1. Open **Explore → Free form**, name it “Traffic class: observed labels”, and choose a date range after deployment and registration.
2. Import dimensions **Date**, **Event name**, **Traffic class (event)** and **Traffic class (user)**; import metrics **Event count**, **Total users**, **Sessions**.
3. Put **Traffic class (event)** in Rows, **Date** in Columns, and the three metrics in Values. In Tab settings, filter **Event name exactly matches `traffic_class`**.
4. Duplicate the tab and remove the event-name filter. This reveals coverage on all events, including `(not set)` where no class parameter was sent. Duplicate again with **Traffic class (user)** as Rows to inspect the property separately.

Event count on the first tab measures classification events, not visits: each document may send one final, and sending both phases increases counts. Users/sessions can occupy several class rows; do not sum those rows into unique totals. `(not set)` means absent data, not human. If both phases are sent, optionally register event-scoped `traffic_phase` and filter to final; the two class dimensions alone cannot distinguish phases.

## 2. Session cohorts, engagement and conversions

1. In a new Free form exploration, add **Session source / medium**, **Session default channel group**, **Device category**, **Browser**, **Operating system**, **Country**, **City**, **Event name**, and both class dimensions.
2. Add **Sessions**, **Engaged sessions**, **Engagement rate**, **Average engagement time per session**, **Views per session**, **Event count**, and **Key events**. Use compatible metrics in separate tabs if GA4 disables a combination. Views can include app screen views in mixed properties; restrict to the web stream for this project.
3. Under Segments, create a **Session segment** named “Contains suspicious label”. Include sessions when an event has **Event name = `traffic_class` AND Traffic class (event) = `suspicious`**, in the same event condition group. Repeat for automated, human and declared_agent. Apply these through Segment comparisons (split across tabs if needed).
4. Use session source / medium as Rows and session metrics as Values. Duplicate for channel, device, browser/OS and country/city. A city is an estimate, not evidence of automation.
5. For conversions, duplicate with **Event name** as Rows and **Event count / Key events** as Values. Limit event names to `purchase`, `generate_lead`, `add_to_cart`. Key events count only names configured as key events; Event count includes the named events regardless. The session segments retain earlier conversions even if their events have no class parameter.

These are **sessions containing a label**, not mutually exclusive final-session classes. A session can contain human and suspicious labels on different documents. Do not filter the whole engagement tab to `event_name=traffic_class`: that would remove the other events carrying engagement/conversions. Use [bigquery.sql](bigquery.sql), B, for one latest final label per session and explicit fallback/coverage.

## 3. Referrals and review candidates

1. In the source tab, inspect sources/referrals such as `chatgpt.com`, `chat.openai.com`, `perplexity.ai`, `claude.ai`, `copilot.microsoft.com`, `gemini.google.com`, `you.com`, and `chat.mistral.ai`. Select observed values or use a domain-boundary regex; maintain the list as sources change.
2. Compare their class cohorts with other sources. Referrals can be ordinary people following assistant links. Missing referrers, apps and stripped referral information limit coverage; source and class answer different questions.
3. Create review Session segments that contain a suspicious/automated detector label **and**, elsewhere in the same session, `purchase` or `generate_lead` or `add_to_cart`. Use separate condition groups; requiring both event names on one event cannot work. Inspect engagement metrics alongside these cohorts. For a threshold such as 120,000 accumulated engagement milliseconds, use SQL query E rather than an event-duration approximation.

Conversions and engagement warrant review; they do not prove a false positive. Agents can convert, and classifications can change after conversion. `human` means insufficient detection evidence; `declared_agent` is a claimed identity; automated evidence does not establish intent. Score is not a probability, and direct suspicious rules can fire without a high score.

## 4. Reports comparisons and missing coverage

1. Open **Reports → Acquisition → Traffic acquisition → Add comparison / Create new**. Where supported, choose **Traffic class (event)**, exact match `suspicious`; add other classes as separate comparisons and retain All users. Inspect **Traffic class (user)** in a separate comparison to assess persistent-property behavior. If a dimension is unavailable/incompatible, use Explore instead. [Google documents comparison controls and compatibility](https://support.google.com/analytics/answer/9269518?hl=en).
2. Treat these as scoped comparisons, not an exclusive final-session breakdown. Use the event-label session segments above when examining complete sessions and conversions.
3. For coverage in Explore, create a Session segment excluding sessions with `event_name=traffic_class`; compare it to a Session segment including that event. This tests event presence, independent of property/parameter presence. Query F provides the explicit observed-session counts and a separate unjoinable-ping count.
4. Use Explore date ranges/report-only segments to bracket test periods. Exact timestamp exclusions and the optional first-observed-city selection are in SQL. Preserve notes explaining each exclusion; do not interpret a city as a bot label.

A JS-less fetch normally creates no GA4 event at all and is invisible here. Missing IDs in cookieless pings prevent reliable user/session counts; do not reconstruct identities. Consent gating, blocked tags, pagehide delivery loss and deployment gaps also affect coverage. Retention, sampling, thresholding and modeled reporting can make UI and raw BigQuery results differ; inspect the data-quality indicator. See [Explorations](https://support.google.com/analytics/answer/7579450?hl=en) and [reporting differences](https://support.google.com/analytics/answer/9371379?hl=en).
