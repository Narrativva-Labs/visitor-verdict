import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {observationDwell, nativeDeviceContext} from './support.mjs';
export async function runContracts(detectorSource) {
  const source = detectorSource || await readFile(new URL('../src/visitor-verdict.js', import.meta.url), 'utf8');
  const results = [];
  function fixture(options = {}) {
    let now = options.now ?? 10000, next = 0;
    const timers = new Map(), listeners = {}, store = options.store || new Map(), registrations = [], removals = [];
    const document = {visibilityState: 'visible', hasFocus: () => true,
      addEventListener: function (name, fn, opts) {
        if (options.passive) void opts?.passive;
        if (options.legacy && typeof opts === 'object') throw Error('Old listener API');
        registrations.push({name, fn, opts, target: this === window ? 'window' : 'document'}); listeners[name] = fn;
      },
      removeEventListener: (name, fn, opts) => {removals.push({name, fn, opts}); delete listeners[name];},
      createElement: () => ({getContext: () => null})};
    const window = {screen: {width: 1440, height: 900}, innerWidth: 1440, innerHeight: 900,
      outerWidth: 1440, outerHeight: 960, chrome: {},
      sessionStorage: {getItem: key => store.get(key), setItem: (key, value) => store.set(key, value)},
      addEventListener: document.addEventListener, removeEventListener: document.removeEventListener,
      setTimeout: (fn, delay) => {timers.set(++next, {fn, at: now + delay}); return next;},
      clearTimeout: id => timers.delete(id), trafficClassConfig: options.config || {debug: true, webgl: true, worker: true}};
    window.top = window;
    const navigator = {language: 'en', userAgent: 'Chrome/140.0 Desktop', languages: ['en'], plugins: {length: 5}, hardwareConcurrency: 8};
    options.modify?.({window, document, navigator, store});
    const context = vm.createContext({window, document, navigator, Date: {now: () => now}, ...(options.withoutJSON ? {JSON: undefined} : {})});
    vm.runInContext(source, context);
    return {window, document, navigator, store, context, timers, listeners, registrations, removals,
      emit: (type, event = {}) => listeners[type]?.({type, ...event}),
      advance(ms) {
        now += ms;
        for (const [id, timer] of timers) if (timer.at <= now) {timers.delete(id); timer.fn();}
      }};
  }
  async function test(name, fn) {
    try { await fn(); results.push({name, status: 'PASS'}); }
    catch (error) { results.push({name, status: 'FAIL', error: String(error)}); }
  }
  await test('Mobile human context preserves device geometry/touch without any UA override', () => {
    const device = {userAgent: 'device UA', defaultBrowserType: 'chromium', viewport: {width: 393, height: 727},
      screen: {width: 393, height: 851}, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true};
    const before = JSON.stringify(device);
    const native = nativeDeviceContext(device);
    assert.deepEqual(native, {viewport: device.viewport, screen: device.screen,
      deviceScaleFactor: 2.75, isMobile: true, hasTouch: true});
    const tablet = nativeDeviceContext(device, {viewport: {width: 800, height: 1280}, userAgent: 'accidental override'});
    assert.ok(!Object.hasOwn(tablet, 'userAgent'));
    assert.deepEqual(tablet.viewport, {width: 800, height: 1280});
    assert.equal(JSON.stringify(device), before);
    // The deliberate DevTools scenario uses the original descriptor unchanged.
    assert.equal(device.userAgent, 'device UA');
  });
  await test('GTM current class reads live state then legacy/provenance storage; final event/property retained', async () => {
    const {containerVersion: c} = JSON.parse(await readFile(new URL('../gtm/container-import.json', import.meta.url), 'utf8'));
    assert.ok(!c.tag.some(t => t.name === 'VV - gtag set traffic_class'));
    assert.ok(!c.trigger.some(t => t.name === 'traffic_class both phases'));
    const variable = c.variable.find(v => v.name === 'VV - current class');
    assert.equal(variable.type, 'jsm');
    const script = '(' + variable.parameter.find(p => p.key === 'javascript').value + ')()';
    const evaluate = window => vm.runInNewContext(script, {window});
    const window = {__trafficClass: {class: 'human'}, sessionStorage: {
      getItem: key => {assert.equal(key, 'traffic_class'); return JSON.stringify({lastClass: 'automated'});},
      setItem: () => {throw Error('Must never write storage');}
    }};
    assert.equal(evaluate(window), 'human', 'Current page wins over storage');
    window.__trafficClass.class = 'suspicious';
    assert.equal(evaluate(window), 'suspicious', 'Re-evaluate at each tag fire');
    delete window.__trafficClass;
    assert.equal(evaluate(window), 'automated');
    for (const lastClass of ['human', 'suspicious', 'automated', 'declared_agent',
      {value: 'automated', direct: true}, {value: 'declared_agent', direct: false}]) {
      window.sessionStorage.getItem = () => JSON.stringify({lastClass});
      assert.equal(evaluate(window), typeof lastClass === 'string' ? lastClass : lastClass.value);
    }
    for (const raw of [null, '', '{', 'null', '{}', '{"lastClass":"bogus"}',
      '{"lastClass":100}', '{"lastClass":{"value":"bogus"}}']) {
      window.sessionStorage.getItem = () => raw;
      assert.equal(evaluate(window), undefined, 'Missing/invalid data stays unknown');
    }
    Object.defineProperty(window, 'sessionStorage', {get() {throw Error('Blocked');}});
    assert.equal(evaluate(window), undefined);
    window.__trafficClass = {class: 'declared_agent'};
    assert.equal(evaluate(window), 'declared_agent', 'Live state works with blocked storage');
    const final = c.tag.find(t => t.name === 'GA4 - traffic_class');
    const finalTrigger = c.trigger.find(t => final.firingTriggerId.includes(t.triggerId));
    assert.equal(finalTrigger.filter[0].parameter.find(p => p.key === 'arg1').value, 'final');
    const mappings = key => final.parameter.find(p => p.key === key).list.map(row =>
      Object.fromEntries(row.map.map(p => [p.key, p.value])));
    assert.deepEqual(mappings('eventSettingsTable'), ['traffic_class', 'traffic_phase', 'traffic_score']
      .map(name => ({parameter: name, parameterValue: '{{' + (name === 'traffic_class' ? 'VV - current class' : name) + '}}'})));
    assert.deepEqual(mappings('userProperties'), [{name: 'traffic_class', value: '{{traffic_class}}'}]);
  });
  await test('Initial synchronous; final once after 8000 visible ms; idle alone stays human', () => {
    const f = fixture();
    assert.equal(f.window.dataLayer.length, 1);
    assert.equal(f.window.__trafficClass.phase, 'initial');
    f.advance(7999); assert.equal(f.window.dataLayer.length, 1);
    f.advance(1); assert.equal(f.window.__trafficClass.phase, 'final');
    assert.equal(f.window.__trafficClass.class, 'human');
    f.emit('pagehide'); f.advance(9000); assert.equal(f.window.dataLayer.length, 2);
  });
  await test('Hidden time pauses countdown; pagehide finalizes while hidden', () => {
    const f = fixture(); f.advance(3000);
    f.document.visibilityState = 'hidden'; f.emit('visibilitychange'); f.advance(50000);
    assert.equal(f.window.dataLayer.length, 1);
    f.document.visibilityState = 'visible'; f.emit('visibilitychange');
    f.advance(4999); assert.equal(f.window.dataLayer.length, 1);
    f.advance(1); assert.equal(f.window.dataLayer.length, 2);
    const hidden = fixture({modify: ({document}) => {document.visibilityState = 'hidden';}});
    hidden.advance(9000); assert.equal(hidden.window.dataLayer.length, 1);
    hidden.emit('pagehide'); assert.equal(hidden.window.dataLayer.length, 2);
  });
  await test('Declared takes precedence over webdriver; hard classes persist in final', () => {
    for (const agent of [true, false]) {
      const f = fixture({modify: ({navigator}) => {navigator.webdriver = true; if (agent) navigator.userAgent = 'ChatGPT-User';}});
      const expected = agent ? 'declared_agent' : 'automated';
      assert.equal(f.window.__trafficClass.class, expected); f.advance(8000);
      assert.equal(f.window.__trafficClass.class, expected);
    }
  });
  await test('Debug off exposes no signals; custom data layer and config work; duplicate load guarded', () => {
    const f = fixture({config: {debug: false, idleMs: 25, dataLayerName: 'custom'}});
    assert.ok(!('signals' in f.window.__trafficClass));
    assert.ok(!('traffic_signals' in f.window.custom[0]));
    vm.runInContext(source, f.context); f.advance(25);
    assert.equal(f.window.custom.length, 2);
  });
  await test('Storage denied does not prevent either phase', () => {
    const f = fixture({modify: ({window}) => Object.defineProperty(window, 'sessionStorage', {get() {throw Error('denied');}})});
    f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
  });
  await test('Mobile Chrome skips empty plugins; desktop checks them', () => {
    for (const mobile of [true, false]) {
      const f = fixture({modify: ({navigator}) => {navigator.plugins.length = 0; if (mobile) navigator.userAgent += ' Android Mobile';}});
      assert.equal(f.window.__trafficClass.signals.includes('PL'), !mobile);
    }
  });
  await test('Synthetic-only and inactivity share a 2-point cap; any trusted modality removes both', () => {
    const f = fixture(); f.emit('mousemove', {isTrusted: false}); f.advance(8000);
    assert.equal(f.window.__trafficClass.class, 'human');
    assert.ok(f.window.__trafficClass.signals.includes('SY'));
    const g = fixture(); g.emit('mousemove', {isTrusted: false}); g.emit('pointerdown', {isTrusted: true}); g.advance(8000);
    assert.equal(g.window.__trafficClass.class, 'human');
    assert.ok(!g.window.__trafficClass.signals.includes('SY'));
  });
  await test('F8 fast navigation is final only; timestamps bounded to fastNavCount and rounded', () => {
    const f = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({timestamps: [9031, 9575]}))});
    assert.ok(!f.window.__trafficClass.signals.includes('FN')); f.advance(8000);
    assert.ok(f.window.__trafficClass.signals.includes('FN'));
    assert.equal(f.window.__trafficClass.class, 'human'); // FN + NI + WG is benign
    const g = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({timestamps: Array.from({length: 30}, (_, i) => 7000 + i * 100)}))});
    assert.deepEqual(JSON.parse(g.store.get('traffic_class')).timestamps, [9800, 9900, 10000]);
  });
  await test('Async notification mismatch only enters final phase', async () => {
    const f = fixture({modify: ({window, navigator}) => {
      window.Notification = {permission: 'denied'}; window.isSecureContext = true;
      navigator.userAgentData = {brands: [{brand: 'Chromium'}]};
      navigator.permissions = {query: () => Promise.resolve({state: 'prompt'})};
    }});
    await Promise.resolve();
    assert.ok(!f.window.__trafficClass.signals.includes('NP'));
    f.advance(8000); assert.ok(f.window.__trafficClass.signals.includes('NP'));
  });
  await test('Requested automation globals detected including non-enumerable keys', () => {
    for (const [target, name] of [['window', '__playwright__binding__'], ['window', '__playwright__binding__controller__'], ['window', '__pwInitScripts'], ['document', '$cdc_marker'], ['document', '$wdc_marker'], ['window', 'cdc_abc_Array'], ['document', '__webdriver_evaluate']]) {
      const f = fixture({modify: objects => Object.defineProperty(objects[target], name, {value: function () {}})});
      assert.equal(f.window.__trafficClass.class, 'automated', name);
    }
  });
  await test('NI requires 8000 visible ms; early pagehide and hidden time cannot fake it', () => {
    const f = fixture(); f.advance(7999); f.emit('pagehide');
    assert.ok(!f.window.__trafficClass.signals.includes('NI'));
    const g = fixture(); g.advance(8000); assert.ok(g.window.__trafficClass.signals.includes('NI'));
  });
  await test('F3 FN plus NI plus one environment family stays human at threshold 6', () => {
    for (const geometry of [false, true]) {
      const f = fixture({modify: ({window, document, store}) => {
        document.createElement = () => ({getContext: () => ({getExtension: () => null})});
        if (geometry) window.screen = {width: 800, height: 600};
        store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}));
      }});
      f.advance(8000);
      assert.equal(f.window.__trafficClass.score, geometry ? 6 : 5);
      assert.equal(f.window.__trafficClass.class, 'human');
    }
    const two = fixture({config: {debug: true, suspiciousThreshold: 3}, modify: ({document, store}) => {
      document.createElement = () => ({getContext: () => ({getExtension: () => null})});
      store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}));
    }});
    two.advance(8000); assert.equal(two.window.__trafficClass.class, 'human');
  });
  await test('Geometry cap, focus gate, language fallback, PDF-disabled and HC safeguards', () => {
    const f = fixture({modify: ({window, navigator}) => {
      window.screen = {width: 800, height: 600}; window.outerWidth = 0; window.outerHeight = 0;
      navigator.languages = []; navigator.plugins.length = 0; navigator.pdfViewerEnabled = false; navigator.hardwareConcurrency = 0;
    }});
    assert.equal(f.window.__trafficClass.score, 2); // geometry 1 + missing WebGL 1
    assert.ok(f.window.__trafficClass.signals.includes('G0'));
    assert.ok(!f.window.__trafficClass.signals.includes('LA'));
    assert.ok(!f.window.__trafficClass.signals.includes('PL'));
    const g = fixture({modify: ({window, document}) => {
      window.outerWidth = window.outerHeight = 0; document.hasFocus = () => false;
    }});
    assert.ok(!g.window.__trafficClass.signals.includes('G0'));
  });
  function headlessGeometry({window, document}) {
    window.screen = {width: 1366, height: 900, availWidth: 1366, availHeight: 900};
    window.innerWidth = window.outerWidth = 1366;
    window.innerHeight = window.outerHeight = 900;
    document.fullscreenElement = null;
    window.matchMedia = () => ({matches: false});
  }
  await test('HW is benign geometry weight 2, shares the family cap, and needs corroboration', () => {
    const alone = fixture({config: {debug: true}, modify: headlessGeometry});
    assert.ok(alone.window.__trafficClass.signals.includes('HW'));
    assert.equal(alone.window.__trafficClass.score, 2);
    alone.emit('keydown', {isTrusted: true}); alone.advance(8000);
    assert.equal(alone.window.__trafficClass.class, 'human');
    assert.equal(alone.window.__trafficClass.score, 2);
    for (const graphics of [false, true]) {
      const f = fixture({config: {debug: true, webgl: graphics}, modify: objects => {
        headlessGeometry(objects);
        objects.store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}));
      }});
      f.advance(8000);
      assert.ok(['HW', 'FN', 'NI'].every(code => f.window.__trafficClass.signals.includes(code)));
      assert.equal(f.window.__trafficClass.score, graphics ? 8 : 7);
      assert.equal(f.window.__trafficClass.class, graphics ? 'suspicious' : 'human');
    }
    const capped = fixture({config: {debug: true}, modify: objects => {
      headlessGeometry(objects);
      objects.window.screen.width = objects.window.screen.availWidth = objects.window.innerWidth = objects.window.outerWidth = 1280;
      objects.window.screen.height = objects.window.screen.availHeight = objects.window.innerHeight = objects.window.outerHeight = 720;
    }});
    assert.ok(['GS', 'HW'].every(code => capped.window.__trafficClass.signals.includes(code)));
    assert.equal(capped.window.__trafficClass.score, 2);
  });
  await test('HW requires every dimension, desktop, visible focus and known non-fullscreen modes', () => {
    const guards = [
      ({window}) => {window.outerWidth++;}, ({window}) => {window.outerHeight++;},
      ({window}) => {window.screen.width++;}, ({window}) => {window.screen.height++;},
      ({window}) => {window.screen.availWidth--;}, ({window}) => {window.screen.availHeight--;},
      ({window}) => {delete window.screen.availHeight;},
      ({window}) => {window.innerWidth = window.outerWidth = window.screen.width = window.screen.availWidth = 0;},
      ({document}) => {document.visibilityState = 'hidden';},
      ({document}) => {document.visibilityState = undefined;},
      ({document}) => {document.hasFocus = () => false;},
      ({document}) => {document.fullscreenElement = {};},
      ({document}) => {delete document.fullscreenElement;},
      ({window}) => {window.matchMedia = undefined;},
      ({window}) => {window.matchMedia = () => {throw Error('unavailable');};},
      ...['fullscreen', 'standalone'].map(mode => ({window}) => {window.matchMedia = query => ({matches: query === `(display-mode: ${mode})`});}),
      ...['Chrome/140.0 Android Mobile', 'iPhone Version/18.0 Safari/605.1', 'Chrome/140.0 Android', 'Chrome/140.0; wv)']
        .map(ua => ({navigator}) => {navigator.userAgent = ua;}),
      ({navigator}) => {navigator.userAgent = 'Macintosh Safari/605.1'; navigator.maxTouchPoints = 5;}
    ];
    for (const [index, guard] of guards.entries()) {
      const f = fixture({config: {debug: true}, modify: objects => {headlessGeometry(objects); guard(objects);}});
      f.emit('pagehide');
      assert.ok(!f.window.dataLayer.some(event => event.traffic_signals.includes('HW')), `HW guard ${index}`);
      assert.equal(f.window.__trafficClass.class, 'human', `HW guard ${index}`);
    }
    const frame = fixture({modify: objects => {headlessGeometry(objects); objects.window.top = {};}});
    assert.equal(frame.window.dataLayer, undefined);
  });
  await test('HW rechecks final geometry after hidden/unfocused initial; real Mac window remains human', () => {
    for (const hidden of [false, true]) {
      const f = fixture({config: {debug: true}, modify: objects => {
        headlessGeometry(objects);
        objects.document.hasFocus = () => hidden;
        if (hidden) objects.document.visibilityState = 'hidden';
      }});
      assert.ok(!f.window.__trafficClass.signals.includes('HW'));
      f.document.hasFocus = () => true; f.document.visibilityState = 'visible'; f.emit('visibilitychange');
      f.emit('keydown', {isTrusted: true}); f.advance(8000);
      assert.ok(f.window.__trafficClass.signals.includes('HW'));
      assert.equal(f.window.__trafficClass.class, 'human');
    }
    const real = fixture({config: {debug: true}, modify: objects => {
      headlessGeometry(objects);
      objects.window.outerHeight += 87;
      objects.window.screen = {width: 1710, height: 1112, availWidth: 1710, availHeight: 998};
    }});
    real.advance(8000);
    assert.ok(!real.window.__trafficClass.signals.includes('HW'));
    assert.equal(real.window.__trafficClass.class, 'human');
  });
  await test('Missing WebGL debug extension and hardware Mesa renderer are not WG', () => {
    for (const renderer of [null, 'Mesa Intel Graphics', 'ANGLE (Apple M1)', 'Google SwiftShader', 'llvmpipe (LLVM 15)', 'Mesa OffScreen']) {
      const f = fixture({modify: ({document}) => {
        document.createElement = () => ({getContext: () => ({getExtension: name => name === 'WEBGL_debug_renderer_info' && renderer ? {} : null, getParameter: () => renderer})});
      }});
      assert.equal(f.window.__trafficClass.signals.includes('WG'), /SwiftShader|llvmpipe|OffScreen/.test(renderer || ''));
    }
  });
  await test('PW exact shapes only, late recheck; nonexistent Puppeteer label ignored', () => {
    const f = fixture({modify: ({window}) => {
      window.__playwright_app = {}; window.__puppeteer_evaluation_script__ = {};
      window.__pwInitScripts = true;
    }});
    assert.equal(f.window.__trafficClass.class, 'human');
    f.window.__playwright__binding__controller__ = {}; f.advance(8000);
    assert.equal(f.window.__trafficClass.class, 'automated');
    assert.ok(f.window.__trafficClass.signals.includes('PW'));
  });
  await test('FN ignores duplicate/future/bad timestamps and reload/back-forward navigation', () => {
    for (const type of ['reload', 'back_forward']) {
      const f = fixture({modify: ({window, store}) => {
        window.performance = {getEntriesByType: () => [{type}]};
        store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500, 9500, -1, 999999, 'bad']}));
      }});
      f.advance(8000); assert.ok(!f.window.__trafficClass.signals.includes('FN'));
      assert.deepEqual(JSON.parse(f.store.get('traffic_class')).timestamps, [9000, 9500]);
    }
  });
  await test('Research token boundaries and score sentinel', () => {
    for (const [ua, agent] of [['Claude-Agent/1.0', true], ['Google-Agent', true], ['ChatGPT Agent', false], ['NotChatGPT-User', false], ['Applebot-Extended', false]]) {
      const f = fixture({modify: ({navigator}) => {navigator.userAgent = ua;}});
      assert.equal(f.window.__trafficClass.class, agent ? 'declared_agent' : 'human');
      if (agent) assert.equal(f.window.__trafficClass.score, 100);
    }
  });
  function mouse(f, type, x, y, extra = {}) {
    if (type === 'click') f.emit('pointerdown', {isTrusted: true, ...extra, pointerType: extra.pointerType === undefined ? 'mouse' : extra.pointerType});
    f.emit(type, {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: x, clientY: y, ...extra});
  }
  function jump(f, x = 320, y = 320) {
    mouse(f, 'mousemove', x, y, {movementX: 320, movementY: 0});
    mouse(f, 'click', x, y);
  }
  await test('F1 TP needs positive jump evidence; absent or sparse movement is inconclusive', () => {
    for (const mode of ['none', 'single', 'stale', 'distant-click']) {
      const f = fixture();
      if (mode !== 'none') mouse(f, 'mousemove', 100, 100);
      if (mode === 'stale') {f.advance(1200); mouse(f, 'mousemove', 400, 400);}
      mouse(f, 'click', mode === 'distant-click' ? 400 : 100, mode === 'distant-click' ? 400 : 100);
      f.emit('pagehide');
      assert.ok(!f.window.__trafficClass.signals.includes('TP'), mode);
      assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 0);
    }
  });
  await test('F1 TP catches one-event delta or recent observed-position jump before navigation', () => {
    for (const delta of [true, false]) {
      const f = fixture();
      if (delta) jump(f);
      else {mouse(f, 'mousemove', 10, 10); f.advance(150); mouse(f, 'mousemove', 320, 320); mouse(f, 'click', 320, 320);}
      assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 1);
      f.emit('pagehide');
      assert.ok(f.window.__trafficClass.signals.includes('TP'));
      assert.equal(f.window.__trafficClass.class, 'human');
    }
    const f = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}))});
    jump(f); f.emit('pagehide');
    assert.equal(f.window.__trafficClass.class, 'suspicious'); // TP + FN + WG
  });
  await test('F1 natural path, fast human flick, rested and repeated clicks never imply TP', () => {
    for (const mode of ['natural', 'flick', 'rest', 'repeat']) {
      const f = fixture();
      if (mode === 'rest') {mouse(f, 'mousemove', 320, 320, {movementX: 320, movementY: 0}); f.advance(601);}
      else {
        for (let j = 0; j < 8; j++) {mouse(f, 'mousemove', j * 40, j * 40); f.advance(8);}
        // Even a large last event in a stream is not a one-event teleport.
        if (mode === 'flick') mouse(f, 'mousemove', 600, 600, {movementX: 320, movementY: 320});
      }
      const x = mode === 'rest' ? 320 : mode === 'flick' ? 600 : 280;
      for (let j = 0; j < (mode === 'repeat' ? 5 : 1); j++) mouse(f, 'click', x, x);
      f.emit('pagehide'); assert.ok(!f.window.__trafficClass.signals.includes('TP'), mode);
    }
  });
  await test('F1 jump expires after 600ms or intermediate path; touch pen keyboard and untrusted ignored', () => {
    for (const mode of ['expired', 'path', 'touch', 'pen', 'keyboard', 'untrusted']) {
      const f = fixture();
      mouse(f, 'mousemove', 320, 320, {movementX: 320, movementY: 0});
      if (mode === 'expired') f.advance(601);
      if (mode === 'path') mouse(f, 'mousemove', 325, 325);
      const extra = mode === 'touch' || mode === 'pen' ? {pointerType: mode} :
        mode === 'keyboard' ? {detail: 0} : mode === 'untrusted' ? {isTrusted: false} : {};
      mouse(f, 'click', mode === 'path' ? 325 : 320, mode === 'path' ? 325 : 320, extra);
      f.emit('pagehide'); assert.ok(!f.window.__trafficClass.signals.includes('TP'), mode);
    }
  });
  await test('F1 compatibility mousemove is not a second path event; click uses fresh mouse pointerdown', () => {
    const f = fixture({modify: ({window}) => {window.PointerEvent = function () {};}});
    mouse(f, 'pointermove', 320, 320); mouse(f, 'mousemove', 320, 320, {movementX: 320, movementY: 0});
    mouse(f, 'click', 320, 320, {pointerType: undefined});
    f.emit('pagehide'); assert.ok(f.window.__trafficClass.signals.includes('TP'));
  });
  await test('TP requires a fresh explicit trusted mouse pointerdown; mobile/unknown/WebKit clicks ignored', () => {
    for (const kind of [undefined, '', 'touch', 'pen', 'unknown']) {
      const f = fixture();
      mouse(f, 'mousemove', 200, 200, {movementX: 320, movementY: 0});
      f.emit('pointerdown', {isTrusted: true, pointerType: kind});
      f.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: 200, clientY: 200});
      f.emit('pagehide'); assert.ok(!f.window.__trafficClass.signals.includes('TP'), String(kind));
    }
    for (const pointerType of [undefined, '', 'mouse']) {
      const f = fixture();
      mouse(f, 'mousemove', 200, 200, {movementX: 320, movementY: 0});
      f.emit('click', {isTrusted: true, pointerType, detail: 1, clientX: 200, clientY: 200});
      f.emit('pagehide'); assert.ok(!f.window.__trafficClass.signals.includes('TP'));
    }
    const untrusted = fixture();
    mouse(untrusted, 'mousemove', 200, 200, {movementX: 320, movementY: 0});
    untrusted.emit('pointerdown', {isTrusted: false, pointerType: 'mouse'});
    untrusted.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: 200, clientY: 200});
    untrusted.emit('pagehide'); assert.ok(!untrusted.window.__trafficClass.signals.includes('TP'));
    const f = fixture();
    f.emit('pointerdown', {isTrusted: true, pointerType: 'mouse'});
    f.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 0, clientX: 0, clientY: 0});
    mouse(f, 'mousemove', 200, 200, {movementX: 320, movementY: 0});
    f.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: 200, clientY: 200});
    f.emit('pagehide'); assert.ok(!f.window.__trafficClass.signals.includes('TP'), 'pointerdown must be consumed');
    const stale = fixture();
    mouse(stale, 'pointerdown', 100, 100); stale.advance(601);
    mouse(stale, 'mousemove', 320, 320, {movementX: 320, movementY: 0});
    stale.emit('click', {isTrusted: true, detail: 1, clientX: 320, clientY: 320});
    stale.emit('pagehide'); assert.ok(!stale.window.__trafficClass.signals.includes('TP'), 'pointerdown must be fresh');
  });
  function fakeWorker(objects) {
    const record = {terminated: 0, revoked: 0};
    objects.window.Blob = function (parts) {this.text = parts.join('');};
    objects.window.URL = {createObjectURL(blob) {record.code = blob.text; return 'blob:test';}, revokeObjectURL() {record.revoked++;}};
    objects.window.Worker = function () {
      record.instance = this;
      this.postMessage = data => {record.input = data;};
      this.terminate = () => {record.terminated++;};
    };
    record.reply = navigator => {
      const context = {navigator, close() {}, postMessage: data => {record.replyData = data;}};
      vm.createContext(context); vm.runInContext(record.code, context);
      context.onmessage({data: record.input});
      record.instance.onmessage?.({data: record.replyData});
    };
    return record;
  }
  const workerNav = {userAgent: 'Chrome/140.0 Desktop', languages: ['en'], hardwareConcurrency: 8};
  const chromeBrands = [{brand: 'Chromium'}, {brand: 'Not.A/Brand'}, {brand: 'Google Chrome'}];
  await test('UB is final-only direct suspicious weight 6, never automated or CA, even without other evidence', () => {
    for (const userAgentData of [undefined, null, {brands: []}]) {
      let record;
      const f = fixture({config: {debug: true, worker: true, suspiciousThreshold: 1000}, modify: objects => {
        record = fakeWorker(objects); objects.navigator.userAgentData = {brands: chromeBrands};
      }});
      record.reply({...workerNav, userAgentData});
      assert.equal(record.input.ub, true);
      assert.ok(!Object.keys(record.input).some(key => /brands|userAgentData/.test(key)));
      assert.ok(Object.values(record.replyData).every(value => typeof value === 'boolean'));
      assert.equal(record.replyData.b, true);
      assert.equal(f.window.__trafficClass.class, 'human');
      assert.ok(!f.window.__trafficClass.signals.includes('UB'));
      f.emit('keydown', {isTrusted: true}); f.advance(8000);
      assert.deepEqual([...f.window.__trafficClass.signals], ['UB']);
      assert.equal(f.window.__trafficClass.class, 'suspicious');
      assert.equal(f.window.__trafficClass.score, 6);
      assert.equal(JSON.parse(f.store.get('traffic_class')).lastClass, 'suspicious');
      assert.equal(fixture({store: f.store, now: 11000}).window.__trafficClass.class, 'human');
      assert.equal(record.terminated, 1); assert.equal(record.revoked, 1);
    }
  });
  await test('UB ignores unsupported, blocked and malformed API shapes; non-empty worker brands need not match', () => {
    const cases = [
      [{brands: chromeBrands}, {}], // WorkerNavigator has no UA-CH API at all.
      [undefined, {userAgentData: {brands: []}}], // Firefox/Safari main API absent.
      [{}, {userAgentData: {brands: []}}],
      [{brands: []}, {userAgentData: {brands: []}}],
      [{brands: {length: 1}}, {userAgentData: {brands: []}}],
      ...[[null], [{}], [{brand: ''}]].map(brands => [{brands}, {userAgentData: {brands: []}}]),
      [{brands: chromeBrands}, {userAgentData: {}}],
      [{brands: chromeBrands}, {userAgentData: {brands: {length: 0}}}],
      [{brands: chromeBrands}, {userAgentData: {brands: chromeBrands}}],
      [{brands: chromeBrands}, {userAgentData: {brands: [{brand: 'Different brand'}]}}],
      [{brands: chromeBrands}, {get userAgentData() {throw Error('denied');}}]
    ];
    for (const [mainData, workerData] of cases) {
      let record;
      const f = fixture({config: {debug: true, worker: true}, modify: objects => {
        record = fakeWorker(objects); objects.navigator.userAgentData = mainData;
      }});
      record.reply(Object.defineProperties({...workerNav}, Object.getOwnPropertyDescriptors(workerData)));
      f.advance(8000);
      assert.equal(record.replyData.b, false);
      assert.ok(!f.window.__trafficClass.signals.includes('UB'));
      assert.equal(f.window.__trafficClass.class, 'human');
    }
  });
  await test('UB shares the worker cap with WK; normal main-only UA switching stays human', () => {
    for (const emptyBrands of [false, true]) {
      let record;
      const f = fixture({config: {debug: true, worker: true}, modify: objects => {
        record = fakeWorker(objects); objects.navigator.userAgentData = {brands: chromeBrands};
        objects.navigator.userAgent += ' UA-Switcher';
      }});
      record.reply({...workerNav, userAgentData: {brands: emptyBrands ? [] : chromeBrands}});
      f.emit('keydown', {isTrusted: true}); f.advance(8000);
      assert.ok(f.window.__trafficClass.signals.includes('WK'));
      assert.equal(f.window.__trafficClass.score, emptyBrands ? 6 : 2);
      assert.equal(f.window.__trafficClass.class, emptyBrands ? 'suspicious' : 'human');
    }
  });
  await test('Pixel 7 and iPhone controls with consistent or unsupported UA-CH stay human without HW/UB', () => {
    for (const [ua, mainData] of [
      ['Chrome/140.0 Android Mobile Pixel 7', {brands: chromeBrands}],
      ['Chrome/140.0 Android Mobile Pixel 7', {brands: []}],
      ['iPhone Version/18.0 Safari/605.1', undefined]
    ]) {
      let record;
      const f = fixture({config: {debug: true, worker: true}, modify: objects => {
        headlessGeometry(objects); record = fakeWorker(objects);
        objects.navigator.userAgent = ua; objects.navigator.userAgentData = mainData;
        objects.navigator.plugins.length = 0;
      }});
      record.reply({...workerNav, userAgent: ua, userAgentData: mainData});
      f.emit('touchstart', {isTrusted: true}); f.advance(8000);
      assert.equal(f.window.__trafficClass.class, 'human');
      assert.ok(!f.window.__trafficClass.signals.some(code => ['HW', 'UB', 'PL'].includes(code)));
    }
  });
  await test('UB preserves declared and hard precedence; production output remains class/phase/score only', () => {
    for (const kind of ['production', 'WD', 'AG', 'HL']) {
      let record;
      const f = fixture({config: {debug: false, worker: true}, modify: objects => {
        record = fakeWorker(objects); objects.navigator.userAgentData = {brands: chromeBrands};
        if (kind === 'WD') objects.navigator.webdriver = true;
        if (kind === 'AG') objects.navigator.userAgent = 'ChatGPT-User';
      }});
      record.reply({...workerNav, userAgent: kind === 'HL' ? 'HeadlessChrome/140.0' : workerNav.userAgent,
        userAgentData: {brands: []}});
      f.emit('keydown', {isTrusted: true}); f.advance(8000);
      assert.equal(f.window.__trafficClass.class, kind === 'AG' ? 'declared_agent' : kind === 'production' ? 'suspicious' : 'automated');
      assert.equal(f.window.__trafficClass.score, kind === 'production' ? 6 : 100);
      assert.deepEqual(Object.keys(f.window.dataLayer[1]).sort(), ['event', 'traffic_class', 'traffic_phase', 'traffic_score']);
      assert.deepEqual(Object.keys(f.window.__trafficClass).sort(), ['class', 'phase', 'score']);
    }
  });
  await test('WK is zero when main and worker navigator are consistent', () => {
    let record;
    const f = fixture({modify: objects => {record = fakeWorker(objects); objects.navigator.webdriver = false;}});
    record.reply({...workerNav, webdriver: false});
    f.emit('keydown', {isTrusted: true}); f.advance(8000);
    assert.equal(record.replyData.m, false); assert.equal(record.replyData.h, false);
    assert.ok(!f.window.__trafficClass.signals.includes('WK'));
    assert.equal(f.window.__trafficClass.score, 1); // only fixture's absent WebGL
    assert.equal(f.window.__trafficClass.class, 'human');
  });
  await test('WK: main-only UA switch is soft 2, worker reply boolean-only, cleanup immediate', () => {
    let record;
    const f = fixture({modify: objects => {record = fakeWorker(objects); objects.navigator.userAgent += ' UA-Switcher';}});
    record.reply(workerNav);
    assert.equal(Object.values(record.replyData).every(v => typeof v === 'boolean'), true);
    assert.ok(!f.window.__trafficClass.signals.includes('WK'));
    f.advance(8000); assert.ok(f.window.__trafficClass.signals.includes('WK'));
    assert.equal(f.window.__trafficClass.score, 5); // WG1 + NI2 + WK2; human
    assert.equal(f.window.__trafficClass.class, 'human');
    assert.equal(record.terminated, 1); assert.equal(record.revoked, 1);
  });
  await test('WK: exact supported comparisons; absent worker webdriver is unknown', () => {
    for (const change of [{}, {languages: ['cs']}, {hardwareConcurrency: 4}, {webdriver: true}]) {
      let record;
      const f = fixture({modify: objects => {record = fakeWorker(objects); objects.navigator.webdriver = false;}});
      record.reply({...workerNav, ...change}); f.advance(8000);
      assert.equal(f.window.__trafficClass.signals.includes('WK'), Object.keys(change).length > 0);
    }
  });
  await test('WK: HeadlessChrome in worker is final hard HL, declaration precedence preserved', () => {
    for (const declared of [false, true]) {
      let record;
      const f = fixture({modify: objects => {record = fakeWorker(objects); if (declared) objects.navigator.userAgent = 'Claude-Agent/1.0';}});
      record.reply({...workerNav, userAgent: 'HeadlessChrome/140.0'}); f.advance(8000);
      assert.ok(f.window.__trafficClass.signals.includes('HL'));
      assert.equal(f.window.__trafficClass.class, declared ? 'declared_agent' : 'automated');
      assert.equal(f.window.__trafficClass.score, 100);
    }
  });
  await test('WK: CSP constructor/error/timeout/pagehide -> unknown, no delay, URLs revoked', () => {
    for (const mode of ['constructor', 'error', 'timeout', 'pagehide']) {
      let record;
      const f = fixture({modify: objects => {
        record = fakeWorker(objects);
        objects.navigator.userAgentData = {brands: chromeBrands};
        if (mode === 'constructor') objects.window.Worker = function () {throw Error('CSP blocked');};
      }});
      if (mode === 'error') record.instance.onerror({preventDefault() {}});
      if (mode === 'timeout') f.advance(1500);
      if (mode === 'pagehide') f.emit('pagehide'); else f.advance(8000);
      assert.equal(f.window.dataLayer.length, 2);
      assert.ok(!f.window.__trafficClass.signals.includes('WK'));
      assert.ok(!f.window.__trafficClass.signals.includes('UB'));
      assert.equal(record.revoked, 1);
      if (mode !== 'constructor') assert.equal(record.terminated, 1);
    }
  });
  await test('WK: late result after early final ignored; production contains only allowed fields', () => {
    let record;
    const f = fixture({config: {debug: false, worker: true}, modify: objects => {record = fakeWorker(objects);}});
    const late = record.instance.onmessage;
    f.emit('pagehide'); late({data: {h: true, m: true, b: true}});
    assert.equal(f.window.dataLayer.length, 2);
    assert.equal(f.window.__trafficClass.class, 'human');
    assert.deepEqual(Object.keys(f.window.dataLayer[1]).sort(), ['event', 'traffic_class', 'traffic_phase', 'traffic_score']);
    assert.deepEqual(Object.keys(f.window.__trafficClass).sort(), ['class', 'phase', 'score']);
  });
  await test('TR: TP writes a bounded counter immediately, once per document, no exported counter', () => {
    const f = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({timestamps: [9000], lastClass: 'human', tpPages: 0}))});
    jump(f, 100, 100);
    const saved = JSON.parse(f.store.get('traffic_class'));
    assert.equal(saved.tpPages, 1); assert.equal(saved.lastClass, 'human');
    assert.equal(f.window.dataLayer.length, 1); // synchronous counter write precedes pagehide
    for (let i = 0; i < 5; i++) jump(f, 300 + i * 100, 200);
    assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 1);
    f.emit('pagehide'); assert.equal(f.window.__trafficClass.class, 'human');
    assert.ok(!f.window.__trafficClass.signals.includes('TR'));
    assert.ok(!('tpPages' in f.window.__trafficClass));
    assert.ok(f.window.dataLayer.every(event => !('tpPages' in event)));
    assert.deepEqual(Object.keys(saved).sort(), ['lastClass', 'timestamps', 'tpPages']);
  });
  await test('Accessibility TR is final-only pointer weight; history alone never starts suspicious', () => {
    const store = new Map(), classes = [];
    for (let page = 0; page < 3; page++) {
      const f = fixture({store, now: 10000 + page * 1000, config: {debug: true}});
      classes.push(f.window.__trafficClass.class);
      assert.ok(!f.window.__trafficClass.signals.includes('TR'));
      if (page < 2) {jump(f); f.emit('pagehide');}
      else f.advance(8000);
      classes.push(f.window.__trafficClass.class);
      assert.equal(JSON.parse(store.get('traffic_class')).tpPages, Math.min(page + 1, 2));
      if (page === 2) {
        assert.deepEqual([...f.window.__trafficClass.signals].sort(), ['FN', 'NI', 'TR']);
        assert.equal(f.window.__trafficClass.score, 7); // TR2 + FN3 + NI2, three families
      }
    }
    assert.deepEqual(classes, ['human', 'human', 'human', 'human', 'human', 'suspicious']);
    const historyOnly = fixture({config: {debug: true, suspiciousThreshold: 1}, modify: ({store}) => store.set('traffic_class', JSON.stringify({tpPages: 255}))});
    assert.equal(historyOnly.window.__trafficClass.class, 'human');
    historyOnly.emit('pagehide'); assert.equal(historyOnly.window.__trafficClass.class, 'human');
  });
  await test('TR: corrupt/missing/noninteger/out-of-range counters reset to zero; 255 saturates', () => {
    for (const value of [undefined, null, '2', true, -1, 1.5, 256, 1e100, [], {}]) {
      const f = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({tpPages: value}))});
      assert.equal(f.window.__trafficClass.class, 'human', JSON.stringify(value));
      assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 0);
      jump(f, 100, 100);
      assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 1);
    }
    for (const value of [254, 255]) {
      const f = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({tpPages: value}))});
      jump(f, 100, 100); f.emit('pagehide');
      assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 255);
      assert.equal(f.window.__trafficClass.class, 'human');
    }
    for (const raw of ['bad JSON', 'null', '[]', '"bad"']) {
      const f = fixture({modify: ({store}) => store.set('traffic_class', raw)});
      jump(f, 100, 100); f.emit('pagehide');
      assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 1);
      assert.equal(f.window.dataLayer.length, 2);
    }
  });
  await test('TR: inherited count never overrides AG/WD/CA or promotes to automated by itself', () => {
    for (const expected of ['declared_agent', 'automated', 'carry', 'human']) {
      const f = fixture({modify: ({store, navigator}) => {
        store.set('traffic_class', JSON.stringify({tpPages: 2, lastClass: expected === 'carry' ? {value: 'automated', direct: true} : 'human'}));
        if (expected === 'declared_agent') navigator.userAgent = 'Claude-Agent/1.0';
        if (expected === 'automated') navigator.webdriver = true;
      }});
      const result = expected === 'carry' ? 'automated' : expected;
      assert.equal(f.window.__trafficClass.class, result); f.emit('pagehide');
      assert.equal(f.window.__trafficClass.class, result);
      assert.ok(f.window.__trafficClass.signals.includes('TR'));
    }
  });
  await test('TR: denied storage degrades to local TP; duplicate/BFCache cannot recount', () => {
    const blocked = fixture({modify: ({window}) => Object.defineProperty(window, 'sessionStorage', {get() {throw Error('denied');}})});
    for (let i = 0; i < 5; i++) jump(blocked, 100 + i * 100, 100);
    blocked.emit('pagehide');
    assert.equal(blocked.window.__trafficClass.class, 'human');
    assert.ok(!blocked.window.__trafficClass.signals.includes('TR'));
    const f = fixture(); jump(f, 100, 100);
    vm.runInContext(source, f.context); f.emit('pagehide'); f.emit('pageshow', {persisted: true});
    vm.runInContext(source, f.context); mouse(f, 'click', 300, 100);
    assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 1);
    assert.equal(f.window.dataLayer.length, 2);
  });
  await test('TR: final cannot overwrite a newer same-tab counter; TP sees newer prior pages', () => {
    const f = fixture();
    f.store.set('traffic_class', JSON.stringify({tpPages: 3})); f.emit('pagehide');
    assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 3);
    const g = fixture();
    g.store.set('traffic_class', JSON.stringify({tpPages: 1})); jump(g, 100, 100); g.emit('pagehide');
    assert.equal(g.window.__trafficClass.class, 'human');
    assert.equal(JSON.parse(g.store.get('traffic_class')).tpPages, 2);
  });
  await test('TR: rested/repeated/Enter controls do not accumulate TP across documents', () => {
    let stored;
    for (const mode of ['rest', 'repeat', 'Enter']) {
      const f = fixture({modify: ({store}) => {if (stored) store.set('traffic_class', stored);}});
      if (mode === 'Enter') {
        f.emit('keydown', {isTrusted: true}); mouse(f, 'click', 100, 100, {detail: 0});
      } else {
        mouse(f, 'mousemove', 20, 20); mouse(f, 'mousemove', 50, 50); mouse(f, 'mousemove', 100, 100);
        if (mode === 'rest') f.advance(1500);
        for (let i = 0; i < (mode === 'repeat' ? 5 : 1); i++) mouse(f, 'click', 100, 100);
      }
      f.emit('pagehide'); stored = f.store.get('traffic_class');
      assert.equal(JSON.parse(stored).tpPages, 0); assert.equal(f.window.__trafficClass.class, 'human');
    }
  });
  await test('Accessibility TR decays once per trusted-input document, never on idle or TP documents', () => {
    let stored = JSON.stringify({tpPages: 3});
    for (const expected of [2, 1, 0]) {
      const f = fixture({modify: ({store}) => store.set('traffic_class', stored)});
      mouse(f, 'mousemove', 10, 10); mouse(f, 'mousemove', 30, 30); mouse(f, 'mousemove', 50, 50);
      f.emit('pagehide'); f.emit('pagehide');
      assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, expected);
      assert.equal(f.window.__trafficClass.class, 'human');
      vm.runInContext(source, f.context); f.emit('pageshow', {persisted: true});
      assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, expected);
      stored = f.store.get('traffic_class');
    }
    const idle = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({tpPages: 2}))});
    idle.advance(8000); assert.equal(JSON.parse(idle.store.get('traffic_class')).tpPages, 2);
    const tp = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({tpPages: 1}))});
    mouse(tp, 'mousemove', 10, 10); mouse(tp, 'mousemove', 30, 30); mouse(tp, 'mousemove', 50, 50);
    tp.advance(200); jump(tp); tp.emit('pagehide');
    assert.equal(JSON.parse(tp.store.get('traffic_class')).tpPages, 2);
    assert.equal(tp.window.__trafficClass.class, 'human');
  });
  await test('F2 CA consumes direct provenance; second consecutive clean page is human', () => {
    for (const signal of ['WD', 'HL', 'AU', 'GL', 'PW', 'AG']) {
      const direct = fixture({modify: ({window, navigator}) => {
        if (signal === 'WD') navigator.webdriver = true;
        if (signal === 'HL') navigator.userAgent = 'HeadlessChrome/140.0';
        if (signal === 'AU') navigator.userAgent = 'Lighthouse/1.0';
        if (signal === 'GL') window.callPhantom = function () {};
        if (signal === 'PW') window.__pwInitScripts = [];
        if (signal === 'AG') navigator.userAgent = 'ChatGPT-User';
      }});
      direct.emit('pagehide');
      const store = direct.store;
      assert.equal(JSON.parse(store.get('traffic_class')).lastClass.direct, true, signal);
      const first = fixture({store, now: 11000});
      assert.ok(first.window.__trafficClass.signals.includes('CA'), signal);
      first.emit('pagehide');
      assert.equal(JSON.parse(store.get('traffic_class')).lastClass, 'automated');
      const second = fixture({store, now: 12000});
      assert.equal(second.window.__trafficClass.class, 'human', signal);
      second.emit('pagehide'); assert.equal(second.window.__trafficClass.class, 'human', signal);
    }
    const legacy = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({lastClass: 'automated'}))});
    assert.equal(legacy.window.__trafficClass.class, 'human');
    const noUnload = new Map([['traffic_class', JSON.stringify({lastClass: {value: 'automated', direct: true}})]]);
    fixture({store: noUnload}); // No final: initial consumption must still expire provenance.
    assert.equal(fixture({store: noUnload, now: 11000}).window.__trafficClass.class, 'human');
  });
  await test('F2 direct evidence on a carried page renews provenance; CA alone never does', () => {
    const store = new Map([['traffic_class', JSON.stringify({lastClass: {value: 'automated', direct: true}})]]);
    const f = fixture({store, modify: ({window}) => {window.__pwInitScripts = [];}});
    f.emit('pagehide'); assert.equal(JSON.parse(store.get('traffic_class')).lastClass.direct, true);
    assert.equal(fixture({store, now: 11000}).window.__trafficClass.class, 'automated');
  });
  await test('F2 GL/PW reject DOM nodes, collections, window proxies and other host instances', () => {
    const host = new (class Host {})();
    const node = {nodeType: 1, ownerDocument: {}};
    const collection = {[Symbol.toStringTag]: 'HTMLCollection', length: 1, 0: node};
    const proxy = {}; proxy.window = proxy;
    for (const value of [node, collection, proxy, host, new Date(), /app/]) {
      for (const [target, name] of [['window', 'callPhantom'], ['window', '__playwright__binding__'], ['document', '$cdc_form']]) {
        const f = fixture({modify: objects => {objects[target][name] = value;}});
        f.advance(8000); assert.equal(f.window.__trafficClass.class, 'human', name);
        assert.ok(!f.window.__trafficClass.signals.includes('GL') && !f.window.__trafficClass.signals.includes('PW'));
      }
    }
  });
  await test('F2 inclusion sentinel ignores named HTML, inherited markers and arbitrary prior values', () => {
    for (const value of [{nodeType: 1}, {class: 'human'}, Object.create({__tcDetector: true}), true]) {
      const f = fixture({modify: ({window}) => {window.__trafficClass = value;}});
      assert.equal(f.window.dataLayer.length, 1);
      vm.runInContext(source, f.context); f.advance(8000);
      assert.equal(f.window.dataLayer.length, 2);
      assert.deepEqual(Object.keys(f.window.__trafficClass).sort(), ['class', 'phase', 'score', 'signals']);
    }
    const getter = {get __tcDetector() {throw Error('not our sentinel');}};
    const f = fixture({modify: ({window}) => {window.__trafficClass = getter;}});
    assert.equal(f.window.dataLayer.length, 1);
  });
  await test('F3 score needs non-benign evidence or two environment families plus behaviour', () => {
    for (const graphics of [false, true]) {
      const f = fixture({config: {debug: true, webgl: graphics}, modify: ({window, store}) => {
        if (!graphics) window.screen = {width: 800, height: 600};
        store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}));
      }});
      f.advance(8000); assert.equal(f.window.__trafficClass.score, 6);
      assert.equal(f.window.__trafficClass.class, 'human');
    }
    const benignOnly = fixture({config: {debug: true, webgl: true, suspiciousThreshold: 1}, modify: ({window, navigator}) => {
      window.screen = {width: 800, height: 600}; navigator.languages = []; navigator.language = ''; navigator.plugins.length = 0;
    }});
    assert.equal(benignOnly.window.__trafficClass.class, 'human');
    const envBehaviour = fixture({modify: ({window, store}) => {
      window.screen = {width: 800, height: 600}; store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}));
    }});
    envBehaviour.advance(8000); assert.equal(envBehaviour.window.__trafficClass.class, 'suspicious');
    let worker;
    const stealth = fixture({modify: objects => {
      worker = fakeWorker(objects); objects.window.screen = {width: 800, height: 600};
      // No WG: GS + NI + FN + WK still has positive worker evidence.
      objects.document.createElement = () => ({getContext: () => ({getExtension: () => null})});
      objects.store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}));
    }});
    worker.reply({...workerNav, userAgent: 'Chrome/141.0 Desktop'}); stealth.advance(8000);
    assert.equal(stealth.window.__trafficClass.class, 'suspicious');
    assert.deepEqual([...stealth.window.__trafficClass.signals].sort(), ['FN', 'GS', 'NI', 'WK']);
    const sy = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}))});
    sy.emit('mousemove', {isTrusted: false}); sy.advance(8000);
    assert.equal(sy.window.__trafficClass.class, 'suspicious');
  });
  await test('F4 heavy probes default off and require strict true opt-in', () => {
    for (const config of [{}, {webgl: false, worker: false}, {webgl: 'true', worker: 1}]) {
      let allocations = 0;
      const f = fixture({config, modify: ({window, document}) => {
        document.createElement = () => {allocations++; throw Error('Unexpected canvas');};
        window.Blob = window.Worker = function () {allocations++;};
      }});
      f.advance(8000); assert.equal(allocations, 0);
      assert.equal(f.window.__trafficClass.class, 'human');
    }
  });
  await test('F4 WebGL finally releases context when renderer probe throws', () => {
    for (const throws of [false, true]) {
      let released = 0;
      const f = fixture({modify: ({document}) => {
        document.createElement = () => ({getContext: () => ({
          getExtension: name => name === 'WEBGL_lose_context' ? {loseContext() {released++;}} : {},
          getParameter() {if (throws) throw Error('blocked renderer'); return 'Mesa Intel';}
        })});
      }});
      assert.equal(released, 1); f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
    }
  });
  await test('F4 Worker finally releases resources if postMessage throws', () => {
    let record;
    const f = fixture({modify: objects => {
      record = fakeWorker(objects);
      const Worker = objects.window.Worker;
      objects.window.Worker = function () {const worker = new Worker(); worker.postMessage = () => {throw Error('blocked');}; return worker;};
    }});
    assert.equal(record.terminated, 1); assert.equal(record.revoked, 1);
    f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
  });
  await test('F5 throwing publication or invalid data layer never prevents final cleanup', () => {
    for (const layer of [{length: 0, push() {throw Error('consumer');}}, {push() {throw Error('not array-like');}}, {length: 0}, 42, {get length() {throw Error('getter');}}]) {
      let record;
      const f = fixture({modify: objects => {record = fakeWorker(objects); objects.window.dataLayer = layer;}});
      f.advance(8000);
      assert.equal(f.window.__trafficClass.phase, 'final');
      assert.equal(Object.keys(f.listeners).length, 0); assert.equal(f.timers.size, 0);
      assert.equal(record.terminated, 1); assert.equal(record.revoked, 1);
      vm.runInContext(source, f.context); assert.equal(f.timers.size, 0);
    }
    const arrayLike = {length: 0, push: Array.prototype.push};
    const f = fixture({modify: ({window}) => {window.dataLayer = arrayLike;}});
    f.emit('pagehide'); assert.equal(arrayLike.length, 2);
  });
  await test('F5 reentrant pagehide during initial publication cannot leak a worker', () => {
    let fns, workers = 0;
    const f = fixture({modify: ({window}) => {
      window.Worker = function () {workers++;}; window.Blob = function () {}; window.URL = {createObjectURL: () => 'blob:test'};
      const add = window.addEventListener;
      window.addEventListener = (name, fn, opts) => {if (name === 'pagehide') fns = fn; add(name, fn, opts);};
      window.dataLayer = {length: 0, push() {fns();}};
    }});
    assert.equal(workers, 0); assert.equal(f.timers.size, 0); assert.equal(Object.keys(f.listeners).length, 0);
  });
  await test('F5 partial listener or timer setup failure removes every installed listener', () => {
    for (const mode of ['listener', 'timer']) {
      const f = fixture({modify: ({window}) => {
        if (mode === 'timer') window.setTimeout = () => {throw Error('Timer failed');};
        else {
          const add = window.addEventListener;
          window.addEventListener = (name, fn, opts) => {if (name === 'pagehide') throw Error('Listener failed'); add(name, fn, opts);};
        }
      }});
      if (mode === 'listener') {
        assert.equal(f.window.__trafficClass.phase, 'initial');
        f.advance(8000); assert.equal(f.window.__trafficClass.phase, 'final');
      }
      assert.equal(Object.keys(f.listeners).length, 0); assert.equal(f.timers.size, 0);
    }
  });
  await test('F6 frames have no detector state, listeners, storage reads or probes', () => {
    let reads = 0;
    const f = fixture({modify: ({window, document}) => {
      window.top = {}; Object.defineProperty(window, 'sessionStorage', {get() {reads++; throw Error('frame storage');}});
      document.createElement = () => {throw Error('frame probe');};
    }});
    assert.equal(reads, 0); assert.equal(f.window.__trafficClass, undefined); assert.equal(f.window.dataLayer, undefined);
    assert.equal(f.timers.size, 0); assert.equal(Object.keys(f.listeners).length, 0);
  });
  await test('F6 prerender defers probes, pageview and publication until activation, once', () => {
    let reads = 0;
    const f = fixture({modify: ({window, document}) => {
      document.prerendering = true;
      const get = window.sessionStorage.getItem; window.sessionStorage.getItem = key => {reads++; return get(key);};
    }});
    vm.runInContext(source, f.context); f.advance(50000);
    assert.equal(reads, 0); assert.equal(f.store.size, 0); assert.equal(f.window.dataLayer, undefined); assert.equal(f.timers.size, 0);
    f.document.prerendering = false; f.emit('prerenderingchange');
    assert.equal(f.window.dataLayer.length, 1);
    assert.deepEqual(JSON.parse(f.store.get('traffic_class')).timestamps, [60000]);
    f.emit('prerenderingchange'); f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
    assert.equal(Object.keys(f.listeners).length, 0);
  });
  await test('F7 debug strict true; invalid numeric and dataLayerName options use defaults', () => {
    for (const value of [true, false, 'true', 1, {}, null]) {
      const f = fixture({config: {debug: value, idleMs: -1, fastNavMs: '2000', fastNavCount: 0, suspiciousThreshold: NaN, dataLayerName: '__proto__'}});
      assert.equal('signals' in f.window.__trafficClass, value === true);
      f.advance(7999); assert.equal(f.window.dataLayer.length, 1);
      f.advance(1); assert.equal(f.window.dataLayer.length, 2);
      assert.deepEqual(Object.keys(JSON.parse(f.store.get('traffic_class'))).sort(), ['lastClass', 'timestamps', 'tpPages']);
    }
    for (const bad of [NaN, Infinity, -10, 0, 1.1, '100', null, {}, 1e12]) {
      const f = fixture({config: {debug: true, idleMs: bad}}); f.advance(7999);
      assert.equal(f.window.__trafficClass.phase, 'initial'); f.advance(1); assert.equal(f.window.__trafficClass.phase, 'final');
    }
  });
  await test('F7 agent tokens are bounded literal strings; malformed config cannot match broad regex', () => {
    for (const [tokens, ua, agent] of [
      [['.*'], 'Chrome/140.0', false], [['Agent.One'], 'AgentXOne', false], [['Agent.One'], 'Agent.One', true],
      [['A+B(1)'], 'A+B(1)', true], [['['], '[', true], [[''], 'Chrome', false],
      [['x'.repeat(129)], 'x'.repeat(129), false], [[...Array(64).fill('unused'), 'Chrome'], 'Chrome', false],
      [[null, {}, 1, 'Chrome'], 'Chrome/140.0', true], ['.*', 'Chrome/140.0', false]
    ]) {
      const f = fixture({config: {debug: true, agentTokens: tokens}, modify: ({navigator}) => {navigator.userAgent = ua;}});
      assert.equal(f.window.__trafficClass.class, agent ? 'declared_agent' : 'human', ua);
    }
  });
  await test('F8 every write merges newer timestamps and preserves newer class and decayed TP', () => {
    const store = new Map();
    const older = fixture({store, now: 10057, modify: ({navigator}) => {navigator.webdriver = true;}});
    const newer = fixture({store, now: 10567});
    newer.emit('pagehide');
    store.set('traffic_class', JSON.stringify({...JSON.parse(store.get('traffic_class')), tpPages: 1}));
    older.advance(8000);
    const saved = JSON.parse(store.get('traffic_class'));
    assert.deepEqual(saved.timestamps, [10000, 10500]); assert.equal(saved.lastClass, 'human'); assert.equal(saved.tpPages, 1);
    const f = fixture({store, now: 20000});
    store.set('traffic_class', JSON.stringify({timestamps: [20100, 20200, 20300], lastClass: 'suspicious', tpPages: 2}));
    f.advance(400); jump(f); // TP merge must see the new document, too.
    assert.deepEqual(JSON.parse(store.get('traffic_class')).timestamps, [20100, 20200, 20300]);
    assert.equal(JSON.parse(store.get('traffic_class')).tpPages, 3);
    f.emit('pagehide'); assert.equal(JSON.parse(store.get('traffic_class')).lastClass, 'suspicious');
  });
  await test('F8 stale human final cannot decay newer TP state or resurrect a previously decayed count', () => {
    const store = new Map([['traffic_class', JSON.stringify({tpPages: 3})]]);
    const older = fixture({store});
    mouse(older, 'mousemove', 10, 10); mouse(older, 'mousemove', 30, 30); mouse(older, 'mousemove', 50, 50);
    const newer = fixture({store, now: 11000});
    mouse(newer, 'mousemove', 10, 10); mouse(newer, 'mousemove', 30, 30); mouse(newer, 'mousemove', 50, 50);
    newer.emit('pagehide'); assert.equal(JSON.parse(store.get('traffic_class')).tpPages, 2);
    older.advance(2000); older.emit('pagehide'); assert.equal(JSON.parse(store.get('traffic_class')).tpPages, 2);
  });
  await test('F8 same rounded timestamp cannot overwrite a changed class or newly increased TP count', () => {
    const store = new Map();
    const older = fixture({store, now: 10001, modify: ({navigator}) => {navigator.webdriver = true;}});
    const newer = fixture({store, now: 10099}); newer.emit('pagehide');
    older.emit('pagehide'); assert.equal(JSON.parse(store.get('traffic_class')).lastClass, 'human');
    const human = fixture({store, now: 11001});
    mouse(human, 'mousemove', 10, 10); mouse(human, 'mousemove', 30, 30); mouse(human, 'mousemove', 50, 50);
    store.set('traffic_class', JSON.stringify({...JSON.parse(store.get('traffic_class')), tpPages: 2}));
    human.emit('pagehide'); assert.equal(JSON.parse(store.get('traffic_class')).tpPages, 2);
  });
  await test('F9 missing isTrusted counts as human activity for NI/SY, never positive TP evidence', () => {
    for (const type of ['mousemove', 'pointerdown', 'touchstart', 'scroll', 'keydown', 'wheel']) {
      const f = fixture(); f.emit('mousemove', {isTrusted: false});
      f.emit(type); f.advance(8000);
      assert.ok(!f.window.__trafficClass.signals.includes('NI'), type);
      assert.ok(!f.window.__trafficClass.signals.includes('SY'), type);
      assert.ok(!f.window.__trafficClass.signals.includes('TP'), type);
    }
  });
  await test('F10 passive capture is detected and removed; old browsers use boolean capture', () => {
    for (const mode of ['passive', 'legacy', 'no-options']) {
      const f = fixture({passive: mode === 'passive', legacy: mode === 'legacy'});
      const input = f.registrations.filter(r => ['mousemove', 'wheel', 'touchstart', 'pagehide', 'visibilitychange'].includes(r.name));
      assert.equal(input.length, 5);
      for (const entry of input) {
        if (entry.name !== 'visibilitychange') assert.equal(entry.target, 'window');
        if (mode === 'passive') assert.deepEqual({...entry.opts}, {capture: true, passive: true});
        else assert.equal(entry.opts, true);
      }
      f.advance(8000); assert.equal(Object.keys(f.listeners).length, 0);
      for (const entry of input) assert.ok(f.removals.some(r => r.name === entry.name && r.fn === entry.fn && r.opts === entry.opts));
    }
  });
  await test('Accessibility warp clicks on three slow pages with keyboard input remain human', () => {
    const store = new Map();
    for (let page = 0; page < 3; page++) {
      const f = fixture({store, now: 10000 + page * 12000, modify: ({window}) => {window.screen = {width: 800, height: 600};}});
      assert.equal(f.window.__trafficClass.class, 'human');
      f.emit('keydown', {isTrusted: true}); jump(f); f.emit('keyup', {isTrusted: true}); f.advance(8000);
      assert.equal(f.window.__trafficClass.class, 'human');
      assert.equal(f.window.__trafficClass.score, 5); // GS1 + WG1 + pointer cap3
      assert.ok(!f.window.__trafficClass.signals.includes('FN') && !f.window.__trafficClass.signals.includes('NI'));
      assert.equal(f.window.__trafficClass.signals.includes('TR'), page > 0);
      assert.equal(JSON.parse(store.get('traffic_class')).tpPages, page + 1);
    }
  });
  await test('Accessibility warp plus fast navigation and idle still needs other families', () => {
    const store = new Map();
    for (let page = 0; page < 3; page++) {
      const f = fixture({store, now: 10000 + page * 1000});
      jump(f);
      if (page < 2) f.emit('pagehide'); else {
        f.advance(8000);
        assert.equal(f.window.__trafficClass.class, 'suspicious');
        assert.deepEqual([...f.window.__trafficClass.signals].sort(), ['FN', 'TP', 'TR', 'WG']);
        assert.equal(f.window.__trafficClass.score, 7); // TP/TR cap3 + FN3 + WG1
        assert.ok(!f.window.__trafficClass.signals.includes('NI'), 'A warp click is activity; do not manufacture NI');
      }
    }
  });
  await test('Accessibility all trusted modalities repay TP history and suppress NI in window capture', () => {
    for (const type of ['keydown', 'keyup', 'focusin', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'scroll', 'wheel', 'mousemove']) {
      const f = fixture({passive: true, modify: ({store}) => store.set('traffic_class', JSON.stringify({tpPages: 2}))});
      const registration = f.registrations.find(r => r.name === type);
      assert.ok(registration && registration.target === 'window' && registration.opts.capture, type);
      f.emit(type, {isTrusted: true}); f.advance(8000);
      assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 1, type);
      assert.ok(!f.window.__trafficClass.signals.includes('NI'), type);
      assert.ok(!f.window.__trafficClass.signals.includes('TR'), type);
      assert.equal(f.window.__trafficClass.class, 'human', type);
    }
    const synthetic = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({tpPages: 2}))});
    synthetic.emit('focusin', {isTrusted: false}); synthetic.emit('pointerup', {isTrusted: false}); synthetic.advance(8000);
    assert.equal(JSON.parse(synthetic.store.get('traffic_class')).tpPages, 2);
    assert.ok(synthetic.window.__trafficClass.signals.includes('NI'));
  });
  await test('Storage sanitises every write, including unknown class shapes and concurrent records', () => {
    for (const lastClass of [{arbitrary: 'raw'}, 'secret', 'human\n', 'automated\r', [], 1, {value: ['automated'], direct: true}, {value: 'human', direct: true},
      {value: 'automated\n', direct: true},
      {value: 'automated', direct: true, arbitrary: 'raw'}, {value: 'declared_agent', direct: true, extra: {raw: true}}]) {
      const writes = [];
      const f = fixture({modify: ({window, store}) => {
        store.set('traffic_class', JSON.stringify({lastClass, unknown: 'raw', timestamps: [9000], tpPages: 1}));
        const set = window.sessionStorage.setItem;
        window.sessionStorage.setItem = (key, value) => {writes.push(JSON.parse(value)); set(key, value);};
      }});
      // Repair an independently written invalid record even when its timestamps
      // are newer than this document. Sanitisation must precede merge decisions.
      f.advance(200);
      f.store.set('traffic_class', JSON.stringify({lastClass, unknown: 'raw', timestamps: [10100], tpPages: 1}));
      jump(f); f.emit('pagehide');
      assert.ok(writes.length >= 3);
      for (const record of writes) {
        assert.deepEqual(Object.keys(record).sort(), ['lastClass', 'timestamps', 'tpPages']);
        const value = record.lastClass;
        assert.ok(typeof value === 'string' ? ['', 'human', 'suspicious', 'automated', 'declared_agent'].includes(value) :
          Object.keys(value).sort().join(',') === 'direct,value' && value.direct === true && ['automated', 'declared_agent'].includes(value.value));
        assert.ok(!JSON.stringify(record).includes('raw'));
      }
    }
  });
  await test('Missing JSON ignores unreadable history and repairs storage with the minimal schema', () => {
    const f = fixture({withoutJSON: true, modify: ({store}) => store.set('traffic_class', '{"lastClass":{"raw":"secret"},"tpPages":255}')});
    assert.equal(f.window.__trafficClass.class, 'human');
    assert.deepEqual(JSON.parse(f.store.get('traffic_class')), {timestamps: [10000], lastClass: '', tpPages: 0});
    f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
    assert.deepEqual(JSON.parse(f.store.get('traffic_class')), {timestamps: [10000], lastClass: 'human', tpPages: 0});
  });
  await test('Missing add/remove listener methods still publish initial and timed final safely', () => {
    const methods = ['addEventListener', 'removeEventListener'];
    for (let bits = 1; bits < 16; bits++) {
      const f = fixture({modify: ({window, document}) => {
        for (const [i, target] of [window, document].entries()) for (const [j, method] of methods.entries()) {
          if (bits & 1 << (i * 2 + j)) target[method] = undefined;
        }
      }});
      assert.equal(f.window.dataLayer.length, 1, String(bits));
      f.advance(8000); f.emit('pagehide'); f.advance(8000);
      assert.equal(f.window.dataLayer.length, 2, String(bits));
      assert.equal(f.window.__trafficClass.phase, 'final'); assert.equal(f.window.__trafficClass.class, 'human');
      assert.equal(Object.keys(f.listeners).length, 0); assert.equal(f.timers.size, 0);
      if (![f.window, f.document].some(target => methods.every(method => typeof target[method] === 'function'))) {
        assert.ok(!f.window.__trafficClass.signals.includes('NI'), 'Unobservable input must remain unknown');
      }
    }
  });
  await test('Rapid fixture spacing preserves FN; real third-page input suppresses NI and decays TR', () => {
    const spacing = observationDwell({mode: 'cdp-agent'}, false);
    assert.ok(spacing > 100 && spacing < 2000);
    for (const type of ['idle', 'focusin', 'mousemove', 'keyup', 'pointerup']) {
      const store = new Map();
      for (let page = 0; page < 3; page++) {
        const f = fixture({store, now: 10000 + page * spacing, config: {debug: true}});
        assert.equal(f.window.__trafficClass.class, 'human');
        if (page < 2) {jump(f); f.emit('pagehide');}
        else {
          if (type !== 'idle') f.emit(type, {isTrusted: true});
          f.advance(8000);
          assert.equal(f.window.__trafficClass.class, type === 'idle' ? 'suspicious' : 'human', type);
          assert.equal(f.window.__trafficClass.signals.includes('NI'), type === 'idle', type);
          assert.equal(f.window.__trafficClass.signals.includes('TR'), type === 'idle', type);
          assert.ok(f.window.__trafficClass.signals.includes('FN'), type);
          assert.equal(JSON.parse(store.get('traffic_class')).tpPages, type === 'idle' ? 2 : 1, type);
        }
      }
    }
  });
  return results;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const results = await runContracts();
  for (const row of results) console.log(`${row.status}: ${row.name}${row.error ? ' — ' + row.error : ''}`);
  if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
}
