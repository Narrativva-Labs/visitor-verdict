import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  createVerifier,
  defaultRegistry,
  requiredHeaderNames,
  coveredHeaderNames,
} from '../dist/index.js';
import { serverAgentTokens } from '../dist/claims.js';
import { agentTokens } from '../dist/tokens.generated.js';
import { parseSail } from '../dist/sail.js';
import { dictionary } from '../dist/fields.js';
import { clock, jwk, signed, makeVerifier, verifier, operator, identity } from './helpers.mjs';

const ips = [{ ...operator, ipLists: [{ name: 'ips', url: 'https://agent.example/ips' }] }];
const sail = readFileSync(
  new URL('fixtures/anthropic-sail-2026-11-20.toml', import.meta.url),
  'utf8',
);

test('N1/int2-1: ten valid requests do not wait for a hanging forced refresh', async () => {
  let calls = 0;
  let startedRefresh;
  const started = new Promise((resolve) => {
    startedRefresh = resolve;
  });
  let release;
  const v = makeVerifier({
    deadlineMs: 100,
    fetchTimeoutMs: 500,
    fetcher: async () => {
      if (++calls === 1) return Response.json({ keys: [jwk] });
      startedRefresh();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  const attack = v.verify(signed({ kid: 'unknown' }));
  await started;
  const results = await Promise.all(Array.from({ length: 10 }, () => v.verify(signed())));
  assert.ok(results.every((result) => result.verification === 'signature_valid'));
  assert.equal(calls, 2);
  release(Response.json({ keys: [jwk] }));
  assert.equal((await attack).reason, 'unknown_keyid');
});
test('N2: context caps reject overlong inputs before scanning or copying them', async () => {
  const huge = 'M'.repeat(64 * 1024 * 1024);
  for (const [key, reason] of [
    ['method', 'insufficient_context'],
    ['host', 'unknown_authority'],
    ['target', 'insufficient_context'],
    ['clientIp', 'insufficient_context'],
  ]) {
    const before = performance.now();
    const result = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      headers: {},
      [key]: huge,
    });
    assert.equal(result.reason, reason);
    assert.ok(performance.now() - before < 100);
  }
});
test('int2-2: uncovered target with lone percent, OPTIONS * and //path cannot affect result', async () => {
  for (const target of ['/?utm_campaign=sleva-50%', '*', '//path']) {
    const r = signed();
    r.target = target;
    assert.equal((await verifier.verify(r)).verification, 'signature_valid');
    assert.equal(
      (await verifier.verify({ method: 'GET', host: 'example.com', headers: {}, target }))
        .verification,
      'no_signature',
    );
  }
});
test('int2-3: required headers always include collector basics; covered helper exposes only TypeError', () => {
  const base = ['user-agent', 'signature', 'signature-input', 'signature-agent'];
  for (const input of [undefined, null, 17, '', 'malformed', 'x'.repeat(20000)])
    assert.deepEqual(requiredHeaderNames(input), base);
  assert.deepEqual(requiredHeaderNames('s=("@authority" "x_trace_id")'), [...base, 'x_trace_id']);
  assert.throws(() => coveredHeaderNames('bad=='), TypeError);
});
test('int2-5: relevant feed failure is unavailable, successful nonmatch is no_signature; match wins', async () => {
  const r = { method: 'GET', host: 'example.com', clientIp: '192.0.2.1', headers: {} };
  const fail = makeVerifier({
    registry: ips,
    fetcher: async () => {
      throw Error();
    },
  });
  assert.equal((await fail.verify(r)).reason, 'ip_evidence_unavailable');
  const miss = makeVerifier({
    registry: ips,
    fetcher: async () => Response.json({ prefixes: [{ ipv4Prefix: '192.0.3.0/24' }] }),
  });
  assert.equal((await miss.verify(r)).verification, 'no_signature');
  const registry = [
    {
      ...operator,
      ipLists: [...ips[0].ipLists, { name: 'other', url: 'https://agent.example/other' }],
    },
  ];
  const match = makeVerifier({
    registry,
    fetcher: async (url) => {
      if (url.endsWith('/other')) throw Error();
      return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    },
  });
  assert.equal((await match.verify(r)).verification, 'ip_match');
});
for (const param of ['type=directory', 'type="directory"'])
  test('std2-1: -01 forbids ALL member params: ' + param, async () => {
    const r = signed({
      agent: `s="${identity}";${param}`,
      components: ['"@authority"', '"signature-agent";key="s"'],
      values: { '"signature-agent";key="s"': `"${identity}";${param}` },
    });
    assert.equal((await verifier.verify(r)).reason, 'untrusted_signature_agent');
  });
test('std2-2: binary-wrapped Latin-1 NBSP is one byte, not UTF-8', async () => {
  const raw = 'a\u00a0b';
  assert.equal(Buffer.from(raw, 'latin1').toString('base64'), 'YaBi');
  const r = signed({
    components: ['"@authority"', '"signature-agent"', '"x-note";bs'],
    values: { '"x-note";bs': ':YaBi:' },
  });
  r.headers['x-note'] = raw;
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  r.headers['x-note'] = 'a\u00c2\u00a0b';
  assert.equal((await verifier.verify(r)).reason, 'crypto_mismatch');
  r.headers['x-note'] = 'a中b';
  assert.equal((await verifier.verify(r)).reason, 'malformed_header');
});
test('std2-3: other tags and absent tags are ignored per-label, including Decimal metadata', async () => {
  for (const tag of ['proxy-auth', undefined]) {
    const r = signed({ tag });
    r.headers['signature-input'] = r.headers['signature-input'].replace(
      'created=' + clock,
      'created=' + clock + '.0',
    );
    if (tag === undefined)
      r.headers['signature-input'] = r.headers['signature-input'].replace(/;tag="[^"]*"/, '');
    const v = await verifier.verify(r);
    assert.equal(v.verification, 'no_signature');
    assert.equal(v.signatures[0].reason, 'ignored_non_wba');
    r.clientIp = '192.0.2.1';
    const match = makeVerifier({
      registry: ips,
      fetcher: async () => Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }),
    });
    assert.equal((await match.verify(r)).verification, 'ip_match');
  }
  const r = signed({ kid: 'missing' });
  r.headers['signature-input'] += ', proxy=("@method");created=1.0;tag="proxy-auth"';
  r.headers.signature += ', proxy=:YQ==:';
  const result = await verifier.verify(r);
  assert.equal(result.reason, 'unknown_keyid');
});
test('std2-4: //path and canonical absolute HTTPS targets preserve raw path octets', async () => {
  const r = signed({
    components: ['"@authority"', '"signature-agent"', '"@path"'],
    values: { '"@path"': '//path/%2e' },
  });
  r.target = '//path/%2e';
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  for (const [target, uri] of [
    ['HTTPS://Example.COM:443/foo', 'https://example.com/foo'],
    ['https://example.com', 'https://example.com/'],
  ]) {
    const r = signed({
      components: ['"@target-uri"', '"signature-agent"'],
      values: { '"@target-uri"': uri },
    });
    r.target = target;
    assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  }
});
test('std2-5: metadata types scoped to Signature-Input; Display String backslashes are literal', async () => {
  const r = signed({
    agent: `s="${identity}", other="https://other.example";expires="tomorrow"`,
    components: ['"@authority"', '"signature-agent";key="s"'],
    values: { '"signature-agent";key="s"': JSON.stringify(identity) },
  });
  r.headers['signature-input'] += ', other=("@method");note=%"foo\\";created=1.0;ctx=:YQ:';
  r.headers.signature += ', other=:YQ==:';
  const v = await verifier.verify(r);
  assert.equal(v.verification, 'signature_valid');
  assert.equal(v.signatures[1].reason, 'ignored_non_wba');
  assert.doesNotThrow(() => dictionary('s="https://other.example";created="anything"'));
});
for (const name of ['x_trace_id', 'cf.ray', '1-test', '!header'])
  test('std2-6: signed field uses RFC 9110 tchar: ' + name, async () => {
    const id = JSON.stringify(name);
    assert.equal(
      (
        await verifier.verify(
          signed({
            components: ['"@authority"', '"signature-agent"', id],
            values: { [id]: 'data' },
          }),
        )
      ).verification,
      'signature_valid',
    );
  });
