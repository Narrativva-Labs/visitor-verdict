import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { fetchBounded } from '../dist/cache.js';
import { clock, jwk, directoryUrl, operator, signed, makeVerifier } from './helpers.mjs';

const ipUrl = 'https://agent.example/ips';
const registry = [{ ...operator, ipLists: [{ name: 'test', url: ipUrl }] }];
const ipRequest = { method: 'GET', host: 'example.com', headers: {}, clientIp: '192.0.2.1' };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const json = (data) => Response.json(data, { headers: { 'cache-control': 'max-age=300' } });
const failures = {
  timeout: () => new Promise(() => {}),
  'slow drip': () => {
    let timer;
    return new Response(
      new ReadableStream({
        start(c) {
          timer = setInterval(() => c.enqueue(new Uint8Array([32])), 5);
        },
        cancel() {
          clearInterval(timer);
        },
      }),
    );
  },
  503: () => new Response('down', { status: 503 }),
  404: () => new Response('missing', { status: 404 }),
  'redirect loop': (url) => new Response(null, { status: 302, headers: { location: url } }),
  'cross-host redirect': () =>
    new Response(null, { status: 307, headers: { location: 'https://other.invalid/keys' } }),
  'oversized streamed body': () => new Response(new Uint8Array(3 * 1024 * 1024)),
  'oversized declared body': () => new Response('{}', { headers: { 'content-length': '3145728' } }),
  'invalid JSON': () => new Response('{'),
  'invalid schema': () => json({ keys: 'wrong', prefixes: 'wrong' }),
};

for (const [name, response] of Object.entries(failures)) {
  for (const kind of ['directory', 'ip'])
    test(`${kind}: ${name}, bounded and not cached`, async (t) => {
      let calls = 0;
      const events = [];
      const unhandled = [];
      const onReject = (e) => unhandled.push(e);
      process.on('unhandledRejection', onReject);
      t.after(() => process.off('unhandledRejection', onReject));
      const v = makeVerifier({
        registry,
        fetchTimeoutMs: 35,
        deadlineMs: 120,
        onRefresh: (e) => events.push(e),
        fetcher: async (url, init) => {
          calls++;
          assert.equal(init.redirect, 'manual');
          assert.equal(init.credentials, 'omit');
          return response(url);
        },
      });
      t.after(() => v.close());
      const start = performance.now();
      const result = await v.verify(kind === 'directory' ? signed() : ipRequest);
      const elapsed = performance.now() - start;
      assert.equal(result.verification, 'none');
      assert(elapsed < 120, `elapsed ${elapsed} ms exceeded deadline`);
      await sleep(45);
      assert.equal(calls, 1, 'redirect never followed');
      assert.equal(events.length, 1);
      assert.equal(events[0].ok, false);
      assert.equal(v.status()[kind === 'directory' ? 'directories' : 'ipLists'].loaded, 0);
      assert.equal(v.status().lastRefreshOk, false);
      assert.deepEqual(unhandled, []);
      t.diagnostic(
        JSON.stringify({
          elapsedMs: elapsed,
          reason: result.reason,
          refreshReason: events[0].reason,
        }),
      );
    });
}

test('deadline wins over uncooperative fetch; late rejection is handled', async (t) => {
  const unhandled = [];
  const listener = (e) => unhandled.push(e);
  process.on('unhandledRejection', listener);
  t.after(() => process.off('unhandledRejection', listener));
  let rejectFetch;
  const v = makeVerifier({
    deadlineMs: 25,
    fetchTimeoutMs: 200,
    fetcher: () =>
      new Promise((_, reject) => {
        rejectFetch = reject;
      }),
  });
  t.after(() => v.close());
  const start = performance.now();
  assert.equal((await v.verify(signed())).reason, 'deadline_exceeded');
  const elapsed = performance.now() - start;
  // Timer dispatch has scheduler tolerance; no hard real-time guarantee is possible in JS.
  assert(elapsed < 65);
  rejectFetch(new Error('late transport rejection'));
  await sleep(30);
  assert.deepEqual(unhandled, []);
  t.diagnostic(JSON.stringify({ deadlineMs: 25, elapsedMs: elapsed, schedulerToleranceMs: 40 }));
});

