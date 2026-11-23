import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentCache, ttlFromHeaders } from '../dist/cache.js';
import { selectOutcome } from '../dist/policy.js';
import { matchesIp } from '../dist/ip.js';
import { defaultRegistry } from '../dist/index.js';
import { clock, jwk, signed, makeVerifier, operator } from './helpers.mjs';

for (const [cc, age, ttl] of [
  [null, null, 300],
  ['no-store', null, 300],
  ['no-cache', '9000', 300],
  ['max-age=0, must-revalidate', '900', 300],
  ['max-age=600', '100', 500],
  ['max-age=600', '900', 300],
  ['max-age=999999', '0', 86400],
  ['max-age="500"', null, 500],
])
  test('ttlFromHeaders table: ' + cc + '/' + age, () => {
    const h = new Headers();
    if (cc !== null) h.set('cache-control', cc);
    if (age !== null) h.set('age', age);
    assert.equal(ttlFromHeaders(h), ttl);
  });
for (const [results, presented, ip, expected] of [
  [[], false, undefined, 'no_signature'],
  [[], false, { operator: 'test', list: 'ips' }, 'ip_match'],
  [['none'], true, undefined, 'none'],
  [['signature_invalid', 'none'], true, { operator: 'test' }, 'signature_invalid'],
  [['none', 'signature_invalid', 'signature_valid'], true, undefined, 'signature_valid'],
  [[], true, undefined, 'none'],
])
  test('selectOutcome table: ' + results + '/' + presented, () => {
    const signatures = results.map((result, i) => ({ label: String(i), result, reason: result }));
    assert.equal(selectOutcome(signatures, presented, ip).verification, expected);
  });
