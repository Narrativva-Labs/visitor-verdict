// Everything, including callbacks, runs inside the VM timeout boundary.
export const setup = String.raw`
var nativeJSON = JSON;
var spec = nativeJSON.parse(__spec);
var now = 1800000000000, nextTimer = 1, timers = [], captured = [], writes = [], faults = [];
var storage = Object.create(null);
storage.visitor_verdict = spec.storage;
var DateOriginal = Date;
Date.now = function () { return now; };
function target(object) {
  Object.defineProperty(object, '_listeners', {value: Object.create(null)});
  object.addEventListener = function (name, fn, options) {
    if (options && typeof options === 'object') { void options.passive; }
    (this._listeners[name] || (this._listeners[name] = [])).push(fn);
  };
  object.removeEventListener = function (name, fn) {
    this._listeners[name] = (this._listeners[name] || []).filter(function (x) { return x !== fn; });
  };
  return object;
}
function dispatch(object, name, extra) {
  var event = Object.assign({type: name}, extra || {});
  // Document input traverses window capture before the document target, even
  // when the event does not bubble. Keep the detector's window listeners live.
  if (object === document) {
    (window._listeners[name] || []).slice().forEach(function (fn) { fn(event); });
  }
  (object._listeners[name] || []).slice().forEach(function (fn) { fn(event); });
}
var window = target({});
window.window = window; window.top = window; window.self = window;
window.setTimeout = function (fn, ms) {
  var id = nextTimer++;
  timers.push({id: id, at: now + Math.max(0, Number(ms) || 0), fn: fn});
  return id;
};
window.clearTimeout = function (id) { timers = timers.filter(function (t) { return t.id !== id; }); };
function advance(ms) {
  var end = now + ms, count = 0;
  for (;;) {
    timers.sort(function (a,b) { return a.at - b.at || a.id - b.id; });
    if (!timers.length || timers[0].at > end) { break; }
    if (++count > 1000) { throw Error('timer queue exceeded 1000 callbacks'); }
    var timer = timers.shift(); now = timer.at; timer.fn();
  }
  now = end;
}
window.sessionStorage = {
  getItem: function (key) { if (spec.blockStorage) { throw Error('SecurityError'); } return storage[key] === undefined ? null : storage[key]; },
  setItem: function (key, value) { if (spec.blockStorage) { throw Error('SecurityError'); } storage[key] = String(value); writes.push({key: key, value: String(value), now: now}); },
  removeItem: function (key) { if (spec.blockStorage) { throw Error('SecurityError'); } delete storage[key]; },
  clear: function () { throw Error('detector must not clear unrelated session storage'); }
};
Object.defineProperty(window, 'localStorage', {get: function () { throw Error('forbidden localStorage access'); }});
window.fetch = function () { throw Error('forbidden network request'); };
window.XMLHttpRequest = function () { throw Error('forbidden network request'); };
window.screen = {width: 1920, height: 1080};
window.innerWidth = 1440; window.innerHeight = 900; window.outerWidth = 1460; window.outerHeight = 980;
window.chrome = {}; window.isSecureContext = true;
window.Notification = {permission: spec.permissionMismatch ? 'denied' : 'default'};
window.performance = {getEntriesByType: function () { return [{type:'navigate'}]; }};
var navigator = {
  userAgent: spec.ua || 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36', webdriver: !!spec.webdriver,
  languages: ['en-US','en'], language: 'en-US', plugins: [1,2,3,4,5],
  hardwareConcurrency: 8, maxTouchPoints: 0, pdfViewerEnabled: true,
  userAgentData: {brands:[{brand:'Chromium',version:'130'}]},
  permissions: {query: function () { return Promise.resolve({state:'prompt'}); }}
};
window.navigator = navigator;
function Element() { this.nodeType = 1; this.ownerDocument = document; }
var document = target({visibilityState: 'visible', hasFocus: function () { return true; }});
window.document = document;
if (spec.webmcp === 'document' || spec.webmcp === 'both') document.modelContext = target({});
if (spec.webmcp === 'legacy' || spec.webmcp === 'both') navigator.modelContext = target({});
if (spec.webmcp === 'throw') Object.defineProperty(document, 'modelContext', {get: function () { throw Error('blocked'); }});
document.createEvent = function () { return {initEvent: function (type) { this.type = type; }}; };
document.dispatchEvent = function (event) { dispatch(document, event.type, event); return true; };
document.createElement = function () {
  var el = new Element();
  el.getContext = function () {
    if (spec.noWebGL) { return null; }
    return {getExtension: function (name) {
      return name === 'WEBGL_debug_renderer_info' ? {UNMASKED_RENDERER_WEBGL: 37446} : {loseContext: function () {}};
    }, getParameter: function () { return spec.softwareGL ? 'SwiftShader' : 'GPU'; }};
  };
  return el;
};
// Agent UI marker DOM: id lookup with fixed parents and a recording MutationObserver.
var rootNode = {}, bodyNode = {children: []}, markerNodes = Object.create(null), observers = [];
document.documentElement = rootNode; document.body = bodyNode;
document.getElementById = function (id) { return markerNodes[id] || null; };
function placeMarker(id, parent) {
  markerNodes[id] = {id: id, parentNode: parent};
  observers.forEach(function (o) { if (o.active) { o.fn([{type: 'childList'}], o); } });
}
window.MutationObserver = function (fn) { this.fn = fn; this.active = false; observers.push(this); };
window.MutationObserver.prototype.observe = function () { this.active = true; };
window.MutationObserver.prototype.disconnect = function () { this.active = false; };
if (spec.marker === 'start') { placeMarker('claude-agent-glow-border', bodyNode); }
if (spec.marker === 'decoy') { placeMarker('claude-agent-glow-border-inner', bodyNode); placeMarker('codex-browser-sidebar-comments-root', rootNode); placeMarker('claude-phantom-cursor', rootNode); }
window.getComputedStyle = function (node) { return {display: node.display}; };
function placeHost() {
  var node = {nodeType:1, tagName:'DIV', parentNode:bodyNode, attributes:[], childNodes:[], display:'contents'};
  bodyNode.children.push(node);
  observers.forEach(function (o) { if (o.active) o.fn([{type:'childList',target:bodyNode,addedNodes:[node]}],o); });
}
if (spec.host === 'start') placeHost();
Object.defineProperty(document, 'cookie', {get: function () { throw Error('forbidden cookie read'); }, set: function () { throw Error('forbidden cookie write'); }});
window.URL = {createObjectURL: function () { return 'blob:local-fake'; }, revokeObjectURL: function () {}};
window.Blob = function (parts) { this.parts = parts; };
window.Worker = function () {
  var worker = this;
  this.postMessage = function () { window.setTimeout(function () {
    if (worker.onmessage) { worker.onmessage({data:{m:!!spec.workerMismatch,h:!!spec.workerHeadless}}); }
  }, 1); };
  this.terminate = function () { worker.onmessage = null; };
};
window.visitorVerdictConfig = CONFIG_EXPRESSION;
var cfg = window.visitorVerdictConfig;
var layerName = cfg && typeof cfg.dataLayerName === 'string' && cfg.dataLayerName.length > 0 && cfg.dataLayerName.length <= 128 && !/^(?:__proto__|prototype|constructor)$/.test(cfg.dataLayerName) ? cfg.dataLayerName : 'dataLayer';
window[layerName] = [];
window[layerName].push = function (event) { captured.push(event); return Array.prototype.push.call(this, event); };
if (spec.soft) { navigator.languages = []; navigator.language = ''; navigator.plugins = []; window.chrome = undefined; window.screen = {width:800,height:600}; }
(spec.pollution || []).forEach(function (p) {
  var value = new Element();
  if (p.kind === 'plain') { value = {}; }
  if (p.kind === 'array') { value = []; }
  if (p.kind === 'collection') { value = Object.create({item:function(){}}); value.length = 1; value[0] = new Element(); Object.defineProperty(value, Symbol.toStringTag, {value:'HTMLCollection'}); }
  if (p.name === '__visitorVerdict') { value.__tcDetector = true; }
  (p.target === 'document' ? document : window)[p.name] = value;
});
var old = spec.old || [];
if (old.indexOf('noWorker') !== -1) { delete window.Worker; }
if (old.indexOf('noWebGL') !== -1) { spec.noWebGL = true; }
if (old.indexOf('noPermissions') !== -1) { delete navigator.permissions; }
if (old.indexOf('noJSON') !== -1) { JSON = undefined; }
if (old.indexOf('noOwnNames') !== -1) { Object.getOwnPropertyNames = undefined; }
if (old.indexOf('noWindowAdd') !== -1) { window.addEventListener = undefined; }
if (old.indexOf('noDocumentAdd') !== -1) { document.addEventListener = undefined; }
if (old.indexOf('noWindowRemove') !== -1) { window.removeEventListener = undefined; }
if (old.indexOf('noDocumentRemove') !== -1) { document.removeEventListener = undefined; }
if (old.indexOf('noMutationObserver') !== -1) { delete window.MutationObserver; }
`;

