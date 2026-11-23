# Validation protocol v2: controlled runs with known ground truth

Status: draft; pilot rounds run on 2026-11-22 (see [results and pilot problems](../../test/validation/results/2026-11-22/summary.md)). Owner: František Bujnovský. Nothing from this protocol is published as an accuracy figure until the second round (see [pilot rule](#pilot-then-fix-then-publish)).

This protocol complements the [field-validation protocol](protocol.md). The field protocol observes ordinary traffic on production sites and never adds markers to it. This protocol covers **controlled runs only**: an operator starts a run with a known true class on a site the project operates, labels it, and compares what each detector reported. The result is a small, re-computable dataset of labels and ground truth, not a population estimate.

## Scope and sites

- Runs happen only on sites the project operates. The reference target is the Vanilla demo shop (`demoshop.frantisekbujnovsky.com`, Vanilla collector with server-side agent verification; the 2026-11-22 pilot ran on Visitor Verdict 1.1.0, and round 2 uses the current frozen release). Never run test traffic on client or third-party sites.
- Automated runs come from one operator machine, strictly one browser at a time (the runner is sequential; the hard limit for any manual parallel work is 3 concurrent sessions per IP). A full round of 36 runs loads about 100 pages.
- No purchases, no form submissions, no account creation. The only page interaction in automated runs is the cookie-banner choice, made with the tool's native click.
- Each automated run uses a fresh browser profile/context. CDP-based tools start their own temporary profile; nothing attaches to a logged-in browser.

## Ground-truth classes

| `true_class` | What it is | How runs are produced | Expected VV result |
|---|---|---|---|
| `human` | A real person on their own device and browser | Human panel (see [field protocol](protocol.md#small-known-human-panel)): own devices, normal input, privacy settings, keyboard-only, screen reader, password-manager autofill, corporate proxy/VPN, private window | `human`; any clear flag is a false positive |
| `automation` | Browser automation with library defaults | Runner: Playwright headless and headed, headless with masked UA and UA Client Hints | `automated` |
| `automation_masked` | Default libraries with common masking flags | Runner: `--disable-blink-features=AutomationControlled`, with and without UA/UA-CH override | `automated` or `suspicious`; `human` is a miss |
| `automation_stealth` | Tools built to look human | Runner: Patchright, nodriver, zendriver; optional Camoufox, undetected-chromedriver, Puppeteer stealth | Recorded; misses are expected and published as such |
| `browser_agent_synthetic` | The detector's handling of an agent UI marker, not a real agent | Runner: `codex-agent-overlay-root` added to the root element after load | `declared_agent`, `traffic_agent=openai`, agent phase |
| `browser_agent` | A real AI agent driving a browser on the operator's machine | Manual: ChatGPT desktop browser plugin, Browser Use and Skyvern run locally; Claude in Chrome only after explicit agreement | Recorded; `declared_agent` only where a known marker or UA token exists |
| `cloud_agent` | An AI agent in a remote browser | Manual: ChatGPT agent, Gemini agent and similar, started from the operator's own accounts | Recorded; server verification (Web Bot Auth, published IP ranges) is the relevant layer |
| `handoff` | One session that switches between a person and an agent | Manual: person browses, hands control to an agent, takes it back | Per-page labels; documents the one-document carry (`CA`/`CD`) |
| `crawler_nojs` | Fetchers that never execute JavaScript | Runner: plain HTTP GET | No browser event; server labels only |
| `webhook` | Server-to-server calls (payment callbacks, agentic-checkout notifications) | Manual or backend test calls to the operator's own endpoints | No browser event; must never be counted as a visit |

Automated scenario details (tool, launch options, expectation) live in [`test/validation/run.mjs`](../../test/validation/run.mjs); its [README](../../test/validation/README.md) lists them.

## Run labelling (`vvp`)

Every run gets one synthetic run id, for example `vval-20261122-pw-headless-1-3fa2`, and every URL the run navigates to carries `?vvp=<run_id>`. The id contains the date, scenario and repetition plus a short random suffix; it identifies a test run, never a visitor, and is never derived from a person, device or account.

- Automated runs navigate to each page with `vvp` (page-to-page `goto`, not link clicks), so every GA4 hit's `page_location` carries it. Test routes must not redirect: on the demo, checkout pages redirect to the cart when it is empty and drop the query.
- Manual runs use the landing URL with `vvp`; later pages reached by clicking lose it. They are matched through the session that landed with `vvp` and through the logged time window.
- `vvdebug` is added only where debug codes are needed (automated pilot runs; manual runs only on request). It enables `traffic_signals` in data-layer events and a small debug badge, for 24 hours in that browser profile. Human panel runs do not use it.
- Pages with `vvp` are excluded from ordinary-traffic reports in the field protocol. This is the only exception to the field rule of not adding query markers: it applies to operator-run test traffic only.
- **Vanilla strips the query string** from `page_location` before forwarding, so `vvp` is not visible in events forwarded through the Vanilla collector. Match Vanilla test runs by time window or tag them via `utm_campaign=test_...` (which [campaign-dashboard.sql](../analysis/campaign-dashboard.sql) Query B flags in `traffic_scope='test'`).

Manual runs are logged in the same CSV schema as the runner (see [captured data](#what-is-captured)); fields the operator cannot observe stay empty, never guessed.

## What is captured

| Channel | Captured | How |
|---|---|---|
| Data layer | Every `traffic_class` event per page: phase (`initial`, `agent`, `final`), class, score, version, `traffic_agent`; `traffic_signals` only with `vvdebug` | Read in the page's main world by the driver, after the page's final event (the run waits for it, bounded) |
| `window.__visitorVerdict` | Current snapshot (class, phase, agent) | Same readout |
| GA4 requests | Event name plus `ep.traffic_class`, `ep.traffic_phase`, `ep.traffic_agent` of each `/g/collect` hit; hit count | Driver-side request observation through a CDP `Network` session (Playwright-based tools only; Playwright's own request events miss some unload beacons) |
| Vanilla requests | Endpoint (`/e` with consent, `/d` denied pings), event name and the three label parameters | Same CDP session |
| Vanilla server labels (`vv_type`, `vv_detail`) | Aggregate counter deltas of the collector's public `/health` (`events.byType`, `pings.byType`, obvious-bot drops) between start and end of a run | Only valid while runs are sequential and the site is otherwise quiet; a delta larger than the observed hit count is marked `possibly-contaminated`. Per-hit server labels need collector debug access, which the demo collector does not expose; they are checked later in the GA4 export of the collector's stream |
| GA4 export | Events with `vvp`, classes and whether a run's hits arrived at all | BigQuery after the daily export (see [GA4 known-bot filtering](#ga4-known-bot-filtering-check)) |
| Run metadata | Run id, round, scenario, true class, tool and browser version, headed/headless, consent choice, start/end UTC, status | Runner or operator |

**Never collected:** IP addresses, client or session IDs, cookies, user-agent strings, page URLs beyond the fixed test routes, page content, screenshots, input traces, free-text notes about people, names, accounts or e-mail addresses. Panel participants are recorded only by broad device category (as in the field protocol). Notes are fixed short codes (`consent-button-missing`, `page-error`, …).

## Comparison tools

| Tool | Where | Rule |
|---|---|---|
| Visitor Verdict, browser | Every run | Production GTM configuration, frozen version |
| Visitor Verdict, server (Vanilla collector) | Every run on the demo | Counter deltas now; per-hit labels from the export |
| BotD (`@fingerprintjs/botd`, version pinned in the lockfile) | **Lab runs only**, Playwright-based tools | Injected with `addScriptTag` on the last page **after** the detector's final result, monitoring disabled. This is a lab injection that changes the page environment; it never runs before or during observation, and it is never part of a site's tagging |
| Microsoft Clarity agent activity | Manual | The operator checks Clarity's bot/agent views for the run windows and records only class-level outcomes |
| GA4 known-bot filtering | Export | Whether a run's hits reached the export (next section) |

No comparison tool is ground truth. Ground truth is the run's `true_class`.

## GA4 known-bot filtering check

Google documents only the general rule: traffic from known bots and spiders is excluded automatically, identified through Google research and the IAB/ABC International Spiders and Bots List; the filter cannot be disabled and Google does not report how much was excluded ([Analytics Help 9888366](https://support.google.com/analytics/answer/9888366)). It does not document which user agents or signals trigger it.

**Our observation, to be confirmed, not Google documentation:** in small canary runs on 19–21 November 2026, runs with a `HeadlessChrome` user agent were absent from the GA4 BigQuery export, while a bot with a masked (non-headless) user agent was present.

The repeatable check is a scenario pair with distinct run ids:

| Scenario | Run id prefix | Browser | Difference |
|---|---|---|---|
| `ga4f-headless` | `ga4f-headless-<n>-<date>-<suffix>` | Playwright headless, defaults | `HeadlessChrome` in UA and UA-CH |
| `ga4f-masked` | `ga4f-masked-<n>-<date>-<suffix>` | Same browser | Non-headless UA string and UA-CH via CDP; `navigator.webdriver` unchanged |

Run about 3 of each per round (`--scenarios ga4f-headless,ga4f-masked`; add `--hold-after-final-ms 6000` when final-phase hits matter, because GA4 sends the batched final `traffic_class` hit about 5 s after the final event). The runner records what was sent: `ga4_hits` and `ga4_labels` from the captured `/g/collect` requests. After the daily export (wait at least 72 hours before calling a run absent), run in the demo property's dataset (`analytics_563222465`):

```sql
DECLARE start_day STRING DEFAULT '20261122';
DECLARE end_day STRING DEFAULT '20261123';
SELECT
  REGEXP_EXTRACT(loc, r'[?&]vvp=([a-z0-9-]+)') AS run_id,
  COUNT(*) AS exported_events,
  COUNTIF(event_name = 'page_view') AS page_views,
  ARRAY_AGG(DISTINCT IFNULL(tc, '(none)')) AS classes
FROM (
  SELECT event_name,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS loc,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_class') AS tc
  FROM `<project>.analytics_563222465.events_*`
  WHERE _TABLE_SUFFIX BETWEEN start_day AND end_day
)
WHERE loc LIKE '%vvp=ga4f-%'
GROUP BY run_id
ORDER BY run_id;
```

Join the result with `runs.csv` on `run_id`. Per scenario report: runs that sent hits (`ga4_hits > 0`), runs present in the export, and the export share with a Wilson interval. A run that sent hits and is absent from the export is "filtered or lost"; this check cannot separate GA4's bot filter from other loss, so a difference between the pair is the evidence, not a single absence.

**Vanilla is a separate path.** The Vanilla collector drops requests whose user agent is an obvious bot (including `HeadlessChrome`) at its entry and forwards nothing for them (`botsFiltered` in `/health`; the runner records it as `dropped_obvious_bot`). So for `ga4f-headless` nothing reaches GA4 through Vanilla at all, independent of Google's filter, and Vanilla-forwarded events carry no `vvp`. The check above therefore concerns the GTM/gtag path only.

## Metrics

All metrics are computed per scenario and per true class from `runs.csv`, in **run units** (a run is one fresh browser session; pages are reported descriptively).

| Metric | Definition |
|---|---|
| Clear detection (recall, clear) | Runs whose worst class over all pages and phases is `automated` or `declared_agent` / completed runs of that true class |
| Any detection | Same with `suspicious` included; reported separately, never merged into the clear figure |
| Operator accuracy (agents) | Runs with the expected `traffic_agent` / runs with `declared_agent` |
| Human false-positive rate | Human-panel participants with any clear-flagged page / completed participants; `suspicious` separately |
| Precision per class | Runs of the matching true class / all runs labelled with that class, **within the run set only**. Lab class mixes are chosen by design, so this is not population precision; it shows confusion between classes (for example automation labelled `declared_agent`) |
| Pending share (server) | Vanilla hits labelled `vv_type=pending` (no browser class yet) / all labelled Vanilla hits, per run set |
| Coverage | Runs with any browser event / runs that executed JavaScript; pages with a final event / pages visited; GA4 delivery (runs with exported hits / runs that sent hits); Vanilla label coverage (Vanilla hits carrying `traffic_class` / all Vanilla hits) |
| Completion | Completed runs / scheduled runs; `skip` and `error` are listed and never counted as detections or misses |

Give k/n and a two-sided 95% Wilson score interval for every proportion (formula in the [field protocol](protocol.md#metrics-and-final-per-site-report)); for n=0 write "not estimable". With n of 3–5 per scenario the intervals are wide (3/3 is 44–100%); they describe these runs, not the tools in general. Repeated runs of one configuration on one machine are not independent samples, and synthetic and real traffic are always reported separately.

## Pilot, then fix, then publish

1. **Pilot round:** run every scenario a few times (3–5), record everything, including errors and skips.
2. **Review:** list problems in the detector, the integration and this protocol. Pilot results are not changed, re-labelled or dropped.
3. **Fix:** detector changes go through the normal release process with a new version; runner and protocol changes are logged in the results' `summary.md`. Detection thresholds are not tuned to make a pilot scenario pass.
4. **Second round:** rerun the full set with the frozen fixed version. Only second-round results are published, together with the list of pilot problems and what changed.

## Publication

What is published: `runs.csv` (labels, true class, tool versions, timestamps, status), the per-round `summary.md`, this protocol and a "what we cannot detect" section. What is not published: anything under [never collected](#what-is-captured). Results are published in this repository; a summary may also appear on the project's website.

## Manual runs (operator accounts)

The runner never starts agents that need personal accounts. These runs are performed by the operator by hand, logged with the same columns:

- ChatGPT agent (cloud), ChatGPT desktop browser plugin (local overlay marker), Gemini agent, other cloud agents.
- Browser Use and Skyvern locally (need model API keys).
- Claude in Chrome: only after explicit agreement.
- Handoff sessions (person ↔ agent).
- Human panel on real devices.
- Clarity agent-activity check for the run windows.
- Webhook calls to the operator's own endpoints.

## Limits

- Lab runs show how specific tool versions and configurations were labelled on one site from one machine. They say nothing about how often such traffic occurs.
- Stealth tools are expected to end `human`; publishing those misses is part of the result.
- The synthetic marker scenario tests the detector's handling of a marker, not whether a given agent release injects it.
- Server labels from counter deltas are aggregate and can be contaminated by other traffic in the same minute.
- `goto` navigation does not exercise click-driven signals (`TP`, `TR`) or rapid navigation (`FN`); those are covered by the [local browser suites](../benchmark.md).
