/* Override these defaults with window.visitorVerdictConfig before loading. */
(function (w, d, n) {
  'use strict';
  var own = Object.prototype.hasOwnProperty, tag = Object.prototype.toString;
  // Frames must not probe, publish, or touch this tab's storage.
  if (w.top !== w) { return; }
  var version = '1.4.1', snapshot, claimed = false, activated = false, duplicate = false, claimListener = false;
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
      idleMs: 8000, finalOnHidden: true, fastNavMs: 2000, fastNavCount: 3,
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
        } else if (typeof value === 'boolean') { config[key] = value; }
      }
    }
    var signals = [], families = {}, score = 0, hard = false, declared = false;
    // Direct provenance is split: a declaration (AG, DM) never renews carried automation (CA).
    var directHard = false, directDeclared = false, carriedSuspicious = false;
    var done = false, initial, initialPublished = false, finalPublished = false, elapsed = 0, started = null, timer;
    // Agent UI markers: operator from a marker (this or the previous document).
    var agentClaim = '', hostClaim = false;
    var agent = '', marked = false, agentPublished = false, latest = '', observer = null, canHide = false;
    var watchedBody = null, idWatches = 0, hostWatches = 0, hostCandidates = [], hostTimer = null, watchedNodes = [];
    // Informational only: never add a scoring signal or carry WebMCP across pages.
    var modelContext = null, legacyContext = null, webmcpCapable = false, webmcpCount = 0, webmcpWatching = false;
    try { modelContext = d.modelContext; } catch (ignore) {}
    try { legacyContext = n.modelContext; } catch (ignore) {}
    webmcpCapable = !!(modelContext || legacyContext);
    function webmcpState() { return webmcpCount ? 'used' : webmcpCapable ? 'capable' : 'none'; }
    var lastWebmcpEvent = null, webmcpTargets = [], trustedGetter = null;
    try {
      // Use the platform getter's brand check as well as instanceof. Chromium
      // exposes isTrusted on each Event; other hosts may put it on the prototype.
      var trustDescriptor = typeof w.Event === 'function' && Object.getOwnPropertyDescriptor(w.Event.prototype, 'isTrusted');
      if (webmcpCapable && (!trustDescriptor || !trustDescriptor.get)) { trustDescriptor = Object.getOwnPropertyDescriptor(d.createEvent('Event'), 'isTrusted'); }
      if (trustDescriptor && typeof trustDescriptor.get === 'function') { trustedGetter = trustDescriptor.get; }
    } catch (ignore) {}
    function webmcpEvent(event) {
      try {
        if (!webmcpWatching || webmcpCount >= 255 || typeof w.Event !== 'function' ||
            !(event instanceof w.Event) || (event.type !== 'toolactivated' && event.type !== 'toolcancel') || event.isTrusted !== true ||
            (trustedGetter && trustedGetter.call(event) !== true) || lastWebmcpEvent === event) { return; }
        lastWebmcpEvent = event;
        webmcpCount++;
        if (snapshot) {
          var state = {'class': snapshot['class'], score: snapshot.score, phase: snapshot.phase,
            version: version, webmcp: webmcpState(), webmcpCount: webmcpCount};
          if (snapshot.agent) { state.agent = snapshot.agent; }
          if (snapshot.claim) { state.claim = snapshot.claim; }
          snapshot = Object.freeze(state);
        }
        if (webmcpCount >= 255) {
          stopWebmcp();
          if (done && !observer) { removeListener(w, 'pagehide', hide, listenerOptions); }
        }
      } catch (ignore) {}
    }
    function stopWebmcp() {
      webmcpWatching = false;
      for (var j = 0; j < webmcpTargets.length; j++) {
        try {
          w.EventTarget.prototype.removeEventListener.call(webmcpTargets[j], 'toolactivated', webmcpEvent, listenerOptions);
          w.EventTarget.prototype.removeEventListener.call(webmcpTargets[j], 'toolcancel', webmcpEvent, listenerOptions);
        } catch (ignore) {}
      }
      webmcpTargets = []; lastWebmcpEvent = null;
      removeListener(w, 'toolactivated', webmcpEvent, listenerOptions);
      removeListener(w, 'toolcancel', webmcpEvent, listenerOptions);
      removeListener(d, 'toolactivated', webmcpEvent, listenerOptions);
      removeListener(d, 'toolcancel', webmcpEvent, listenerOptions);
    }
    function watchWebmcp() {
      if (!canHide || !webmcpCapable) { return; }
      // Bypass instance methods: polyfills must never receive our internal callback.
      var contexts = [modelContext, legacyContext, d, w], j, target;
      for (j = 0; j < contexts.length; j++) {
        target = contexts[j];
        try {
          if (!target || target === contexts[j - 1] || typeof w.EventTarget !== 'function' ||
              !(target instanceof w.EventTarget)) { continue; }
          w.EventTarget.prototype.addEventListener.call(target, 'toolactivated', webmcpEvent, listenerOptions);
          webmcpTargets.push(target);
          webmcpWatching = true;
          w.EventTarget.prototype.addEventListener.call(target, 'toolcancel', webmcpEvent, listenerOptions);
        } catch (ignore) {}
      }
      // Legacy hosts without native EventTarget still receive guarded events.
      if (typeof w.EventTarget !== 'function' || !(d instanceof w.EventTarget)) {
        webmcpWatching = addListener(d, 'toolactivated', webmcpEvent, listenerOptions) || webmcpWatching;
        webmcpWatching = addListener(d, 'toolcancel', webmcpEvent, listenerOptions) || webmcpWatching;
      }
      if (typeof w.EventTarget !== 'function' || !(w instanceof w.EventTarget)) {
        webmcpWatching = addListener(w, 'toolactivated', webmcpEvent, listenerOptions) || webmcpWatching;
        webmcpWatching = addListener(w, 'toolcancel', webmcpEvent, listenerOptions) || webmcpWatching;
      }
    }
    var burst = false, untrustedControl = false, lastTrusted = -Infinity, typingField = null, typingTimes = [], keyField = null, keyTime = null;
    var active = false, synthetic = false, mismatch = false, timestamps = [], fast = false;
    var inputTarget = canListen(w) ? w : canListen(d) ? d : null, observesInput = true;
    var visibilityTarget = canListen(d) ? d : w;
    var ua = n.userAgent || '', mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua) ||
      (n.maxTouchPoints > 1 && /Macintosh/i.test(ua));
    var embedded = /; wv\)|WebView|FBAN|FBAV|Instagram/i.test(ua);
    var desktop = !mobile && !embedded && /Chrome\//i.test(ua);
    var chromium = false, hasBrands = false, brands = n.userAgentData && n.userAgentData.brands, i;
    var events = 'mousemove pointermove pointerdown pointercancel pointerup touchstart touchmove touchend touchcancel scroll keydown keyup wheel click focusin input change'.split(' ');
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
          hc: n.hardwareConcurrency});
        ready = true;
      } catch (ignore) {} finally { if (!ready) { stopWorker(); } }
    }
    function distance(a, x, y) {
      return (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y);
    }
    function pointer(event, now) {
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
        if (code === 'AG' || code === 'CD' || code === 'DM' || code === 'DH') { declared = true; if (code !== 'CD') { directDeclared = true; } }
        else { hard = true; if (code !== 'CA') { directHard = true; } }
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
    function cleanClaim(value) {
      return value === 'dom_host' || value === 'dom_marker' || value === 'ua_token' ? value : '';
    }
    function cleanClass(value) {
      if (value === 'human' || value === 'suspicious' || value === 'automated' || value === 'declared_agent') { return value; }
      if (value && tag.call(value) === '[object Object]' && value.direct === true && typeof value.value === 'string' &&
          (value.value === 'automated' || value.value === 'declared_agent' || value.value === 'suspicious')) {
        var clean = {value: value.value, direct: true};
        // The operator belongs to declared_agent only.
        if (value.value === 'declared_agent' && cleanAgent(value.agent)) { clean.agent = value.agent; }
        if (value.value === 'declared_agent' && cleanClaim(value.claim)) { clean.claim = value.claim; }
        return clean;
      }
      return '';
    }
    function classText(value) {
      value = cleanClass(value);
      return typeof value === 'string' ? '"' + value + '"' : '{"value":"' + value.value + '","direct":true' +
        (value.agent ? ',"agent":"' + value.agent + '"' : '') +
        (value.claim ? ',"claim":"' + value.claim + '"' : '') + '}';
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
    function suspicious(withoutUB) {
      var env = 0, family, total = score, count = Object.keys(families).length;
      if (withoutUB && workerBrands) {
        // Test independent evidence, including the worker-family cap, not UB's
        // six points. WK may remain as ordinary corroboration.
        var remainingWorker = signals.indexOf('WK') !== -1 ? 2 : 0;
        total -= (families.worker || 0) - remainingWorker;
        if (!remainingWorker) { count--; }
      }
      for (family in families) {
        if (/^(geometry|language|plugins|graphics|chrome|permissions)$/.test(family)) { env++; }
      }
      // UB is a direct suspicious rule, never hard proof or carry provenance.
      return !withoutUB && workerBrands || total >= config.suspiciousThreshold && count >= 3 &&
        (families.pointer || signals.indexOf('SY') !== -1 ||
        (env >= 2 && (families.interaction || families.navigation)));
    }
    function publish(phase) {
      // One initial, at most one agent escalation and one final, in any order after initial.
      if (phase === 'initial' ? initialPublished : !initialPublished ||
          (phase === 'final' ? finalPublished : phase !== 'agent' || agentPublished)) { return initial; }
      var result = hard ? 'automated' : declared ? 'declared_agent' :
        suspicious() || carriedSuspicious ? 'suspicious' : 'human';
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
      var state = {'class': result, score: total, phase: phase, version: version,
        webmcp: webmcpState(), webmcpCount: webmcpCount};
      var event = {event: 'traffic_class', traffic_class: result, traffic_phase: phase,
        traffic_score: total, traffic_version: version, traffic_agent: undefined, traffic_agent_claim: undefined,
        traffic_webmcp: webmcpState(), traffic_webmcp_count: webmcpCount};
      // The operator is exposed only together with declared_agent; automated wins without it.
      if (agent && result === 'declared_agent') { state.agent = event.traffic_agent = agent;
      }
      if (agentClaim && result === 'declared_agent') { state.claim = event.traffic_agent_claim = agentClaim; }
      snapshot = Object.freeze(state);
      if (config.debug) { event.traffic_signals = signals.slice(0); }
      // Only current evidence can seed one grace document. CA/CD/CS alone store no
      // provenance, so a carried class cannot seed another grace document.
      // A marker seen at load is stored at once, as later phases are.
      if (phase !== 'initial' || marked) { save(provenance(result)); }
      try {
        var layer = w[config.dataLayerName];
        if (layer === undefined || layer === null) { layer = w[config.dataLayerName] = []; }
        if (typeof layer.length === 'number' && isFinite(layer.length) && layer.length >= 0 &&
            Math.floor(layer.length) === layer.length && typeof layer.push === 'function') { layer.push(event); }
      } catch (ignore) {}
      return result;
    }
    function provenance(result) {
      // Preserve the reported class; only fresh evidence seeds another grace page.
      if (result === 'suspicious') { return suspicious(true) ? {value: result, direct: true} : result; }
      // Only direct hard evidence stores automated. A direct declaration stores
      // declared_agent even when carried CA made this document automated.
      // Only a marker seen in this document renews the stored operator.
      if (result === 'automated' && directHard) { return {value: result, direct: true}; }
      if ((result === 'automated' || result === 'declared_agent') && directDeclared) {
        return marked ? {value: 'declared_agent', direct: true, agent: agent, claim: agentClaim} : {value: 'declared_agent', direct: true, claim: agentClaim};
      }
      return result;
    }
    // Agent UI markers (DM): exact IDs and parents that browser agents inject
    // while they control the tab. Presence only; content is never read.
    var markers = ['claude-agent-glow-border', 'claude-phantom-cursor', 'codex-agent-overlay-root'];
    function marker() {
      try {
        for (var j = 0; j < markers.length; j++) {
          var node = d.getElementById(markers[j]), parent = j < 2 ? d.body : d.documentElement;
          if (node && parent && node.parentNode === parent) { return j < 2 ? 'anthropic' : 'openai'; }
        }
      } catch (ignore) {}
      return '';
    }
    function mark(operator) {
      // Escalate only: automated keeps precedence; a repeated operator adds nothing.
      var nextClaim = hostClaim ? 'dom_host' : 'dom_marker';
      var changed = !hard && (latest !== 'declared_agent' || agent !== operator || agentClaim !== nextClaim);
      marked = true; agent = operator; agentClaim = nextClaim;
      if (hostClaim) { add('DH', 100); } else { add('DM', 100); }
      unwatch();
      if (!initialPublished) { return; }
      // Same class and operator (CD or automated): publish nothing, renew provenance now.
      if (changed) { publish('agent'); }
      else { save(provenance(latest)); }
    }
    function host(node) {
      try {
        return !mobile && !embedded && (chromium || desktop) && d.visibilityState !== 'hidden' &&
          node && node.parentNode === d.body && /^div$/i.test(node.tagName) &&
          node.attributes.length === 0 && node.childNodes.length === 0 &&
          ('shadowRoot' in node ? node.shadowRoot === null : true) &&
          w.getComputedStyle(node).display === 'contents';
      } catch (ignore) { return false; }
    }
    function pageContents(node) {
      var children = d.body && d.body.children || [], j, other;
      for (j = 0; j < children.length; j++) {
        other = children[j];
        try {
          if (other !== node && /^div$/i.test(other.tagName) &&
              (other.attributes.length || other.childNodes.length) &&
              w.getComputedStyle(other).display === 'contents') { return true; }
        } catch (ignore) {}
      }
      return false;
    }
    function settleHosts() {
      hostTimer = null;
      var pending = hostCandidates; hostCandidates = [];
      for (var j = 0; j < pending.length; j++) {
        if (host(pending[j]) && !pageContents(pending[j])) { hostClaim = true; mark('anthropic'); return; }
      }
    }
    function check(records) {
      try {
        var operator = marker();
        if (operator && !marked) { mark(operator); }
        if (marked) { return; }
        var candidates = [], j, k;
        if (!records) { candidates = d.body && d.body.children || []; }
        else {
          for (j = 0; j < records.length; j++) {
            if (records[j].type === 'attributes') { candidates.push(records[j].target); }
            else {
              var added = records[j].addedNodes;
              for (k = 0; added && k < added.length; k++) { candidates.push(added[k]); }
            }
          }
        }
        // A fresh batch always gets its own full settling interval.
        for (j = 0; j < candidates.length; j++) {
          if (host(candidates[j]) && hostCandidates.indexOf(candidates[j]) === -1 && hostCandidates.length < 32) {
            hostCandidates.push(candidates[j]);
            w.clearTimeout(hostTimer); hostTimer = w.setTimeout(settleHosts, 250);
          }
        }
      } catch (ignore) {}
    }
    // ID watches use a filtered observer on new direct children without an ID.
    // Broad attribute watches are limited to empty new body DIVs (host candidates).
    function attach(records) {
      try {
        if (!observer) { return; }
        if (d.body && d.body !== watchedBody) {
          watchedBody = d.body; observer.observe(watchedBody, {childList: true});
        }
        var retained = [], removed = false, j;
        for (j = 0; j < watchedNodes.length; j++) {
          if (watchedNodes[j].node.parentNode === d.body || watchedNodes[j].node.parentNode === d.documentElement) { retained.push(watchedNodes[j]); }
          else { removed = true; }
        }
        hostCandidates = hostCandidates.filter(function (node) { return node.parentNode === d.body; });
        if (removed) {
          observer.disconnect(); observer.observe(d.documentElement, {childList: true});
          if (watchedBody) { observer.observe(watchedBody, {childList: true}); }
          watchedNodes = retained; idWatches = 0; hostWatches = 0;
          for (j = 0; j < retained.length; j++) { if (retained[j].options.attributeFilter) { idWatches++; } else { hostWatches++; } }
          for (j = 0; j < retained.length; j++) { observer.observe(retained[j].node, retained[j].options); }
        }
        for (var k = 0; records && k < records.length; k++) {
          var added = records[k].addedNodes;
          for (var m = 0; added && m < added.length; m++) {
            var node = added[m], seen = false;
            for (j = 0; j < watchedNodes.length; j++) { if (watchedNodes[j].node === node) { seen = true; break; } }
            if (!seen && node && node.nodeType === 1 && node !== d.body &&
                (node.parentNode === d.body || node.parentNode === d.documentElement)) {
              var empty = node.parentNode === d.body && /^div$/i.test(node.tagName) &&
                node.childNodes && node.childNodes.length === 0 && hostWatches < 32;
              if (!empty && (node.id || idWatches >= 32)) { continue; }
              var options = empty ? {attributes: true} : {attributes: true, attributeFilter: ['id']};
              if (empty) { hostWatches++; } else { idWatches++; }
              watchedNodes.push({node: node, options: options}); observer.observe(node, options);
            }
          }
        }
      } catch (ignore) {}
    }
    function mutated(records) {
      var bodyChanged = d.body !== watchedBody;
      attach(records); check(bodyChanged ? null : records);
    }
    function watch() {
      try {
        // Without a pagehide listener the observer could never disconnect.
        if (done || marked || !canHide || typeof w.MutationObserver !== 'function' || !d.documentElement) { return; }
        observer = new w.MutationObserver(mutated);
        observer.observe(d.documentElement, {childList: true});
        attach();
      } catch (ignore) { unwatch(); }
    }
    function unwatch() {
      if (observer) {
        try { observer.disconnect(); } catch (ignore) {}
        observer = null;
      }
      w.clearTimeout(hostTimer); hostTimer = null; hostCandidates = []; watchedNodes = [];
      removeListener(visibilityTarget, 'visibilitychange', visibility, listenerOptions);
      if (done && !webmcpWatching) { removeListener(w, 'pagehide', hide, listenerOptions); }
    }
    for (i = 0; i < config.agentTokens.length; i++) {
      var token = config.agentTokens[i];
      if (typeof token === 'string' && token.length > 0 && token.length <= 128 &&
          bounded(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) { agentClaim = 'ua_token'; add('AG', 100); break; }
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
      var consumed = save(saved.lastClass && saved.lastClass.direct === true ? saved.lastClass.value : null);
      if (!consumed) { fast = false; }
      if (consumed && saved.lastClass && saved.lastClass.direct === true &&
          classSnapshot === classText(saved.lastClass.value)) {
        if (saved.lastClass.value === 'automated') { add('CA', 100); }
        else if (saved.lastClass.value === 'declared_agent') { add('CD', 100); agent = cleanAgent(saved.lastClass.agent); if (!agentClaim) { agentClaim = cleanClaim(saved.lastClass.claim); } }
        else if (saved.lastClass.value === 'suspicious') { carriedSuspicious = true; add('CS', 0); }
      }
    } catch (ignore) { fast = false; }
    function interact(event) {
      if (done || d.visibilityState === 'hidden') { return; }
      var now = Date.now(), type = event.type;
      pointer(event, now);
      if (type === 'keydown') {
        keyField = null; keyTime = null;
        if (event.isTrusted === true && !event.isComposing && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey &&
            typeof event.timeStamp === 'number' && isFinite(event.timeStamp) && event.timeStamp >= 0) {
          keyField = event.target; keyTime = event.timeStamp;
        }
      } else if (/^(keyup|focusin|pointerdown|touchstart)$/.test(type)) { keyField = null; keyTime = null; }

      if (event.isTrusted === true &&
          /^(keydown|keyup|pointerdown|pointerup|touchstart|touchend|click|focusin|input|change|mousemove|pointermove|touchmove|scroll|wheel)$/.test(type)) { lastTrusted = now; }
      if (type === 'input' || type === 'change') {
        var field = event.target, name = field && String(field.tagName).toUpperCase();
        var control = name === 'INPUT' || name === 'SELECT' || name === 'TEXTAREA';
        // Only a paired keydown supplies physical-key timing. Input is created
        // during editing and can be compressed after queued key dispatch.
        var clock = keyField === field ? keyTime : null;
        keyField = null; keyTime = null;
        if (type === 'input' && control && event.isTrusted === true && event.inputType === 'insertText' && !event.isComposing && clock !== null) {
          if (typingField !== field) { typingField = field; typingTimes = []; }
          typingTimes.push(clock);
          if (typingTimes.length > 3) { typingTimes.shift(); }
          if (typingTimes.length === 3 && clock - typingTimes[0] > 0 && clock - typingTimes[0] <= 5) { burst = true; }
        } else if (type === 'input') { typingField = null; typingTimes = []; }
        if (type === 'change' && field && !field.disabled && !field.readOnly &&
            (name === 'SELECT' || name === 'INPUT' && /^(checkbox|radio)$/i.test(field.type)) &&
            event.isTrusted === false && lastTrusted !== -Infinity && now - lastTrusted > 2000) {
          try { if (field.getClientRects().length > 0) { untrustedControl = true; } } catch (ignore) {}
        }
        return;
      }
      if ((event.isTrusted === true || event.isTrusted === undefined) && type !== 'pointercancel') { active = true; }
      if (/^(mousemove|pointerdown|touchstart)$/.test(event.type) && event.isTrusted === false) { synthetic = true; }
    }
    function exposure() {
      if (started !== null) { elapsed += Math.max(0, Date.now() - started); started = null; }
      w.clearTimeout(timer);
    }
    function cleanup() {
      exposure(); stopWorker();
      for (i = 0; i < events.length; i++) { removeListener(inputTarget, events[i], interact, listenerOptions); }
      if (!observer) { removeListener(visibilityTarget, 'visibilitychange', visibility, listenerOptions); }
      // Live marker/WebMCP watches keep pagehide until they disconnect.
      if (!observer && !webmcpWatching) { removeListener(w, 'pagehide', hide, listenerOptions); }
    }
    function hide() { stopWebmcp(); unwatch(); finish(); }
    function finish() {
      if (done) { return; }
      done = true; cleanup();
      playwright(); geometry();
      if (observesInput && !active && elapsed >= config.idleMs) { add('NI', 2, 'interaction'); }
      if (fast) { add('FN', 3, 'navigation'); }
      if (synthetic && !active) { add('SY', 2, 'interaction'); }
      if (burst) { add('BT', 2, 'interaction'); }
      if (untrustedControl) { add('UC', 2, 'interaction'); }
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
      move = clicked = typingField = keyField = null; keyTime = null; typingTimes = []; pointerKind = '';
      try { publish('final'); } finally { signals = []; families = {}; }
    }
    var wasVisible = d.visibilityState !== 'hidden';
    function visibility() {
      var becameHidden = wasVisible && d.visibilityState === 'hidden';
      wasVisible = d.visibilityState !== 'hidden';
      pointerKind = ''; keyField = null; keyTime = null; typingField = null; typingTimes = [];
      if (wasVisible && observer && !marked) { check(); }
      if (done) { return; }
      exposure();
      if (becameHidden && config.finalOnHidden && initialPublished) { finish(); return; }
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
      canHide = addListener(w, 'pagehide', hide, listenerOptions); addListener(visibilityTarget, 'visibilitychange', visibility, listenerOptions);
      watchWebmcp(); visibility();
      var operator = marker();
      if (operator) { mark(operator); }
      check(); watch();
      initial = publish('initial'); ua = ''; brands = null;
      // Check again once watching: a consumer of the initial push may have added a marker.
      startWorker();
      operator = marker(); if (operator && !marked) { mark(operator); }
    } catch (ignore) { done = true; stopWebmcp(); unwatch(); cleanup(); }
  }
}(window, document, navigator));
