import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifier, defaultRegistry, visitorLabels } from '../dist/index.js';
const openai = defaultRegistry.find((o) => o.operator === 'openai');
function setup(options = {}) {
  let time = 1800000000,
    calls = 0,
    blocked = false;
  const verifier = createVerifier({
    registry: [openai],
    authorities: ['example.com'],
    now: () => time,
    flagSpoofedClaims: true,
    fetchTimeoutMs: 30,
    fetcher: async (url) => {
      calls++;
      if (blocked) return new Promise(() => {});
      if (url.includes('directory')) return Response.json({ keys: [] });
      return Response.json(
        {
          prefixes: [
            { ipv4Prefix: url.includes('gptbot.json') ? '198.51.100.0/24' : '192.0.2.0/24' },
          ],
        },
        { headers: { 'cache-control': 'max-age=3600' } },
      );
    },
    ...options,
  });
  const request = {
    method: 'GET',
    host: 'example.com',
    clientIp: '203.0.113.7',
    headers: { 'user-agent': 'ChatGPT-User/1.0' },
  };
  return {
    verifier,
    request,
    advance: (n) => (time += n),
    calls: () => calls,
    block: () => (blocked = true),
  };
}
test('OpenAI mismatch, IP trust, labels, operator union and opt-out', async () => {
  const { verifier, request } = setup();
  await verifier.warm({ ipLists: true });
  const v = await verifier.verify(request);
  assert.equal(v.verification, 'ip_mismatch');
  assert.equal(v.verified, undefined);
  assert.deepEqual(visitorLabels({ verdict: v }), {
    vv_type: 'bot_spoofed',
    vv_detail: 'none|ip_mismatch|unknown|ua_token|-|-',
  });
  assert.equal(visitorLabels({ verdict: v, browserClass: 'automated' }).vv_type, 'bot_spoofed');
  const untrusted = await verifier.verify({ ...request, ipTrusted: false });
  assert.equal(untrusted.verification, 'ip_mismatch');
  assert.equal(
    visitorLabels({ verdict: untrusted, browserClass: 'automated' }).vv_type,
    'bot_automation',
  );
  assert.equal(
    (await verifier.verify({ ...request, clientIp: '192.0.2.2' })).verification,
    'ip_match',
  );
  assert.equal(
    (await verifier.verify({ ...request, clientIp: '198.51.100.2' })).verification,
    'no_signature',
  );
  for (const key of ['signature', 'signature-input'])
    assert.notEqual(
      (await verifier.verify({ ...request, headers: { ...request.headers, [key]: '' } }))
        .verification,
      'ip_mismatch',
    );
  assert.notEqual(
    (await verifier.verify({ ...request, headers: { 'signature-agent': '"https://chatgpt.com"' } }))
      .verification,
    'ip_mismatch',
  );
  const off = setup({ flagSpoofedClaims: false });
  await off.verifier.warm({ ipLists: true });
  assert.equal((await off.verifier.verify(off.request)).verification, 'no_signature');
  verifier.close();
  off.verifier.close();
});
test('stale negative evidence refreshes at ten minutes without waiting', async () => {
  const s = setup();
  await s.verifier.warm({ ipLists: true });
  const before = s.calls();
  s.advance(601);
  s.block();
  assert.equal(
    (await s.verifier.verify(s.request, { cacheOnly: true })).verification,
    'ip_mismatch',
  );
  assert.equal(s.calls(), before + 4);
  await s.verifier.verify(s.request, { cacheOnly: true });
  assert.equal(s.calls(), before + 4);
  s.advance(86401);
  assert.notEqual(
    (await s.verifier.verify(s.request, { cacheOnly: true })).verification,
    'ip_mismatch',
  );
  s.verifier.close();
});
test('missing operator feeds or no completeness cannot assert mismatch', async () => {
  const s = setup();
  assert.notEqual(
    (await s.verifier.verify(s.request, { cacheOnly: true })).verification,
    'ip_mismatch',
  );
  const other = setup({
    registry: [{ ...openai, ipLists: openai.ipLists.map((l) => ({ ...l, complete: false })) }],
  });
  await other.verifier.warm({ ipLists: true });
  assert.notEqual((await other.verifier.verify(other.request)).verification, 'ip_mismatch');
  s.verifier.close();
  other.verifier.close();
});

