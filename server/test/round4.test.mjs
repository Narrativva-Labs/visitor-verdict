import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerifier, defaultRegistry } from '../dist/index.js';
import { AgentCache, FEED_CACHE_SIZE } from '../dist/cache.js';
import { publicKeys } from '../dist/keys.js';
import { agentTokens } from '../dist/tokens.generated.js';
import { serverAgentTokens } from '../dist/claims.js';
import { clock, jwk, keyid, operator, signed, makeVerifier } from './helpers.mjs';

const allTokens = serverAgentTokens(defaultRegistry);
const request = (token = 'Baiduspider', ip = '192.0.2.1') => ({
  method: 'GET',
  host: 'example.com',
  clientIp: ip,
  headers: { 'user-agent': token },
});
const baseConfig = {
  registry: defaultRegistry,
  authorities: ['example.com'],
  now: () => clock,
  fetcher: async () => Response.json({ prefixes: [] }),
};
const goodResolver = (extra = {}) => ({
  reverse: async () => ['spider.baidu.com'],
  resolve4: async () => ['192.0.2.1'],
  resolve6: async () => [],
  ...extra,
});
const dnsVerifier = (resolver, extra = {}) =>
  createVerifier({ ...baseConfig, reverseDns: { enabled: true, resolver }, ...extra });

for (const [token, url] of [
  ['KimiBot', 'https://www.kimi.ai/policies/kimibot.json'],
  ['Kimi-SearchBot', 'https://www.kimi.ai/policies/kimi-searchbot.json'],
  ['Kimi-User', 'https://www.kimi.ai/policies/kimi-user.json'],
  ['CCBot', 'https://index.commoncrawl.org/ccbot.json'],
  ['SeznamBot', 'https://search.seznam.cz/ipranges/seznambot.json'],
  ['Yeti', 'https://searchadvisor.naver.com/doc/naverbot.json'],
  ['Ads-Naver', 'https://searchadvisor.naver.com/doc/naverbot.json'],
  ['Blueno', 'https://searchadvisor.naver.com/doc/naverbot.json'],
  ['MistralAI-Index', 'https://mistral.ai/mistralai-index-ips.json'],
])
  test('confirmed JSON feed mapping: ' + token, async () => {
    let calls = 0;
    const verifier = createVerifier({
      ...baseConfig,
      fetcher: async (actual) => {
        assert.equal(actual, url);
        calls++;
        return Response.json({
          creationTime: '2026-11-20T00:00:00Z',
          synctoken: 'public-metadata',
          notes: 'synthetic test ranges; not a live capture',
          prefixes: [{ ipv4Prefix: '192.0.2.0/24' }, { ipv6Prefix: '2001:db8::/32' }],
        });
      },
    });
    assert.equal((await verifier.verify(request(token))).verification, 'ip_match');
    assert.equal((await verifier.verify(request(token, '2001:db8::1'))).verification, 'ip_match');
    assert.equal(calls, 1);
  });
