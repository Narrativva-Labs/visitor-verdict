import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function runContracts() {
  const source = await readFile(new URL('../src/traffic-class.js', import.meta.url), 'utf8');
  const results = [];
  function fixture(options = {}) {
    let now = 10000, next = 0;
    const timers = new Map(), listeners = {}, store = new Map();
    const document = {visibilityState: 'visible', hasFocus: () => true,
      addEventListener: (name, fn) => {listeners[name] = fn;},
      removeEventListener: name => {delete listeners[name];},
      createElement: () => ({getContext: () => null})};
    const window = {screen: {width: 1440, height: 900}, innerWidth: 1440, innerHeight: 900,
      outerWidth: 1440, outerHeight: 960, chrome: {},
      sessionStorage: {getItem: key => store.get(key), setItem: (key, value) => store.set(key, value)},
      addEventListener: document.addEventListener, removeEventListener: document.removeEventListener,
      setTimeout: (fn, delay) => {timers.set(++next, {fn, at: now + delay}); return next;},
      clearTimeout: id => timers.delete(id), trafficClassConfig: options.config || {debug: true}};
    window.top = window;
    const navigator = {language: 'en', userAgent: 'Chrome/140.0 Desktop', languages: ['en'], plugins: {length: 5}, hardwareConcurrency: 8};
    options.modify?.({window, document, navigator, store});
    const context = vm.createContext({window, document, navigator, Date: {now: () => now}});
    vm.runInContext(source, context);
    return {window, document, navigator, store, context,
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
  await test('Fast navigation is final only; timestamps bounded to 20; automated carry from final', () => {
    const f = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}))});
    assert.ok(!f.window.__trafficClass.signals.includes('FN')); f.advance(8000);
    assert.ok(f.window.__trafficClass.signals.includes('FN'));
    assert.equal(f.window.__trafficClass.class, 'suspicious');
    const g = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({timestamps: Array.from({length: 30}, (_, i) => i + 9970), lastClass: 'automated'}))});
    assert.equal(g.window.__trafficClass.class, 'automated');
    assert.equal(JSON.parse(g.store.get('traffic_class')).timestamps.length, 20);
    g.advance(8000); assert.equal(JSON.parse(g.store.get('traffic_class')).lastClass, 'automated');
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
  await test('Threshold 6 and 3 families: rapid idle standard screen suspicious; rapid idle alone human', () => {
    for (const geometry of [false, true]) {
      const f = fixture({modify: ({window, document, store}) => {
        document.createElement = () => ({getContext: () => ({getExtension: () => null})});
        if (geometry) window.screen = {width: 800, height: 600};
        store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}));
      }});
      f.advance(8000);
      assert.equal(f.window.__trafficClass.score, geometry ? 6 : 5);
      assert.equal(f.window.__trafficClass.class, geometry ? 'suspicious' : 'human');
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
  await test('TP: single move/click and missing approach counted before navigating pagehide', () => {
    for (const moves of [0, 1]) {
      const f = fixture({modify: ({window}) => {window.PointerEvent = function () {};}});
      if (moves) mouse(f, 'pointermove', 100, 100);
      mouse(f, 'click', 100, 100); f.emit('pagehide');
      assert.ok(f.window.__trafficClass.signals.includes('TP'));
      assert.equal(f.window.__trafficClass.class, 'human'); // TP3 + WG1 cannot classify alone
    }
    const f = fixture({modify: ({store}) => store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}))});
    mouse(f, 'click', 100, 100); f.emit('pagehide');
    assert.equal(f.window.__trafficClass.class, 'suspicious'); // TP + FN + graphics = 3 families
    const g = fixture({modify: ({document, store}) => {
      document.createElement = () => ({getContext: () => ({getExtension: () => null})});
      store.set('traffic_class', JSON.stringify({timestamps: [9000, 9500]}));
    }});
    mouse(g, 'click', 100, 100); g.emit('pagehide');
    assert.equal(g.window.__trafficClass.score, 6);
    assert.equal(g.window.__trafficClass.class, 'human'); // still needs 3 families
  });
  await test('TP: natural approach, rested cursor, repeated same point are exempt', () => {
    for (const rest of [false, true]) {
      const f = fixture({modify: ({window}) => {window.PointerEvent = function () {};}});
      if (!rest) { mouse(f, 'pointermove', 10, 10); mouse(f, 'pointermove', 40, 40); }
      mouse(f, 'pointermove', 100, 100);
      if (rest) f.advance(1200);
      mouse(f, 'click', 100, 100);
      for (let i = 0; i < 4; i++) { f.advance(200); mouse(f, 'click', 100, 100); }
      f.emit('pagehide'); assert.ok(!f.window.__trafficClass.signals.includes('TP'));
    }
  });
  await test('TP: distant click, sparse recent approach; ignore touch/pen/keyboard/untrusted', () => {
    const f = fixture(); mouse(f, 'mousemove', 0, 0); f.advance(1200);
    mouse(f, 'click', 200, 200); f.emit('pagehide');
    assert.ok(f.window.__trafficClass.signals.includes('TP'));
    for (const extra of [{pointerType: 'touch'}, {pointerType: 'pen'}, {detail: 0}, {isTrusted: false}]) {
      const g = fixture(); mouse(g, 'click', 100, 100, extra); g.emit('pagehide');
      assert.ok(!g.window.__trafficClass.signals.includes('TP'));
    }
  });
  await test('TP: compatibility mousemove does not double-count pointermove; old click uses pointerdown kind', () => {
    const f = fixture({modify: ({window}) => {window.PointerEvent = function () {};}});
    mouse(f, 'pointermove', 100, 100); mouse(f, 'mousemove', 100, 100);
    mouse(f, 'pointerdown', 100, 100); mouse(f, 'click', 100, 100, {pointerType: undefined});
    f.emit('pagehide'); assert.ok(f.window.__trafficClass.signals.includes('TP'));
  });
  await test('TP requires a fresh explicit trusted mouse pointerdown; mobile/unknown/WebKit clicks ignored', () => {
    for (const kind of [undefined, '', 'touch', 'pen', 'unknown']) {
      const f = fixture();
      f.emit('pointerdown', {isTrusted: true, pointerType: kind});
      f.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: 200, clientY: 200});
      f.emit('pagehide'); assert.ok(!f.window.__trafficClass.signals.includes('TP'), String(kind));
    }
    for (const pointerType of [undefined, '', 'mouse']) {
      const f = fixture();
      f.emit('click', {isTrusted: true, pointerType, detail: 1, clientX: 200, clientY: 200});
      f.emit('pagehide'); assert.ok(!f.window.__trafficClass.signals.includes('TP'));
    }
    const untrusted = fixture();
    untrusted.emit('pointerdown', {isTrusted: false, pointerType: 'mouse'});
    untrusted.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: 200, clientY: 200});
    untrusted.emit('pagehide'); assert.ok(!untrusted.window.__trafficClass.signals.includes('TP'));
    const f = fixture();
    f.emit('pointerdown', {isTrusted: true, pointerType: 'mouse'});
    f.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 0, clientX: 0, clientY: 0});
    f.emit('click', {isTrusted: true, pointerType: 'mouse', detail: 1, clientX: 200, clientY: 200});
    f.emit('pagehide'); assert.ok(!f.window.__trafficClass.signals.includes('TP'), 'pointerdown must be consumed');
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
        if (mode === 'constructor') objects.window.Worker = function () {throw Error('CSP blocked');};
      }});
      if (mode === 'error') record.instance.onerror({preventDefault() {}});
      if (mode === 'timeout') f.advance(1500);
      if (mode === 'pagehide') f.emit('pagehide'); else f.advance(8000);
      assert.equal(f.window.dataLayer.length, 2);
      assert.ok(!f.window.__trafficClass.signals.includes('WK'));
      assert.equal(record.revoked, 1);
      if (mode !== 'constructor') assert.equal(record.terminated, 1);
    }
  });
  await test('WK: late result after early final ignored; production contains only allowed fields', () => {
    let record;
    const f = fixture({config: {debug: false}, modify: objects => {record = fakeWorker(objects);}});
    const late = record.instance.onmessage;
    f.emit('pagehide'); late({data: {h: true, m: true}});
    assert.equal(f.window.dataLayer.length, 2);
    assert.equal(f.window.__trafficClass.class, 'human');
    assert.deepEqual(Object.keys(f.window.dataLayer[1]).sort(), ['event', 'traffic_class', 'traffic_phase', 'traffic_score']);
    assert.deepEqual(Object.keys(f.window.__trafficClass).sort(), ['class', 'phase', 'score']);
  });
  return results;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const results = await runContracts();
  for (const row of results) console.log(`${row.status}: ${row.name}${row.error ? ' — ' + row.error : ''}`);
  if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
}