export const lifecycle = String.raw`
// Capture stale callbacks to model an already queued timeout racing pagehide.
var stale = timers.slice();
for (var m = 0; m < (spec.webmcpEvents || 0); m++) {
  dispatch(spec.webmcp === 'document' || spec.webmcp === 'both' ? document.modelContext : window,
    m % 2 ? 'toolcancel' : 'toolactivated', {isTrusted: spec.webmcpTrusted});
}
if (spec.interaction) {
  dispatch(document, 'mousemove', {clientX:10,clientY:10,isTrusted: spec.oldTrusted ? undefined : true});
  dispatch(document, 'scroll', {isTrusted: spec.oldTrusted ? undefined : true});
}
if (spec.synthetic) {
  dispatch(document, 'mousemove', {clientX:10,clientY:10,isTrusted:false});
  dispatch(document, 'pointerdown', {pointerType:'mouse',isTrusted:false});
}
if (spec.teleport) {
  for (var j = 0; j < 3; j++) {
    dispatch(document, 'mousemove', {clientX:0,clientY:0,isTrusted:true});
    advance(10);
    dispatch(document, 'mousemove', {clientX:500+j*100,clientY:500,movementX:500,movementY:500,isTrusted:true});
    dispatch(document, 'pointerdown', {pointerType:'mouse',isTrusted:true});
    dispatch(document, 'click', {clientX:500+j*100,clientY:500,pointerType:'mouse',detail:1,isTrusted:true});
  }
}
if (spec.host === 'late') placeHost();
if (spec.form) {
  var field = {tagName:'INPUT'};
  for (var b = 0; b < 3; b++) {
    dispatch(document, 'keydown', {target:field, isTrusted:spec.form !== 'untrusted', timeStamp:now});
    dispatch(document, 'input', {target:field, isTrusted:spec.form !== 'untrusted', inputType:spec.form === 'paste' ? 'insertFromPaste' : 'insertText'});
    advance(spec.form === 'normal' ? 100 : 2);
  }
}
if (spec.marker === 'late') { advance(2000); placeMarker('codex-agent-overlay-root', rootNode); }
if (spec.race === 'hide-first') { dispatch(window, 'pagehide'); }
if (spec.race === 'visibility') {
  advance(100); document.visibilityState = 'hidden'; dispatch(document, 'visibilitychange');
  advance(4000000); document.visibilityState = 'visible'; dispatch(document, 'visibilitychange');
}
advance(4000001);
if (spec.marker === 'after-final') { placeMarker('claude-phantom-cursor', bodyNode); placeMarker('claude-phantom-cursor', bodyNode); }
dispatch(window, 'pagehide'); dispatch(window, 'pagehide');
stale.forEach(function (t) { t.fn(); });
dispatch(window, 'pageshow', {persisted:true}); dispatch(window, 'pagehide');
`;

