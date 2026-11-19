# Lightweight field validation: clear automation in GA4

Status: prospective protocol; no field results yet. Owner: František Bujnovský. This replaces the proposed 30-day accuracy study. The purpose is to describe **clear automation observed in GA4** and check deployment and obvious human misclassification over **14–28 consecutive days per site**. It is not an accuracy certification or an attempt to catch sophisticated evaders.

## Freeze before starting

Complete this record separately for every site before collecting study data. Do not choose the duration after looking at the results.

| Item | Record before day 1 |
|---|---|
| Site and GA4 export dataset / web stream | … |
| Actual detector deployment date | … |
| Study start/end dates, property timezone | … (choose 14, 21 or 28 days) |
| Frozen `traffic_version` | … |
| Source revision / release and deployed artifact checksum | … (build artifact only, never visitor data) |
| Config, including worker/WebGL, threshold and agent list | … |
| GTM container version and event parameter mappings | … |
| CMP / consent configuration; automatic-event fallback policy | … |
| Panel slots, devices and canary schedule | … |
| Analyst and final extraction date | … |

Freeze detector logic/configuration and the GTM mapping for the interval. Both data-layer phases must include the same static `traffic_version`; the GA4 detector event must forward it as an event parameter. Forward it on other tagged events where available. Verify it in the export before day 1. The version is release metadata, never a visitor identifier. v1.0.0 implements this versioned payload; verify the deployed build and final GA4 DLV mapping before starting.

