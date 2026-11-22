"""CDP driver for the validation runner: nodriver or zendriver, installed Google Chrome.

Called by test/validation/run.mjs with one JSON argument:
  {"tool": "nodriver"|"zendriver", "urls": [...], "dwellMs": 9500, "consentSelector": "..."|null}
Prints one JSON line: {"toolVersion", "browserVersion", "pages": [{"snapshot", "events"}], "error"?}
Labels only: classes, phases, operator enums and debug codes. No page content or identifiers.
"""
import asyncio
import importlib.metadata
import json
import re
import sys
import time

READ = """JSON.stringify((() => {
  const s = window.__visitorVerdict ? Object.assign({}, window.__visitorVerdict) : null;
  const events = (window.dataLayer || []).filter(e => e && e.event === 'traffic_class').map(e => ({
    phase: e.traffic_phase, class: e.traffic_class, score: e.traffic_score, version: e.traffic_version,
    agent: e.traffic_agent, signals: Array.isArray(e.traffic_signals) ? e.traffic_signals.slice(0, 40) : undefined}));
  return {snapshot: s, events: events, visibility: document.visibilityState, ageMs: Math.round(performance.now()), focus: document.hasFocus()};
})())"""


HAS_FINAL = "(window.dataLayer || []).some(e => e && e.event === 'traffic_class' && e.traffic_phase === 'final')"


def log(*parts):
    # Progress for debugging, stderr only (no page data).
    print(*parts, file=sys.stderr, flush=True)


def emit(payload):
    print(json.dumps(payload), flush=True)


async def run(spec):
    tool = spec["tool"]
    try:
        lib = __import__(tool)
    except ImportError:
        emit({"skip": True, "error": f"{tool} not installed in this interpreter"})
        return
    result = {"toolVersion": importlib.metadata.version(tool), "browserVersion": "", "pages": []}
    # Same anti-throttling flags Playwright passes by default, so an occluded window
    # does not report hidden and pause the detector's visible-time window.
    browser = await lib.start(headless=False, browser_args=[
        "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling"])
    try:
        tab = None
        for index, url in enumerate(spec["urls"]):
            loaded = time.monotonic()
            tab = await browser.get(url) if tab is None else await tab.get(url)
            await asyncio.sleep(0.5)
            try:
                await tab.activate()
            except Exception:
                pass
            if index == 0:
                ua = await tab.evaluate("navigator.userAgent")
                match = re.search(r"Chrome/([\d.]+)", str(ua))
                result["browserVersion"] = match.group(1) if match else ""
                if spec.get("consentSelector"):
                    await asyncio.sleep(1.0)
                    button = await tab.select(spec["consentSelector"], timeout=5)
                    # Native mouse input through CDP, as a library user would click.
                    await button.mouse_click()
            # asyncio.sleep, not tab.sleep: nodriver 0.47 returns from tab.sleep early.
            # Dwell relative to the document's own clock: some drivers return from
            # navigation before the new document exists.
            deadline = loaded + spec["dwellMs"] / 1000 + 15
            while time.monotonic() < deadline:
                age = await tab.evaluate("location.href === %s ? performance.now() : -1" % json.dumps(url))
                age = float(age) if isinstance(age, (int, float)) else -1.0
                remaining = spec["dwellMs"] / 1000 - (age / 1000 if age >= 0 else 0)
                if age >= 0 and remaining <= 0:
                    break
                await asyncio.sleep(min(max(remaining, 0.25), 2.0))
            # The detector starts after the tag manager loads it, so its 8-second final
            # can land after the minimum dwell: wait for it, bounded.
            for _ in range(40):
                has_final = await tab.evaluate(HAS_FINAL)
                if has_final is True:
                    break
                await asyncio.sleep(0.25)
            raw = await tab.evaluate(READ)
            result["pages"].append(json.loads(raw if isinstance(raw, str) else json.dumps(raw)))
    except Exception as error:  # report without page data
        result["error"] = type(error).__name__
        log(type(error).__name__)
    finally:
        try:
            stopped = browser.stop()
            if asyncio.iscoroutine(stopped):
                await stopped
        except Exception:
            pass
    emit(result)


if __name__ == "__main__":
    spec = json.loads(sys.argv[1])
    try:
        lib_loop = None
        try:
            lib_loop = __import__(spec["tool"]).loop  # nodriver expects its own loop
        except Exception:
            pass
        if spec["tool"] == "nodriver" and lib_loop:
            lib_loop().run_until_complete(run(spec))
        else:
            asyncio.run(run(spec))
    except Exception as error:
        emit({"error": type(error).__name__, "pages": []})
