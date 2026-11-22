/* Test harness only: the production detector never makes network requests. */
window.visitorVerdictConfig = window.tcTestConfig || {debug: true, webgl: true, worker: true};
window.dataLayer = [];
window.dataLayer.push = function (event) {
  Array.prototype.push.call(this, event);
  // Capture synchronously through Playwright's console channel before unload can
  // cancel the test-only POST. No exposed binding or detector instrumentation.
  console.debug('visitor-verdict-test:' + JSON.stringify({path: location.pathname, event: event}));
  // Primary channel: same-tab sessionStorage survives the navigation that fires pagehide.
  try {
    var log = JSON.parse(sessionStorage.getItem('tc_test_events') || '[]');
    log.push({path: location.pathname, event: event});
    sessionStorage.setItem('tc_test_events', JSON.stringify(log));
  } catch (e) { /* storage blocked: console and /log remain */ }
  document.getElementById('result').textContent = JSON.stringify(event, null, 2);
  fetch('/log', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(event), keepalive: true}).catch(function () {});
  return this.length;
};
// Test harness only: ?marker=id[,id] places synthetic agent UI markers where the
// agents put them (Claude markers in body, the OpenAI overlay on the root element);
// &markerDelay=ms inserts them later instead of before the detector loads.
(function () {
  var match = /[?&]marker=([a-z,-]+)/.exec(location.search), delay = /[?&]markerDelay=(\d+)/.exec(location.search);
  if (!match) { return; }
  function place() {
    match[1].split(',').forEach(function (id) {
      var node = document.createElement('div');
      node.id = id;
      (id.indexOf('claude-') === 0 ? document.body : document.documentElement).appendChild(node);
    });
  }
  if (delay) { setTimeout(place, Number(delay[1])); } else { place(); }
}());
