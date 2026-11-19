"""One isolated tool/mode per process. Never inject detector patches or DOM input."""
import asyncio
import importlib.metadata
import json
import math
import os
from pathlib import Path
import signal
import sys
import time
import traceback

TOOL, MODE, OUTPUT = sys.argv[1:4]
if MODE not in ('default', 'human-like'):
    raise ValueError('Unknown mode')
PROTOCOL = json.loads(Path(__file__).with_name('protocol.json').read_text())
ORIGIN = 'http://127.0.0.1:8787'
RESULT = dict(tool=TOOL, mode=MODE, events=[], versions={}, notes=[])
STARTED = time.monotonic()


def save():
    temp = Path(OUTPUT + '.tmp')
    temp.write_text(json.dumps(RESULT, indent=2) + '\n')
    temp.replace(OUTPUT)


def checkpoint(stage):
    RESULT['stage'] = stage
    RESULT['elapsedSeconds'] = round(time.monotonic() - STARTED, 2)
    save()
    print(stage, flush=True)


def terminated(signum, frame):
    # Do not call the browser from a signal handler: its protocol may be hung.
    RESULT['error'] = 'Runner terminated by signal %s at stage: %s' % (signum, RESULT.get('stage'))
    save()
    os._exit(124)  # The supervisor kills this runner's remaining browser processes.


signal.signal(signal.SIGTERM, terminated)
signal.signal(signal.SIGINT, terminated)
checkpoint('starting Python runner')


def versions(*names):
    for name in names:
        RESULT['versions'][name] = importlib.metadata.version(name)


def capture(evaluate):
    RESULT['events'] = json.loads(evaluate(PROTOCOL['readEvents']))
    save()


def ready(evaluate, path):
    expr = PROTOCOL['ready'].replace('PATH', json.dumps(path))
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            if evaluate(expr):
                capture(evaluate)
                return
        except Exception:
            pass
        time.sleep(.1)
    raise RuntimeError('Visible loaded document not observed: ' + path)


def points(target):
    for i in range(31):
        t = i / 30
        ease = t * t * (3 - 2 * t)
        yield (round(30 + (target['x'] - 30) * ease),
               round(230 + (target['y'] - 230) * ease + math.sin(t * math.pi) * 30))


def run_selenium():
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.actions.action_builder import ActionBuilder
    from selenium.webdriver.common.actions.pointer_input import PointerInput
    versions('selenium')
    driver = None
    evaluate = None
    try:
        chrome = os.environ.get('TC_ADV_CHROME')
        if TOOL == 'undetected-chromedriver':
            import undetected_chromedriver as uc
            versions('undetected-chromedriver')
            kwargs = dict(headless=False, use_subprocess=True)
            if chrome:
                kwargs['browser_executable_path'] = chrome
            if os.environ.get('TC_ADV_UC_MAJOR'):
                kwargs['version_main'] = int(os.environ['TC_ADV_UC_MAJOR'])
            driver = uc.Chrome(**kwargs)
        else:
            options = webdriver.ChromeOptions()
            if chrome:
                options.binary_location = chrome
            if TOOL == 'selenium-headless':
                options.add_argument('--headless=new')
            driver = webdriver.Chrome(options=options)
        RESULT['browserVersion'] = driver.capabilities.get('browserVersion')
        RESULT['notes'].append('Fresh default profile; ' + ('headless' if TOOL == 'selenium-headless' else 'headed'))
        driver.set_page_load_timeout(20)
        driver.set_script_timeout(15)
        evaluate = lambda expr: driver.execute_script('return (' + expr + ');')
        driver.get(ORIGIN + PROTOCOL['paths'][0])
        ready(evaluate, PROTOCOL['paths'][0])
        for path in PROTOCOL['paths'][1:]:
            selector = 'a[href="' + path + '"]'
            if MODE == 'human-like':
                time.sleep(2.4)
                target = json.loads(evaluate(PROTOCOL['target'].replace('SELECTOR', json.dumps(selector))))
                actions = ActionBuilder(driver, mouse=PointerInput('mouse', 'adv-mouse'), duration=25)
                for x, y in points(target):
                    actions.pointer_action.move_to_location(x, y)
                    actions.pointer_action.pause(.022)
                actions.pointer_action.pause(.18)
                actions.pointer_action.click()
                actions.perform()
            else:
                driver.find_element(By.CSS_SELECTOR, selector).click()
            ready(evaluate, path)
        if MODE == 'human-like':
            actions = ActionBuilder(driver, mouse=PointerInput('mouse', 'adv-mouse'), duration=50)
            actions.pointer_action.move_to_location(40, 210)
            actions.pointer_action.move_to_location(300, 260)
            actions.perform()
        time.sleep(10)
        capture(evaluate)
    finally:
        if evaluate:
            try:
                capture(evaluate)
            except Exception:
                pass
        if driver:
            driver.quit()


