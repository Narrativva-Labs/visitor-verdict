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
      createElement: () => ({getContext: () => null}),
      createEvent: () => ({initEvent(type) { this.type = type; }}),
      dispatchEvent: event => {listeners[event.type]?.(event); return true;}
    };
    const window = {screen: {width: 1440, height: 900}, innerWidth: 1440, innerHeight: 900,
      outerWidth: 1440, outerHeight: 960, chrome: {},
      sessionStorage: {getItem: key => store.get(key), setItem: (key, value) => store.set(key, value)},
      addEventListener: document.addEventListener, removeEventListener: document.removeEventListener,
      setTimeout: (fn, delay) => {timers.set(++next, {fn, at: now + delay}); return next;},
      clearTimeout: id => timers.delete(id), visitorVerdictConfig: options.config || {debug: true, webgl: true, worker: true}};
    window.top = window;
    const navigator = {language: 'en', userAgent: 'Chrome/140.0 Desktop', languages: ['en'], plugins: {length: 5}, hardwareConcurrency: 8};
    options.modify?.({window, document, navigator, store});
    const context = vm.createContext({window, document, navigator, Date: {now: () => now},
      ...(options.json ? {JSON: options.json} : {}), ...(options.withoutJSON ? {JSON: undefined} : {})});
    vm.runInContext(source, context);
    return {window, document, navigator, store, context, timers, listeners, registrations, removals,
      get signals() { return window[window.visitorVerdictConfig.dataLayerName || 'dataLayer']?.at(-1)?.traffic_signals || []; },
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
  await test('GTM names, snapshot-only final event, and readiness triggers match the v1 contract', async () => {
    const {containerVersion: c} = JSON.parse(await readFile(new URL('../gtm/container-import.json', import.meta.url), 'utf8'));
    for (const object of [c.container, ...c.tag, ...c.trigger, ...c.variable]) assert.ok(object.name.startsWith('VV - '), object.name);
    assert.equal(c.tag.length, 2, 'Import creates detector and event tags only');
    assert.ok(!c.tag.some(t => t.type === 'googtag' || t.type === 'gaawc'));
    const variable = c.variable.find(v => v.name === 'VV - current class');
    assert.equal(variable.type, 'jsm');
    const script = '(' + variable.parameter.find(p => p.key === 'javascript').value + ')()';
    const evaluate = window => vm.runInNewContext(script, {window});
    const window = {__visitorVerdict: {class: 'human'}, __visitorVerdictLast: 'automated'};
    Object.defineProperty(window, 'sessionStorage', {get() {throw Error('Must not read storage');}});
    assert.equal(evaluate(window), 'human');
    window.__visitorVerdict = {class: 'suspicious'};
    assert.equal(evaluate(window), 'suspicious');
    delete window.__visitorVerdict;
    for (const c of ['human', 'suspicious', 'automated', 'declared_agent']) {
      window.__visitorVerdictLast = c; assert.equal(evaluate(window), c);
    }
    for (const value of [null, '', 'human\n', 'bogus', 100, {value: 'automated'}]) {
      window.__visitorVerdict = {class: value}; window.__visitorVerdictLast = value;
      assert.equal(evaluate(window), undefined);
    }
    Object.defineProperty(window, '__visitorVerdict', {get() {throw Error('Getter');}, configurable: true});
    window.__visitorVerdictLast = 'human'; assert.equal(evaluate(window), 'human');
    const final = c.tag.find(t => t.name === 'VV - GA4 traffic_class');
    const mappings = key => final.parameter.find(p => p.key === key).list.map(row =>
      Object.fromEntries(row.map.map(p => [p.key, p.value])));
    const fields = ['traffic_class', 'traffic_phase', 'traffic_score', 'traffic_version'];
    assert.deepEqual(mappings('eventSettingsTable'), fields.map(name => ({parameter: name, parameterValue: '{{VV - DLV ' + name + '}}'})));
    assert.deepEqual(mappings('userProperties'), [{name: 'traffic_class', value: '{{VV - DLV traffic_class}}'}]);
    for (const name of fields) {
      const v = c.variable.find(v => v.name === 'VV - DLV ' + name);
      assert.equal(v.type, 'v'); assert.equal(v.parameter.find(p => p.key === 'name').value, name);
    }
    for (const phase of ['initial', 'final']) {
      const trigger = c.trigger.find(t => t.name === 'VV - ' + phase);
      assert.equal(trigger.type, 'CUSTOM_EVENT');
      assert.equal(trigger.customEventFilter[0].parameter.find(p => p.key === 'arg1').value, 'traffic_class');
      assert.equal(trigger.filter[0].parameter.find(p => p.key === 'arg0').value, '{{VV - DLV traffic_phase}}');
      assert.equal(trigger.filter[0].parameter.find(p => p.key === 'arg1').value, phase);
      assert.equal(final.firingTriggerId.includes(trigger.triggerId), phase === 'final');
    }
    const timer = c.trigger.find(t => t.name === 'VV - timer fallback 1s');
    assert.equal(timer.type, 'TIMER'); assert.equal(timer.interval.value, '1000'); assert.equal(timer.limit.value, '1');
    assert.equal(timer.eventName.value, 'gtm.timer'); assert.equal(timer.autoEventFilter.length, 1);
    assert.ok(!c.tag.some(t => t.firingTriggerId.includes(timer.triggerId)), 'Existing Google tag is wired by its owner');
    const detector = c.tag.find(t => t.name === 'VV - detector');
    assert.deepEqual(detector.firingTriggerId, ['2147479553']);
    assert.equal(detector.consentSettings.consentStatus, 'NOT_NEEDED');
    const html = detector.parameter.find(p => p.key === 'html').value;
    assert.match(html, /window\.visitorVerdictConfig =/);
    assert.ok(!html.includes('trafficClassConfig'));
  });
  await test('CSP-safe GTM template has complete sections, equivalent validation, and only two read permissions', async () => {
    const tpl = await readFile(new URL('../gtm/templates/vv-current-class.tpl', import.meta.url), 'utf8');
    const sections = Object.fromEntries([...tpl.matchAll(/___([A-Z_]+)___\s*([\s\S]*?)(?=___[A-Z_]+___|$)/g)].map(m => [m[1], m[2].trim()]));
    for (const name of ['TERMS_OF_SERVICE', 'INFO', 'TEMPLATE_PARAMETERS', 'SANDBOXED_JS_FOR_WEB_TEMPLATE', 'WEB_PERMISSIONS', 'TESTS', 'NOTES']) assert.ok(sections[name], name);
    assert.equal(JSON.parse(sections.INFO).type, 'MACRO'); assert.deepEqual(JSON.parse(sections.TEMPLATE_PARAMETERS), []);
    const permissions = JSON.parse(sections.WEB_PERMISSIONS);
    assert.equal(permissions.length, 1); assert.equal(permissions[0].instance.key.publicId, 'access_globals');
    const rows = permissions[0].instance.param[0].value.listItem.map(row => Object.fromEntries(row.mapKey.map((k, i) => [k.string, row.mapValue[i].string ?? row.mapValue[i].boolean])));
    assert.deepEqual(rows, ['__visitorVerdict.class', '__visitorVerdictLast'].map(key => ({key, read: true, write: false, execute: false})));
    const evaluate = (current, previous) => {
      const calls = [];
      const value = vm.runInNewContext('(function() {' + sections.SANDBOXED_JS_FOR_WEB_TEMPLATE + '})()', {
        require(name) {
          assert.equal(name, 'copyFromWindow');
          return path => {calls.push(path); return path === '__visitorVerdict.class' ? current : previous;};
        }
      });
      return {value, calls};
    };
    for (const c of ['human', 'suspicious', 'automated', 'declared_agent']) {
      assert.deepEqual(evaluate(c, 'human'), {value: c, calls: ['__visitorVerdict.class']});
      assert.equal(evaluate(undefined, c).value, c);
    }
    for (const bad of ['human\n', 'bogus', {value: 'human'}, null, 1]) assert.equal(evaluate(bad, bad).value, undefined);
  });
  await test('v1 snapshots are frozen, replaced per publication, and immune to public/data-layer poisoning', () => {
    const f = fixture();
    const initial = f.window.__visitorVerdict;
    assert.ok(Object.isFrozen(initial)); assert.equal(initial.version, '1.0.0');
    assert.deepEqual(Object.keys(initial).sort(), ['class', 'phase', 'score', 'version']);
    const descriptor = Object.getOwnPropertyDescriptor(f.window, '__visitorVerdict');
    assert.equal(descriptor.configurable, false); assert.equal(descriptor.set, undefined);
    assert.throws(() => {f.window.__visitorVerdict = {class: 'automated', score: Infinity};}, TypeError);
    assert.throws(() => Object.defineProperty(f.window, '__visitorVerdict', {value: {class: 'automated'}}), TypeError);
    assert.throws(() => {initial.class = 'automated';}, TypeError);
    assert.throws(() => {initial.score = NaN;}, TypeError);
    assert.throws(() => {delete initial.phase;}, TypeError);
    f.window.dataLayer[0].traffic_class = 'alien'; f.window.dataLayer[0].traffic_score = Infinity;
    f.window.dataLayer[0].traffic_signals.push('WD');
    f.advance(8000);
    const final = f.window.__visitorVerdict;
    assert.notEqual(final, initial); assert.ok(Object.isFrozen(final));
    assert.equal(initial.phase, 'initial'); assert.equal(final.phase, 'final');
    assert.equal(final.class, 'human'); assert.equal(final.score, 3);
    assert.ok(!f.signals.includes('WD'));
    assert.equal(f.window.dataLayer[1].traffic_version, '1.0.0');
    vm.runInContext(source, f.context); f.emit('pagehide'); f.advance(8000);
    assert.equal(f.window.dataLayer.length, 2);
  });
  await test('v1 poisoned snapshots/markers never seed state or suppress inclusion, including locked public data', () => {
    for (const value of [{__tcDetector: true, __vvDetector: true, class: 'alien', score: Infinity, phase: 'final'}, {class: 'automated', score: 100}]) {
      const f = fixture({modify: ({window}) => {window.__visitorVerdict = value;}});
      assert.equal(f.window.__visitorVerdict.class, 'human');
      assert.equal(f.window.dataLayer[0].traffic_version, '1.0.0');
      vm.runInContext(source, f.context); f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
    }
    for (const descriptor of [{value: {class: 'alien', score: Infinity}}, {get() {return true;}}]) {
      const f = fixture({modify: ({window}) => Object.defineProperty(window, '__visitorVerdict', descriptor)});
      vm.runInContext(source, f.context); f.advance(8000); vm.runInContext(source, f.context);
      assert.deepEqual(Array.from(f.window.dataLayer, e => e.traffic_phase), ['initial', 'final']);
      assert.ok(f.window.dataLayer.every(e => e.traffic_class === 'human' && Number.isFinite(e.traffic_score)));
    }
  });
  await test('v1 source and generated GTM inclusions share a private document guard before and after final', async () => {
    const html = await readFile(new URL('../gtm/custom-html.html', import.meta.url), 'utf8');
    const script = html.trim().slice('<script>'.length, -'</script>'.length);
    const f = fixture();
    vm.runInContext(script, f.context); f.advance(8000); vm.runInContext(script, f.context); vm.runInContext(source, f.context);
    assert.equal(f.window.dataLayer.length, 2); assert.equal(f.window.__visitorVerdict.phase, 'final');
    const g = fixture({modify: ({document}) => {document.prerendering = true;}});
    vm.runInContext(script, g.context); g.document.prerendering = false; g.emit('prerenderingchange'); g.advance(8000);
    assert.equal(g.window.dataLayer.length, 2);
  });
  await test('v1 config and storage names have no legacy alias; previous class is a validated immutable string', () => {
    const f = fixture({config: {idleMs: 31, dataLayerName: 'vvEvents'}, modify: ({window, store}) => {
      window.trafficClassConfig = {idleMs: 1, dataLayerName: 'legacyEvents'};
      store.set('traffic_class', JSON.stringify({lastClass: {value: 'automated', direct: true}, tpPages: 255}));
      window.__trafficClass = {class: 'automated'};
    }});
    assert.equal(f.window.__visitorVerdict.class, 'human'); assert.equal(f.window.__visitorVerdictLast, undefined);
    assert.equal(f.window.legacyEvents, undefined); f.advance(1); assert.equal(f.window.vvEvents.length, 1);
    f.advance(30); assert.equal(f.window.vvEvents.length, 2); assert.ok(f.store.has('visitor_verdict'));
    assert.equal(JSON.parse(f.store.get('traffic_class')).tpPages, 255, 'Legacy record untouched');
    for (const value of ['human', 'suspicious', 'automated', 'declared_agent', {value: 'automated', direct: true}, {value: 'declared_agent', direct: true}, 'human\n', 'alien', 123, null, {value: 'human'}]) {
      const g = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({lastClass: value}))});
      const expected = ['human', 'suspicious', 'automated', 'declared_agent'].includes(value) ? value : value?.direct === true ? value.value : undefined;
      assert.equal(g.window.__visitorVerdictLast, expected);
      const descriptor = Object.getOwnPropertyDescriptor(g.window, '__visitorVerdictLast');
      assert.equal(descriptor.writable, false); assert.equal(descriptor.configurable, false);
      g.advance(8000); assert.equal(g.window.__visitorVerdictLast, expected, 'Snapshot taken only at start');
    }
  });
  await test('v1 GL/PW ignore planted plain data and getters but retain callable evidence and UA precedence', () => {
    for (const [target, name, code] of [['window', 'callPhantom', 'GL'], ['window', '__pwInitScripts', 'PW'], ['window', '__playwright__binding__controller__', 'PW'], ['document', '$cdc_marker', 'GL']]) {
      for (const value of [{}, [], {binding: 'data'}, ['script'], true, 'function']) {
        const f = fixture({modify: objects => {objects[target][name] = value;}});
        f.advance(8000); assert.equal(f.window.__visitorVerdict.class, 'human'); assert.ok(!f.signals.includes(code));
      }
      const getter = fixture({modify: objects => Object.defineProperty(objects[target], name, {get() {throw Error('Not evidence');}})});
      getter.advance(8000); assert.equal(getter.window.__visitorVerdict.class, 'human');
      const callable = fixture({modify: objects => {objects[target][name] = function () {}; objects.navigator.userAgent = 'ChatGPT-User';}});
      assert.equal(callable.window.__visitorVerdict.class, 'automated'); assert.ok(callable.signals.includes(code));
    }
    for (const [code, ua] of [['HL', 'ChatGPT-User HeadlessChrome/140.0'], ['AU', 'ChatGPT-User Lighthouse/1.0']]) {
      const f = fixture({modify: ({navigator}) => {navigator.userAgent = ua;}});
      assert.equal(f.window.__visitorVerdict.class, 'automated'); assert.ok(f.signals.includes(code));
    }
    const declared = fixture({modify: ({navigator}) => {navigator.userAgent = 'ChatGPT-User';}});
    assert.equal(declared.window.__visitorVerdict.class, 'declared_agent');
    declared.window.__playwright__binding__ = function () {}; declared.advance(8000);
    assert.equal(declared.window.__visitorVerdict.class, 'automated', 'Late hard evidence upgrades the initial declaration');
  });
  await test('v1 adversarial summaries retain version and reject pre-v1 event payloads', async () => {
    const {summarize, paths} = await import('./adversarial/report.mjs');
    const events = paths.flatMap(path => ['initial', 'final'].map(phase => ({path, event: {
      event: 'traffic_class', traffic_class: 'human', traffic_phase: phase, traffic_score: 0,
      traffic_version: '1.0.0', traffic_signals: []
    }})));
    const report = summarize({events});
    assert.equal(report.status, 'COMPLETE');
    assert.ok(report.pages.every(p => p.initial.traffic_version === '1.0.0' && p.final.traffic_version === '1.0.0'));
    delete events[0].event.traffic_version;
    assert.equal(summarize({events}).status, 'ERROR');
  });
  await test('v1 reentrant initial publication, stale timers, BFCache and duplicate loads cannot publish twice', () => {
    let pagehide;
    const events = [];
    const f = fixture({modify: ({window}) => {
      const add = window.addEventListener;
      window.addEventListener = (name, fn, opts) => {if (name === 'pagehide') pagehide = fn; add.call(window, name, fn, opts);};
      window.dataLayer = {length: 0, push(event) {events.push(event); this.length++; if (event.traffic_phase === 'initial') pagehide();}};
    }});
    f.emit('pagehide'); vm.runInContext(source, f.context); f.advance(8000);
    assert.deepEqual(events.map(e => e.traffic_phase), ['initial', 'final']);
    assert.ok(events.every(e => e.traffic_class === 'human' && Number.isFinite(e.traffic_score) && e.traffic_version === '1.0.0'));
    assert.equal(f.window.__visitorVerdict.phase, 'final');
  });
  await test('Initial synchronous; final once after 8000 visible ms; idle alone stays human', () => {
    const f = fixture();
    assert.equal(f.window.dataLayer.length, 1);
    assert.equal(f.window.__visitorVerdict.phase, 'initial');
    f.advance(7999); assert.equal(f.window.dataLayer.length, 1);
    f.advance(1); assert.equal(f.window.__visitorVerdict.phase, 'final');
    assert.equal(f.window.__visitorVerdict.class, 'human');
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
  await test('Hard evidence takes precedence over declared tokens and persists in final', () => {
    for (const agent of [true, false]) {
      const f = fixture({modify: ({navigator}) => {navigator.webdriver = true; if (agent) navigator.userAgent = 'ChatGPT-User';}});
      const expected = 'automated';
      assert.equal(f.window.__visitorVerdict.class, expected); f.advance(8000);
      assert.equal(f.window.__visitorVerdict.class, expected);
    }
  });
  await test('Debug off exposes no signals; custom data layer and config work; duplicate load guarded', () => {
    const f = fixture({config: {debug: false, idleMs: 25, dataLayerName: 'custom'}});
    assert.ok(!('signals' in f.window.__visitorVerdict));
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
      assert.equal(f.signals.includes('PL'), !mobile);
    }
  });
  await test('Synthetic-only and inactivity share a 2-point cap; any trusted modality removes both', () => {
    const f = fixture(); f.emit('mousemove', {isTrusted: false}); f.advance(8000);
    assert.equal(f.window.__visitorVerdict.class, 'human');
    assert.ok(f.signals.includes('SY'));
    const g = fixture(); g.emit('mousemove', {isTrusted: false}); g.emit('pointerdown', {isTrusted: true}); g.advance(8000);
    assert.equal(g.window.__visitorVerdict.class, 'human');
    assert.ok(!g.signals.includes('SY'));
  });
  await test('F8 fast navigation is final only; timestamps bounded to fastNavCount and rounded', () => {
    const f = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({timestamps: [9031, 9575]}))});
    assert.ok(!f.signals.includes('FN')); f.advance(8000);
    assert.ok(f.signals.includes('FN'));
    assert.equal(f.window.__visitorVerdict.class, 'human'); // FN + NI + WG is benign
    const g = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({timestamps: Array.from({length: 30}, (_, i) => 7000 + i * 100)}))});
    assert.deepEqual(JSON.parse(g.store.get('visitor_verdict')).timestamps, [9800, 9900, 10000]);
  });
  await test('Async notification mismatch only enters final phase', async () => {
    const f = fixture({modify: ({window, navigator}) => {
      window.Notification = {permission: 'denied'}; window.isSecureContext = true;
      navigator.userAgentData = {brands: [{brand: 'Chromium'}]};
      navigator.permissions = {query: () => Promise.resolve({state: 'prompt'})};
    }});
    await Promise.resolve();
    assert.ok(!f.signals.includes('NP'));
    f.advance(8000); assert.ok(f.signals.includes('NP'));
  });
  await test('Requested automation globals detected including non-enumerable keys', () => {
    for (const [target, name] of [['window', '__playwright__binding__'], ['window', '__playwright__binding__controller__'], ['window', '__pwInitScripts'], ['document', '$cdc_marker'], ['document', '$wdc_marker'], ['window', 'cdc_abc_Array'], ['document', '__webdriver_evaluate']]) {
      const f = fixture({modify: objects => Object.defineProperty(objects[target], name, {value: function () {}})});
      assert.equal(f.window.__visitorVerdict.class, 'automated', name);
    }
  });
  await test('NI requires 8000 visible ms; early pagehide and hidden time cannot fake it', () => {
    const f = fixture(); f.advance(7999); f.emit('pagehide');
    assert.ok(!f.signals.includes('NI'));
    const g = fixture(); g.advance(8000); assert.ok(g.signals.includes('NI'));
  });
  await test('F3 FN plus NI plus one environment family stays human at threshold 6', () => {
    for (const geometry of [false, true]) {
      const f = fixture({modify: ({window, document, store}) => {
        document.createElement = () => ({getContext: () => ({getExtension: () => null})});
        if (geometry) window.screen = {width: 800, height: 600};
        store.set('visitor_verdict', JSON.stringify({timestamps: [9000, 9500]}));
      }});
      f.advance(8000);
      assert.equal(f.window.__visitorVerdict.score, geometry ? 6 : 5);
      assert.equal(f.window.__visitorVerdict.class, 'human');
    }
    const two = fixture({config: {debug: true, suspiciousThreshold: 3}, modify: ({document, store}) => {
      document.createElement = () => ({getContext: () => ({getExtension: () => null})});
      store.set('visitor_verdict', JSON.stringify({timestamps: [9000, 9500]}));
    }});
    two.advance(8000); assert.equal(two.window.__visitorVerdict.class, 'human');
  });
  await test('Geometry cap, focus gate, language fallback, PDF-disabled and HC safeguards', () => {
    const f = fixture({modify: ({window, navigator}) => {
      window.screen = {width: 800, height: 600}; window.outerWidth = 0; window.outerHeight = 0;
      navigator.languages = []; navigator.plugins.length = 0; navigator.pdfViewerEnabled = false; navigator.hardwareConcurrency = 0;
    }});
    assert.equal(f.window.__visitorVerdict.score, 2); // geometry 1 + missing WebGL 1
    assert.ok(f.signals.includes('G0'));
    assert.ok(!f.signals.includes('LA'));
    assert.ok(!f.signals.includes('PL'));
    const g = fixture({modify: ({window, document}) => {
      window.outerWidth = window.outerHeight = 0; document.hasFocus = () => false;
    }});
    assert.ok(!g.signals.includes('G0'));
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
    assert.ok(alone.signals.includes('HW'));
    assert.equal(alone.window.__visitorVerdict.score, 2);
    alone.emit('keydown', {isTrusted: true}); alone.advance(8000);
    assert.equal(alone.window.__visitorVerdict.class, 'human');
    assert.equal(alone.window.__visitorVerdict.score, 2);
    for (const graphics of [false, true]) {
      const f = fixture({config: {debug: true, webgl: graphics}, modify: objects => {
        headlessGeometry(objects);
        objects.store.set('visitor_verdict', JSON.stringify({timestamps: [9000, 9500]}));
      }});
      f.advance(8000);
      assert.ok(['HW', 'FN', 'NI'].every(code => f.signals.includes(code)));
      assert.equal(f.window.__visitorVerdict.score, graphics ? 8 : 7);
      assert.equal(f.window.__visitorVerdict.class, graphics ? 'suspicious' : 'human');
    }
    const capped = fixture({config: {debug: true}, modify: objects => {
      headlessGeometry(objects);
      objects.window.screen.width = objects.window.screen.availWidth = objects.window.innerWidth = objects.window.outerWidth = 1280;
      objects.window.screen.height = objects.window.screen.availHeight = objects.window.innerHeight = objects.window.outerHeight = 720;
    }});
    assert.ok(['GS', 'HW'].every(code => capped.signals.includes(code)));
    assert.equal(capped.window.__visitorVerdict.score, 2);
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
      assert.equal(f.window.__visitorVerdict.class, 'human', `HW guard ${index}`);
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
      assert.ok(!f.signals.includes('HW'));
      f.document.hasFocus = () => true; f.document.visibilityState = 'visible'; f.emit('visibilitychange');
      f.emit('keydown', {isTrusted: true}); f.advance(8000);
      assert.ok(f.signals.includes('HW'));
      assert.equal(f.window.__visitorVerdict.class, 'human');
    }
    const real = fixture({config: {debug: true}, modify: objects => {
      headlessGeometry(objects);
      objects.window.outerHeight += 87;
      objects.window.screen = {width: 1710, height: 1112, availWidth: 1710, availHeight: 998};
    }});
    real.advance(8000);
    assert.ok(!real.signals.includes('HW'));
    assert.equal(real.window.__visitorVerdict.class, 'human');
  });
  await test('Missing WebGL debug extension and hardware Mesa renderer are not WG', () => {
    for (const renderer of [null, 'Mesa Intel Graphics', 'ANGLE (Apple M1)', 'Google SwiftShader', 'llvmpipe (LLVM 15)', 'Mesa OffScreen']) {
      const f = fixture({modify: ({document}) => {
        document.createElement = () => ({getContext: () => ({getExtension: name => name === 'WEBGL_debug_renderer_info' && renderer ? {} : null, getParameter: () => renderer})});
      }});
      assert.equal(f.signals.includes('WG'), /SwiftShader|llvmpipe|OffScreen/.test(renderer || ''));
    }
  });
  await test('PW exact shapes only, late recheck; nonexistent Puppeteer label ignored', () => {
    const f = fixture({modify: ({window}) => {
      window.__playwright_app = {}; window.__puppeteer_evaluation_script__ = {};
      window.__pwInitScripts = true;
    }});
    assert.equal(f.window.__visitorVerdict.class, 'human');
    f.window.__playwright__binding__controller__ = function () {}; f.advance(8000);
    assert.equal(f.window.__visitorVerdict.class, 'automated');
    assert.ok(f.signals.includes('PW'));
  });
  await test('FN ignores duplicate/future/bad timestamps and reload/back-forward navigation', () => {
    for (const type of ['reload', 'back_forward']) {
      const f = fixture({modify: ({window, store}) => {
        window.performance = {getEntriesByType: () => [{type}]};
        store.set('visitor_verdict', JSON.stringify({timestamps: [9000, 9500, 9500, -1, 999999, 'bad']}));
      }});
      f.advance(8000); assert.ok(!f.signals.includes('FN'));
      assert.deepEqual(JSON.parse(f.store.get('visitor_verdict')).timestamps, [9000, 9500]);
    }
  });
  await test('Research token boundaries and score sentinel', () => {
    for (const [ua, agent] of [['Claude-Agent/1.0', true], ['Google-Agent', true], ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Gemini-Deep-Research; +https://gemini.google/overview/deep-research/) Chrome/135.0.0.0 Safari/537.36', true], ['Gemini-Deep-Researcher', false], ['ChatGPT Agent', false], ['NotChatGPT-User', false], ['Applebot-Extended', false]]) {
      const f = fixture({modify: ({navigator}) => {navigator.userAgent = ua;}});
      assert.equal(f.window.__visitorVerdict.class, agent ? 'declared_agent' : 'human');
      if (agent) assert.equal(f.window.__visitorVerdict.score, 100);
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
      assert.ok(!f.signals.includes('TP'), mode);
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 0);
    }
  });
  await test('F1 TP catches one-event delta or recent observed-position jump before navigation', () => {
    for (const delta of [true, false]) {
      const f = fixture();
      if (delta) jump(f);
      else {mouse(f, 'mousemove', 10, 10); f.advance(150); mouse(f, 'mousemove', 320, 320); mouse(f, 'click', 320, 320);}
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 1);
      f.emit('pagehide');
      assert.ok(f.signals.includes('TP'));
      assert.equal(f.window.__visitorVerdict.class, 'human');
    }
    const f = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({timestamps: [9000, 9500]}))});
    jump(f); f.emit('pagehide');
    assert.equal(f.window.__visitorVerdict.class, 'suspicious'); // TP + FN + WG
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
      f.emit('pagehide'); assert.ok(!f.signals.includes('TP'), mode);
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
      f.emit('pagehide'); assert.ok(!f.signals.includes('TP'), mode);
    }
  });
  await test('F1 compatibility mousemove is not a second path event; click uses fresh mouse pointerdown', () => {
    const f = fixture({modify: ({window}) => {window.PointerEvent = function () {};}});
    mouse(f, 'pointermove', 320, 320); mouse(f, 'mousemove', 320, 320, {movementX: 320, movementY: 0});
    mouse(f, 'click', 320, 320, {pointerType: undefined});
    f.emit('pagehide'); assert.ok(f.signals.includes('TP'));
  });
  await test('TP requires a fresh explicit trusted mouse pointerdown; mobile/unknown/WebKit clicks ignored', () => {
    for (const kind of [undefined, '', 'touch', 'pen', 'unknown']) {
      const f = fixture();
      mouse(f, 'mousemove', 200, 200, {movementX: 320, movementY: 0});
      f.emit('pointerdown', {isTrusted: true, pointerType: kind});
      f.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: 200, clientY: 200});
      f.emit('pagehide'); assert.ok(!f.signals.includes('TP'), String(kind));
    }
    for (const pointerType of [undefined, '', 'mouse']) {
      const f = fixture();
      mouse(f, 'mousemove', 200, 200, {movementX: 320, movementY: 0});
      f.emit('click', {isTrusted: true, pointerType, detail: 1, clientX: 200, clientY: 200});
      f.emit('pagehide'); assert.ok(!f.signals.includes('TP'));
    }
    const untrusted = fixture();
    mouse(untrusted, 'mousemove', 200, 200, {movementX: 320, movementY: 0});
    untrusted.emit('pointerdown', {isTrusted: false, pointerType: 'mouse'});
    untrusted.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: 200, clientY: 200});
    untrusted.emit('pagehide'); assert.ok(!untrusted.signals.includes('TP'));
    const f = fixture();
    f.emit('pointerdown', {isTrusted: true, pointerType: 'mouse'});
    f.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 0, clientX: 0, clientY: 0});
    mouse(f, 'mousemove', 200, 200, {movementX: 320, movementY: 0});
    f.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: 200, clientY: 200});
    f.emit('pagehide'); assert.ok(!f.signals.includes('TP'), 'pointerdown must be consumed');
    const stale = fixture();
    mouse(stale, 'pointerdown', 100, 100); stale.advance(601);
    mouse(stale, 'mousemove', 320, 320, {movementX: 320, movementY: 0});
    stale.emit('click', {isTrusted: true, detail: 1, clientX: 320, clientY: 320});
    stale.emit('pagehide'); assert.ok(!stale.signals.includes('TP'), 'pointerdown must be fresh');
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
      assert.equal(f.window.__visitorVerdict.class, 'human');
      assert.ok(!f.signals.includes('UB'));
      f.emit('keydown', {isTrusted: true}); f.advance(8000);
      assert.deepEqual([...f.signals], ['UB']);
      assert.equal(f.window.__visitorVerdict.class, 'suspicious');
      assert.equal(f.window.__visitorVerdict.score, 6);
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).lastClass, 'suspicious');
      assert.equal(fixture({store: f.store, now: 11000}).window.__visitorVerdict.class, 'human');
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
      assert.ok(!f.signals.includes('UB'));
      assert.equal(f.window.__visitorVerdict.class, 'human');
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
      assert.ok(f.signals.includes('WK'));
      assert.equal(f.window.__visitorVerdict.score, emptyBrands ? 6 : 2);
      assert.equal(f.window.__visitorVerdict.class, emptyBrands ? 'suspicious' : 'human');
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
      assert.equal(f.window.__visitorVerdict.class, 'human');
      assert.ok(!f.signals.some(code => ['HW', 'UB', 'PL'].includes(code)));
    }
  });
  await test('UB preserves declared and hard precedence; production output remains class/phase/score/version only', () => {
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
      assert.equal(f.window.__visitorVerdict.class, kind === 'AG' ? 'declared_agent' : kind === 'production' ? 'suspicious' : 'automated');
      assert.equal(f.window.__visitorVerdict.score, kind === 'production' ? 6 : 100);
      assert.deepEqual(Object.keys(f.window.dataLayer[1]).sort(), ['event', 'traffic_class', 'traffic_phase', 'traffic_score', 'traffic_version']);
      assert.deepEqual(Object.keys(f.window.__visitorVerdict).sort(), ['class', 'phase', 'score', 'version']);
    }
  });
  await test('WK is zero when main and worker navigator are consistent', () => {
    let record;
    const f = fixture({modify: objects => {record = fakeWorker(objects); objects.navigator.webdriver = false;}});
    record.reply({...workerNav, webdriver: false});
    f.emit('keydown', {isTrusted: true}); f.advance(8000);
    assert.equal(record.replyData.m, false); assert.equal(record.replyData.h, false);
    assert.ok(!f.signals.includes('WK'));
    assert.equal(f.window.__visitorVerdict.score, 1); // only fixture's absent WebGL
    assert.equal(f.window.__visitorVerdict.class, 'human');
  });
  await test('WK: main-only UA switch is soft 2, worker reply boolean-only, cleanup immediate', () => {
    let record;
    const f = fixture({modify: objects => {record = fakeWorker(objects); objects.navigator.userAgent += ' UA-Switcher';}});
    record.reply(workerNav);
    assert.equal(Object.values(record.replyData).every(v => typeof v === 'boolean'), true);
    assert.ok(!f.signals.includes('WK'));
    f.advance(8000); assert.ok(f.signals.includes('WK'));
    assert.equal(f.window.__visitorVerdict.score, 5); // WG1 + NI2 + WK2; human
    assert.equal(f.window.__visitorVerdict.class, 'human');
    assert.equal(record.terminated, 1); assert.equal(record.revoked, 1);
  });
  await test('WK: exact supported comparisons; absent worker webdriver is unknown', () => {
    for (const change of [{}, {languages: ['cs']}, {hardwareConcurrency: 4}, {webdriver: true}]) {
      let record;
      const f = fixture({modify: objects => {record = fakeWorker(objects); objects.navigator.webdriver = false;}});
      record.reply({...workerNav, ...change}); f.advance(8000);
      assert.equal(f.signals.includes('WK'), Object.keys(change).length > 0);
    }
  });
  await test('WK: HeadlessChrome in worker is final hard HL and overrides initial declaration', () => {
    for (const declared of [false, true]) {
      let record;
      const f = fixture({modify: objects => {record = fakeWorker(objects); if (declared) objects.navigator.userAgent = 'Claude-Agent/1.0';}});
      record.reply({...workerNav, userAgent: 'HeadlessChrome/140.0'}); f.advance(8000);
      assert.ok(f.signals.includes('HL'));
      assert.equal(f.window.__visitorVerdict.class, 'automated');
      assert.equal(f.window.__visitorVerdict.score, 100);
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
      assert.ok(!f.signals.includes('WK'));
      assert.ok(!f.signals.includes('UB'));
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
    assert.equal(f.window.__visitorVerdict.class, 'human');
    assert.deepEqual(Object.keys(f.window.dataLayer[1]).sort(), ['event', 'traffic_class', 'traffic_phase', 'traffic_score', 'traffic_version']);
    assert.deepEqual(Object.keys(f.window.__visitorVerdict).sort(), ['class', 'phase', 'score', 'version']);
  });
  await test('TR: TP writes a bounded counter immediately, once per document, no exported counter', () => {
    const f = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({timestamps: [9000], lastClass: 'human', tpPages: 0}))});
    jump(f, 100, 100);
    const saved = JSON.parse(f.store.get('visitor_verdict'));
    assert.equal(saved.tpPages, 1); assert.equal(saved.lastClass, 'human');
    assert.equal(f.window.dataLayer.length, 1); // synchronous counter write precedes pagehide
    for (let i = 0; i < 5; i++) jump(f, 300 + i * 100, 200);
    assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 1);
    f.emit('pagehide'); assert.equal(f.window.__visitorVerdict.class, 'human');
    assert.ok(!f.signals.includes('TR'));
    assert.ok(!('tpPages' in f.window.__visitorVerdict));
    assert.ok(f.window.dataLayer.every(event => !('tpPages' in event)));
    assert.deepEqual(Object.keys(saved).sort(), ['lastClass', 'timestamps', 'tpPages']);
  });
  await test('Accessibility TR is final-only pointer weight; history alone never starts suspicious', () => {
    const store = new Map(), classes = [];
    for (let page = 0; page < 3; page++) {
      const f = fixture({store, now: 10000 + page * 1000, config: {debug: true}});
      classes.push(f.window.__visitorVerdict.class);
      assert.ok(!f.signals.includes('TR'));
      if (page < 2) {jump(f); f.emit('pagehide');}
      else f.advance(8000);
      classes.push(f.window.__visitorVerdict.class);
      assert.equal(JSON.parse(store.get('visitor_verdict')).tpPages, Math.min(page + 1, 2));
      if (page === 2) {
        assert.deepEqual([...f.signals].sort(), ['FN', 'NI', 'TR']);
        assert.equal(f.window.__visitorVerdict.score, 7); // TR2 + FN3 + NI2, three families
      }
    }
    assert.deepEqual(classes, ['human', 'human', 'human', 'human', 'human', 'suspicious']);
    const historyOnly = fixture({config: {debug: true, suspiciousThreshold: 1}, modify: ({store}) => store.set('visitor_verdict', JSON.stringify({tpPages: 255}))});
    assert.equal(historyOnly.window.__visitorVerdict.class, 'human');
    historyOnly.emit('pagehide'); assert.equal(historyOnly.window.__visitorVerdict.class, 'human');
  });
  await test('TR: corrupt/missing/noninteger/out-of-range counters reset to zero; 255 saturates', () => {
    for (const value of [undefined, null, '2', true, -1, 1.5, 256, 1e100, [], {}]) {
      const f = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({tpPages: value}))});
      assert.equal(f.window.__visitorVerdict.class, 'human', JSON.stringify(value));
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 0);
      jump(f, 100, 100);
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 1);
    }
    for (const value of [254, 255]) {
      const f = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({tpPages: value}))});
      jump(f, 100, 100); f.emit('pagehide');
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 255);
      assert.equal(f.window.__visitorVerdict.class, 'human');
    }
    for (const raw of ['bad JSON', 'null', '[]', '"bad"']) {
      const f = fixture({modify: ({store}) => store.set('visitor_verdict', raw)});
      jump(f, 100, 100); f.emit('pagehide');
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 1);
      assert.equal(f.window.dataLayer.length, 2);
    }
  });
  await test('TR: inherited count never overrides AG/WD/CA or promotes to automated by itself', () => {
    for (const expected of ['declared_agent', 'automated', 'carry', 'human']) {
      const f = fixture({modify: ({store, navigator}) => {
        store.set('visitor_verdict', JSON.stringify({tpPages: 2, lastClass: expected === 'carry' ? {value: 'automated', direct: true} : 'human'}));
        if (expected === 'declared_agent') navigator.userAgent = 'Claude-Agent/1.0';
        if (expected === 'automated') navigator.webdriver = true;
      }});
      const result = expected === 'carry' ? 'automated' : expected;
      assert.equal(f.window.__visitorVerdict.class, result); f.emit('pagehide');
      assert.equal(f.window.__visitorVerdict.class, result);
      assert.ok(f.signals.includes('TR'));
    }
  });
  await test('TR: denied storage degrades to local TP; duplicate/BFCache cannot recount', () => {
    const blocked = fixture({modify: ({window}) => Object.defineProperty(window, 'sessionStorage', {get() {throw Error('denied');}})});
    for (let i = 0; i < 5; i++) jump(blocked, 100 + i * 100, 100);
    blocked.emit('pagehide');
    assert.equal(blocked.window.__visitorVerdict.class, 'human');
    assert.ok(!blocked.signals.includes('TR'));
    const f = fixture(); jump(f, 100, 100);
    vm.runInContext(source, f.context); f.emit('pagehide'); f.emit('pageshow', {persisted: true});
    vm.runInContext(source, f.context); mouse(f, 'click', 300, 100);
    assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 1);
    assert.equal(f.window.dataLayer.length, 2);
  });
  await test('TR: final cannot overwrite a newer same-tab counter; TP sees newer prior pages', () => {
    const f = fixture();
    f.store.set('visitor_verdict', JSON.stringify({tpPages: 3})); f.emit('pagehide');
    assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 3);
    const g = fixture();
    g.store.set('visitor_verdict', JSON.stringify({tpPages: 1})); jump(g, 100, 100); g.emit('pagehide');
    assert.equal(g.window.__visitorVerdict.class, 'human');
    assert.equal(JSON.parse(g.store.get('visitor_verdict')).tpPages, 2);
  });
  await test('TR: rested/repeated/Enter controls do not accumulate TP across documents', () => {
    let stored;
    for (const mode of ['rest', 'repeat', 'Enter']) {
      const f = fixture({modify: ({store}) => {if (stored) store.set('visitor_verdict', stored);}});
      if (mode === 'Enter') {
        f.emit('keydown', {isTrusted: true}); mouse(f, 'click', 100, 100, {detail: 0});
      } else {
        mouse(f, 'mousemove', 20, 20); mouse(f, 'mousemove', 50, 50); mouse(f, 'mousemove', 100, 100);
        if (mode === 'rest') f.advance(1500);
        for (let i = 0; i < (mode === 'repeat' ? 5 : 1); i++) mouse(f, 'click', 100, 100);
      }
      f.emit('pagehide'); stored = f.store.get('visitor_verdict');
      assert.equal(JSON.parse(stored).tpPages, 0); assert.equal(f.window.__visitorVerdict.class, 'human');
    }
  });
  await test('Accessibility TR decays once per trusted-input document, never on idle or TP documents', () => {
    let stored = JSON.stringify({tpPages: 3});
    for (const expected of [2, 1, 0]) {
      const f = fixture({modify: ({store}) => store.set('visitor_verdict', stored)});
      mouse(f, 'mousemove', 10, 10); mouse(f, 'mousemove', 30, 30); mouse(f, 'mousemove', 50, 50);
      f.emit('pagehide'); f.emit('pagehide');
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, expected);
      assert.equal(f.window.__visitorVerdict.class, 'human');
      vm.runInContext(source, f.context); f.emit('pageshow', {persisted: true});
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, expected);
      stored = f.store.get('visitor_verdict');
    }
    const idle = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({tpPages: 2}))});
    idle.advance(8000); assert.equal(JSON.parse(idle.store.get('visitor_verdict')).tpPages, 2);
    const tp = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({tpPages: 1}))});
    mouse(tp, 'mousemove', 10, 10); mouse(tp, 'mousemove', 30, 30); mouse(tp, 'mousemove', 50, 50);
    tp.advance(200); jump(tp); tp.emit('pagehide');
    assert.equal(JSON.parse(tp.store.get('visitor_verdict')).tpPages, 2);
    assert.equal(tp.window.__visitorVerdict.class, 'human');
  });
  await test('F2 CA/CD preserve class and consume direct provenance; second clean page is human', () => {
    for (const signal of ['WD', 'HL', 'AU', 'GL', 'PW', 'AG']) {
      const direct = fixture({modify: ({window, navigator}) => {
        if (signal === 'WD') navigator.webdriver = true;
        if (signal === 'HL') navigator.userAgent = 'HeadlessChrome/140.0';
        if (signal === 'AU') navigator.userAgent = 'Lighthouse/1.0';
        if (signal === 'GL') window.callPhantom = function () {};
        if (signal === 'PW') window.__playwright__binding__ = function () {};
        if (signal === 'AG') navigator.userAgent = 'ChatGPT-User';
      }});
      direct.emit('pagehide');
      const store = direct.store;
      assert.equal(JSON.parse(store.get('visitor_verdict')).lastClass.direct, true, signal);
      const first = fixture({store, now: 11000});
      const expected = signal === 'AG' ? 'declared_agent' : 'automated';
      assert.equal(first.window.__visitorVerdict.class, expected);
      assert.ok(first.signals.includes(signal === 'AG' ? 'CD' : 'CA'), signal);
      first.emit('pagehide');
      assert.equal(first.window.__visitorVerdict.class, expected);
      assert.equal(JSON.parse(store.get('visitor_verdict')).lastClass, expected);
      const second = fixture({store, now: 12000});
      assert.equal(second.window.__visitorVerdict.class, 'human', signal);
      second.emit('pagehide'); assert.equal(second.window.__visitorVerdict.class, 'human', signal);
    }
    const legacy = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({lastClass: 'automated'}))});
    assert.equal(legacy.window.__visitorVerdict.class, 'human');
    const noUnload = new Map([['visitor_verdict', JSON.stringify({lastClass: {value: 'automated', direct: true}})]]);
    fixture({store: noUnload}); // No final: initial consumption must still expire provenance.
    assert.equal(fixture({store: noUnload, now: 11000}).window.__visitorVerdict.class, 'human');
  });
  await test('Declared page 1 carries as declared on page 2, with or without another declared UA token', () => {
    for (const token of ['ChatGPT-User', 'Claude-Agent/1.0']) for (const keepToken of [false, true]) {
      const first = fixture({modify: ({navigator}) => {navigator.userAgent = token;}});
      first.emit('pagehide'); assert.equal(first.window.__visitorVerdict.class, 'declared_agent');
      const second = fixture({store: first.store, now: 11000, modify: ({navigator}) => {if (keepToken) navigator.userAgent = token;}});
      assert.equal(second.window.__visitorVerdict.class, 'declared_agent');
      assert.ok(second.signals.includes('CD')); assert.ok(!second.signals.includes('CA'));
      second.advance(8000);
      assert.equal(second.window.__visitorVerdict.class, 'declared_agent');
      assert.equal(second.window.__visitorVerdict.score, 100);
      assert.ok(second.window.dataLayer.every(e => e.traffic_class === 'declared_agent'));
      const saved = JSON.parse(second.store.get('visitor_verdict')).lastClass;
      assert.deepEqual(saved, keepToken ? {value: 'declared_agent', direct: true} : 'declared_agent');
    }
  });
  await test('Declared carry never defeats current hard evidence, including a late Playwright binding', () => {
    for (const late of [false, true]) {
      const first = fixture({modify: ({navigator}) => {navigator.userAgent = 'ChatGPT-User';}});
      first.emit('pagehide');
      const second = fixture({store: first.store, now: 11000, modify: ({navigator}) => {
        navigator.userAgent = 'Claude-Agent/1.0'; if (!late) navigator.webdriver = true;
      }});
      assert.equal(second.window.__visitorVerdict.class, late ? 'declared_agent' : 'automated');
      if (late) second.window.__playwright__binding__ = function () {};
      second.advance(8000);
      assert.equal(second.window.__visitorVerdict.class, 'automated');
      assert.ok(second.signals.includes('CD')); assert.ok(second.signals.includes(late ? 'PW' : 'WD'));
      assert.deepEqual(JSON.parse(second.store.get('visitor_verdict')).lastClass, {value: 'automated', direct: true});
    }
  });
  await test('Forged stored declarations can only carry declared_agent, never automated or renewed provenance', () => {
    for (const lastClass of ['declared_agent', {value: 'declared_agent', direct: true},
      {value: 'declared_agent', direct: false}, {value: 'declared_agent', direct: true, extra: 'automated'},
      {value: 'declared_agent\n', direct: true}, {value: ['declared_agent'], direct: true}]) {
      const carry = lastClass && lastClass.value === 'declared_agent' && lastClass.direct === true;
      const first = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({lastClass}))});
      const expected = carry ? 'declared_agent' : 'human';
      assert.equal(first.window.__visitorVerdict.class, expected); first.advance(8000);
      assert.equal(first.window.__visitorVerdict.class, expected);
      assert.ok(first.window.dataLayer.every(e => e.traffic_class !== 'automated'));
      assert.equal(typeof JSON.parse(first.store.get('visitor_verdict')).lastClass, 'string');
      const second = fixture({store: first.store, now: 20000}); second.advance(8000);
      assert.equal(second.window.__visitorVerdict.class, 'human');
    }
  });
  await test('F2 direct evidence on a carried page renews provenance; CA alone never does', () => {
    const store = new Map([['visitor_verdict', JSON.stringify({lastClass: {value: 'automated', direct: true}})]]);
    const f = fixture({store, modify: ({window}) => {window.__playwright__binding__ = function () {};}});
    f.emit('pagehide'); assert.equal(JSON.parse(store.get('visitor_verdict')).lastClass.direct, true);
    assert.equal(fixture({store, now: 11000}).window.__visitorVerdict.class, 'automated');
  });
  await test('F2 GL/PW reject DOM nodes, collections, window proxies and other host instances', () => {
    const host = new (class Host {})();
    const node = {nodeType: 1, ownerDocument: {}};
    const collection = {[Symbol.toStringTag]: 'HTMLCollection', length: 1, 0: node};
    const proxy = {}; proxy.window = proxy;
    for (const value of [node, collection, proxy, host, new Date(), /app/]) {
      for (const [target, name] of [['window', 'callPhantom'], ['window', '__playwright__binding__'], ['document', '$cdc_form']]) {
        const f = fixture({modify: objects => {objects[target][name] = value;}});
        f.advance(8000); assert.equal(f.window.__visitorVerdict.class, 'human', name);
        assert.ok(!f.signals.includes('GL') && !f.signals.includes('PW'));
      }
    }
  });
  await test('F2 inclusion sentinel ignores named HTML, inherited markers and arbitrary prior values', () => {
    for (const value of [{nodeType: 1}, {class: 'human'}, Object.create({__tcDetector: true}), true]) {
      const f = fixture({modify: ({window}) => {window.__visitorVerdict = value;}});
      assert.equal(f.window.dataLayer.length, 1);
      vm.runInContext(source, f.context); f.advance(8000);
      assert.equal(f.window.dataLayer.length, 2);
      assert.deepEqual(Object.keys(f.window.__visitorVerdict).sort(), ['class', 'phase', 'score', 'version']);
    }
    const getter = {get __tcDetector() {throw Error('not our sentinel');}};
    const f = fixture({modify: ({window}) => {window.__visitorVerdict = getter;}});
    assert.equal(f.window.dataLayer.length, 1);
  });
  await test('F3 score needs non-benign evidence or two environment families plus behaviour', () => {
    for (const graphics of [false, true]) {
      const f = fixture({config: {debug: true, webgl: graphics}, modify: ({window, store}) => {
        if (!graphics) window.screen = {width: 800, height: 600};
        store.set('visitor_verdict', JSON.stringify({timestamps: [9000, 9500]}));
      }});
      f.advance(8000); assert.equal(f.window.__visitorVerdict.score, 6);
      assert.equal(f.window.__visitorVerdict.class, 'human');
    }
    const benignOnly = fixture({config: {debug: true, webgl: true, suspiciousThreshold: 1}, modify: ({window, navigator}) => {
      window.screen = {width: 800, height: 600}; navigator.languages = []; navigator.language = ''; navigator.plugins.length = 0;
    }});
    assert.equal(benignOnly.window.__visitorVerdict.class, 'human');
    const envBehaviour = fixture({modify: ({window, store}) => {
      window.screen = {width: 800, height: 600}; store.set('visitor_verdict', JSON.stringify({timestamps: [9000, 9500]}));
    }});
    envBehaviour.advance(8000); assert.equal(envBehaviour.window.__visitorVerdict.class, 'suspicious');
    let worker;
    const stealth = fixture({modify: objects => {
      worker = fakeWorker(objects); objects.window.screen = {width: 800, height: 600};
      // No WG: GS + NI + FN + WK still has positive worker evidence.
      objects.document.createElement = () => ({getContext: () => ({getExtension: () => null})});
      objects.store.set('visitor_verdict', JSON.stringify({timestamps: [9000, 9500]}));
    }});
    worker.reply({...workerNav, userAgent: 'Chrome/141.0 Desktop'}); stealth.advance(8000);
    assert.equal(stealth.window.__visitorVerdict.class, 'suspicious');
    assert.deepEqual([...stealth.signals].sort(), ['FN', 'GS', 'NI', 'WK']);
    const sy = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({timestamps: [9000, 9500]}))});
    sy.emit('mousemove', {isTrusted: false}); sy.advance(8000);
    assert.equal(sy.window.__visitorVerdict.class, 'suspicious');
  });
  await test('F4 heavy probes default off and require strict true opt-in', () => {
    for (const config of [{}, {webgl: false, worker: false}, {webgl: 'true', worker: 1}]) {
      let allocations = 0;
      const f = fixture({config, modify: ({window, document}) => {
        document.createElement = () => {allocations++; throw Error('Unexpected canvas');};
        window.Blob = window.Worker = function () {allocations++;};
      }});
      f.advance(8000); assert.equal(allocations, 0);
      assert.equal(f.window.__visitorVerdict.class, 'human');
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
      assert.equal(f.window.__visitorVerdict.phase, 'final');
      assert.equal(Object.keys(f.listeners).filter(name => name !== 'visitor-verdict:claim').length, 0); assert.equal(f.timers.size, 0);
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
    assert.equal(workers, 0); assert.equal(f.timers.size, 0); assert.equal(Object.keys(f.listeners).filter(name => name !== 'visitor-verdict:claim').length, 0);
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
        assert.equal(f.window.__visitorVerdict.phase, 'initial');
        f.advance(8000); assert.equal(f.window.__visitorVerdict.phase, 'final');
      }
      assert.equal(Object.keys(f.listeners).filter(name => name !== 'visitor-verdict:claim').length, 0); assert.equal(f.timers.size, 0);
    }
  });
  await test('F6 frames have no detector state, listeners, storage reads or probes', () => {
    let reads = 0;
    const f = fixture({modify: ({window, document}) => {
      window.top = {}; Object.defineProperty(window, 'sessionStorage', {get() {reads++; throw Error('frame storage');}});
      document.createElement = () => {throw Error('frame probe');};
    }});
    assert.equal(reads, 0); assert.equal(f.window.__visitorVerdict, undefined); assert.equal(f.window.dataLayer, undefined);
    assert.equal(f.timers.size, 0); assert.equal(Object.keys(f.listeners).filter(name => name !== 'visitor-verdict:claim').length, 0);
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
    assert.deepEqual(JSON.parse(f.store.get('visitor_verdict')).timestamps, [60000]);
    f.emit('prerenderingchange'); f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
    assert.equal(Object.keys(f.listeners).filter(name => name !== 'visitor-verdict:claim').length, 0);
  });
  await test('F7 debug strict true; invalid numeric and dataLayerName options use defaults', () => {
    for (const value of [true, false, 'true', 1, {}, null]) {
      const f = fixture({config: {debug: value, idleMs: -1, fastNavMs: '2000', fastNavCount: 0, suspiciousThreshold: NaN, dataLayerName: '__proto__'}});
      assert.equal('signals' in f.window.__visitorVerdict, false);
      assert.equal('traffic_signals' in f.window.dataLayer[0], value === true);
      f.advance(7999); assert.equal(f.window.dataLayer.length, 1);
      f.advance(1); assert.equal(f.window.dataLayer.length, 2);
      assert.deepEqual(Object.keys(JSON.parse(f.store.get('visitor_verdict'))).sort(), ['lastClass', 'timestamps', 'tpPages']);
    }
    for (const bad of [NaN, Infinity, -10, 0, 1.1, '100', null, {}, 1e12]) {
      const f = fixture({config: {debug: true, idleMs: bad}}); f.advance(7999);
      assert.equal(f.window.__visitorVerdict.phase, 'initial'); f.advance(1); assert.equal(f.window.__visitorVerdict.phase, 'final');
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
      assert.equal(f.window.__visitorVerdict.class, agent ? 'declared_agent' : 'human', ua);
    }
  });
  await test('F8 every write merges newer timestamps and preserves newer class and decayed TP', () => {
    const store = new Map();
    const older = fixture({store, now: 10057, modify: ({navigator}) => {navigator.webdriver = true;}});
    const newer = fixture({store, now: 10567});
    newer.emit('pagehide');
    store.set('visitor_verdict', JSON.stringify({...JSON.parse(store.get('visitor_verdict')), tpPages: 1}));
    older.advance(8000);
    const saved = JSON.parse(store.get('visitor_verdict'));
    assert.deepEqual(saved.timestamps, [10000, 10500]); assert.equal(saved.lastClass, 'human'); assert.equal(saved.tpPages, 1);
    const f = fixture({store, now: 20000});
    store.set('visitor_verdict', JSON.stringify({timestamps: [20100, 20200, 20300], lastClass: 'suspicious', tpPages: 2}));
    f.advance(400); jump(f); // TP merge must see the new document, too.
    assert.deepEqual(JSON.parse(store.get('visitor_verdict')).timestamps, [20100, 20200, 20300]);
    assert.equal(JSON.parse(store.get('visitor_verdict')).tpPages, 3);
    f.emit('pagehide'); assert.equal(JSON.parse(store.get('visitor_verdict')).lastClass, 'suspicious');
  });
  await test('F8 stale human final cannot decay newer TP state or resurrect a previously decayed count', () => {
    const store = new Map([['visitor_verdict', JSON.stringify({tpPages: 3})]]);
    const older = fixture({store});
    mouse(older, 'mousemove', 10, 10); mouse(older, 'mousemove', 30, 30); mouse(older, 'mousemove', 50, 50);
    const newer = fixture({store, now: 11000});
    mouse(newer, 'mousemove', 10, 10); mouse(newer, 'mousemove', 30, 30); mouse(newer, 'mousemove', 50, 50);
    newer.emit('pagehide'); assert.equal(JSON.parse(store.get('visitor_verdict')).tpPages, 2);
    older.advance(2000); older.emit('pagehide'); assert.equal(JSON.parse(store.get('visitor_verdict')).tpPages, 2);
  });
  await test('F8 same rounded timestamp cannot overwrite a changed class or newly increased TP count', () => {
    const store = new Map();
    const older = fixture({store, now: 10001, modify: ({navigator}) => {navigator.webdriver = true;}});
    const newer = fixture({store, now: 10099}); newer.emit('pagehide');
    older.emit('pagehide'); assert.equal(JSON.parse(store.get('visitor_verdict')).lastClass, 'human');
    const human = fixture({store, now: 11001});
    mouse(human, 'mousemove', 10, 10); mouse(human, 'mousemove', 30, 30); mouse(human, 'mousemove', 50, 50);
    store.set('visitor_verdict', JSON.stringify({...JSON.parse(store.get('visitor_verdict')), tpPages: 2}));
    human.emit('pagehide'); assert.equal(JSON.parse(store.get('visitor_verdict')).tpPages, 2);
  });
  await test('F9 missing isTrusted counts as human activity for NI/SY, never positive TP evidence', () => {
    for (const type of ['mousemove', 'pointerdown', 'touchstart', 'scroll', 'keydown', 'wheel']) {
      const f = fixture(); f.emit('mousemove', {isTrusted: false});
      f.emit(type); f.advance(8000);
      assert.ok(!f.signals.includes('NI'), type);
      assert.ok(!f.signals.includes('SY'), type);
      assert.ok(!f.signals.includes('TP'), type);
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
      f.advance(8000); assert.equal(Object.keys(f.listeners).filter(name => name !== 'visitor-verdict:claim').length, 0);
      for (const entry of input) assert.ok(f.removals.some(r => r.name === entry.name && r.fn === entry.fn && r.opts === entry.opts));
    }
  });
  await test('Accessibility warp clicks on three slow pages with keyboard input remain human', () => {
    const store = new Map();
    for (let page = 0; page < 3; page++) {
      const f = fixture({store, now: 10000 + page * 12000, modify: ({window}) => {window.screen = {width: 800, height: 600};}});
      assert.equal(f.window.__visitorVerdict.class, 'human');
      f.emit('keydown', {isTrusted: true}); jump(f); f.emit('keyup', {isTrusted: true}); f.advance(8000);
      assert.equal(f.window.__visitorVerdict.class, 'human');
      assert.equal(f.window.__visitorVerdict.score, 5); // GS1 + WG1 + pointer cap3
      assert.ok(!f.signals.includes('FN') && !f.signals.includes('NI'));
      assert.equal(f.signals.includes('TR'), page > 0);
      assert.equal(JSON.parse(store.get('visitor_verdict')).tpPages, page + 1);
    }
  });
  await test('Accessibility warp plus fast navigation and idle still needs other families', () => {
    const store = new Map();
    for (let page = 0; page < 3; page++) {
      const f = fixture({store, now: 10000 + page * 1000});
      jump(f);
      if (page < 2) f.emit('pagehide'); else {
        f.advance(8000);
        assert.equal(f.window.__visitorVerdict.class, 'suspicious');
        assert.deepEqual([...f.signals].sort(), ['FN', 'TP', 'TR', 'WG']);
        assert.equal(f.window.__visitorVerdict.score, 7); // TP/TR cap3 + FN3 + WG1
        assert.ok(!f.signals.includes('NI'), 'A warp click is activity; do not manufacture NI');
      }
    }
  });
  await test('Accessibility all trusted modalities repay TP history and suppress NI in window capture', () => {
    for (const type of ['keydown', 'keyup', 'focusin', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'scroll', 'wheel', 'mousemove']) {
      const f = fixture({passive: true, modify: ({store}) => store.set('visitor_verdict', JSON.stringify({tpPages: 2}))});
      const registration = f.registrations.find(r => r.name === type);
      assert.ok(registration && registration.target === 'window' && registration.opts.capture, type);
      f.emit(type, {isTrusted: true}); f.advance(8000);
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, 1, type);
      assert.ok(!f.signals.includes('NI'), type);
      assert.ok(!f.signals.includes('TR'), type);
      assert.equal(f.window.__visitorVerdict.class, 'human', type);
    }
    const synthetic = fixture({modify: ({store}) => store.set('visitor_verdict', JSON.stringify({tpPages: 2}))});
    synthetic.emit('focusin', {isTrusted: false}); synthetic.emit('pointerup', {isTrusted: false}); synthetic.advance(8000);
    assert.equal(JSON.parse(synthetic.store.get('visitor_verdict')).tpPages, 2);
    assert.ok(synthetic.signals.includes('NI'));
  });
  await test('v1 oversized storage poison is ignored and repaired to the bounded schema', () => {
    for (const length of [47864, 100000]) {
      const raw = JSON.stringify({timestamps: Array(length).fill(9000), lastClass: {value: 'automated', direct: true}, tpPages: 255});
      const parsedLengths = [];
      const f = fixture({json: {parse(text) {
        parsedLengths.push(text.length);
        return JSON.parse(text);
      }}, modify: ({store}) => store.set('visitor_verdict', raw)});
      assert.equal(f.window.__visitorVerdict.class, 'human'); assert.equal(f.window.__visitorVerdictLast, undefined);
      assert.deepEqual(JSON.parse(f.store.get('visitor_verdict')), {timestamps: [10000], lastClass: '', tpPages: 0});
      // Also repair a record planted after startup, on the next final write.
      f.store.set('visitor_verdict', raw);
      f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
      assert.equal(f.window.__visitorVerdict.class, 'human');
      assert.deepEqual(JSON.parse(f.store.get('visitor_verdict')), {timestamps: [10000], lastClass: 'human', tpPages: 0});
      assert.ok(parsedLengths.every(size => size <= 2048), 'Oversized storage must never enter JSON.parse');
    }
  });
  await test('Storage accepts the 2048-character boundary and discards 2049 characters before parsing', () => {
    const record = JSON.stringify({lastClass: 'suspicious', tpPages: 1});
    for (const length of [2048, 2049]) {
      let parsed = false;
      const raw = record.padEnd(length, ' ');
      const f = fixture({json: {parse(text) {if (text === raw) parsed = true; return JSON.parse(text);}},
        modify: ({store}) => store.set('visitor_verdict', raw)});
      assert.equal(parsed, length === 2048);
      assert.equal(f.window.__visitorVerdictLast, length === 2048 ? 'suspicious' : undefined);
      assert.equal(JSON.parse(f.store.get('visitor_verdict')).tpPages, length === 2048 ? 1 : 0);
    }
  });
  await test('Timestamp merging reads at most the approved 20-entry tail even inside a short record', () => {
    const times = Array(100).fill(0); times[0] = 9000; times[1] = 9500;
    times[times.length - 1] = 9800;
    const raw = JSON.stringify({timestamps: times});
    assert.ok(raw.length < 2048);
    let reads = 0;
    const f = fixture({config: {debug: true, fastNavCount: 20}, json: {parse(text) {
      const record = JSON.parse(text);
      if (text === raw) {
        // A throwing prefix makes a full-array copy/scan observable without
        // relying on a wall-clock performance assertion.
        Object.defineProperty(record.timestamps, 0, {get() {throw Error('Unbounded timestamp scan');}});
        Object.defineProperty(record.timestamps, 99, {get() {reads++; return 9800;}});
      }
      return record;
    }}, modify: ({store}) => store.set('visitor_verdict', raw)});
    assert.ok(reads > 0, 'Tail was processed successfully');
    assert.deepEqual(JSON.parse(f.store.get('visitor_verdict')).timestamps, [0, 9800, 10000]);
    f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
  });
  await test('Storage sanitises every write, including unknown class shapes and concurrent records', () => {
    for (const lastClass of [{arbitrary: 'raw'}, 'secret', 'human\n', 'automated\r', [], 1, {value: ['automated'], direct: true}, {value: 'human', direct: true},
      {value: 'automated\n', direct: true},
      {value: 'automated', direct: true, arbitrary: 'raw'}, {value: 'declared_agent', direct: true, extra: {raw: true}}]) {
      const writes = [];
      const f = fixture({modify: ({window, store}) => {
        store.set('visitor_verdict', JSON.stringify({lastClass, unknown: 'raw', timestamps: [9000], tpPages: 1}));
        const set = window.sessionStorage.setItem;
        window.sessionStorage.setItem = (key, value) => {writes.push(JSON.parse(value)); set(key, value);};
      }});
      // Repair an independently written invalid record even when its timestamps
      // are newer than this document. Sanitisation must precede merge decisions.
      f.advance(200);
      f.store.set('visitor_verdict', JSON.stringify({lastClass, unknown: 'raw', timestamps: [10100], tpPages: 1}));
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
    const f = fixture({withoutJSON: true, modify: ({store}) => store.set('visitor_verdict', '{"lastClass":{"raw":"secret"},"tpPages":255}')});
    assert.equal(f.window.__visitorVerdict.class, 'human');
    assert.deepEqual(JSON.parse(f.store.get('visitor_verdict')), {timestamps: [10000], lastClass: '', tpPages: 0});
    f.advance(8000); assert.equal(f.window.dataLayer.length, 2);
    assert.deepEqual(JSON.parse(f.store.get('visitor_verdict')), {timestamps: [10000], lastClass: 'human', tpPages: 0});
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
      assert.equal(f.window.__visitorVerdict.phase, 'final'); assert.equal(f.window.__visitorVerdict.class, 'human');
      assert.equal(Object.keys(f.listeners).filter(name => name !== 'visitor-verdict:claim').length, 0); assert.equal(f.timers.size, 0);
      if (![f.window, f.document].some(target => methods.every(method => typeof target[method] === 'function'))) {
        assert.ok(!f.signals.includes('NI'), 'Unobservable input must remain unknown');
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
        assert.equal(f.window.__visitorVerdict.class, 'human');
        if (page < 2) {jump(f); f.emit('pagehide');}
        else {
          if (type !== 'idle') f.emit(type, {isTrusted: true});
          f.advance(8000);
          assert.equal(f.window.__visitorVerdict.class, type === 'idle' ? 'suspicious' : 'human', type);
          assert.equal(f.signals.includes('NI'), type === 'idle', type);
          assert.equal(f.signals.includes('TR'), type === 'idle', type);
          assert.ok(f.signals.includes('FN'), type);
          assert.equal(JSON.parse(store.get('visitor_verdict')).tpPages, type === 'idle' ? 2 : 1, type);
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