If a correctness fix is necessary, log the change and start a new version interval. Do not silently combine it with the frozen interval. Report unversioned and mixed-version sessions separately, alongside a total that retains them. A session with some unversioned automatic events is not necessarily a version failure: the dedicated final tag forwards version, while other tags need explicit version mapping. Shared settings capture values at Google-tag startup and the timer fallback can fire before the detector loads. Use the [readiness setup](../ga4-reporting.md#import-and-readiness-wiring) to make the initial class available to the first page_view when possible.

No held-out split, manual traffic-labelling exercise, kappa, threshold tuning or accuracy target is required. Check operational health during the interval; produce one small final report per site. Do not change thresholds to fit a missed canary.

## Collection and windows

Use the normal production integration, debug disabled. Keep conversion collection enabled; this study only annotates and reports. No access blocking or automatic conversion suppression. Detector output is class, phase, score and static version; no raw signals, identifiers, input traces or extra visitor instrumentation. The study does not change consent settings or permit advertising use before consent.

Use [windows.csv](windows.csv) with exactly `start_ts,end_ts,label,site,notes`. Timestamps are ISO 8601 UTC and half-open `[start,end)`; synchronize operator clocks. Use labels `panel:android-chrome`, `panel:ios-safari`, `panel:firefox`, `panel:brave`, `panel:assistive`, `canary:default`, `canary:ua-fixed`, `canary:stealth` or `canary:patchright`. Use broad device/configuration categories, never names, emails, account IDs or URL parameters. Notes hold status, planned/completed page counts and class-only outcome summaries, not personal details.

Example format (illustration, not actual observations):

```csv
start_ts,end_ts,label,site,notes
2026-12-01T09:00:00.000Z,2026-12-01T09:03:00.000Z,panel:android-chrome,shop.example,status=complete;pages=3;clear=0
```

Schedule one panel/canary slot at a time at a quiet time on each site. Windows identify evaluation cohorts, **not individual visitors**. Other traffic can occur within them. A matching GA4 event is evidence consistent with delivery, not proof that it came from the participant/run. If attribution is ambiguous, mark it indeterminate; do not infer identity from timestamps, geography, IP or UA. Do not add query markers or new identifiers to force a match. Prefer a quiet existing public page with no personal path content; record only its approved route outside participant records if needed for an operator check.

Pass the site's rows to SQL as `labelled_windows ARRAY<STRUCT<start_ts,end_ts,label>>` after filtering CSV by site. No automatic CSV import is supplied. Ordinary-traffic reports exclude the whole existing identifiable GA4 session if any event overlaps a logged window; missing-ID pings are excluded per event. This conservative exclusion also removes incidental organic traffic in those windows: report excluded windows/duration and avoid long windows. Evaluation counts use the retained pre-exclusion events. Avoid overlapping windows, which otherwise duplicate evaluation counts.

## Small known-human panel

Recruit **5–10 real people per site**, using their ordinary physical devices and browsers. Aim to include Android Chrome, iOS Safari, desktop Firefox and Brave, plus a screen-reader user and a voice-control user where feasible; people may cover more than one category. Record absent categories honestly. Emulation and scripted “human-like” controls do not replace people, particularly assistive-technology users.

Arrange one short logged slot per person (about 3–5 minutes), spread across the interval. Ask them to browse 2–3 safe public pages naturally, read for at least 10 visible seconds on one page, and use their normal input and privacy/consent preferences. Do not coach them into mouse motion or override their browser. No real purchases or personal form submission are needed. An operator can read class/phase from `window.__visitorVerdict` without enabling debug; record only class outcomes, page count, final observed/missing, and whether a matching GA4 delivery was observed/ambiguous/missing. Obtain their agreement to the test; maintain scheduling contacts outside repo/data exports and delete them when no longer needed.

Panel endpoints, per site and broad device category:

- Clear flags: participants with any locally observed `automated`/`declared_agent` page / all completed participants, with Wilson 95% CI. Also give page counts descriptively; repeated pages are not independent people.
- Secondary suspicious count, separate from clear flags.
- Local observability and GA4 delivery: completed slots with local results and slots with unambiguous exported matching results / completed slots. Retain missing and indeterminate outcomes.

Any clear flag in this known-human panel triggers a deployment/evidence review, not relabelling or a guaranteed defect diagnosis. Zero flags in 5–10 people is limited reassurance, not a low population false-positive-rate guarantee (0/10 has Wilson upper bound about 28%).

## A few canary runs

Plan 2–3 rounds per site (start/end and optionally middle), one run per configuration per round: default Playwright headless, AutomationControlled disabled with a non-headless UA string, and stealth when installed. Include Patchright when available to document its likely limitation; it need not be caught. Use a fresh browser/context per run, 2–3 safe pages, one run at a time. Preserve natural CMP settings; the runner does not accept consent or interact with forms.

From the repository root:

```sh
node test/canary.mjs --url https://shop.example/ --url https://shop.example/about \
  --pages 3 --configs default,ua-fixed,stealth --site shop.example
# Optional installed Patchright:
node test/canary.mjs --url https://shop.example/ --pages 3 --configs patchright
```

Use only sites you operate. The runner appends one window row per configuration to `test/results/canary-windows.csv`, in the template's schema. Merge these rows into the study log without duplicating headers. It prints class and phase per page; retain only class-level outcome summaries in notes if desired. It does not capture requests, URLs, signals, IDs, screenshots, browser properties or response bodies. No dependency installation is automatic. `--output` changes the CSV location. Only one writer may use a CSV at once.

Each page waits at least 10 seconds (increase `--wait-ms` for a larger frozen idleMs), and configurations are separated by at least 10 seconds. Sequential `goto` navigation does not test pointer clicks or rapid-navigation detection. The UA-fixed configuration can retain main/worker UA-CH inconsistencies; it is an explicit configuration, not a clean human control. Browser launch/navigation errors, missing final results and unavailable packages are reported distinctly; a SKIP is not a detection pass. Browser launch errors may leave a zero-page window.

Report per configuration: scheduled, skipped, launched, completed, local clear-flagged, local suspicious-only, local human, missing final, and GA4 clear delivery confirmed/absent/indeterminate. Local detection proportion = completed runs with any clear result / completed runs. End-to-end clear detection+delivery proportion = completed runs with an unambiguous exported clear detector event / completed runs. Give Wilson intervals and counts; list indeterminate runs separately and bound that proportion by treating them as none versus all delivered. Also show operational completion / scheduled runs; never turn an execution error into a detection success. GA4 absence is a delivery/detection outcome, not evidence of human traffic. These are configuration-specific smoke checks, not representative automation recall or a minimum recall promise.

## Metrics and final per-site report

Run [bigquery.sql](../analysis/bigquery.sql) for **one web stream/site at a time**, with the frozen date interval and deployment guard. Use completed daily exports and wait at least 72 hours after the last study day before the final extraction. Preserve finite boundary padding. Do not fabricate sessions from missing IDs or join cookieless pings to later consented sessions.

A session is the existing `(user_pseudo_id, ga_session_id)` pair in that web stream. The session start date derives from `ga_session_id` in the property timezone. “Worst class” precedence is **declared_agent > automated > suspicious > human > unknown** across all valid event parameters in the observed session; unknown means no valid class. A later human label never cancels earlier evidence. `class_transition` means more than one distinct valid class was observed; it is not proof of a chronological transition when export order ties. User properties are not exclusion evidence.

| Measure | Exact numerator / denominator or rule |
|---|---|
| Headline clear automation share | Sessions whose worst class is automated or declared_agent / all observed joinable ordinary sessions, including unknown |
| Class shares | Each worst class count / same all-session denominator; show unknown and suspicious separately |
| Coverage | Sessions with any valid class event parameter / all observed joinable ordinary sessions; show count without a class |
| Engaged clear flags | Clear-flagged engaged sessions / all engaged sessions, including unclassified; engaged = any exported `session_engaged=1` |
| Converting clear flags | Clear-flagged purchasing sessions / all purchasing sessions, including unclassified; purchase = at least one exported `purchase`, not cart or lead |
| Optional CR comparison (existing B) | Purchasing sessions / sessions in the same cohort: all; excluding clear automation; strict additionally excludes suspicious (secondary only) |
| Excluded revenue (existing B) | Sum of exported USD purchase revenue in clear-flagged sessions, shown explicitly alongside retained revenue; no silent deletion |
| Score histogram | Counts of detector events by class, phase, score, session engaged/purchasing status and version; unknown join status stays unknown |

Give k/n, percentage and **two-sided 95% Wilson score CI** for headline share, coverage, engaged/converter flag rates and panel/canary proportions. With `p=k/n`, `z=1.95996398454`, limits are `(p+z²/(2n) ± z*sqrt(p(1-p)/n+z²/(4n²)))/(1+z²/n)`, clipped to [0,1]. For n=0 display not estimable, never 0%. These are descriptive binomial intervals, not guarantees; repeat sessions/devices and traffic bursts violate independence and can make them too narrow. Use participant/run units for panel/canary summaries, not repeated pages. No multiple-comparison significance claims.

### Plausibility check: hour of day and city

An independent sanity check that `automated` behaves like automation rather than like the site's audience. It uses only fields GA4 already exports (`event_timestamp` in the property timezone, `geo.city`) and adds nothing to the detector.

| View | What to compare | What a plausible result looks like | What warrants review |
|---|---|---|---|
| Hour of day × worst class | Share of each class's sessions per hour (0–23), per site | `human` follows the audience's day/night rhythm; `automated` is flatter, without the night dip | `automated` sessions follow exactly the human curve, which suggests real people are being labelled |
| City × worst class | Top 10 cities per class, with session counts | `automated` concentrates in a few cities that host data centres (for example Ashburn, Boardman, Council Bluffs, Frankfurt, Dublin, Amsterdam) or `(not set)` | `automated` mirrors the human city mix, especially the site's home cities |

This is descriptive, not a test of accuracy: small counts make both views noisy, VPN and corporate egress put real people in data-centre cities, and scheduled human activity exists. A mismatch is a reason to inspect those sessions (engagement, landing pages, device, panel and canary windows), never to relabel them. Report it in the final per-site report as one short paragraph.

The check on engaged/converting traffic asks whether any clear flags appear, **not whether all such flags are errors**. Engaged bots, test orders and genuine automated purchases exist. Review any nonzero k while retaining its label and CI; even zero observed flags cannot prove absence. Show unknown coverage within these groups (SQL I). Do not exclude suspicious traffic from the headline. The strict existing SQL cohort is an optional sensitivity view, clearly labelled.

Coverage has boundaries: session coverage is conditional on GA4 seeing an identifiable session. A/F2 show event labels and missing-ID pings separately; G optionally checks observable existing GA4 page groups with labels/finals, and unassignable pageviews. None measures the fraction of **all website requests** executing the detector. No new page IDs are created. `page_path` discards queries/fragments but may still contain sensitive path segments; it remains in temporary analysis tables and is not needed in the published report.

A compact final report contains site/stream, dates/version/config, ordinary session n, five worst-class counts, clear share+CI, coverage+CI, engaged and converter k/n+CI, excluded revenue if relevant, panel table, canary table and deployment caveats. Keep version splits plus the all-version total; investigate mixed/unexpected versions rather than silently dropping them. SQL A–F remain available, with study summary, G page coverage, H histogram, I engaged/purchase strata and a separate evaluation-window output. Window output is event counts; denominators and attribution judgements come from the logged runs, not from treating each delivered event as a run.

## Limits and claims to avoid

Existing base/extended reports validate controlled behaviour, fuzz checks validate invariants, and adversarial reports show Patchright and other patched browsers ending human. Live reports also show stale/missing page-view labels and a historical consent expectation that predates the current before-consent policy. They are context, not field accuracy evidence. Pin the actual deployed artifact rather than assuming reports match it.

Do not claim a population bot percentage, human identity, malicious intent, authenticated agent identity, accuracy/precision/recall guarantees, or validation of all accessibility configurations. Clear classes indicate browser evidence/UA claims, not intent; inherited automation can persist for one following document. Sophisticated evaders may look human by design. Suspicious remains uncertain.

JS-less fetches and blocked GA4 are outside the measured population. Consent, blocked storage, CSP, unload loss, background tabs, first-page timing, automatic settings carrying the previous page's label, late arrivals, session boundaries, purchase duplication/refunds and nonrepresentative volunteers all affect interpretation. A missing label is unknown. An increase in CR after exclusions is arithmetic, not marketing lift. Scores are not probabilities and cannot reconstruct alternate thresholds without family evidence, which production does not export. No hand-labelled audit, burst z-scores or weekly significance monitoring is needed for this study.

Statistical reference: [NIST binomial proportion confidence intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm). Export reference: [Google GA4 BigQuery schema](https://support.google.com/analytics/answer/7029846?hl=en). These describe methods/schema, not evidence of this detector's performance.