async def run_camoufox():
    checkpoint('importing Camoufox')
    from camoufox.async_api import AsyncCamoufox
    from camoufox import DefaultAddons
    versions('camoufox', 'playwright')
    display = os.environ.get('TC_ADV_CAMOUFOX_DISPLAY', 'headed')
    if display not in ('headed', 'virtual'):
        raise ValueError('TC_ADV_CAMOUFOX_DISPLAY must be headed or virtual')
    if display == 'virtual' and sys.platform != 'linux':
        raise ValueError('Camoufox virtual display requires Linux/Xvfb; use headed on macOS')
    launch_ms = int(os.environ.get('TC_ADV_CAMOUFOX_LAUNCH_MS', '300000'))
    if launch_ms < 1000:
        raise ValueError('TC_ADV_CAMOUFOX_LAUNCH_MS must be at least 1000')
    RESULT['notes'].append('Camoufox %s; geoip=False; default addons excluded to avoid first-run addon downloads; no extra humanize option; no viewport emulation.' % display)
    manager = AsyncCamoufox(headless=False if display == 'headed' else 'virtual',
                            geoip=False, exclude_addons=list(DefaultAddons), timeout=launch_ms)
    page = None
    entered = False
    console_events = []

    def console_event(message):
        prefix = 'visitor-verdict-test:'
        if not message.text.startswith(prefix):
            return
        try:
            entry = json.loads(message.text[len(prefix):])
            if entry.get('path') not in PROTOCOL['paths'] or entry.get('event', {}).get('event') != 'traffic_class':
                return
            event = entry['event']
            clean = {'path': entry['path'], 'event': {key: event.get(key) for key in
                     ('event', 'traffic_class', 'traffic_phase', 'traffic_score', 'traffic_version', 'traffic_signals')}}
            console_events.append(clean)
            # Storage remains authoritative, with console supplying missing unload events.
            keys = {(e['path'], e['event']['traffic_phase']) for e in RESULT['events']}
            if (clean['path'], event['traffic_phase']) not in keys:
                RESULT['events'].append(clean)
            save()
        except (ValueError, KeyError, TypeError):
            pass

    async def step(stage, operation, seconds=15):
        checkpoint(stage)
        return await asyncio.wait_for(operation, timeout=seconds)

    async def collect():
        stored = json.loads(await asyncio.wait_for(page.evaluate(PROTOCOL['readEvents']), timeout=5))
        keys = {(e['path'], e['event']['traffic_phase']) for e in stored}
        RESULT['events'] = stored + [e for e in console_events
                                    if (e['path'], e['event']['traffic_phase']) not in keys]
        save()

    async def loaded(path):
        await step('waiting for visible document ' + path,
                   page.wait_for_function(PROTOCOL['ready'].replace('PATH', json.dumps(path)), timeout=15000), 17)
        await collect()

    try:
        browser = await step('launching Camoufox (includes first-run preparation/fetch if cache missing)',
                             manager.__aenter__(), launch_ms / 1000 + 5)
        entered = True
        RESULT['browserVersion'] = browser.version
        # Avoid conflicts between a generated window size and Playwright viewport sizing.
        page = await step('creating Camoufox page', browser.new_page(no_viewport=True))
        page.set_default_timeout(15000)
        page.set_default_navigation_timeout(20000)
        page.on('console', console_event)
        await step('bringing Camoufox page to front', page.bring_to_front())
        # No networkidle wait: the test site emits POSTs and uses a worker.
        await step('navigating to /index.html', page.goto(ORIGIN + PROTOCOL['paths'][0], wait_until='domcontentloaded'), 22)
        await loaded(PROTOCOL['paths'][0])
        for path in PROTOCOL['paths'][1:]:
            selector = 'a[href="' + path + '"]'
            if MODE == 'human-like':
                await asyncio.sleep(2.4)
                target = json.loads(await step('finding link to ' + path,
                    page.evaluate(PROTOCOL['target'].replace('SELECTOR', json.dumps(selector)))))
                async def approach():
                    for x, y in points(target):
                        await page.mouse.move(x, y)
                        await asyncio.sleep(.022)
                    await asyncio.sleep(.18)
                    await page.mouse.down()
                    await page.mouse.up()
                await step('mouse approach and click ' + path, approach())
            else:
                await step('clicking link to ' + path, page.locator(selector).click())
            await loaded(path)
        if MODE == 'human-like':
            await step('last-page mouse move', page.mouse.move(40, 210))
            await step('last-page mouse path', page.mouse.move(300, 260, steps=25))
        checkpoint('waiting 10 seconds for page 3 timed final')
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            await asyncio.sleep(min(1, max(0, deadline - time.monotonic())))
            await collect()
        await collect()
        if not any(e['path'] == '/page3.html' and e['event']['traffic_phase'] == 'final' for e in RESULT['events']):
            raise RuntimeError('Page 3 timed final missing after 10s; check visibility/focus (no synthetic final emitted)')
        checkpoint('Camoufox trace collected')
    except Exception:
        RESULT['error'] = traceback.format_exc()
        RESULT['failedStage'] = RESULT.get('stage')
        save()
        raise
    finally:
        if page:
            try:
                await collect()
            except Exception:
                pass
        # Save before cleanup too: a stuck browser close must not discard the trace.
        checkpoint('closing Camoufox')
        if entered:
            try:
                await asyncio.wait_for(manager.__aexit__(None, None, None), timeout=10)
            except Exception as error:
                RESULT['cleanupError'] = repr(error)
                save()


