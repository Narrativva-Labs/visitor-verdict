import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentCache } from '../dist/cache.js';
import { clock, directoryUrl, jwk, signed, makeVerifier, operator } from './helpers.mjs';

const cached = { cacheOnly: true };
const longTtl = { headers: { 'cache-control': 'max-age=3600' } };
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

test('hard max caps fresh HTTP TTL and warm reuse at age 601', async () => {
  let now = clock;
  let fetches = 0;
  const verifier = makeVerifier({
    staleMaxSeconds: 600,
    now: () => now,
    fetcher: async () => {
      fetches++;
      if (fetches > 1) throw Error('offline');
      return Response.json({ keys: [jwk] }, longTtl);
    },
  });
  assert.equal((await verifier.verify(signed())).verification, 'signature_valid');
  now += 601;
  const result = await verifier.verify(signed({ created: now, expires: now + 600 }));
  assert.equal(result.verification, 'none');
  assert.equal(fetches, 2);
  assert.deepEqual(await verifier.warm(), { ok: [], failed: [directoryUrl] });
  assert.equal(fetches, 2);
});

test('hard max also caps the forced-refresh cooldown fallback', async () => {
  let fetches = 0;
  const cache = new AgentCache(
    async () => {
      if (++fetches > 1) throw Error('offline');
      return Response.json({ version: 1 }, longTtl);
    },
    100,
    { staleMaxSeconds: 600 },
  );
  const decode = (data) => data;
  await cache.load(directoryUrl, 'directory', clock, decode);
  await assert.rejects(cache.load(directoryUrl, 'directory', clock + 590, decode, 'forced'));
  await assert.rejects(cache.load(directoryUrl, 'directory', clock + 601, decode, 'forced'));
  await assert.rejects(cache.load(directoryUrl, 'directory', clock + 601, decode, 'cached'));
  assert.equal(fetches, 2);
});

test('refresh-ahead uses the shorter effective TTL', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = clock;
  let fetches = 0;
  const verifier = makeVerifier({
    now: () => now,
    staleMaxSeconds: 600,
    fetcher: async () => {
      fetches++;
      return Response.json({ keys: [jwk] }, longTtl);
    },
  });
  t.after(() => verifier.close());
  await verifier.warm({ refreshAhead: true });
  now += 539;
  t.mock.timers.tick(539000);
  await settle();
  assert.equal(fetches, 1);
  now++;
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(fetches, 2);
});

test('zero still disables stale serving without shortening the HTTP fresh TTL', async () => {
  let now = clock;
  let fetches = 0;
  const verifier = makeVerifier({
    now: () => now,
    staleMaxSeconds: 0,
    fetcher: async () => {
      if (++fetches > 1) throw Error('offline');
      return Response.json({ keys: [jwk] }, longTtl);
    },
  });
  await verifier.warm();
  now += 601;
  assert.equal(
    (await verifier.verify(signed({ created: now }), cached)).verification,
    'signature_valid',
  );
  assert.equal(fetches, 1);
  now = clock + 3600;
  assert.equal(
    (await verifier.verify(signed({ created: now, expires: now + 600 }), cached)).reason,
    'cache_miss',
  );
  assert.equal(fetches, 2);
});

test('cold cache-only requests finish before a 900 ms fetch and share one background flight', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fetches = 0;
  const verifier = makeVerifier({
    deadlineMs: 300,
    fetchTimeoutMs: 3000,
    fetcher: async () => {
      fetches++;
      await new Promise((resolve) => setTimeout(resolve, 900));
      return Response.json({ keys: [jwk] });
    },
  });
  let results;
  void Promise.all(Array.from({ length: 20 }, () => verifier.verify(signed(), cached))).then(
    (value) => {
      results = value;
    },
  );
  await settle();
  assert.equal(
    results?.length,
    20,
    'cache-only must settle without advancing network/deadline timers',
  );
  assert.ok(
    results.every((value) => value.verification === 'none' && value.reason === 'cache_miss'),
  );
  assert.equal(fetches, 1);
  t.mock.timers.tick(900);
  await settle();
  assert.equal((await verifier.verify(signed(), cached)).verification, 'signature_valid');
  assert.equal(fetches, 1);
});

test('offline cache-only requests never join network work, including a startup warm flight', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fetches = 0;
  const verifier = makeVerifier({
    fetcher: async () => {
      fetches++;
      return new Promise(() => {});
    },
  });
  void verifier.warm();
  let result;
  void verifier.verify(signed(), cached).then((value) => {
    result = value;
  });
  await settle();
  assert.equal(result?.reason, 'cache_miss');
  assert.equal(fetches, 1);
});