test('two-hour freshness boundary, failed refresh and automation precedence', async () => {
  const s = setup();
  await s.verifier.warm({ ipLists: true });
  s.block();
  s.advance(7200);
  const boundary = await s.verifier.verify(s.request, { cacheOnly: true });
  assert.equal(boundary.ipListsFresh, true);
  assert.equal(visitorLabels({ verdict: boundary }).vv_type, 'bot_spoofed');
  // The outstanding refresh fails; cache reads and failures cannot renew evidence.
  await new Promise((resolve) => setTimeout(resolve, 45));
  s.advance(1);
  const stale = await s.verifier.verify(s.request, { cacheOnly: true });
  assert.equal(stale.verification, 'ip_mismatch');
  assert.equal(stale.ipListsFresh, false);
  assert.equal(visitorLabels({ verdict: stale }).vv_type, 'agent_unverified');
  assert.equal(
    visitorLabels({ verdict: stale, browserClass: 'automated' }).vv_type,
    'bot_automation',
  );
  for (const ipListsFresh of [undefined, false]) {
    const missing = { ...boundary, ipListsFresh };
    assert.equal(visitorLabels({ verdict: missing }).vv_type, 'agent_unverified');
    assert.equal(
      visitorLabels({ verdict: missing, browserClass: 'automated' }).vv_type,
      'bot_automation',
    );
  }
  s.verifier.close();
});

test('exclusively non-WBA signatures allow mismatch and positive IP; mixed or malformed do not', async () => {
  const s = setup();
  await s.verifier.warm({ ipLists: true });
  const headers = {
    ...s.request.headers,
    signature: 'other=:AAAA:',
    'signature-input': 'other=("@method");tag="other-protocol"',
  };
  const ignored = await s.verifier.verify({ ...s.request, headers });
  assert.equal(ignored.verification, 'ip_mismatch');
  assert.equal(ignored.ipListsFresh, true);
  assert.equal(ignored.signatures[0].reason, 'ignored_non_wba');
  assert.equal(
    (await s.verifier.verify({ ...s.request, headers, clientIp: '192.0.2.1' })).verification,
    'ip_match',
  );
  const mixed = {
    ...headers,
    signature: headers.signature + ', wba=:AAAA:',
    'signature-input': headers['signature-input'] + ', wba=("@method");tag="web-bot-auth"',
  };
  assert.notEqual(
    (await s.verifier.verify({ ...s.request, headers: mixed })).verification,
    'ip_mismatch',
  );
  assert.notEqual(
    (
      await s.verifier.verify({
        ...s.request,
        headers: { ...headers, 'signature-input': 'malformed' },
      })
    ).verification,
    'ip_mismatch',
  );
  s.verifier.close();
});

test('freshness uses successful source completion per feed, never cache reuse or an absent timestamp', async () => {
  const { AgentCache } = await import('../dist/cache.js');
  const { ipMismatch, decodeList } = await import('../dist/ip.js');
  let now = 1800000000,
    resolve;
  const registry = [{ ...openai, ipLists: openai.ipLists.slice(0, 1) }];
  const url = registry[0].ipLists[0].url;
  const cache = new AgentCache(() => new Promise((r) => (resolve = r)), 1000, {
    now: () => now,
    staleMaxSeconds: 86400,
  });
  const work = cache.load(url, 'ip', now, decodeList, 'warm');
  now += 20;
  resolve(Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }));
  await work;
  assert.equal(cache.successfulRefreshAt(url, 'ip'), now);
  now += 7190;
  assert.deepEqual(
    await ipMismatch('203.0.113.1', ['ChatGPT-User'], registry, cache, now, new Map()),
    { fresh: true },
  );
  // Reading the cached block must not advance successful-refresh time.
  assert.equal(cache.successfulRefreshAt(url, 'ip'), now - 7190);
  const missingTimeCache = {
    load: async () => decodeList({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }),
    successfulRefreshAt: () => undefined,
  };
  assert.deepEqual(
    await ipMismatch('203.0.113.1', ['ChatGPT-User'], registry, missingTimeCache, now, new Map()),
    { fresh: false },
  );
  const partial = {
    ...missingTimeCache,
    load: async (u, _kind, _now, _decode, _mode, trace) => {
      trace.successfulRefreshAt = u === url ? now : now - 7201;
      return decodeList({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    },
  };
  assert.deepEqual(
    await ipMismatch('203.0.113.1', ['ChatGPT-User'], [openai], partial, now, new Map()),
    { fresh: false },
  );
  cache.close();
});

test('missing source completion clock remains uncertain and starts background refresh', async () => {
  const { AgentCache } = await import('../dist/cache.js');
  const { ipMismatch, decodeList } = await import('../dist/ip.js');
  let now = 1800000000,
    resolve,
    calls = 0;
  const cache = new AgentCache(
    () => {
      calls++;
      return new Promise((r) => (resolve = r));
    },
    50,
    { now: () => now, staleMaxSeconds: 86400 },
  );
  const registry = [{ ...openai, ipLists: openai.ipLists.slice(0, 1) }];
  const url = registry[0].ipLists[0].url;
  const work = cache.load(url, 'ip', now, decodeList, 'warm');
  now = NaN;
  resolve(Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }));
  await work;
  now = 1800000001;
  assert.equal(cache.successfulRefreshAt(url, 'ip'), undefined);
  assert.deepEqual(
    await ipMismatch('203.0.113.1', ['ChatGPT-User'], registry, cache, now, new Map()),
    { fresh: false },
  );
  assert.equal(calls, 2);
  resolve(Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }));
  cache.close();
});
