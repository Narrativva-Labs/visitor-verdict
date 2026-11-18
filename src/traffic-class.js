/* Override these defaults with window.trafficClassConfig before loading. */
(function (w, d, n) {
  'use strict';
  var config = {
    idleMs: 8000, fastNavMs: 2000, fastNavCount: 3,
    suspiciousThreshold: 6, debug: false, dataLayerName: 'dataLayer',
    agentTokens: [
      'ChatGPT-User', 'OAI-SearchBot', 'OAI-AdsBot', 'GPTBot',
      'Claude-Agent', 'Claude-User', 'Claude-SearchBot', 'ClaudeBot',
      'Perplexity-User', 'PerplexityBot', 'Google-Agent', 'Google-CloudVertexBot',
      'Google-GeminiNotebook', 'Google-NotebookLM', 'MistralAI-User',
      'MistralAI-Index', 'MistralAI-Training', 'DuckAssistBot', 'Applebot',
      'Bytespider', 'meta-externalagent', 'meta-externalfetcher', 'meta-webindexer',
      'CCBot', 'Amazonbot', 'Amzn-SearchBot'
    ]
  };
  if (w.__trafficClass) { return; }
  var key, overrides = w.trafficClassConfig || {};
  for (key in config) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) { config[key] = overrides[key]; }
  }
  var signals = [], families = {}, score = 0, hard = false, declared = false;
  var done = false, initial, elapsed = 0, started = null, timer;
  var active = false, synthetic = false, mismatch = false, timestamps = [], fast = false;
  var ua = n.userAgent || '', mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua) ||
    (n.maxTouchPoints > 1 && /Macintosh/i.test(ua));
  var embedded = /; wv\)|WebView|FBAN|FBAV|Instagram/i.test(ua);
  var desktop = !mobile && !embedded && /Chrome\//i.test(ua);
  var chromium = false, brands = n.userAgentData && n.userAgentData.brands, i;
  var events = 'mousemove pointerdown touchstart scroll keydown wheel'.split(' ');
  function add(code, weight, family) {
    if (signals.indexOf(code) !== -1) { return; }
    signals.push(code);
    if (weight === 100) { if (code === 'AG') { declared = true; } else { hard = true; } }
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
      return !!value && (typeof value === 'object' || typeof value === 'function');
    } catch (ignore) { return false; }
  }
  function playwright() {
    var names = '__playwright__binding__ __playwright__binding__controller__ __pwInitScripts'.split(' ');
    for (var j = 0; j < names.length; j++) { if (shape(w, names[j])) { add('PW', 100); } }
  }
  function geometry() {
    try {
      if (d.visibilityState !== 'hidden' && d.hasFocus() && w.top === w &&
          ((w.screen.width === 0 && w.screen.height === 0) ||
          (w.innerWidth === 0 && w.innerHeight === 0) || (w.outerWidth === 0 && w.outerHeight === 0))) {
        add('G0', 1, 'geometry');
      }
    } catch (ignore) {}
  }
  function save(lastClass) {
    try { w.sessionStorage.setItem('traffic_class', JSON.stringify({timestamps: timestamps, lastClass: lastClass})); return true; } catch (ignore) { return false; }
  }
  function publish(phase) {
    var result = declared ? 'declared_agent' : hard ? 'automated' :
      score >= config.suspiciousThreshold && Object.keys(families).length >= 3 ? 'suspicious' : 'human';
    if (phase === 'final' && (initial === 'automated' || initial === 'declared_agent')) { result = initial; }
    var total = hard || declared ? 100 : score;
    var event = {event: 'traffic_class', traffic_class: result, traffic_phase: phase, traffic_score: total};
    w.__trafficClass = {'class': result, score: total, phase: phase};
    if (config.debug) { event.traffic_signals = signals.slice(0); w.__trafficClass.signals = signals.slice(0); }
    if (phase === 'final') { save(result); }
    w[config.dataLayerName] = w[config.dataLayerName] || [];
    w[config.dataLayerName].push(event);
    return result;
  }
  for (i = 0; i < config.agentTokens.length; i++) { if (bounded(config.agentTokens[i])) { add('AG', 100); break; } }
  if (n.webdriver === true) { add('WD', 100); }
  if (bounded('HeadlessChrome')) { add('HL', 100); }
  if (brands) {
    for (i = 0; i < brands.length; i++) {
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
  try {
    var canvas = d.createElement('canvas'), gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) { add('WG', 1, 'graphics'); }
    else {
      var extension = gl.getExtension('WEBGL_debug_renderer_info');
      if (extension && /(?:^|[ (])(?:SwiftShader|llvmpipe|softpipe)(?:$|[ )])|^Mesa OffScreen$/i.test(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL))) { add('WG', 1, 'graphics'); }
      extension = gl.getExtension('WEBGL_lose_context');
      if (extension) { extension.loseContext(); }
    }
    gl = null; canvas = null; extension = null;
  } catch (ignore) {}
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
    var saved = JSON.parse(w.sessionStorage.getItem('traffic_class') || '{}');
    if (saved.lastClass === 'automated') { add('CA', 100); }
    var now = Date.now(), list = saved.timestamps, last = -Infinity;
    if (Object.prototype.toString.call(list) === '[object Array]') {
      for (i = 0; i < list.length; i++) {
        if (typeof list[i] === 'number' && isFinite(list[i]) && list[i] >= 0 && list[i] <= now && list[i] > last) {
          timestamps.push(list[i]); last = list[i];
        }
      }
    }
    timestamps = timestamps.slice(-20);
    var navigation = w.performance && w.performance.getEntriesByType && w.performance.getEntriesByType('navigation')[0];
    var revisit = navigation ? /reload|back_forward/.test(navigation.type) :
      w.performance && w.performance.navigation && w.performance.navigation.type;
    if (!revisit && now > last) {
      timestamps = timestamps.slice(-19); timestamps.push(now);
      var count = 1;
      for (i = timestamps.length - 1; i > 0; i--) {
        var gap = timestamps[i] - timestamps[i - 1];
        if (gap <= 0 || gap >= config.fastNavMs) { break; }
        count++;
      }
      fast = count >= config.fastNavCount;
    }
    if (!save(/^(human|suspicious|automated|declared_agent)$/.test(saved.lastClass) ? saved.lastClass : '')) { fast = false; }
  } catch (ignore) { fast = false; }
  function interact(event) {
    if (done || d.visibilityState === 'hidden') { return; }
    if (event.isTrusted === true) { active = true; }
    if (/^(mousemove|pointerdown|touchstart)$/.test(event.type) && event.isTrusted === false) { synthetic = true; }
  }
  function exposure() {
    if (started !== null) { elapsed += Math.max(0, Date.now() - started); started = null; }
    w.clearTimeout(timer);
  }
  function finish() {
    if (done) { return; }
    exposure(); done = true;
    playwright(); geometry();
    for (i = 0; i < events.length; i++) { d.removeEventListener(events[i], interact, true); }
    d.removeEventListener('visibilitychange', visibility); w.removeEventListener('pagehide', finish);
    if (!active && elapsed >= config.idleMs) { add('NI', 2, 'interaction'); }
    if (fast) { add('FN', 3, 'navigation'); }
    if (synthetic && !active) { add('SY', 2, 'interaction'); }
    if (mismatch) { add('NP', 1, 'permissions'); }
    publish('final'); signals = []; families = {};
  }
  function visibility() {
    if (done) { return; }
    exposure();
    if (d.visibilityState !== 'hidden') {
      started = Date.now(); timer = w.setTimeout(finish, Math.max(0, config.idleMs - elapsed));
    }
  }
  for (i = 0; i < events.length; i++) { d.addEventListener(events[i], interact, true); }
  w.addEventListener('pagehide', finish); d.addEventListener('visibilitychange', visibility);
  initial = publish('initial'); ua = ''; brands = null;
  visibility();
}(window, document, navigator));