test('Kagi static ranges come from operator documentation and make no fetch', async () => {
  const v = createVerifier({ ...baseConfig, fetcher: async () => assert.fail('no feed fetch') });
  for (const ip of ['216.18.205.234', '35.212.27.76', '104.254.65.50', '209.151.156.194'])
    assert.equal((await v.verify(request('Kagibot', ip))).verification, 'ip_match');
  assert.equal((await v.verify(request('Kagibot', '192.0.2.1'))).verification, 'no_signature');
});
test('server-only claims remain unverified and browser token list remains a subset', async () => {
  const v = createVerifier(baseConfig);
  const tokens = [
    'Bytespider',
    'TikTokSpider',
    'DeepSeekBot',
    'ChatGLM-Spider',
    'YisouSpider',
    '360Spider',
    'PetalBot',
    'Baiduspider',
    'Sogou',
    'YandexBot',
    'YandexAdditional',
    'Kagibot',
    'YouBot',
    'Diffbot',
    'Timpibot',
    'Amzn-User',
    'AmazonAdBot',
  ];
  assert.ok(agentTokens.every((token) => allTokens.includes(token)));
  for (const token of tokens) {
    assert.ok(allTokens.includes(token));
    const result = await v.verify(request(token));
    assert.ok(result.claimed.uaTokens.includes(token));
    assert.equal(result.verification, 'no_signature');
  }
  assert.ok((await v.verify(request('Sogou web spider/4.0'))).claimed.uaTokens.includes('Sogou'));
});
test('rDNS is disabled by default and does not query non-bot claims or confirmed list matches', async () => {
  let calls = 0;
  const resolver = goodResolver({
    reverse: async () => {
      calls++;
      return ['spider.baidu.com'];
    },
  });
  const disabled = createVerifier({ ...baseConfig, reverseDns: { enabled: false, resolver } });
  assert.equal((await disabled.verify(request())).verification, 'no_signature');
  const enabled = dnsVerifier(resolver, {
    fetcher: async () => Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }),
  });
  await enabled.verify(request('ordinary browser'));
  await enabled.verify(request('Applebot'));
  assert.equal(calls, 0);
});
test('rDNS forward-confirmed match, case and trailing dot; caches positive results without outputting IP/PTR', async () => {
  let calls = 0;
  const v = dnsVerifier(
    goodResolver({
      reverse: async () => {
        calls++;
        return ['Spider.Baidu.Com.'];
      },
    }),
  );
  for (let i = 0; i < 3; i++) {
    const result = await v.verify(request());
    assert.equal(result.verification, 'ip_match');
    assert.equal(result.reason, 'reverse_dns_match');
    assert.equal(result.verified.method, 'rdns');
    assert.equal(result.verified.operator, 'baidu');
    assert.ok(!JSON.stringify(result).includes('192.0.2.1'));
    assert.ok(!JSON.stringify(result).includes('spider.baidu.com'));
  }
  assert.equal(calls, 1);
});
for (const ptr of [
  'evilbaidu.com',
  'baidu.com.evil.net',
  'spider.baidu.com.evil.net',
  '-bad.baidu.com',
  'bad_name.baidu.com',
])
  test('reject DNS suffix spoofing: ' + ptr, async () => {
    let forward = 0;
    const v = dnsVerifier(
      goodResolver({
        reverse: async () => [ptr],
        resolve4: async () => {
          forward++;
          return ['192.0.2.1'];
        },
      }),
    );
    assert.equal((await v.verify(request())).verification, 'no_signature');
    assert.equal(forward, 0);
  });