test('IP v4/v6/mapped boundaries and malformed input', () => {
  const prefixes = [{ ipv4Prefix: '192.0.2.0/24' }, { ipv6Prefix: '2001:db8::/32' }];
  for (const ip of [
    '192.0.2.0',
    '192.0.2.255',
    '::ffff:192.0.2.1',
    '::ffff:c000:2ff',
    '2001:db8::',
  ])
    assert.equal(matchesIp(ip, prefixes), true, ip);
  for (const ip of ['192.0.3.1', '2001:db9::', 'bad', '192.0.2.1/24'])
    assert.equal(matchesIp(ip, prefixes), false, ip);
  for (const prefix of ['192.0.2.1/33', '192.0.2.1/-1', '2001:db8::/129', '192.0.2.1/24/1'])
    assert.equal(matchesIp('192.0.2.1', [{ ipv4Prefix: prefix }]), false);
  assert.equal(matchesIp('192.0.2.1', [{ ipv6Prefix: '::ffff:c000:200/120' }]), true);
});
test('IP feed above 64 KiB is accepted, compiled ONCE and reused', async () => {
  const registry = [{ ...operator, ipLists: [{ name: 'ips', url: 'https://agent.example/ips' }] }];
  let calls = 0;
  const data = { prefixes: [{ ipv4Prefix: '192.0.2.0/24' }], padding: 'x'.repeat(73871) };
  const v = makeVerifier({
    registry,
    fetcher: async () => {
      calls++;
      return Response.json(data);
    },
  });
  const request = { method: 'GET', host: 'example.com', clientIp: '::ffff:192.0.2.1', headers: {} };
  for (let i = 0; i < 10; i++) assert.equal((await v.verify(request)).verification, 'ip_match');
  assert.equal(calls, 1);
  const cache = new AgentCache(async () => Response.json(data), 100);
  let compiled = 0;
  const decode = () => {
    compiled++;
    return {};
  };
  const a = await cache.load('https://agent.example/ips', 'ip', clock, decode);
  const b = await cache.load('https://agent.example/ips', 'ip', clock + 1, decode);
  assert.equal(a, b);
  assert.equal(compiled, 1);
});
test('IP 1 MiB and 8192 prefix limits; failed lists never yield ip_match', async () => {
  for (const response of [
    () => new Response('x'.repeat(1048577)),
    () => Response.json({ prefixes: Array(8193).fill({ ipv4Prefix: '192.0.2.0/24' }) }),
    () => {
      throw Error();
    },
  ]) {
    const v = makeVerifier({
      registry: [{ ...operator, ipLists: [{ name: 'ips', url: 'https://agent.example/ips' }] }],
      fetcher: async () => response(),
    });
    const result = await v.verify({
      method: 'GET',
      host: 'example.com',
      clientIp: '192.0.2.1',
      headers: {},
    });
    assert.equal(result.verification, 'none');
    assert.equal(result.reason, 'ip_evidence_unavailable');
  }
});
test('invalid signature retains precedence over IP evidence', async () => {
  const v = makeVerifier({
    registry: [{ ...operator, ipLists: [{ name: 'ips', url: 'https://agent.example/ips' }] }],
    fetcher: async (url) =>
      Response.json(
        url.endsWith('/ips') ? { prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] } : { keys: [jwk] },
      ),
  });
  const r = signed();
  r.clientIp = '192.0.2.1';
  r.method = 'POST';
  const result = await v.verify(r);
  assert.equal(result.verification, 'signature_invalid');
  assert.equal(result.ip.operator, 'test');
  assert.ok(!JSON.stringify(result).includes(r.clientIp));
});
test('IP lists start in parallel; overall deadline does not wait serially', async () => {
  let calls = 0;
  const registry = [
    {
      ...operator,
      ipLists: Array.from({ length: 5 }, (_, i) => ({
        name: 'ips' + i,
        url: 'https://agent.example/ips' + i,
      })),
    },
  ];
  const v = makeVerifier({
    registry,
    deadlineMs: 20,
    fetchTimeoutMs: 50,
    fetcher: async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const result = await v.verify({
    method: 'GET',
    host: 'example.com',
    clientIp: '192.0.2.1',
    headers: {},
  });
  assert.equal(result.reason, 'deadline_exceeded');
  assert.equal(calls, 5);
});
test('cache failures cool down; hard expiry never uses stale data', async () => {
  let calls = 0;
  const cache = new AgentCache(async () => {
    calls++;
    if (calls > 1) throw Error();
    return Response.json({});
  }, 100);
  await cache.load('https://agent.example/keys', 'directory', clock, (data) => data);
  await assert.rejects(
    cache.load('https://agent.example/keys', 'directory', clock + 300, (data) => data),
  );
  await assert.rejects(
    cache.load('https://agent.example/keys', 'directory', clock + 301, (data) => data),
  );
  assert.equal(calls, 2);
});
test('std-3/6: registry maps Vertex to common-crawlers and includes DuckDuckGo', () => {
  const google = defaultRegistry.find((o) => o.operator === 'google');
  const vertex = google.ipLists.filter((list) => list.uaTokens.includes('Google-CloudVertexBot'));
  assert.equal(vertex.length, 1);
  assert.ok(vertex[0].url.endsWith('/common-crawlers.json'));
  assert.equal(
    defaultRegistry.find((o) => o.operator === 'perplexity').source,
    'https://docs.perplexity.ai/docs/resources/perplexity-crawlers',
  );
  assert.equal(
    defaultRegistry.find((o) => o.operator === 'duckduckgo').directoryUrl,
    'https://assistbot.duckduckgo.com/.well-known/http-message-signatures-directory',
  );
});
test('cold concurrent signatures share a single directory refresh', async () => {
  let calls = 0;
  const v = makeVerifier({
    fetcher: async () => {
      calls++;
      await new Promise((resolve) => setImmediate(resolve));
      return Response.json({ keys: [jwk] });
    },
  });
  const results = await Promise.all(Array.from({ length: 30 }, () => v.verify(signed())));
  assert.ok(results.every((v) => v.verification === 'signature_valid'));
  assert.equal(calls, 1);
});