test('SAIL snapshot parses, maps service ranges and verifies Claude-Agent', async () => {
  const parsed = parseSail(sail);
  assert.equal(parsed.expiresAfter, 3600);
  assert.equal(parsed.services.get('Claude-Agent').length, 10);
  let calls = 0;
  let now = clock;
  const v = createVerifier({
    registry: defaultRegistry,
    authorities: ['example.com'],
    now: () => now,
    fetcher: async (url) => {
      assert.equal(url, 'https://claude.com/.well-known/sail');
      calls++;
      return new Response(sail, {
        headers: { 'content-type': 'application/sail+toml', 'cache-control': 'max-age=300' },
      });
    },
  });
  const r = {
    method: 'GET',
    host: 'example.com',
    headers: { 'user-agent': 'Claude-Agent' },
    clientIp: '136.71.21.147',
  };
  for (const offset of [0, 300, 3599, 3600]) {
    now = clock + offset;
    assert.equal((await v.verify(r)).verification, 'ip_match');
  }
  assert.equal(calls, 2);
});
for (const mutate of [
  (s) => s + '\nunknown=1',
  (s) => s.replace('exclusive     = true', 'exclusive     = "true"'),
  (s) => s.replace('3600  #', '0  #'),
  (s) => s.replace('"136.71.21.147"', '"not an IP"'),
  (s) => s.replace('exhaustive  = true', 'bad_field = true'),
  (s) => s.replace('prefix_sets = ["agentic-browser-use"]', 'prefix_sets = ["missing"]'),
  (s) => s + '\nschema="duplicate"',
  (s) => s.replace('2026-11-14', '2026-02-31'),
  () => 'x'.repeat(65537),
])
  test('SAIL strict parser rejects malformed/unsupported schema: ' + mutate.toString(), () => {
    assert.throws(() => parseSail(mutate(sail)), /invalid_sail/);
  });