test('PTR with forward mismatch is a negative cache hit', async () => {
  let calls = 0;
  const v = dnsVerifier(
    goodResolver({
      reverse: async () => {
        calls++;
        return ['spider.baidu.com'];
      },
      resolve4: async () => ['192.0.2.2'],
    }),
  );
  for (let i = 0; i < 2; i++)
    assert.equal((await v.verify(request())).verification, 'no_signature');
  assert.equal(calls, 1);
});
test('same IP with a different claim cannot reuse another operator proof', async () => {
  const v = dnsVerifier(goodResolver());
  assert.equal((await v.verify(request())).verified.operator, 'baidu');
  assert.equal((await v.verify(request('PetalBot'))).verification, 'no_signature');
});
test('IPv6 equivalent forms and mapped IPv4 normalize for DNS cache and forward matching', async () => {
  let calls = 0;
  const v = dnsVerifier(
    goodResolver({
      reverse: async () => {
        calls++;
        return ['spider.baidu.jp'];
      },
      resolve4: async () => [],
      resolve6: async () => ['2001:db8:0:0::1'],
    }),
  );
  assert.equal((await v.verify(request('Baiduspider', '2001:db8::1'))).verification, 'ip_match');
  assert.equal((await v.verify(request('Baiduspider', '2001:0db8::1'))).verification, 'ip_match');
  assert.equal(calls, 1);
  const mapped = dnsVerifier(goodResolver());
  assert.equal(
    (await mapped.verify(request('Baiduspider', '::ffff:c000:201'))).verification,
    'ip_match',
  );
});
test('DNS timeout and overall deadline are bounded; unresolved work cannot exceed concurrency cap', async () => {
  let calls = 0;
  const resolver = goodResolver({
    reverse: async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const v = dnsVerifier(resolver, { reverseDns: { enabled: true, resolver, timeoutMs: 15 } });
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => v.verify(request('Baiduspider', '192.0.2.' + (i + 1)))),
  );
  assert.ok(results.every((result) => result.reason === 'reverse_dns_unavailable'));
  assert.equal(calls, 4);
  await v.verify(request('Baiduspider', '192.0.2.50'));
  assert.equal(calls, 4);
  const deadline = dnsVerifier(resolver, {
    deadlineMs: 10,
    reverseDns: { enabled: true, resolver, timeoutMs: 30 },
  });
  assert.equal((await deadline.verify(request())).reason, 'deadline_exceeded');
});
test('DNS same-IP concurrent requests single-flight; LRU eviction and hard TTL expiry', async () => {
  let now = clock;
  let calls = 0;
  const resolver = goodResolver({
    reverse: async () => {
      calls++;
      return [];
    },
  });
  const v = dnsVerifier(resolver, {
    now: () => now,
    reverseDns: { enabled: true, resolver, ttlSec: 10, cacheSize: 2 },
  });
  await Promise.all(Array.from({ length: 10 }, () => v.verify(request())));
  assert.equal(calls, 1);
  await v.verify(request('Baiduspider', '192.0.2.2'));
  await v.verify(request());
  await v.verify(request('Baiduspider', '192.0.2.3'));
  await v.verify(request('Baiduspider', '192.0.2.2'));
  assert.equal(calls, 4);
  now += 11;
  await v.verify(request('Baiduspider', '192.0.2.2'));
  assert.equal(calls, 5);
});
test('rDNS never overrides invalid WBA signatures', async () => {
  const resolver = goodResolver();
  const v = makeVerifier({
    registry: [
      {
        ...operator,
        extraUaTokens: ['Baiduspider'],
        reverseDns: [
          {
            uaTokens: ['Baiduspider'],
            suffixes: ['baidu.com'],
            source: 'test fixture',
            checked: '2026-11-20',
          },
        ],
      },
    ],
    reverseDns: { enabled: true, resolver },
  });
  const r = signed();
  r.method = 'POST';
  r.clientIp = '192.0.2.1';
  r.headers['user-agent'] = 'Baiduspider';
  const result = await v.verify(r);
  assert.equal(result.verification, 'signature_invalid');
  assert.equal(result.rdns.operator, 'test');
});
test('feed cache has bounded LRU capacity and evicts only completed entries', async () => {
  let calls = 0;
  const cache = new AgentCache(async () => {
    calls++;
    return Response.json({ prefixes: [] });
  }, 100);
  for (let i = 0; i <= FEED_CACHE_SIZE; i++)
    await cache.load('https://agent.example/' + i, 'ip', clock, (data) => data);
  await cache.load('https://agent.example/0', 'ip', clock, (data) => data);
  assert.equal(calls, FEED_CACHE_SIZE + 2);
  let busyCalls = 0;
  const busy = new AgentCache(async () => {
    busyCalls++;
    return new Promise(() => {});
  }, 15);
  const results = await Promise.allSettled(
    Array.from({ length: FEED_CACHE_SIZE + 1 }, (_, i) =>
      busy.load('https://agent.example/' + i, 'ip', clock, (data) => data),
    ),
  );
  assert.equal(busyCalls, FEED_CACHE_SIZE);
  assert.ok(results.every((result) => result.status === 'rejected'));
});
for (const value of [
  { enabled: true, cacheSize: 0 },
  { enabled: true, timeoutMs: 0 },
  { enabled: true, ttlSec: 3601 },
  { enabled: true, resolver: {} },
])
  test('invalid DNS config fails at construction: ' + JSON.stringify(value), () => {
    assert.throws(() => createVerifier({ ...baseConfig, reverseDns: value }), TypeError);
  });
