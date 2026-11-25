import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifier } from '../dist/index.js';
import { AgentCache } from '../dist/cache.js';
import { publicKeys } from '../dist/keys.js';
import { jwk } from './helpers.mjs';
const url = 'https://example.test/sail',
  now = 1800000000;
const body = `schema = "draft-kelley-webbotauth-sail-00"\nmodified = 2026-11-24T00:00:00Z\nexpires_after = 86400\n[[prefix_sets]]\nname = "optional"\nexclusive = true\nipv4_prefixes = ["192.0.2.0/24"]\nipv6_prefixes = []\n[[services]]\nname = "optional"\nexhaustive = true\nprefix_sets = ["optional"]\n[[prefix_sets]]\nname = "required"\nexclusive = true\nipv4_prefixes = []\nipv6_prefixes = []\n[[services]]\nname = "required"\nexhaustive = true\nprefix_sets = ["required"]\n`;
const registry = (service) => [
  {
    operator: 'openai',
    verifiedByCapture: false,
    source: 'https://example.test/docs',
    checked: '2026-11-25',
    ipLists: [
      {
        name: service,
        url,
        format: 'sail',
        service,
        uaTokens: ['GPTBot'],
        complete: true,
        source: 'https://example.test/docs',
        checked: '2026-11-25',
      },
    ],
  },
];
test('K7 all services in one verifier must be available', async () => {
  const r = registry('required');
  r[0].ipLists.push(registry('optional')[0].ipLists[0]);
  const v = createVerifier({
    authorities: ['example.com'],
    registry: r,
    now: () => now,
    fetcher: async () =>
      new Response(body, { headers: { 'content-type': 'application/sail+toml' } }),
  });
  try {
    assert.deepEqual((await v.warm({ ipLists: true })).failed, [url]);
    assert.equal(v.status().ipLists.loaded, 0);
  } finally {
    v.close();
  }
});
test('K7 cold directory failures retry at 1,2,4,8,16,30,60 seconds', async () => {
  let time = now,
    calls = 0;
  const events = [];
  const c = new AgentCache(
    async () => {
      calls++;
      throw Error('offline');
    },
    10,
    { now: () => time, onRefresh: (e) => events.push(e) },
  );
  try {
    for (const delay of [1, 2, 4, 8, 16, 30, 60, 60]) {
      await assert.rejects(c.load(url, 'directory', time, publicKeys, 'warm'));
      const n = calls;
      time += delay - 0.01;
      await assert.rejects(c.load(url, 'directory', time, publicKeys, 'warm'));
      assert.equal(calls, n);
      time += 0.01;
    }
    assert.equal(calls, 8);
    assert.equal(events.length, 8);
    assert.ok(events.every((e) => !e.ok));
  } finally {
    c.close();
  }
});
test('K7 directory persistence preserves age, source allowlist, key validity and stale maximum', async () => {
  let time = now,
    calls = 0;
  const make = () =>
    new AgentCache(
      async () => {
        calls++;
        return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'max-age=300' } });
      },
      10,
      { now: () => time, staleMaxSeconds: 600 },
    );
  const a = make(),
    b = make();
  try {
    await a.load(url, 'directory', time, publicKeys, 'warm');
    const snapshot = JSON.parse(JSON.stringify(a.directorySnapshot()));
    time += 301;
    b.restoreDirectories(snapshot, new Map([[url, publicKeys]]));
    assert.equal(b.status([[url, 'directory']]).directories.loaded, 1);
    assert.equal(b.successfulRefreshAt(url, 'directory'), now);
    // Restoring never changes fetched time or revalidates against a new source URL.
    const other = make();
    other.restoreDirectories(snapshot, new Map());
    assert.equal(other.status([[url, 'directory']]).directories.loaded, 0);
    other.close();
    time = now + 600;
    assert.equal(b.status([[url, 'directory']]).directories.loaded, 0);
    assert.equal(calls, 1);
  } finally {
    a.close();
    b.close();
  }
});
test('K7 warm/ahead has a 4s timeout while request loads keep their shorter budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = new AgentCache(() => new Promise(() => {}), 20, { now: () => now });
  const warm = assert.rejects(
    c.load(url, 'directory', now, publicKeys, 'warm'),
    (e) => e.reason === 'directory_timeout',
  );
  t.mock.timers.tick(3999);
  await new Promise(setImmediate);
  assert.equal(c.status([[url, 'directory']]).lastRefreshOk, null);
  t.mock.timers.tick(1);
  await warm;
  const req = assert.rejects(
    c.load(url + '/other', 'directory', now, publicKeys),
    (e) => e.reason === 'directory_timeout',
  );
  t.mock.timers.tick(20);
  await req;
  c.close();
});