test('JSON directories and IP lists tolerate incorrect MIME; SAIL rejects it', async () => {
  for (const kind of ['directory', 'ip']) {
    const data = kind === 'directory' ? { keys: [jwk] } : { prefixes: [] };
    assert.deepEqual(
      (
        await fetchBounded(
          directoryUrl,
          async () =>
            new Response(JSON.stringify(data), {
              headers: { 'content-type': 'text/html' },
            }),
          kind,
          100,
        )
      ).data,
      data,
    );
  }
  await assert.rejects(
    fetchBounded(directoryUrl, async () => new Response(''), 'sail', 100),
    (e) => e.reason === 'invalid_sail',
  );
});

for (const kind of ['directory', 'ip'])
  test(`${kind}: stale works during outage, stops at hard age`, async (t) => {
    let now = clock;
    let down = false;
    let calls = 0;
    const events = [];
    const v = makeVerifier({
      registry,
      now: () => now,
      staleMaxSeconds: 600,
      onRefresh: (e) => events.push(e),
      fetcher: async (url) => {
        calls++;
        if (down) throw Error('offline');
        return json(
          url === directoryUrl ? { keys: [jwk] } : { prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] },
        );
      },
    });
    t.after(() => v.close());
    const request = kind === 'directory' ? signed() : ipRequest;
    const expected = kind === 'directory' ? 'signature_valid' : 'ip_match';
    assert.equal((await v.verify(request)).verification, expected);
    down = true;
    now += 301;
    assert.equal((await v.verify(request)).verification, expected);
    await tick();
    assert.equal(v.status().lastRefreshOk, false);
    now = clock + 599;
    assert.equal((await v.verify(request)).verification, expected);
    await tick();
    now = clock + 600;
    assert.equal((await v.verify(request)).verification, 'none');
    assert.equal(v.status()[kind === 'directory' ? 'directories' : 'ipLists'].loaded, 0);
    assert(events.some((e) => !e.ok));
    t.diagnostic(JSON.stringify({ calls, refreshes: events.length, staleMaxSeconds: 600 }));
  });

test('rotation replaces keys mid-run and removes the previous key', async (t) => {
  let now = clock;
  let keys = [jwk];
  const v = makeVerifier({ now: () => now, fetcher: async () => json({ keys }) });
  t.after(() => v.close());
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  const pair2 = generateKeyPairSync('ed25519');
  const next = pair2.publicKey.export({ format: 'jwk' });
  const kid = createHash('sha256')
    .update(JSON.stringify({ crv: next.crv, kty: next.kty, x: next.x }))
    .digest('base64url');
  const request = signed({ kid });
  const params = request.headers['signature-input'].slice(2);
  const base = `"@authority": example.com\n"@method": GET\n"signature-agent": "https://agent.example"\n"@signature-params": ${params}`;
  request.headers.signature =
    's=:' + sign(null, Buffer.from(base), pair2.privateKey).toString('base64') + ':';
  keys = [next];
  now += 301;
  await v.verify(signed()); // stale document starts refresh
  await tick();
  assert.equal((await v.verify(request)).verification, 'signature_valid');
  assert.notEqual((await v.verify(signed())).verification, 'signature_valid');
});

for (const [createdDelta, expiresDelta, reason] of [
  [0, 0, 'signature_valid'],
  [30, 60, 'signature_valid'],
  [31, 60, 'future_created'],
  [-60, -30, 'signature_valid'],
  [-60, -31, 'expired'],
  [1, 0, 'invalid_validity_window'],
])
  test(`clock boundary created=${createdDelta}, expires=${expiresDelta}`, async (t) => {
    const v = makeVerifier();
    t.after(() => v.close());
    const result = await v.verify(
      signed({ created: clock + createdDelta, expires: clock + expiresDelta }),
    );
    assert.equal(reason === 'signature_valid' ? result.verification : result.reason, reason);
  });
