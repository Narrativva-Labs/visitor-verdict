/* Test harness only: the production detector never makes network requests. */
window.trafficClassConfig = window.tcTestConfig || {debug: true, webgl: true, worker: true};
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
