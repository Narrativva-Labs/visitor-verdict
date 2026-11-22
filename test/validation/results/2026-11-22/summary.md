# Validation runs 2026-11-22

Generated 2026-11-22T22:07:22.245Z from runs.csv (110 rows; rounds: pilot-1, pilot-1b, pilot-1c, round-2). Units are runs, not pages. Match = worst class across all pages and phases is in the expected set (and the expected operator for agent scenarios). Wilson intervals are descriptive; repeated runs of one configuration on one machine are not independent samples of real traffic. Skipped and errored runs are not detection results.

| Round | Scenario | True class | Expected | Runs | Complete | Skip/error | Worst class (complete runs) | Match k/n | Wilson 95% | Agent phase | BotD (lab) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pilot-1 | pw-headless | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1 | pw-headless-masked | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1 | pw-headless-masked-quiet | automation_masked | automated or suspicious | 3 | 3 | 0 | suspiciousx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1 | pw-headed | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1 | pw-headed-quiet | automation_masked | automated or suspicious | 3 | 3 | 0 | humanx3 | 0/3 | 0–56% | — | botd-2.0.0:not_botx3 |
| pilot-1 | pw-dom-marker | browser_agent_synthetic | declared_agent/openai | 3 | 3 | 0 | declared_agentx3 | 3/3 | 44–100% | p1:declared_agent/openaix3 | botd-2.0.0:not_botx3 |
| pilot-1 | patchright-headed | automation_stealth | automated or suspicious | 3 | 3 | 0 | humanx3 | 0/3 | 0–56% | — | botd-2.0.0:not_botx3 |
| pilot-1 | nodriver-headed | automation_stealth | automated or suspicious | 3 | 0 | 3 | — | — | n/e | — | — |
| pilot-1 | zendriver-headed | automation_stealth | automated or suspicious | 3 | 0 | 3 | — | — | n/e | — | — |
| pilot-1 | ga4f-headless | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1 | ga4f-masked | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1 | fetch-nojs | crawler_nojs | no_event | 3 | 3 | 0 | no_eventx3 | 3/3 | 44–100% | — | — |
| pilot-1b | pw-headless | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1b | pw-headless-masked | automation | automated | 3 | 2 | 1 | automatedx2 | 2/2 | 34–100% | — | botd-2.0.0:bot/headless_chromex2 |
| pilot-1b | pw-headless-masked-quiet | automation_masked | automated or suspicious | 3 | 3 | 0 | suspiciousx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1b | pw-headed | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1b | pw-headed-quiet | automation_masked | automated or suspicious | 3 | 3 | 0 | humanx3 | 0/3 | 0–56% | — | botd-2.0.0:not_botx3 |
| pilot-1b | pw-dom-marker | browser_agent_synthetic | declared_agent/openai | 3 | 3 | 0 | declared_agentx3 | 3/3 | 44–100% | p1:declared_agent/openaix3 | botd-2.0.0:not_botx3 |
| pilot-1b | patchright-headed | automation_stealth | automated or suspicious | 3 | 3 | 0 | humanx3 | 0/3 | 0–56% | — | botd-2.0.0:not_botx3 |
| pilot-1b | nodriver-headed | automation_stealth | automated or suspicious | 3 | 3 | 0 | humanx3 | 0/3 | 0–56% | — | — |
| pilot-1b | zendriver-headed | automation_stealth | automated or suspicious | 3 | 3 | 0 | humanx3 | 0/3 | 0–56% | — | — |
| pilot-1b | ga4f-headless | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1b | ga4f-masked | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| pilot-1b | fetch-nojs | crawler_nojs | no_event | 3 | 3 | 0 | no_eventx3 | 3/3 | 44–100% | — | — |
| pilot-1c | pw-headless | automation | automated | 1 | 1 | 0 | automated | 1/1 | 21–100% | — | botd-2.0.0:bot/headless_chrome |
| pilot-1c | pw-headless-masked-quiet | automation_masked | automated or suspicious | 1 | 1 | 0 | suspicious | 1/1 | 21–100% | — | botd-2.0.0:bot/headless_chrome |
| round-2 | pw-headless | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| round-2 | pw-headless-masked | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| round-2 | pw-headless-masked-quiet | automation_masked | automated or suspicious | 3 | 3 | 0 | suspiciousx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| round-2 | pw-headed | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| round-2 | pw-headed-quiet | automation_masked | automated or suspicious | 3 | 3 | 0 | humanx3 | 0/3 | 0–56% | — | botd-2.0.0:not_botx3 |
| round-2 | pw-dom-marker | browser_agent_synthetic | declared_agent/openai | 3 | 3 | 0 | declared_agentx3 | 3/3 | 44–100% | p1:declared_agent/openaix3 | botd-2.0.0:not_botx3 |
| round-2 | patchright-headed | automation_stealth | automated or suspicious | 3 | 0 | 3 | — | — | n/e | — | — |
| round-2 | nodriver-headed | automation_stealth | automated or suspicious | 3 | 0 | 3 | — | — | n/e | — | — |
| round-2 | zendriver-headed | automation_stealth | automated or suspicious | 3 | 0 | 3 | — | — | n/e | — | — |
| round-2 | ga4f-headless | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| round-2 | ga4f-masked | automation | automated | 3 | 3 | 0 | automatedx3 | 3/3 | 44–100% | — | botd-2.0.0:bot/headless_chromex3 |
| round-2 | fetch-nojs | crawler_nojs | no_event | 3 | 3 | 0 | no_eventx3 | 3/3 | 44–100% | — | — |