async def run_nodriver():
    import nodriver as nd
    versions('nodriver')
    browser = None
    tab = None

    async def evaluate(expr):
        return await tab.evaluate(expr, return_by_value=True)

    async def collect():
        RESULT['events'] = json.loads(await evaluate(PROTOCOL['readEvents']))
        save()

    async def loaded(path):
        expr = PROTOCOL['ready'].replace('PATH', json.dumps(path))
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            try:
                if await evaluate(expr):
                    await collect()
                    return
            except Exception:
                pass
            await asyncio.sleep(.1)
        raise RuntimeError('Visible loaded document not observed: ' + path)

    try:
        kwargs = dict(headless=False)
        if os.environ.get('TC_ADV_CHROME'):
            kwargs['browser_executable_path'] = os.environ['TC_ADV_CHROME']
        browser = await nd.start(**kwargs)
        RESULT['notes'].append('Nodriver headed default launch; CDP mouse input for human-like path.')
        tab = await browser.get(ORIGIN + PROTOCOL['paths'][0])
        await loaded(PROTOCOL['paths'][0])
        for path in PROTOCOL['paths'][1:]:
            selector = 'a[href="' + path + '"]'
            if MODE == 'human-like':
                await asyncio.sleep(2.4)
                target = json.loads(await evaluate(PROTOCOL['target'].replace('SELECTOR', json.dumps(selector))))
                for x, y in points(target):
                    await tab.send(nd.cdp.input_.dispatch_mouse_event('mouseMoved', x=x, y=y))
                    await asyncio.sleep(.022)
                await asyncio.sleep(.18)
                await tab.mouse_click(target['x'], target['y'])
            else:
                element = await tab.select(selector)
                await element.click()
            await loaded(path)
        if MODE == 'human-like':
            for x, y in [(40, 210), (100, 220), (200, 240), (300, 260)]:
                await tab.send(nd.cdp.input_.dispatch_mouse_event('mouseMoved', x=x, y=y))
                await asyncio.sleep(.05)
        await asyncio.sleep(10)
        await collect()
    finally:
        if tab:
            try:
                await collect()
            except Exception:
                pass
        if browser:
            browser.stop()


try:
    if sys.version_info < (3, 10):
        raise RuntimeError('Python >=3.10 required; rebuild the venv with setup.sh (Python %s)' % sys.version.split()[0])
    if TOOL == 'nodriver':
        asyncio.run(run_nodriver())
    elif TOOL == 'camoufox':
        asyncio.run(run_camoufox())
    elif TOOL in ('undetected-chromedriver', 'selenium-headed', 'selenium-headless'):
        run_selenium()
    else:
        raise ValueError('Unknown tool: ' + TOOL)
except Exception:
    RESULT['error'] = traceback.format_exc()
finally:
    save()
sys.exit(1 if RESULT.get('error') or RESULT.get('cleanupError') else 0)