test('cache-only uses bounded stale data during refresh, never after hard expiry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = clock;
  let fetches = 0;
  const verifier = makeVerifier({
    now: () => now,
    staleMaxSeconds: 600,
    fetcher: async () => {
      if (++fetches > 1) return new Promise(() => {});
      return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'no-store' } });
    },
  });
  await verifier.warm();
  now += 301;
  assert.equal((await verifier.verify(signed(), cached)).verification, 'signature_valid');
  assert.equal(fetches, 2);
  now = clock + 600;
  assert.equal((await verifier.verify(signed(), cached)).reason, 'cache_miss');
  assert.equal(fetches, 2);
});

test('cache-only unknown keyids start one controlled forced refresh without waiting', async () => {
  let fetches = 0;
  const verifier = makeVerifier({
    fetcher: async () => {
      fetches++;
      return Response.json({ keys: [jwk] });
    },
  });
  await verifier.warm();
  const requests = Array.from({ length: 20 }, () =>
    verifier.verify(signed({ kid: 'unknown' }), cached),
  );
  const results = await Promise.all(requests);
  assert.ok(results.every((result) => result.verification === 'none'));
  assert.equal(fetches, 2);
  await settle();
  assert.equal((await verifier.verify(signed({ kid: 'unknown' }), cached)).reason, 'unknown_keyid');
  assert.equal(fetches, 2);
});

test('cache-only IP misses warm once, then match; hard expiry caps longer HTTP TTL', async () => {
  let release;
  let now = clock;
  let fetches = 0;
  const verifier = makeVerifier({
    registry: [
      {
        ...operator,
        extraUaTokens: ['TestBot'],
        ipLists: [{ name: 'ips', url: 'https://agent.example/ips', uaTokens: ['TestBot'] }],
      },
    ],
    staleMaxSeconds: 600,
    now: () => now,
    fetcher: () => {
      fetches++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const request = {
    method: 'GET',
    host: 'example.com',
    headers: { 'user-agent': 'TestBot' },
    clientIp: '192.0.2.1',
  };
  assert.equal((await verifier.verify(request, cached)).reason, 'cache_miss');
  assert.equal((await verifier.verify(request, cached)).reason, 'cache_miss');
  assert.equal(fetches, 1);
  release(Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }, longTtl));
  await settle();
  assert.equal((await verifier.verify(request, cached)).verification, 'ip_match');
  now += 601;
  assert.equal((await verifier.verify(request, cached)).reason, 'cache_miss');
  assert.equal(fetches, 2);
  release(Response.json({ prefixes: [] }, longTtl));
  await settle();
  assert.equal((await verifier.verify(request, cached)).verification, 'no_signature');
});

test('cache-only supports a cached SAIL service and never waits on its cold feed', async () => {
  const verifier = makeVerifier({
    registry: [
      {
        ...operator,
        ipLists: [
          {
            name: 'sail',
            url: 'https://agent.example/sail',
            format: 'sail',
            service: 'Claude-Agent',
            uaTokens: ['Claude-Agent'],
          },
        ],
      },
    ],
    fetcher: async () => {
      const { readFileSync } = await import('node:fs');
      return new Response(
        readFileSync(new URL('fixtures/anthropic-sail-2026-11-20.toml', import.meta.url)),
        { headers: { 'content-type': 'application/sail+toml' } },
      );
    },
  });
  const request = {
    method: 'GET',
    host: 'example.com',
    headers: { 'user-agent': 'Claude-Agent' },
    clientIp: '136.71.21.147',
  };
  assert.equal((await verifier.verify(request, cached)).reason, 'cache_miss');
  await settle();
  assert.equal((await verifier.verify(request, cached)).verification, 'ip_match');
});

test('cache-only never calls DNS or weakens a configured external replay store', async () => {
  let dnsCalls = 0;
  const resolver = {
    reverse: async () => {
      dnsCalls++;
      return [];
    },
    resolve4: async () => [],
    resolve6: async () => [],
  };
  const verifier = makeVerifier({
    registry: [
      {
        ...operator,
        extraUaTokens: ['TestBot'],
        reverseDns: [
          {
            uaTokens: ['TestBot'],
            suffixes: ['agent.example'],
            source: 'test',
            checked: '2026-11-20',
          },
        ],
      },
    ],
    reverseDns: { enabled: true, resolver },
  });
  await verifier.verify(
    {
      method: 'GET',
      host: 'example.com',
      headers: { 'user-agent': 'TestBot' },
      clientIp: '192.0.2.1',
    },
    cached,
  );
  assert.equal(dnsCalls, 0);
  let nonceCalls = 0;
  const replay = makeVerifier({
    nonceStore: {
      insertIfAbsent: async () => {
        nonceCalls++;
        return true;
      },
    },
  });
  await replay.warm();
  assert.equal((await replay.verify(signed(), cached)).reason, 'insufficient_context');
  assert.equal(nonceCalls, 0);
});
