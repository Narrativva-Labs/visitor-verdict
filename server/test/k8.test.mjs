import test from 'node:test';
import assert from 'node:assert/strict';
import { jwk } from './helpers.mjs';
const base = process.env.VV_K8_LIB_BASE || '../dist/';
const { AgentCache } = await import(base + 'cache.js');
const { publicKeys } = await import(base + 'keys.js');
const { createVerifier, visitorLabels } = await import(base + 'index.js');
const now = 1800000000,
  url = 'https://keys.example/jwks';
test('K8 directory restore is atomic even when a later row is corrupt', () => {
  const c = new AgentCache(
    async () => {
      throw Error('no network');
    },
    10,
    { now: () => now, staleMaxSeconds: 86400 },
  );
  try {
    assert.throws(() =>
      c.restoreDirectories(
        {
          v: 1,
          entries: [
            [url, { keys: [jwk] }, now - 10, now + 10000, now + 80000, now - 10, true],
            ['broken'],
          ],
        },
        new Map([[url, publicKeys]]),
      ),
    );
    assert.equal(c.status([[url, 'directory']]).directories.loaded, 0);
  } finally {
    c.close();
  }
});
test('K8 startup revalidates a long-TTL restored directory and replaces revoked keys', async () => {
  let calls = 0;
  const c = new AgentCache(
    async () => {
      calls++;
      return Response.json({ keys: [{ ...jwk, kid: 'new' }] });
    },
    10,
    { now: () => now, staleMaxSeconds: 86400 },
  );
  try {
    c.restoreDirectories(
      {
        v: 1,
        entries: [
          [
            url,
            { keys: [{ ...jwk, kid: 'revoked' }] },
            now - 10,
            now + 10000,
            now + 80000,
            now - 10,
            true,
          ],
        ],
      },
      new Map([[url, publicKeys]]),
    );
    const keys = await c.load(url, 'directory', now, publicKeys, 'warm');
    assert.equal(calls, 1);
    assert.ok(![...keys.values()].some((k) => k.kid === 'revoked'));
  } finally {
    c.close();
  }
});
test('K8 stale failed directories are visible before their hard expiry', async () => {
  let time = now;
  const c = new AgentCache(
    async () => {
      throw Error('offline');
    },
    10,
    { now: () => time, staleMaxSeconds: 86400 },
  );
  try {
    c.restoreDirectories(
      {
        v: 1,
        entries: [[url, { keys: [jwk] }, now - 10, now + 10000, now + 80000, now - 10, true]],
      },
      new Map([[url, publicKeys]]),
    );
    await assert.rejects(c.load(url, 'directory', time, publicKeys, 'warm'));
    assert.equal(c.status([[url, 'directory']]).directories.loaded, 1);
    assert.equal(c.status([[url, 'directory']]).directories.stale, 1);
  } finally {
    c.close();
  }
});
test('K8 untrusted client IP cannot supply positive identity evidence', async () => {
  const v = createVerifier({
    authorities: ['example.com'],
    now: () => now,
    registry: [
      {
        operator: 'openai',
        source: 'https://example.test/docs',
        checked: '2026-11-25',
        verifiedByCapture: false,
        ipLists: [{ name: 'one', url: 'https://example.test/ips', uaTokens: ['GPTBot'] }],
        purposes: {
          ipLists: { one: 'crawler' },
          sources: ['https://example.test/docs'],
          checked: '2026-11-25',
        },
      },
    ],
    fetcher: async () => Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }),
  });
  try {
    await v.warm({ ipLists: true });
    const verdict = await v.verify({
      method: 'GET',
      host: 'example.com',
      clientIp: '192.0.2.9',
      ipTrusted: false,
      headers: { 'user-agent': 'GPTBot' },
    });
    assert.equal(verdict.verification, 'no_signature');
    assert.equal(visitorLabels({ verdict }).vv_type, 'crawler_unverified');
  } finally {
    v.close();
  }
});
