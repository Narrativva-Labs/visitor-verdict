import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerifier, defaultRegistry } from '../dist/index.js';
import { purposeFor } from '../dist/purpose.js';

const request = (token) => ({
  method: 'GET',
  host: 'example.com',
  clientIp: '192.0.2.1',
  headers: { 'user-agent': token },
});
function verifier(operator, ptr, fetcher = async () => Response.json({ prefixes: [] })) {
  return createVerifier({
    registry: defaultRegistry.filter((entry) => entry.operator === operator),
    authorities: ['example.com'],
    fetcher,
    reverseDns: {
      enabled: true,
      resolver: {
        reverse: async () => [ptr],
        resolve4: async () => ['192.0.2.1'],
        resolve6: async () => [],
      },
    },
  });
}
for (const ptr of [
  'x.bc.googleusercontent.com',
  'x.gae.googleusercontent.com',
  'google.com.evil.example',
  'evilgoogle.com',
])
  test('Google claims cannot verify customer cloud DNS: ' + ptr, async () => {
    for (const token of ['Google-Agent', 'Gemini-Deep-Research']) {
      const result = await verifier('google', ptr).verify(request(token));
      assert.equal(result.verified, undefined);
      assert.equal(result.agent_purpose, 'unknown');
    }
  });
for (const list of ['user-triggered-agents', 'user-triggered-fetchers-google'])
  test('observed Gemini research token verifies against managed Google feed: ' + list, async () => {
    const v = verifier('google', 'unrelated.example', async (url) =>
      Response.json({
        prefixes: url.endsWith('/' + list + '.json') ? [{ ipv4Prefix: '192.0.2.1/32' }] : [],
      }),
    );
    const result = await v.verify(request('Gemini-Deep-Research'));
    assert.equal(result.ip.list, list);
    assert.equal(result.verification, 'ip_match');
    assert.equal(result.agent_purpose, 'user_directed');
  });
for (const [op, token, ptr, expected] of [
  ['google', 'Gemini-Deep-Research', 'google-proxy.google.com', 'user_directed'],
  ['google', 'GoogleOther', 'crawl.googlebot.com', 'crawler'],
  ['google', 'Google-InspectionTool', 'crawl.googlebot.com', 'crawler'],
  ['google', 'Google-Read-Aloud', 'google-proxy.google.com', 'user_directed'],
  ['naver', 'Ads-Naver', 'crawl.naver.com', 'crawler'],
  ['baidu', 'Baiduspider', 'crawl.baidu.com', 'crawler'],
  ['petal', 'PetalBot', 'crawl.petalsearch.com', 'crawler'],
  ['yandex', 'YandexBot', 'crawl.yandex.com', 'crawler'],
  ['yandex', 'YandexAdditional', 'crawl.yandex.ru', 'crawler'],
  ['amazonads', 'AmazonAdBot', 'crawl.amazonadbot.com', 'crawler'],
])
  test('DNS purpose follows matched rule including cached evidence: ' + token, async () => {
    const v = verifier(op, ptr);
    for (let i = 0; i < 2; i++) {
      const result = await v.verify(request(token));
      assert.equal(result.verified?.method, 'rdns');
      assert.equal(result.agent_purpose, expected);
    }
  });
test('DNS purpose ignores a different rule of the same operator', async () => {
  const v = verifier('google', 'crawl.googlebot.com');
  const result = await v.verify(request('Googlebot Gemini-Deep-Research'));
  assert.equal(result.agent_purpose, 'crawler');
});
test('unmapped eligible shared-feed tokens make the purpose ambiguous', async () => {
  const v = verifier('naver', 'crawl.naver.com');
  assert.equal((await v.verify(request('Yeti Blueno'))).agent_purpose, 'unknown');
});
test('IP purpose ignores tokens outside the matching list', () => {
  const registry = [
    {
      operator: 'test',
      ipLists: [{ name: 'one', uaTokens: ['Crawler'] }],
      purposes: { uaTokens: { Crawler: 'crawler', User: 'user_directed' } },
    },
  ];
  assert.equal(
    purposeFor(
      {
        verification: 'ip_match',
        verified: { operator: 'test', method: 'ip' },
        ip: { operator: 'test', list: 'one' },
        claimed: { uaTokens: ['Crawler', 'User'] },
      },
      registry,
    ),
    'crawler',
  );
});
for (const token of [
  'meta-externalagent',
  'meta-externalfetcher',
  'meta-webindexer',
  'MistralAI-Training',
])
  test('documented claims without a verification method remain unverified: ' + token, async () => {
    const v = createVerifier({
      registry: defaultRegistry,
      authorities: ['example.com'],
      fetcher: async () => assert.fail('claim-only must not fetch'),
    });
    const result = await v.verify(request(token));
    assert.ok(result.claimed.uaTokens.includes(token));
    assert.equal(result.verified, undefined);
    assert.equal(result.agent_purpose, 'unknown');
  });
test('all default registry entries have dated evidence with a source', () => {
  for (const entry of defaultRegistry) {
    assert.ok(entry.evidence.length);
    for (const fact of entry.evidence) {
      assert.ok(['documented', 'observed', 'inferred'].includes(fact.level));
      assert.match(fact.source, /^https:\/\//);
      assert.match(fact.checked, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
  const google = defaultRegistry.find((entry) => entry.operator === 'google');
  assert.ok(
    google.evidence.some(
      (e) => e.level === 'observed' && e.uaTokens?.includes('Gemini-Deep-Research'),
    ),
  );
  assert.ok(google.reverseDns.every((rule) => !rule.suffixes.includes('googleusercontent.com')));
});

test('IP shared-feed purpose includes eligible tokens with unknown roles', async () => {
  const v = verifier('naver', 'unrelated.example', async () =>
    Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.1/32' }] }),
  );
  assert.equal((await v.verify(request('Yeti Blueno'))).agent_purpose, 'unknown');
  assert.equal((await v.verify(request('Ads-Naver'))).agent_purpose, 'crawler');
});
test('registry evidence validation rejects invalid levels, sources and tokens', () => {
  const entry = defaultRegistry.find((e) => e.operator === 'meta');
  for (const invalid of [
    { level: 'trusted' },
    { source: 'http://example.com' },
    { uaTokens: [123] },
  ]) {
    assert.throws(
      () =>
        createVerifier({
          registry: [{ ...entry, evidence: [{ ...entry.evidence[0], ...invalid }] }],
          authorities: ['example.com'],
        }),
      TypeError,
    );
  }
});
