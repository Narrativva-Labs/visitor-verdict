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
    'agent_unverified',
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
