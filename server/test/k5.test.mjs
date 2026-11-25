import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentCache } from '../dist/cache.js';
import { decodeSail } from '../dist/ip.js';
import { createVerifier, visitorLabels } from '../dist/index.js';
const url = 'https://example.test/sail',
  start = 1800000000;
function sail(services) {
  return (
    `schema = "draft-kelley-webbotauth-sail-00"\nmodified = 2026-11-24T00:00:00Z\nexpires_after = 86400\n` +
    Object.entries(services)
      .map(
        ([name, count]) =>
          `[[prefix_sets]]\nname = "${name}"\nexclusive = true\nipv4_prefixes = [${Array.from({ length: count }, (_, i) => `"192.0.${i}.0/24"`).join(', ')}]\nipv6_prefixes = []\n[[services]]\nname = "${name}"\nexhaustive = true\nprefix_sets = ["${name}"]\n`,
      )
      .join('')
  );
}
test('K5 empty complete SAIL is a failed warm, unloaded and retries after cooldown', async () => {
  let now = start,
    calls = 0,
    count = 0;
  const fetcher = async () => {
    calls++;
    return new Response(sail({ bad: count }), {
      headers: { 'content-type': 'application/sail+toml' },
    });
  };
  const cache = new AgentCache(fetcher, 50, { now: () => now });
  cache.requireComplete(url, 'bad');
  try {
    await assert.rejects(cache.load(url, 'sail', now, decodeSail, 'warm'), { reason: 'shrink' });
    assert.equal(cache.status([[url, 'sail']]).ipLists.loaded, 0);
    now += 61;
    count = 1;
    const data = await cache.load(url, 'sail', now, decodeSail, 'request');
    assert.equal(data.get('bad').prefixCount, 1);
    assert.equal(calls, 2);
  } finally {
    cache.close();
  }
  count = 0;
  const verifier = createVerifier({
    authorities: ['example.com'],
    registry: [
      {
        operator: 'openai',
        verifiedByCapture: false,
        source: 'https://example.test/docs',
        checked: '2026-11-25',
        ipLists: [
          {
            name: 'bad',
            source: 'https://example.test/docs',
            checked: '2026-11-25',
            url,
            format: 'sail',
            service: 'bad',
            uaTokens: ['GPTBot'],
            complete: true,
          },
        ],
      },
    ],
    fetcher,
    now: () => now,
  });
  try {
    const result = await verifier.warm({ ipLists: true });
    assert.equal(result.failed.length, 1);
    assert.equal(result.ok.length, 0);
  } finally {
    verifier.close();
  }
});
test('K5 long TTL SAIL shrink does not defer retry/confirmation for 24h', async () => {
  let now = start,
    count = 4,
    calls = 0;
  const cache = new AgentCache(
    async () => {
      calls++;
      return new Response(sail({ bad: count, good: 1 }), {
        headers: { 'content-type': 'application/sail+toml' },
      });
    },
    50,
    { now: () => now, staleMaxSeconds: 86400 },
  );
  cache.requireComplete(url, 'bad');
  cache.requireComplete(url, 'good');
  try {
    await cache.load(url, 'sail', now, decodeSail, 'warm');
    now += 601;
    count = 1;
    await cache.load(url, 'sail', now, decodeSail, 'ahead');
    now += 601;
    await cache.load(url, 'sail', now, decodeSail, 'request');
    await new Promise(setImmediate);
    assert.equal(calls, 3);
    now += 6600;
    const data = await cache.load(url, 'sail', now, decodeSail, 'ahead');
    assert.equal(data.get('bad').prefixCount, 1);
    assert.equal(cache.serviceStatus(url, 'good', now).ok, true);
  } finally {
    cache.close();
  }
});
test('K5 removal of unconfigured non-complete SAIL service is a healthy update', async () => {
  let now = start,
    services = { good: 1, optional: 1 };
  const events = [];
  const cache = new AgentCache(
    async () =>
      new Response(sail(services), { headers: { 'content-type': 'application/sail+toml' } }),
    50,
    { now: () => now, onRefresh: (e) => events.push(e) },
  );
  cache.requireComplete(url, 'good');
  try {
    await cache.load(url, 'sail', now, decodeSail, 'warm');
    now += 601;
    services = { good: 1 };
    const result = await cache.load(url, 'sail', now, decodeSail, 'forced');
    assert.equal(result.has('optional'), false);
    assert.equal(events.at(-1).ok, true);
    assert.equal(events.at(-1).reason, undefined);
  } finally {
    cache.close();
  }
});
test('K5 malformed non-WBA cannot promote IP and invalid agent claim contains no raw header', async () => {
  const v = createVerifier({
    authorities: ['example.com'],
    registry: [
      {
        operator: 'openai',
        verifiedByCapture: false,
        source: 'https://example.test/docs',
        checked: '2026-11-25',
        signatureAgent: 'https://chatgpt.com',
        directoryUrl: url + '/keys',
        ipLists: [
          {
            name: 'one',
            source: 'https://example.test/docs',
            checked: '2026-11-25',
            url,
            uaTokens: ['GPTBot'],
          },
        ],
      },
    ],
    fetcher: async () => Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }),
    now: () => start,
    reverseDns: { enabled: false },
  });
  try {
    await v.warm({ ipLists: true });
    const verdict = await v.verify({
      host: 'example.com',
      method: 'GET',
      secure: true,
      clientIp: '192.0.2.1',
      headers: { 'user-agent': 'GPTBot', signature: 'other=:AAAA:', 'signature-input': 'other=1' },
    });
    assert.equal(visitorLabels({ verdict }).vv_type, 'agent_unverified');
    const raw = 's=' + 'attacker'.repeat(100);
    const other = await v.verify({
      host: 'example.com',
      method: 'GET',
      secure: true,
      headers: { 'signature-agent': raw },
    });
    assert.deepEqual(other.claimed.signatureAgents, ['(non-string)']);
    assert.ok(!JSON.stringify(other).includes(raw));
  } finally {
    v.close();
  }
});