<!-- notes: everything below is kept when the runner regenerates the tables -->

## Setup

- Target: Vanilla demo shop, GTM container with Visitor Verdict 1.1.0 (`worker: true`, `webgl: false`, debug via `vvdebug`), Vanilla collector with agent verification. macOS, one machine, strictly sequential runs, consent "accept all" clicked on page 1, 3 pages per run, at least 9.5 s per page.
- Tools: Playwright 1.65.0 (Chromium 158.0.8127.18 headless shell and bundled Chromium), Patchright 1.64.3 with Google Chrome 158.0.8127.36, nodriver 0.47.0 and zendriver 0.17.1 with Google Chrome 158, BotD 2.0.0 (lab injection after final). Not run: Camoufox (failed to launch on macOS in the v1.0 benchmark; large download), undetected-chromedriver (needs a matching chromedriver download), Puppeteer stealth (covered by the local suites).
- Rounds: **pilot-1** (36 runs) found runner problems, fixed in the runner only; **pilot-1b** (36 runs) reran the full set with the fixed runner; **pilot-1c** (2 runs) checked GA4 final-hit delivery with `--hold-after-final-ms 6000`. No detector code was changed. Rows are kept as recorded, including errors.

## Outcomes (pilot-1b, run units)

| Scenario | Worst class | Clear detection | Notes |
|---|---|---|---|
| Playwright headless (`pw-headless`, `ga4f-headless`) | `automated` 6/6 | 6/6 (61–100%) | `WD HL`; BotD bot |
| Headless, masked UA/UA-CH (`pw-headless-masked`, `ga4f-masked`) | `automated` 5/5 (1 network timeout) | 5/5 (57–100%) | still `WD`; `UB` also fires |
| Headless, masked UA/UA-CH, AutomationControlled off | `suspicious` 3/3 | 0/3; any detection 3/3 | only `UB` (CDP UA-CH override leaves worker brands empty); BotD says bot 3/3 |
| Headed Playwright defaults | `automated` 3/3 | 3/3 | `WD` |
| Headed, AutomationControlled off | `human` 3/3 | 0/3 (0–56%) | `NI`, sometimes `TP` from the consent click; BotD also not_bot |
| Synthetic OpenAI overlay marker | `declared_agent`/`openai` 3/3 | 3/3 | agent phase on page 1, `CD` carry to page 2, page 3 `human` (one-document carry, as designed) |
| Patchright, nodriver, zendriver (headed, Chrome) | `human` 9/9 | 0/9 (0–30%) | known misses; BotD not_bot for Patchright |
| Plain fetch | no event 3/3 | — | nothing reached the collector |

## Problems found

### Detector and integration (not fixed; input for the fix phase)

