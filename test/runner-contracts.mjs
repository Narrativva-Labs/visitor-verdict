import assert from 'node:assert/strict';
import test from 'node:test';
import {navigateAndWait, observationDwell, performanceSummary} from './support.mjs';

test('Navigation waits for the destination even when the departing page already has a final', async t => {
  for (const scenario of ['14 Passive reader', '14b No input', '22 Storage denied']) await t.test(scenario, async () => {
    let current = 'old', navigating = false, waiter, armed = false;
    const page = {
      async waitForURL(url, options) {
        assert.equal(url, 'http://test/page2.html'); assert.equal(options.waitUntil, 'load');
        armed = true;
        await new Promise(resolve => {waiter = resolve;});
      },
      snapshot() {
        assert.equal(navigating, false, 'Reading the departing execution context would race navigation');
        return {path: current, initial: {traffic_class: 'human'}};
      }
    };
    const before = {finals: [{traffic_class: 'human'}]};
    await navigateAndWait(page, 'http://test/page2.html', async () => {
      assert.equal(armed, true); navigating = true;
      // A click can resolve while old load and old final are already complete.
      setImmediate(() => {current = '/page2.html'; navigating = false; waiter();});
    });
    assert.equal(before.finals[0].traffic_class, 'human');
    assert.equal(page.snapshot().path, '/page2.html');
  });
});

test('Navigation action failures remain errors, not a fabricated classification', async () => {
  let release;
  const page = {waitForURL: () => new Promise(resolve => {release = resolve;})};
  await assert.rejects(navigateAndWait(page, '/page2.html', async () => {throw Error('Click failed');}), /Click failed/);
  release();
});

test('Rapid regression visits occupy distinct rounded buckets with margin below 2 seconds', () => {
  for (const mode of ['benign', 'cdp-agent']) {
    const spacing = observationDwell({mode}, false);
    for (const offset of [0, 1, 49, 99]) {
      const times = [0, 1, 2].map(i => Math.floor((10000 + offset + i * spacing) / 100) * 100);
      assert.equal(new Set(times).size, 3);
      assert.ok(times.slice(1).every((time, i) => time - times[i] > 0 && time - times[i] < 2000));
    }
  }
  assert.equal(observationDwell({mode: 'passive', human: true, dwell: 12000}, false), 12000);
  assert.equal(observationDwell({mode: 'idle', human: true, dwell: 12000}, false), 12000);
});

test('Default performance keeps a strict 5ms median budget; probes-on is informational', () => {
  assert.equal(performanceSummary(Array(20).fill(4.9), 5).status, 'PASS');
  assert.equal(performanceSummary(Array(20).fill(5), 5).status, 'FAIL');
  assert.equal(performanceSummary(Array(20).fill(7.1), 5).status, 'FAIL');
  const heavy = performanceSummary(Array(20).fill(7.1));
  assert.equal(heavy.status, 'INFO'); assert.equal(heavy.medianMs, 7.1); assert.equal(heavy.budgetMs, null);
  assert.equal(performanceSummary([9, 1, 3, 7], 5).medianMs, 5);
});