export const poison = String.raw`
var beforePoison = window.__visitorVerdict;
var beforeDescriptor = Object.getOwnPropertyDescriptor(window, '__visitorVerdict');
var beforeFrozen = Object.isFrozen(beforePoison);
if (spec.poisonSnapshot) {
  try { window.__visitorVerdict = {class:'alien',score:Infinity,phase:'final',version:'poison'}; } catch (e) {}
  try { beforePoison.class = 'automated'; beforePoison.score = NaN; beforePoison.phase = 'final'; beforePoison.version = 'poison'; } catch (e) {}
  try { Object.defineProperty(window, '__visitorVerdict', {value:{class:'automated'}}); } catch (e) {}
  try { delete window.__visitorVerdict; } catch (e) {}
}
`;
export const snapshot = `nativeJSON.stringify({events:captured,writes:writes,storage:storage,state:window.__visitorVerdict,now:now,
  beforeFrozen:beforeFrozen,finalFrozen:Object.isFrozen(window.__visitorVerdict),
  readOnly:beforeDescriptor && beforeDescriptor.configurable === false && beforeDescriptor.set === undefined && typeof beforeDescriptor.get === 'function',
  initialIntact:beforePoison && beforePoison.phase === 'initial' && beforePoison.version === '1.5.0',
  previous:window.__visitorVerdictLast})`;