test('interop: lifetime limit is configurable and indeterminate, inverted windows remain invalid', async () => {
  const r = signed({ expires: clock + 86401 });
  const def = makeVerifier();
  assert.equal((await def.verify(r)).verification, 'none');
  assert.equal((await def.verify(r)).reason, 'invalid_validity_window');
  const wider = makeVerifier({ maxLifetimeSeconds: 86401 });
  assert.equal((await wider.verify(r)).verification, 'signature_valid');
});
test('interop: key aliases are opt-in, only enabled for Google by default', async () => {
  assert.deepEqual(
    defaultRegistry.filter((op) => op.allowKidAlias).map((op) => op.operator),
    ['google'],
  );
  const keys = { keys: [{ ...jwk, kid: 'custom' }] };
  assert.ok(publicKeys(keys).has(keyid));
  assert.equal(publicKeys(keys).has('custom'), false);
  const r = signed({ kid: 'custom' });
  const strict = makeVerifier({ fetcher: async () => Response.json(keys) });
  assert.equal((await strict.verify(r)).reason, 'unknown_keyid');
  const compatible = makeVerifier({
    registry: [{ ...operator, allowKidAlias: true }],
    fetcher: async () => Response.json(keys),
  });
  assert.equal((await compatible.verify(r)).verified.keyidForm, 'kid');
});
test('interop: noncanonical base64 pad bits decode to the same valid signature', async () => {
  const r = signed();
  const base64 = r.headers.signature.slice(3, -1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const index = base64.length - 3;
  const changed =
    base64.slice(0, index) +
    alphabet[alphabet.indexOf(base64[index]) | 1] +
    base64.slice(index + 1);
  r.headers.signature = 's=:' + changed + ':';
  assert.equal((await makeVerifier().verify(r)).verification, 'signature_valid');
});
test('interop: ambiguous Signature-Agent and duplicate Signature headers remain indeterminate', async () => {
  const r = signed();
  r.headers['signature-agent'] = ['s="https://agent.example"', 's="https://agent.example"'];
  assert.equal((await makeVerifier().verify(r)).reason, 'ambiguous_signature_agent');
  assert.equal((await makeVerifier().verify(r)).verification, 'none');
  const duplicate = signed();
  duplicate.headers.signature += ', ' + duplicate.headers.signature;
  assert.equal((await makeVerifier().verify(duplicate)).verification, 'none');
});
for (const [target, query] of [
  ['/path', '?'],
  ['/path?', '?'],
  ['/path?x=%2f&y=1', '?x=%2f&y=1'],
])
  test('interop: @query and @scheme: ' + target, async () => {
    const r = signed({
      components: ['"@authority"', '"signature-agent"', '"@scheme"', '"@query"'],
      values: { '"@scheme"': 'https', '"@query"': query },
    });
    r.target = target;
    assert.equal((await makeVerifier().verify(r)).verification, 'signature_valid');
  });
test('interop: one signature may cover two keyed Signature-Agent members when its own member is covered', async () => {
  const agent = 's="https://agent.example", t="https://other.example"';
  const r = signed({
    agent,
    components: ['"@authority"', '"signature-agent";key="s"', '"signature-agent";key="t"'],
    values: {
      '"signature-agent";key="s"': '"https://agent.example"',
      '"signature-agent";key="t"': '"https://other.example"',
    },
  });
  assert.equal((await makeVerifier().verify(r)).verification, 'signature_valid');
});
test('Google common crawler claim cannot verify against user-controlled googleusercontent PTR', async () => {
  const v = dnsVerifier(
    goodResolver({ reverse: async () => ['customer.gae.googleusercontent.com'] }),
  );
  assert.equal((await v.verify(request('Google-CloudVertexBot'))).verification, 'no_signature');
});