1. **Final-phase classes do not reach GA4 for visitors who leave quickly after the final.** Without a hold after the final event, no run in pilot-1/1b produced a captured GA4 `traffic_class` final hit. A separate check showed GA4 sends the batched final hit about 5 s after the final event; with a 6 s hold (pilot-1c) all three final hits were captured. A visitor who navigates within about 5 s after the 8-second final can therefore lose it. To confirm in the BigQuery export (are the hits lost or only not observed?).
2. **`suspicious` escalations at final are invisible downstream.** In `pw-headless-masked-quiet` the class becomes `suspicious` only at final (UB). All GA4 page events and all Vanilla events carry the initial `human`, and the collector counted those runs as `human`. Unless the final `traffic_class` hit is delivered (problem 1), the export shows these sessions as human.
3. **Vanilla never receives the final class directly.** Vanilla events carry the class current at send time; there is no Vanilla `traffic_class` event. Page 2 and 3 `page_view` hits are sent before the detector's initial result and carry no class (2 per run); the collector's sticky session memory relabels them, but `pending` share depends on that memory. Pre-consent `/d` pings had no class: `pings.pending=2` per run.
4. **UA-CH override alone produces `UB`.** Masking UA Client Hints through CDP leaves worker brands empty, which yields `suspicious` even without other evidence. This is the documented UB limitation (device emulation, CDP overrides); it worked in the detector's favour here, but it means a human using DevTools device emulation would look the same.
5. **Headed Chromium with AutomationControlled disabled is a clean miss** for both Visitor Verdict and BotD (known limit since v1.0). The consent click sometimes produced `TP`, below the corroboration threshold.
6. **Collector drops 3 requests per run as obvious bots even with a masked UA** (`dropped_obvious_bot=3` in all masked runs). Some requests still carried a headless user agent, probably unload/keepalive requests that do not use the page-level override. Unverified; needs a collector-side check.

### Runner and protocol (fixed in the runner during the pilot unless noted)

7. **Test route redirected and dropped `vvp`:** `/doprava.html` redirects to the cart when the cart is empty and removes the query (pilot-1, all scenarios: page 3 was the cart without `vvp`). Routes changed to `/`, `/hledat.html`, `/kosik.html`; the protocol now requires non-redirecting routes.
8. **Playwright request events missed unload requests;** capture moved to a CDP `Network` session plus a final `about:blank` navigation.
9. **Fixed dwell could read before the final:** the detector starts only after GTM loads it, so 9.5 s after navigation is sometimes less than 8 visible seconds after detector start (pilot-1 `pw-headless-masked` run 3, page 1 had no final). The runner now waits for the final, bounded.
10. **nodriver and zendriver runs hung in pilot-1** (0/6 completed): the redirect in problem 7 kept the driver waiting for the original URL, and `tab.sleep` in nodriver 0.47 returns early. Fixed (bounded wait, `asyncio.sleep`); 6/6 completed in pilot-1b.
11. **Collector counter deltas do not match observed requests (open):** the collector counted 12 POST hits per run where the runner observed 8, so the `possibly-contaminated` flag fires on every pilot-1/1c run and is not usable as a contamination test yet. Either some requests are invisible to the page's CDP session or the counting differs; needs a check against collector logs. Per-hit server labels (`vv_type`, `vv_detail`) are not observable from the client; they must come from the export.
12. **Python drivers capture no network labels** (`not_captured`); GA4 and Vanilla delivery for nodriver/zendriver can only be checked in the export.
13. **Collector restarted during one run** (pilot-1b `patchright-headed` run 2, `collector-restarted`); the delta for that run is unavailable.
14. **One network timeout** (pilot-1b `pw-headless-masked` run 3): recorded as error, not as a result.
15. **BotD reports `headless_chrome` for headed Playwright** with webdriver; its `botKind` is not a reliable headless indicator. BotD flagged masked headless with AutomationControlled off as bot where Visitor Verdict said only `suspicious`.

## Pending

- GA4 export check for the `ga4f-` pair (6 + 6 runs sent 11 GA4 hits each) after the daily export, at least 72 hours later; see the [protocol](../../../../docs/study/validation-protocol.md#ga4-known-bot-filtering-check). Vanilla dropped all `ga4f-headless` collector hits at entry (`dropped_obvious_bot=12` per run), so only the GTM path is tested.
- Manual runs (human panel, real browser agents, cloud agents, handoff, Clarity, webhooks).
- Second round after fixes, with `--hold-after-final-ms 6000` for delivery checks.
