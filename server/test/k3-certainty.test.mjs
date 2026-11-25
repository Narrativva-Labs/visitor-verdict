import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentCache } from '../dist/cache.js';
import { decodeList, ipMismatch } from '../dist/ip.js';
const registry = [
  {
    operator: 'openai',
    ipLists: [
      { name: 'all', url: 'https://example.test/ips', complete: true, uaTokens: ['GPTBot'] },
    ],
  },
];
test('failed refresh before two hours disables certainty until a successful recovery', async () => {
  let now = 1800000000,
    fail = false;
  const cache = new AgentCache(
    async () => {
      if (fail) throw Error();
      return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    },
    50,
    { now: () => now, staleMaxSeconds: 86400 },
  );
  const check = () => ipMismatch('203.0.113.1', ['GPTBot'], registry, cache, now, new Map());
  await cache.load(registry[0].ipLists[0].url, 'ip', now, decodeList, 'warm');
  now -= 30;
  assert.deepEqual(await check(), { fresh: true });
  now += 631;
  fail = true;
  await check();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await check(), { fresh: false });
  now += 61;
  fail = false;
  await check();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await check(), { fresh: true });
  cache.close();
});
test('empty or over-half-shrunk lists preserve LKG and disable negative certainty', async () => {
  for (const size of [0, 1, 2]) {
    let now = 1800000000,
      count = 4;
    const cache = new AgentCache(
      async () =>
        Response.json({
          prefixes: Array.from({ length: count }, (_, i) => ({ ipv4Prefix: `192.0.${i}.0/24` })),
        }),
      50,
      { now: () => now, staleMaxSeconds: 86400 },
    );
    const url = registry[0].ipLists[0].url;
    await cache.load(url, 'ip', now, decodeList, 'warm');
    now += 601;
    count = size;
    await ipMismatch('203.0.113.1', ['GPTBot'], registry, cache, now, new Map());
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await ipMismatch('203.0.113.1', ['GPTBot'], registry, cache, now, new Map()), {
      fresh: size === 2,
    });
    assert.equal(
      (await cache.load(url, 'ip', now, decodeList, 'claim')).rules.length,
      size === 2 ? 2 : 4,
    );
    cache.close();
  }
});

test('non-complete documents may legitimately become empty and revoke old positive ranges', async () => {
  let now = 1800000000,
    count = 4;
  const cache = new AgentCache(
    async () =>
      Response.json({
        prefixes: Array.from({ length: count }, (_, i) => ({ ipv4Prefix: `192.0.${i}.0/24` })),
      }),
    50,
    { now: () => now, staleMaxSeconds: 86400 },
  );
  const url = registry[0].ipLists[0].url;
  await cache.load(url, 'ip', now, decodeList, 'warm');
  now += 601;
  count = 0;
  assert.equal((await cache.load(url, 'ip', now, decodeList, 'forced')).rules.length, 0);
  cache.close();
});
