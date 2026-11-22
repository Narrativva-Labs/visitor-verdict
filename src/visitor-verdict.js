/* Override these defaults with window.visitorVerdictConfig before loading. */
(function (w, d, n) {
  'use strict';
  var own = Object.prototype.hasOwnProperty, tag = Object.prototype.toString;
  // Frames must not probe, publish, or touch this tab's storage.
  if (w.top !== w) { return; }
  var version = '1.1.0', snapshot, claimed = false, activated = false, duplicate = false, claimListener = false;
  // Keep the per-document inclusion marker in an event listener's closure.
  // Predefined public globals (even non-configurable ones) cannot claim it.
  function claim(event) {
    if (claimed && typeof event.vvClaim === 'function') { event.vvClaim(); }
  }
  try {
    if (canListen(d) && typeof d.createEvent === 'function' && typeof d.dispatchEvent === 'function') {
      var probe = d.createEvent('Event');
      probe.initEvent('visitor-verdict:claim', false, false);
      probe.vvClaim = function () { duplicate = true; };
      d.dispatchEvent(probe);
      if (duplicate) { return; }
      claimListener = addListener(d, 'visitor-verdict:claim', claim, true);
      claimed = claimListener;
    }
  } catch (ignore) {}
  // Legacy hosts without an event API can still recognise our accessor's
  // closure handshake. Plain data properties never qualify as an owner.
  // An accessor lets each publication replace the frozen snapshot while the
  // public property itself stays non-configurable and has no setter.
  function current(probe) {
    if (probe === current) { return claimed; }
    return snapshot;
  }
  var existing = Object.getOwnPropertyDescriptor(w, '__visitorVerdict');
  try {
    if (!claimListener && existing && !existing.configurable && !existing.set && existing.get &&
        existing.get(existing.get) === true) { return; }
  } catch (ignore) {}
  try {
    Object.defineProperty(w, '__visitorVerdict', {get: current, configurable: false, enumerable: true});
    claimed = true;
  } catch (ignore) {
    // A preloaded non-configurable global cannot be repaired in this realm.
    // Do not trust its contents or let it disable data-layer publication.
  }
  function activate() {
    if (activated || d.prerendering === true) { return; }
    activated = true;
    removeListener(d, 'prerenderingchange', activate, true);
    start();
  }
  if (d.prerendering === true) { addListener(d, 'prerenderingchange', activate, true); }
  else { activate(); }
  function canListen(target) {
    return !!target && typeof target.addEventListener === 'function' && typeof target.removeEventListener === 'function';
  }
  function addListener(target, name, handler, options) {
    try {
      // An add without a matching remove would leave a permanent listener.
      if (canListen(target)) { target.addEventListener(name, handler, options); return true; }
    } catch (ignore) {}
    return false;
  }
  function removeListener(target, name, handler, options) {
    try {
      if (target && typeof target.removeEventListener === 'function') { target.removeEventListener(name, handler, options); }
    } catch (ignore) {}
  }
  function shapeValue(value) {
    try {
      if (!value || value === w || value.window === value || value.nodeType || value.ownerDocument) { return false; }
      var kind = tag.call(value), proto;
      if (kind === '[object Function]' || kind === '[object Array]') { return true; }
      if (kind !== '[object Object]') { return false; }
      proto = Object.getPrototypeOf(value);
      return proto === null || Object.getPrototypeOf(proto) === null;
    } catch (ignore) { return false; }
  }
  function start() {
    var config = {
      idleMs: 8000, fastNavMs: 2000, fastNavCount: 3,
      suspiciousThreshold: 6, debug: false, webgl: false, worker: false, dataLayerName: 'dataLayer',
      agentTokens: [
        'ChatGPT-User', 'OAI-SearchBot', 'OAI-AdsBot', 'GPTBot',
        'Claude-Agent', 'Claude-User', 'Claude-SearchBot', 'ClaudeBot',
        'Perplexity-User', 'PerplexityBot', 'Google-Agent', 'Google-CloudVertexBot',
        'Google-GeminiNotebook', 'Google-NotebookLM', 'Gemini-Deep-Research', 'MistralAI-User',
        'MistralAI-Index', 'MistralAI-Training', 'DuckAssistBot', 'Applebot',
        'Bytespider', 'meta-externalagent', 'meta-externalfetcher', 'meta-webindexer',
        'CCBot', 'Amazonbot', 'Amzn-SearchBot'
      ]
    };
    var key, overrides = w.visitorVerdictConfig || {};
    for (key in config) {
      if (own.call(overrides, key)) {
        var value = overrides[key];
        if (key === 'agentTokens') {
          if (tag.call(value) === '[object Array]') { config[key] = value.slice(0, 64); }
        } else if (key === 'dataLayerName') {
          if (typeof value === 'string' && value.length > 0 && value.length <= 128 &&
              !/^(?:__proto__|prototype|constructor)$/.test(value)) { config[key] = value; }
        } else if (typeof config[key] === 'number') {
          var max = key === 'idleMs' ? 3600000 : key === 'fastNavMs' ? 60000 : key === 'fastNavCount' ? 20 : 1000;
          if (typeof value === 'number' && isFinite(value) && value >= (key === 'fastNavCount' ? 2 : 1) &&
              value <= max && Math.floor(value) === value) { config[key] = value; }
        } else { config[key] = value === true; }
      }
    }
    var signals = [], families = {}, score = 0, hard = false, declared = false, direct = false;
    var done = false, initial, initialPublished = false, finalPublished = false, elapsed = 0, started = null, timer;
    // Agent UI markers: operator from a marker (this or the previous document).
    var agent = '', marked = false, agentPublished = false, latest = '', observer = null;
    var active = false, synthetic = false, mismatch = false, timestamps = [], fast = false;
    var inputTarget = canListen(w) ? w : canListen(d) ? d : null, observesInput = true;
    var visibilityTarget = canListen(d) ? d : w;
    var ua = n.userAgent || '', mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua) ||
      (n.maxTouchPoints > 1 && /Macintosh/i.test(ua));
    var embedded = /; wv\)|WebView|FBAN|FBAV|Instagram/i.test(ua);
    var desktop = !mobile && !embedded && /Chrome\//i.test(ua);
    var chromium = false, hasBrands = false, brands = n.userAgentData && n.userAgentData.brands, i;
    var events = 'mousemove pointermove pointerdown pointercancel pointerup touchstart touchmove touchend touchcancel scroll keydown keyup wheel click focusin'.split(' ');
    // Bounded transient state only: no trajectories, rates or input objects retained.
    var move = null, clicked = null, pointerKind = '', downAt = 0, teleport = false;
    var tpPages = 0, pageTime = Math.floor(Date.now() / 100) * 100;
    var classSnapshot = null, tpSnapshot = 0;
    var worker = null, workerURL = null, workerTimer, workerMismatch = false, workerHeadless = false, workerBrands = false;
    var urlAPI = w.URL || w.webkitURL;
    function stopWorker() {
      w.clearTimeout(workerTimer);
      if (worker) {
        worker.onmessage = worker.onerror = null;
        try { worker.terminate(); } catch (ignore) {}
        worker = null;
      }
      if (workerURL) {
        try { urlAPI.revokeObjectURL(workerURL); } catch (ignore) {}
        workerURL = null;
      }
    }
    function startWorker() {
      if (!config.worker || done) { return; }
      var ready = false;
      try {
        if (!w.Worker || !w.Blob || !urlAPI || !urlAPI.createObjectURL) { return; }
        // Main values travel only to this local worker; its reply contains booleans.
        // No OffscreenCanvas probe: avoid another graphics context and its cost.
        var code = 'onmessage=function(e){var a=e.data,n=navigator,m=false,b=false;' +
          'try{if(a.ua&&n.userAgent&&a.ua!==n.userAgent)m=true;' +
          'if(typeof a.wd==="boolean"&&typeof n.webdriver==="boolean"&&a.wd!==n.webdriver)m=true;' +
          'if(a.la&&a.la.length&&n.languages&&n.languages.length&&a.la.join("|")!==Array.prototype.join.call(n.languages,"|"))m=true;' +
          'if(a.hc>0&&n.hardwareConcurrency>0&&a.hc!==n.hardwareConcurrency)m=true;' +
          // An absent API (Firefox/Safari), malformed shape or denied getter is
          // unknown. An exposed API with no value/brands contradicts main UA-CH.
          'try{if(a.ub&&"userAgentData" in n){var u=n.userAgentData;' +
          'b=u==null||(Object.prototype.toString.call(u.brands)==="[object Array]"&&u.brands.length===0);}}catch(y){}' +
          'postMessage({m:m,b:b,h:/(?:^|[^A-Za-z0-9_-])HeadlessChrome(?=$|[^A-Za-z0-9_-])/i.test(n.userAgent||"")});' +
          '}catch(x){postMessage({m:false,b:false,h:false});}close();}';
        workerURL = urlAPI.createObjectURL(new w.Blob([code], {type: 'text/javascript'}));
        worker = new w.Worker(workerURL);
        worker.onmessage = function (event) {
          try {
            if (!done && event.data) {
              workerMismatch = event.data.m === true;
              workerHeadless = event.data.h === true;
              workerBrands = event.data.b === true;
            }
          } finally { stopWorker(); }
        };
        worker.onerror = function (event) {
          try { if (event.preventDefault) { event.preventDefault(); } } finally { stopWorker(); }
        };
        workerTimer = w.setTimeout(stopWorker, Math.min(1500, config.idleMs));
        worker.postMessage({ua: n.userAgent || '', wd: n.webdriver,
          ub: hasBrands,
          la: n.languages ? Array.prototype.slice.call(n.languages) : null, hc: n.hardwareConcurrency});
        ready = true;
      } catch (ignore) {} finally { if (!ready) { stopWorker(); } }
    }
    function distance(a, x, y) {
      return (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
    }
    function pointer(event) {
      var now = Date.now();
      if (event.type === 'pointerdown') {
        pointerKind = event.isTrusted === true && event.pointerType === 'mouse' ? 'mouse' : '';
        downAt = now;
        return;
      }
      if (/^(touchstart|touchend|touchcancel|pointercancel|keydown|keyup)$/.test(event.type)) { pointerKind = ''; return; }
      var mouseDown = false;
      if (event.type === 'click') { mouseDown = pointerKind === 'mouse' && now - downAt <= 600; pointerKind = ''; }
      if (event.isTrusted !== true || typeof event.clientX !== 'number' || typeof event.clientY !== 'number') { return; }
      // Use mousemove only: Pointer Events also emit a compatibility mousemove.
      if (event.type === 'mousemove') {
        if (move && distance(move, event.clientX, event.clientY) === 0) { return; }
        var recent = move && now - move.t <= 600;
        var jump = (typeof event.movementX === 'number' && typeof event.movementY === 'number' &&
          event.movementX * event.movementX + event.movementY * event.movementY > 40000) ||
          (recent && distance(move, event.clientX, event.clientY) > 40000);
        var path = recent && now - move.t <= 120 ? Math.min(3, move.path + 1) : 1;
        move = {x: event.clientX, y: event.clientY, t: now, jump: !!jump && path < 3, path: path};
      }
      if (event.type === 'click' && event.detail > 0 && mouseDown && (!event.pointerType || event.pointerType === 'mouse') &&
          move && move.jump && now - move.t <= 600 && distance(move, event.clientX, event.clientY) <= 4 &&
          (!clicked || distance(clicked, event.clientX, event.clientY) > 1600)) {
        if (!teleport) { teleport = true; recordTeleport(); }
      }
      if (event.type === 'click') { clicked = {x: event.clientX, y: event.clientY}; move = null; }
    }
    function add(code, weight, family) {
      if (signals.indexOf(code) !== -1) { return; }
      signals.push(code);
      if (weight === 100) {
        if (code !== 'CA' && code !== 'CD') { direct = true; }
        if (code === 'AG' || code === 'CD' || code === 'DM') { declared = true; } else { hard = true; }
      }
      else if (weight) {
        score += Math.max(0, weight - (families[family] || 0));
        families[family] = Math.max(weight, families[family] || 0);
      }
    }
    function bounded(pattern) {
      try { return new RegExp('(?:^|[^A-Za-z0-9_-])(?:' + pattern + ')(?=$|[^A-Za-z0-9_-])', 'i').test(ua); }
      catch (ignore) { return false; }
    }
    function shape(object, name) {
      try {
        var prop = Object.getOwnPropertyDescriptor(object, name), value = prop && prop.value;
        // Plain objects/arrays are common application data and can be planted
        // under any name. Require executable evidence, retaining host checks.
        // Page-authored functions can still imitate real automation bindings.
        return typeof value === 'function' && shapeValue(value);
      } catch (ignore) { return false; }
    }
    function playwright() {
      var names = '__playwright__binding__ __playwright__binding__controller__ __pwInitScripts'.split(' ');
      for (var j = 0; j < names.length; j++) { if (shape(w, names[j])) { add('PW', 100); } }
    }
    function geometry() {
      try {
        if (d.visibilityState === 'hidden' || !d.hasFocus() || w.top !== w) { return; }
        if ((w.screen.width === 0 && w.screen.height === 0) ||
            (w.innerWidth === 0 && w.innerHeight === 0) || (w.outerWidth === 0 && w.outerHeight === 0)) {
          add('G0', 1, 'geometry');
        }
        // F11, kiosk/PWA windows and mobile can share these dimensions. HW is
        // benign geometry evidence: it never bypasses the corroboration gate.
        if (!mobile && !embedded && d.visibilityState === 'visible' && w.innerWidth > 0 && w.innerHeight > 0 &&
            w.outerWidth === w.innerWidth && w.outerHeight === w.innerHeight &&
            w.screen.width === w.innerWidth && w.screen.height === w.innerHeight &&
            w.screen.availWidth === w.screen.width && w.screen.availHeight === w.screen.height &&
            d.fullscreenElement === null && typeof w.matchMedia === 'function' &&
            w.matchMedia('(display-mode: fullscreen)').matches === false &&
            w.matchMedia('(display-mode: standalone)').matches === false) { add('HW', 2, 'geometry'); }
      } catch (ignore) {}
    }
    function boundedTP(value) {
      return typeof value === 'number' && isFinite(value) && value >= 0 && value <= 255 &&
        Math.floor(value) === value ? value : 0;
    }
    function cleanAgent(value) {
      return value === 'openai' || value === 'anthropic' ? value : '';
    }
    function cleanClass(value) {
      if (value === 'human' || value === 'suspicious' || value === 'automated' || value === 'declared_agent') { return value; }
      if (value && tag.call(value) === '[object Object]' && value.direct === true && typeof value.value === 'string' &&
          (value.value === 'automated' || value.value === 'declared_agent')) {
        var clean = {value: value.value, direct: true};
        if (cleanAgent(value.agent)) { clean.agent = value.agent; }
        return clean;
      }
      return '';
    }
    function classText(value) {
      value = cleanClass(value);
      return typeof value === 'string' ? '"' + value + '"' : '{"value":"' + value.value + '","direct":true' +
        (value.agent ? ',"agent":"' + value.agent + '"' : '') + '}';
    }
    function readStore() {
      // Our bounded schema fits comfortably below this cap. Ignore oversized
      // planted records before parsing or iterating attacker-controlled arrays.
      var raw = w.sessionStorage.getItem('visitor_verdict');
      var record = {};
      if (typeof raw === 'string' && raw.length <= 2048 && raw) { record = JSON.parse(raw); }
      record = record && tag.call(record) === '[object Object]' ? record : {};
      return {timestamps: record.timestamps, lastClass: cleanClass(record.lastClass), tpPages: boundedTP(record.tpPages)};
    }
    function mergeTimes(list) {
      var merged = [], now = Date.now(), j, value;
      // Only the approved 20-entry tail may enter the merge. With our own
      // bounded history this limits validation, deduplication and sort to 40.
      list = timestamps.concat(tag.call(list) === '[object Array]' ? list.slice(-20) : []);
      for (j = 0; j < list.length; j++) {
        value = list[j];
        if (typeof value === 'number' && isFinite(value) && value >= 0 && value <= now) {
          value = Math.floor(value / 100) * 100;
          if (merged.indexOf(value) === -1) { merged.push(value); }
        }
      }
      merged.sort(function (a, b) { return a - b; });
      return merged.slice(-config.fastNavCount);
    }
    function save(lastClass, change) {
      try {
        // Every write reads current state: stale finalizers cannot restore old
        // timestamps, a decayed counter, or an older document's class/provenance.
        var saved;
        try { saved = readStore(); } catch (ignore) { saved = {}; }
        timestamps = mergeTimes(saved.timestamps);
        var newer = (timestamps.length && timestamps[timestamps.length - 1] > pageTime) ||
          (classSnapshot !== null && classText(saved.lastClass) !== classSnapshot);
        tpPages = boundedTP(saved.tpPages);
        if (change === 'tp') { tpPages = Math.min(255, tpPages + 1); }
        if (change === 'decay' && !newer && tpPages === tpSnapshot) { tpPages = Math.max(0, tpPages - 1); }
        var nextClass = cleanClass(lastClass !== null && !newer ? lastClass : saved.lastClass);
        // All components have been reduced to bounded numbers or fixed enums.
        // This also repairs writable storage when a legacy browser lacks JSON.
        w.sessionStorage.setItem('visitor_verdict', '{"timestamps":[' + timestamps.join(',') +
          '],"lastClass":' + classText(nextClass) + ',"tpPages":' + tpPages + '}');
        if (!newer) { classSnapshot = classText(nextClass); tpSnapshot = tpPages; }
        return true;
      } catch (ignore) { return false; }
    }
    function recordTeleport() {
      // Called once per document, in click capture, before navigation/pagehide.
      if (!save(null, 'tp')) { tpPages = 1; }
    }
    function suspicious() {
      var env = 0, family;
      for (family in families) {
        if (/^(geometry|language|plugins|graphics|chrome|permissions)$/.test(family)) { env++; }
      }
      // UB is a direct suspicious rule, never hard proof or carry provenance.
      return workerBrands || score >= config.suspiciousThreshold && Object.keys(families).length >= 3 &&
        (families.pointer || signals.indexOf('SY') !== -1 || families.worker ||
        (env >= 2 && (families.interaction || families.navigation)));
    }
    function publish(phase) {
      // One initial, at most one agent escalation and one final, in any order after initial.
      if (phase === 'initial' ? initialPublished : !initialPublished ||
          (phase === 'final' ? finalPublished : phase !== 'agent' || agentPublished)) { return initial; }
      var result = hard ? 'automated' : declared ? 'declared_agent' :
        suspicious() ? 'suspicious' : 'human';
      if (phase === 'final' && initial === 'automated') { result = initial; }
      else if (phase === 'final' && initial === 'declared_agent' && !hard) { result = initial; }
      var total = hard || declared ? 100 : score;
      if (typeof cleanClass(result) !== 'string' || !cleanClass(result) ||
          typeof total !== 'number' || !isFinite(total)) { return initial; }
      // Mark before any consumer callback can reenter. Never read public state.
      if (phase === 'initial') { initialPublished = true; initial = result; }
      else if (phase === 'final') { finalPublished = true; }
      else { agentPublished = true; }
      latest = result;
      var state = {'class': result, score: total, phase: phase, version: version};
      var event = {event: 'traffic_class', traffic_class: result, traffic_phase: phase,
        traffic_score: total, traffic_version: version};
      if (agent) { state.agent = event.traffic_agent = agent; }
      snapshot = Object.freeze(state);
      if (config.debug) { event.traffic_signals = signals.slice(0); }
      // Only direct evidence can seed one grace document. CA/CD alone store no
      // provenance, so a carried class cannot seed another grace document.
      if (phase !== 'initial') { save(provenance(result)); }
      try {
        var layer = w[config.dataLayerName];
        if (layer === undefined || layer === null) { layer = w[config.dataLayerName] = []; }
        if (typeof layer.length === 'number' && isFinite(layer.length) && layer.length >= 0 &&
            Math.floor(layer.length) === layer.length && typeof layer.push === 'function') { layer.push(event); }
      } catch (ignore) {}
      return result;
    }
    function provenance(result) {
      // Only a marker seen in this document renews the stored operator.
      return direct ? (marked ? {value: result, direct: true, agent: agent} : {value: result, direct: true}) : result;
    }
    // Agent UI markers (DM): exact IDs and parents that browser agents inject
    // while they control the tab. Presence only; content is never read.
    var markers = ['claude-agent-glow-border', 'claude-phantom-cursor', 'codex-agent-overlay-root'];
    function marker() {
      try {
        for (var j = 0; j < markers.length; j++) {
          var node = d.getElementById(markers[j]);
          if (node && node.parentNode === (j < 2 ? d.body : d.documentElement)) { return j < 2 ? 'anthropic' : 'openai'; }
        }
      } catch (ignore) {}
      return '';
    }
    function mark(operator) {
      // Escalate only: automated keeps precedence; a repeated operator adds nothing.
      var changed = !hard && (latest !== 'declared_agent' || agent !== operator);
      marked = true; agent = operator; add('DM', 100); unwatch();
      if (!initialPublished) { return; }
      if (changed) { publish('agent'); }
      else if (finalPublished) { save(provenance(latest)); }
    }
    function check() {
      try {
        var operator = marker();
        if (operator && !marked) { mark(operator); }
      } catch (ignore) {}
    }
    function watch() {
      try {
        if (done || marked || typeof w.MutationObserver !== 'function' || !d.documentElement) { return; }
        observer = new w.MutationObserver(check);
        observer.observe(d.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['id']});
      } catch (ignore) { unwatch(); }
    }
    function unwatch() {
      if (observer) {
        try { observer.disconnect(); } catch (ignore) {}
        observer = null;
      }
      if (done) { removeListener(w, 'pagehide', hide, listenerOptions); }
    }
    for (i = 0; i < config.agentTokens.length; i++) {
      var token = config.agentTokens[i];
      if (typeof token === 'string' && token.length > 0 && token.length <= 128 &&
          bounded(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) { add('AG', 100); break; }
    }
    if (n.webdriver === true) { add('WD', 100); }
    if (bounded('HeadlessChrome')) { add('HL', 100); }
    if (tag.call(brands) === '[object Array]') {
      for (i = 0; i < brands.length; i++) {
        if (!brands[i] || typeof brands[i].brand !== 'string') { continue; }
        if (brands[i].brand.length) { hasBrands = true; }
        if (/HeadlessChrome/i.test(brands[i].brand)) { add('HL', 100); }
        if (/Chromium|Google Chrome|Microsoft Edge/i.test(brands[i].brand)) { chromium = true; }
      }
    }
    if (bounded('PhantomJS|Chrome-Lighthouse|Lighthouse|GTmetrix|Google-PageRenderer') ||
        /(?:^|[^A-Za-z0-9_-])PTST\/[0-9]/i.test(ua)) { add('AU', 100); }
    try {
      var names = Object.getOwnPropertyNames(w);
      for (i = 0; i < names.length; i++) {
        if (/^(callPhantom|_phantom|__nightmare|domAutomation|domAutomationController|cdc_[A-Za-z0-9]+_(Array|Promise|Symbol|Object|Proxy|JSON|Window))$/.test(names[i]) && shape(w, names[i])) { add('GL', 100); }
      }
      names = Object.getOwnPropertyNames(d);
      for (i = 0; i < names.length; i++) {
        if (/^(?:__(?:selenium|webdriver|driver|fxdriver)_(?:evaluate|unwrapped)$|__webdriver_script_(?:fn|func|function)$|__\$webdriverAsyncExecutor$|\$cdc_|\$wdc_)/.test(names[i]) && shape(d, names[i])) { add('GL', 100); }
      }
      names = null;
    } catch (ignore) {}
    playwright(); geometry();
    var screen = w.screen || {};
    if ((screen.width === 800 && screen.height === 600) ||
        (screen.width === 1280 && screen.height === 720 && w.innerWidth === 1280 && w.innerHeight === 720)) { add('GS', 1, 'geometry'); }
    if ((!n.languages || !n.languages.length) && !(n.language || n.userLanguage || n.browserLanguage || n.systemLanguage)) { add('LA', 1, 'language'); }
    if (desktop && (chromium || w.chrome) && n.plugins && !n.plugins.length && n.pdfViewerEnabled !== false) { add('PL', 1, 'plugins'); }
    if (config.webgl) {
      var canvas, gl, extension;
      try {
        canvas = d.createElement('canvas'); gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) { add('WG', 1, 'graphics'); }
        else {
          extension = gl.getExtension('WEBGL_debug_renderer_info');
          if (extension && /(?:^|[ (])(?:SwiftShader|llvmpipe|softpipe)(?:$|[ )])|^Mesa OffScreen$/i.test(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL))) { add('WG', 1, 'graphics'); }
        }
      } catch (ignore) {} finally {
        try { extension = gl && gl.getExtension('WEBGL_lose_context'); if (extension) { extension.loseContext(); } } catch (ignore) {}
        gl = canvas = extension = null;
      }
    }
    if (desktop && chromium && !w.chrome) { add('CH', 1, 'chrome'); }
    if (!n.hardwareConcurrency) { add('HC', 0); }
    try {
      if (chromium && w.isSecureContext && w.top === w && w.Notification &&
          w.Notification.permission === 'denied' && n.permissions && n.permissions.query) {
        n.permissions.query({name: 'notifications'}).then(function (status) {
          if (!done && status.state === 'prompt') { mismatch = true; }
        }, function () {});
      }
    } catch (ignore) {}
    try {
      var saved;
      try { saved = readStore(); } catch (ignore) { saved = {}; }
      var previous = cleanClass(saved.lastClass);
      if (previous && typeof previous !== 'string') { previous = previous.value; }
      try { Object.defineProperty(w, '__visitorVerdictLast', {value: previous || undefined, configurable: false, writable: false}); }
      catch (ignore) {}
      tpPages = boundedTP(saved.tpPages);
      classSnapshot = classText(saved.lastClass); tpSnapshot = tpPages;
      if (saved.lastClass && saved.lastClass.direct === true) {
        if (saved.lastClass.value === 'automated') { add('CA', 100); }
        else if (saved.lastClass.value === 'declared_agent') { add('CD', 100); }
        agent = cleanAgent(saved.lastClass.agent);
      }
      timestamps = mergeTimes(saved.timestamps);
      var navigation = w.performance && w.performance.getEntriesByType && w.performance.getEntriesByType('navigation')[0];
      var revisit = navigation ? /reload|back_forward/.test(navigation.type) :
        w.performance && w.performance.navigation && w.performance.navigation.type;
      if (!revisit) {
        timestamps = mergeTimes([pageTime]);
        var count = 1;
        for (i = timestamps.length - 1; i > 0; i--) {
          var gap = timestamps[i] - timestamps[i - 1];
          if (gap <= 0 || gap >= config.fastNavMs) { break; }
          count++;
        }
        fast = count >= config.fastNavCount;
      }
      // Consume provenance now, including when this document never fires pagehide.
      // A carried class itself cannot seed another carried document.
      if (!save(saved.lastClass && saved.lastClass.direct === true ? saved.lastClass.value : null)) { fast = false; }
    } catch (ignore) { fast = false; }
    function interact(event) {
      if (done || d.visibilityState === 'hidden') { return; }
      pointer(event);
      if ((event.isTrusted === true || event.isTrusted === undefined) && event.type !== 'pointercancel') { active = true; }
      if (/^(mousemove|pointerdown|touchstart)$/.test(event.type) && event.isTrusted === false) { synthetic = true; }
    }
    function exposure() {
      if (started !== null) { elapsed += Math.max(0, Date.now() - started); started = null; }
      w.clearTimeout(timer);
    }
    function cleanup() {
      exposure(); stopWorker();
      for (i = 0; i < events.length; i++) { removeListener(inputTarget, events[i], interact, listenerOptions); }
      removeListener(visibilityTarget, 'visibilitychange', visibility, listenerOptions);
      // A live marker watch keeps pagehide until it disconnects.
      if (!observer) { removeListener(w, 'pagehide', hide, listenerOptions); }
    }
    function hide() { unwatch(); finish(); }
    function finish() {
      if (done) { return; }
      done = true; cleanup();
      playwright(); geometry();
      if (observesInput && !active && elapsed >= config.idleMs) { add('NI', 2, 'interaction'); }
      if (fast) { add('FN', 3, 'navigation'); }
      if (synthetic && !active) { add('SY', 2, 'interaction'); }
      if (mismatch) { add('NP', 1, 'permissions'); }
      if (teleport) { add('TP', 3, 'pointer'); }
      if (workerMismatch) { add('WK', 2, 'worker'); }
      if (workerBrands) { add('UB', 6, 'worker'); }
      if (workerHeadless) { add('HL', 100); }
      // Warp-on-click accessibility tools share TP's pattern. History is only
      // a final-phase pointer weight (2), capped at 3 together with current TP.
      // Any trusted input without TP repays one page of history.
      try { tpPages = boundedTP(readStore().tpPages); } catch (ignore) { tpPages = teleport ? 1 : 0; }
      if (active && !teleport) { save(null, 'decay'); }
      if (tpPages >= 2) { add('TR', 2, 'pointer'); }
      move = clicked = null; pointerKind = '';
      try { publish('final'); } finally { signals = []; families = {}; }
    }
    function visibility() {
      pointerKind = '';
      if (done) { return; }
      exposure();
      if (d.visibilityState !== 'hidden') {
        started = Date.now(); timer = w.setTimeout(finish, Math.max(0, config.idleMs - elapsed));
      }
    }
    var listenerOptions = true;
    try {
      var passive = Object.defineProperty({}, 'passive', {get: function () { listenerOptions = {capture: true, passive: true}; }});
      if (!addListener(inputTarget, 'tc-passive', noop, passive)) { listenerOptions = true; }
      removeListener(inputTarget, 'tc-passive', noop, passive);
    } catch (ignore) { listenerOptions = true; }
    function noop() {}
    try {
      for (i = 0; i < events.length; i++) {
        if (!addListener(inputTarget, events[i], interact, listenerOptions)) { observesInput = false; }
      }
      addListener(w, 'pagehide', hide, listenerOptions); addListener(visibilityTarget, 'visibilitychange', visibility, listenerOptions);
      visibility();
      var operator = marker();
      if (operator) { mark(operator); }
      initial = publish('initial'); ua = ''; brands = null;
      startWorker(); watch();
    } catch (ignore) { done = true; unwatch(); cleanup(); }
  }
}(window, document, navigator));
