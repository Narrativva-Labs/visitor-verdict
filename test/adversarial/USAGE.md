# Local adversarial benchmark

From the repository root:

```sh
bash test/adversarial/setup.sh
bash test/adversarial/run-all.sh
```

Setup creates `test/adversarial/.venv` (override with `TC_ADV_VENV`), installs exact direct Python/npm versions,
fetches Camoufox and the Patchright Chromium build. Puppeteer downloads its own
browser during npm installation. Python >=3.10 and Node 20+ are required. Setup
prefers `/opt/homebrew/bin/python3.13`, then `/opt/homebrew/bin/python3.11`, then
supported Python commands on PATH. `PYTHON` overrides selection and is checked.
An old/broken existing venv is rejected with rebuild instructions; it is never
silently reused or deleted.
Have desktop Chrome installed for Selenium, nodriver, undetected-chromedriver
and puppeteer-real-browser. Headed runs need an active desktop session. Setup
continues after individual tool installation failures and returns nonzero if
any required step failed. puppeteer-real-browser is an optional npm dependency;
its missing/unsupported installation becomes a recorded run error.

The root package.json and existing tests are independent. npm creates a local
package-lock.json here; later setup runs use npm ci. Direct Python requirements
are pinned; transitive dependencies and downloaded browsers may change. Setup
records pip freeze in test/results/adversarial/pip-freeze.txt; each run also
records tool and browser versions where available.

run-all owns the server on 127.0.0.1:8787: stop an already running test server
first. It runs all 18 scenarios sequentially in separate processes with fresh
profiles. Each navigation after the first uses a link click. The final page
waits 10 seconds. Human-like mode adds a 2.4 second dwell, curved native mouse
movement and a short rest before each click. No script-dispatched mouse events
or extra navigator patches are added by these runners. Default mode preserves
each library's native element-click behavior (including nodriver's click).

Read `test/results/adversarial-report.md` or `.json`. They contain initial/final
classes, scores and debug signal codes for every page, plus an **Ends human**
column for the full run. `unknown` means incomplete evidence or execution error.
There are no classification expectations or grades. Runner JSON and bounded
stdout/stderr logs live in `test/results/adversarial/`. The reports update after
every scenario. Errors do not stop subsequent tools; run-all exits 1 if any
execution was incomplete, regardless of the observed class.

Optional environment variables (apply to setup/run as relevant):

| Variable | Purpose |
|---|---|
| PYTHON | Python executable used to create the venv (setup only) |
| TC_ADV_VENV | Override venv path |
| TC_ADV_CHROME | Absolute Chrome executable path; used by Chrome launchers, including Patchright; Camoufox ignores it |
| TC_ADV_UC_MAJOR | Explicit installed Chrome major for undetected-chromedriver if its automatic driver selection mismatches |
| TC_ADV_TIMEOUT_MS | Per-process timeout, default 120000, minimum 30000 |
| TC_ADV_CAMOUFOX_LAUNCH_MS | Camoufox preparation/launch budget, default 300000 |
| TC_ADV_CAMOUFOX_TIMEOUT_MS | Camoufox process timeout, defaults to max(TC_ADV_TIMEOUT_MS, launch budget + 120000), normally 420000 |
| TC_ADV_CAMOUFOX_DISPLAY | `headed` (default; native macOS desktop) or `virtual` (Linux/Xvfb only) |

Camoufox uses its async API, explicit `headless=False` on macOS, `geoip=False`,
and no default addons (avoids first-run addon downloads on a local fixture).
GeoIP was not explicitly enabled in the old runner, so it is not a confirmed
cause of the previous stall. Browser fetch belongs in setup; if the browser cache
is missing, Camoufox may still fetch it during launch. The larger launch budget
covers that preparation and macOS first-open costs. An OS security prompt or a
missing desktop session still needs to be resolved locally.

The previous timeout logs did not identify a stage, so the cause remains unknown.
Other candidates are browser startup/driver connection, generated window sizing
conflicting with viewport emulation, or a stalled protocol evaluation. The runner
now disables viewport emulation, bounds operations (including evaluate and close),
and checkpoints before imports, launch, page creation and each navigation. It waits
for DOM content and visible-document readiness, never networkidle. A missing final
after the real 10-second wait is reported as an error, not awaited indefinitely.

Camoufox checkpoints include partial detector events from sessionStorage and the
test site's console mirror. They survive navigation, protocol hangs and process
timeouts. SIGTERM writes the last known evidence without calling the browser;
the supervisor also seeds an evidence file before spawning and keeps its hard
kill deadline. Reports show the last stage and failed stage. No event is invented
when launch times out before reaching the local site.

The benchmark reads only detector debug output from the test site's existing
`tc_test_events` storage mirror. Session storage is required; a missing final,
blocked storage or a hidden final tab is an execution error. Raw environment
signals, browser fingerprints, URLs outside the three fixture paths and pointer
traces are not collected. Tool downloads/driver discovery may access the network;
benchmark navigation targets only the local fixture. The production detector is
unchanged. No BotD or third-party detection site is used.

API references used for these adapters:
[undetected-chromedriver](https://github.com/ultrafunkamsterdam/undetected-chromedriver),
[nodriver](https://ultrafunkamsterdam.github.io/nodriver/nodriver/classes/tab.html),
[Camoufox](https://pypi.org/project/camoufox/0.4.11/),
[Selenium actions](https://www.selenium.dev/documentation/webdriver/actions_api/mouse/),
[Puppeteer Extra](https://github.com/berstend/puppeteer-extra),
[Rebrowser](https://github.com/rebrowser/rebrowser-patches),
[puppeteer-real-browser](https://github.com/ZFC-Digital/puppeteer-real-browser),
[Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs).

The code has only been checked statically here; dependency installation and real
browser execution are left to the owner. Package/browser/platform incompatibilities
are reported honestly and do not imply a detector classification result.
