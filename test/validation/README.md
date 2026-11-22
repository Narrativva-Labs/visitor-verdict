# Validation runner

Automated part of the [validation protocol v2](../../docs/study/validation-protocol.md). It runs scenarios with a known true class against a site the project operates and appends one row per run to `results/<date>/runs.csv`, then regenerates the tables in `results/<date>/summary.md` (text below the notes marker is kept).

```sh
# Smoke test against the local test site (no network traffic to the demo)
node test/validation/run.mjs --target local --n 1 --pages 2

# Pilot round on the demo shop
VV_VALIDATION_TOOLS=<dir containing node_modules/patchright> \
VV_VALIDATION_NODRIVER_PY=<python with nodriver> \
VV_VALIDATION_ZENDRIVER_PY=<python with zendriver> \
node test/validation/run.mjs --target demo --n 3 --round pilot-1
```

Options: `--scenarios a,b`, `--pages 1..3`, `--dwell-ms` (per page, at least 9000 so the detector's 8-second final is reached), `--gap-ms` between runs, `--consent all|necessary|none` (cookie-banner choice on the first page), `--no-debug` (no `vvdebug`, no signal codes), `--no-botd`, `--hold-after-final-ms` (stay on each page after its final; GA4 batches hits and sends the final `traffic_class` hit about 5 s after the final event, so delivery checks need about 6000), `--round <name>`, `--out <dir>`. `--help` lists everything.

Targets are a fixed allowlist in `run.mjs` (`demo`, `local`). Do not add sites the project does not operate.

## Scenarios

| Id | True class | Tool | Expected worst class |
|---|---|---|---|
| `pw-headless` | automation | Playwright headless shell | `automated` |
| `pw-headless-masked` | automation | Playwright headless, UA and UA-CH overridden via CDP | `automated` |
| `pw-headless-masked-quiet` | automation_masked | as above plus `--disable-blink-features=AutomationControlled` | `automated` or `suspicious` |
| `pw-headed` | automation | Playwright headed Chromium | `automated` |
| `pw-headed-quiet` | automation_masked | headed, AutomationControlled disabled | `automated` or `suspicious` |
| `pw-dom-marker` | browser_agent_synthetic | headed quiet, `codex-agent-overlay-root` added 2 s after load on page 1 | `declared_agent` / `openai` |
| `patchright-headed` | automation_stealth | Patchright with installed Google Chrome | `automated` or `suspicious` (known miss) |
| `nodriver-headed` | automation_stealth | nodriver, installed Google Chrome | `automated` or `suspicious` (known miss) |
| `zendriver-headed` | automation_stealth | zendriver, installed Google Chrome | `automated` or `suspicious` (known miss) |
| `ga4f-headless` | automation | Playwright headless (GA4 filtering pair, run id `ga4f-headless-…`) | `automated` |
| `ga4f-masked` | automation | headless with masked UA/UA-CH (run id `ga4f-masked-…`) | `automated` |
| `fetch-nojs` | crawler_nojs | plain HTTP GET | no event |

Each run: fresh browser, every page (demo: `/`, `/hledat.html`, `/kosik.html`; checkout pages redirect to the cart when it is empty and drop the query) loads with `?vvp=<run_id>&vvdebug=1`; the cookie-banner choice is clicked with the tool's native click after 1.5 s; every page is held at least `--dwell-ms` and then until its final event (at most 10 s more, because the detector starts only after GTM loads it); then the data layer and `window.__visitorVerdict` are read in the page's main world. Pages are opened with `goto` (not link clicks) so `vvp` stays on every URL. GA4 and Vanilla requests are observed through a CDP `Network` session, because Playwright's request events miss some unload beacons. After the last page the run navigates to `about:blank` and waits 2.5 s so unload beacons are sent. BotD is injected on the last page only after the final result (lab comparison; it changes the page environment). Runs are sequential; collector `/health` counters are read before and after each run. The Python drivers (nodriver, zendriver) read the same page data but do not capture network labels.

Optional tools are not dependencies of this repository. Install them in a separate directory (for example `npm install patchright` and a Python venv with `pip install nodriver zendriver`) and point the environment variables at them. A missing tool gives `status=skip`, never a detection result. `cdp-driver.py` is the Python side for nodriver and zendriver; it uses `asyncio.sleep` because `tab.sleep` in nodriver 0.47 can return early.

## Columns of `runs.csv`

`run_id`, `round`, `scenario`, `true_class`, `expected_vv`, `tool`, `tool_version`, `browser_version`, `headless`, `consent`, `debug`, `started_at`, `ended_at` (UTC), `status` (`complete`, `incomplete`, `skip`, `error`), `pages_completed`, `vv_initial` (page 1 initial), `vv_final` (last page final), `vv_worst` (worst class across all pages and phases), `vv_agent_phase` (agent-phase events, `p<page>:class/operator`), `traffic_agent`, `vv_pages` (per page `i:`/`a:`/`f:` phase classes; `[hidden]` if the page was not visible at readout), `signals` (debug codes, only with `vvdebug`), `ga4_hits` and `ga4_labels` (captured `/g/collect` hits as `event:class/phase/agent`), `vanilla_labels` (`e|d:event:class/phase/agent`), `vanilla_server_delta` (aggregate collector counter changes during the run), `botd_result`, `match` (worst class in the expected set, plus the expected operator), `notes` (fixed codes).

No IPs, client or session IDs, cookies, user-agent strings, page URLs or page content are written.