for (const value of [NaN, Infinity, -Infinity, 1e12])
  test(`invalid clock ${value}`, async (t) => {
    const v = makeVerifier({ now: () => value });
    t.after(() => v.close());
    assert.equal((await v.verify(signed())).reason, 'invalid_clock');
    assert.equal((await v.warm()).failed.length, 1);
    assert.equal(v.status().directories.loaded, 0);
  });
test('throwing clock has the same invalid_clock outcome as nonfinite clocks', async (t) => {
  const v = makeVerifier({
    now: () => {
      throw Error('clock unavailable');
    },
  });
  t.after(() => v.close());
  assert.equal((await v.verify(signed())).reason, 'invalid_clock');
});

function percentiles(samples) {
  samples.sort((a, b) => a - b);
  return {
    p50: samples[Math.floor(samples.length * 0.5)],
    p95: samples[Math.floor(samples.length * 0.95)],
    p99: samples[Math.floor(samples.length * 0.99)],
    max: samples.at(-1),
  };
}
test('1000 concurrent real Ed25519 verifies: warm cache, latency and event-loop delay', async (t) => {
  let calls = 0;
  const v = makeVerifier({
    deadlineMs: 1500,
    fetcher: async () => {
      calls++;
      return json({ keys: [jwk] });
    },
  });
  t.after(() => v.close());
  await v.warm();
  const request = signed();
  const lag = monitorEventLoopDelay({ resolution: 1 });
  lag.enable();
  await sleep(5);
  const start = performance.now();
  let timerDelay;
  const timer = new Promise((resolve) =>
    setTimeout(() => {
      timerDelay = performance.now() - start;
      resolve();
    }, 0),
  );
  const samples = [];
  const results = await Promise.all(
    Array.from({ length: 1000 }, async () => {
      const at = performance.now();
      const result = await v.verify(request);
      samples.push(performance.now() - at);
      return result;
    }),
  );
  await timer;
  await sleep(5);
  lag.disable();
  assert(results.every((v) => v.verification === 'signature_valid'));
  assert.equal(calls, 1);
  assert(Math.max(...samples) < 1500);
  t.diagnostic(
    JSON.stringify({
      count: 1000,
      latencyMs: percentiles(samples),
      timerDelayMs: timerDelay,
      eventLoopMaxMs: lag.max / 1e6,
      totalMs: performance.now() - start,
      fetches: calls,
    }),
  );
});
test('10000 malformed signature headers: bounded parser, no fetch or rejection', async (t) => {
  let calls = 0;
  const v = makeVerifier({
    fetcher: async () => {
      calls++;
      throw Error('unexpected');
    },
  });
  t.after(() => v.close());
  const malformed = ['s=(', 's=:!:', 'x'.repeat(70000), 's=("@authority");created=NaN', '\u0000'];
  const reasons = {};
  const start = performance.now();
  for (let i = 0; i < 10000; i++) {
    const result = await v.verify({
      ...ipRequest,
      clientIp: undefined,
      headers: {
        signature: malformed[i % malformed.length],
        'signature-input': malformed[i % malformed.length],
      },
    });
    assert.notEqual(result.verification, 'signature_valid');
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
  }
  assert.equal(calls, 0);
  t.diagnostic(JSON.stringify({ count: 10000, totalMs: performance.now() - start, reasons }));
});

test('1000 cold concurrent signed verifies coalesce to one directory fetch', async (t) => {
  let calls = 0;
  const v = makeVerifier({
    fetcher: async () => {
      calls++;
      await sleep(15);
      return json({ keys: [jwk] });
    },
  });
  t.after(() => v.close());
  const start = performance.now();
  const results = await Promise.all(Array.from({ length: 1000 }, () => v.verify(signed())));
  assert(results.every((result) => result.verification === 'signature_valid'));
  assert.equal(calls, 1);
  t.diagnostic(
    JSON.stringify({ count: 1000, fetches: calls, elapsedMs: performance.now() - start }),
  );
});

test('a fetch response arriving after timeout has its body cancelled', async () => {
  let release;
  let cancelled = 0;
  const pending = fetchBounded(
    directoryUrl,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    'directory',
    10,
  );
  await assert.rejects(pending, (e) => e.reason === 'directory_timeout');
  release(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
    ),
  );
  await tick();
  assert.equal(cancelled, 1);
});