test('browser tokens remain a subset; server-only bingbot token enables Microsoft IP evidence', async () => {
  const all = serverAgentTokens(defaultRegistry);
  assert.ok(agentTokens.every((token) => all.includes(token)));
  assert.ok(all.includes('bingbot'));
  assert.ok(!agentTokens.includes('bingbot'));
  for (const [token, url, op] of [
    ['bingbot', 'https://www.bing.com/toolbox/bingbot.json', 'microsoft'],
    ['Applebot', 'https://search.developer.apple.com/applebot.json', 'apple'],
    ['MistralAI-User', 'https://mistral.ai/mistralai-user-ips.json', 'mistral'],
  ]) {
    const v = createVerifier({
      registry: defaultRegistry,
      authorities: ['example.com'],
      fetcher: async (actual) => {
        assert.equal(actual, url);
        return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
      },
    });
    const result = await v.verify({
      method: 'GET',
      host: 'example.com',
      clientIp: '192.0.2.1',
      headers: { 'user-agent': token },
    });
    assert.equal(result.verification, 'ip_match');
    assert.equal(result.ip.operator, op);
    assert.ok(result.claimed.uaTokens.includes(token));
  }
});
test('non-WBA identity does not suppress independent IP match', async () => {
  const v = makeVerifier({
    registry: ips,
    fetcher: async () => Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }),
  });
  const r = signed({ tag: 'proxy-auth', agent: '"https://untrusted.example"' });
  r.clientIp = '192.0.2.1';
  assert.equal((await v.verify(r)).verification, 'ip_match');
});
test('missing base64 padding in unrelated RFC signatures does not poison WBA peers', async () => {
  const r = signed();
  r.headers['signature-input'] += ', other=("@method");tag="proxy-auth"';
  r.headers.signature += ', other=:YQ:';
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
});
for (const [expires, retained] of [
  [1, 300],
  [999999, 86400],
])
  test('SAIL expires_after retention is bounded: ' + expires, async () => {
    let now = clock;
    let calls = 0;
    const v = createVerifier({
      registry: defaultRegistry,
      authorities: ['example.com'],
      now: () => now,
      fetcher: async () => {
        calls++;
        return new Response(sail.replace('expires_after = 3600', 'expires_after = ' + expires), {
          headers: { 'content-type': 'application/sail+toml' },
        });
      },
    });
    const r = {
      method: 'GET',
      host: 'example.com',
      headers: { 'user-agent': 'Claude-Agent' },
      clientIp: '136.71.21.147',
    };
    assert.equal((await v.verify(r)).verification, 'ip_match');
    now += retained - 1;
    assert.equal((await v.verify(r)).verification, 'ip_match');
    assert.equal(calls, 1);
    now++;
    assert.equal((await v.verify(r)).verification, 'ip_match');
    assert.equal(calls, 2);
  });
test('SAIL comment parsing and malformed array/reference rejection', () => {
  assert.doesNotThrow(() =>
    parseSail(sail.replaceAll('agentic-browser-use', 'agentic#browser-use')),
  );
  for (const text of [
    'unknown=1\n' + sail,
    sail.replace('ipv6_prefixes = []', 'ipv6_prefixes = ["192.0.2.1"]'),
    sail + '\n[[unexpected]]',
    sail.replace('ipv6_prefixes = []', 'ipv6_prefixes = ['),
    sail.replace(
      'name          = "agentic-browser-use"',
      'name = "agentic-browser-use"\nname = "duplicate"',
    ),
  ])
    assert.throws(() => parseSail(text));
});
test('std2-5: Date extension before valid peer does not consume its delimiter', async () => {
  const r = signed({
    agent: `other="https://other.example";expires=@1795164388, s="${identity}"`,
    components: ['"@authority"', '"signature-agent";key="s"'],
    values: { '"signature-agent";key="s"': JSON.stringify(identity) },
  });
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  const parsed = dictionary('s=vvdate0;date=@1795164388, other=@1795164389');
  assert.equal(parsed.get('s')[0].toString(), 'vvdate0');
  assert.ok(parsed.get('s')[1].get('date') instanceof Date);
  assert.ok(parsed.get('other')[0] instanceof Date);
});
