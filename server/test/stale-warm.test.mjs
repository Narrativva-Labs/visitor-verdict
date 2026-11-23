import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createVerifier, defaultRegistry } from '../dist/index.js';
import { clock, directoryUrl, jwk, fixture, signed, makeVerifier, operator } from './helpers.mjs';

const captures = fixture('chatgpt-agent-2026-11-20.json').requests;
const directory = fixture('openai-directory-2026-11-20.json');
const openaiUrl = defaultRegistry.find((o) => o.operator === 'openai').directoryUrl;
const host = captures[0].headers.host;
// The captured signatures are valid from created=1795160788 for one hour.
const created = 1795160788;
const capture = () => ({ method: captures[0].method, host, headers: captures[0].headers });
const noStore = { headers: { 'cache-control': 'no-store, no-transform' } };
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('no-store directory: requests during a hanging refresh use stale data, then new data', async () => {
  let now = created + 60;
  let calls = 0;
  let release;
  const v = createVerifier({
    registry: defaultRegistry,
    authorities: [host],
    now: () => now,
    deadlineMs: 300,
    fetchTimeoutMs: 3000,
    fetcher: async (url) => {
      assert.equal(url, openaiUrl);
      if (++calls === 1) return Response.json(directory, noStore);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  assert.equal((await v.verify(capture())).verification, 'signature_valid');
  now += 301;
  const results = await Promise.all([v.verify(capture()), v.verify(capture())]);
  assert.ok(results.every((result) => result.verification === 'signature_valid'));
  assert.equal(calls, 2);
  now += 4;
  assert.equal((await v.verify(capture())).verification, 'signature_valid');
  assert.equal(calls, 2);
  // The refreshed directory shortens the key's exp: new data must be used and honoured.
  const exp = now + 100;
  release(Response.json({ ...directory, keys: [{ ...directory.keys[0], exp }] }, noStore));
  await settle();
  now = exp - 1;
  assert.equal((await v.verify(capture())).verification, 'signature_valid');
  assert.equal(calls, 2);
  now = exp;
  assert.equal((await v.verify(capture())).reason, 'unknown_keyid');
});

test('failed refreshes keep stale data until the hard maximum age, never beyond', async () => {
  let now = clock;
  let calls = 0;
  const v = makeVerifier({
    now: () => now,
    staleMaxSeconds: 3600,
    fetcher: async () => {
      if (++calls === 1) return Response.json({ keys: [jwk] }, noStore);
      throw Error('offline');
    },
  });
  const request = () => signed({ created: now, expires: now + 600 });
  for (const [offset, expectedCalls] of [
    [0, 1],
    [301, 2],
    [330, 2], // cooldown after the failed refresh
    [400, 3],
    [3599, 4],
  ]) {
    now = clock + offset;
    assert.equal((await v.verify(request())).verification, 'signature_valid', String(offset));
    await settle();
    assert.equal(calls, expectedCalls, String(offset));
  }
  now = clock + 3600;
  const expired = await v.verify(request());
  assert.equal(expired.verification, 'none');
  assert.equal(expired.reason, 'directory_unavailable');
  now = clock + 3700;
  assert.equal((await v.verify(request())).verification, 'none');
  assert.equal(calls, 5);
});

test('a key removed in a newer successful fetch no longer verifies', async () => {
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  let now = clock;
  let calls = 0;
  const v = makeVerifier({
    now: () => now,
    fetcher: async () => Response.json({ keys: ++calls === 1 ? [jwk, other] : [other] }, noStore),
  });
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  now += 301;
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  await settle();
  now += 1;
  assert.equal((await v.verify(signed())).reason, 'unknown_keyid');
});

test('staleMaxSeconds 0 disables stale serving; invalid values fail at construction', async () => {
  let now = clock;
  let calls = 0;
  const v = makeVerifier({
    now: () => now,
    staleMaxSeconds: 0,
    deadlineMs: 50,
    fetchTimeoutMs: 500,
    fetcher: async () =>
      ++calls === 1 ? Response.json({ keys: [jwk] }, noStore) : new Promise(() => {}),
  });
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  now += 300;
  assert.equal((await v.verify(signed())).reason, 'deadline_exceeded');
  for (const staleMaxSeconds of [-1, 86401, 1.5, '60'])
    assert.throws(() => makeVerifier({ staleMaxSeconds }), TypeError);
});

test('warm() makes the first request valid within deadlineMs 300 despite 900 ms fetch latency', async () => {
  const options = () => ({
    registry: defaultRegistry,
    authorities: [host],
    now: () => created + 60,
    deadlineMs: 300,
    fetchTimeoutMs: 3000,
    fetcher: async (url) => {
      await delay(900);
      return url === openaiUrl
        ? Response.json(directory, noStore)
        : new Response('missing', { status: 404 });
    },
  });
  const cold = createVerifier(options());
  assert.equal((await cold.verify(capture())).reason, 'deadline_exceeded');
  const warm = createVerifier(options());
  const result = await warm.warm();
  assert.deepEqual(result.ok, [openaiUrl]);
  assert.equal(result.failed.length, defaultRegistry.filter((o) => o.directoryUrl).length - 1);
  assert.equal((await warm.verify(capture())).verification, 'signature_valid');
});

test('warm() reports failures, shares flights, and never rejects', async () => {
  const otherIdentity = 'https://other.example';
  const registry = [
    {
      ...operator,
      ipLists: [
        { name: 'ips', url: 'https://agent.example/ips' },
        { name: 'bad', url: 'https://agent.example/bad' },
      ],
    },
    {
      ...operator,
      operator: 'other',
      signatureAgent: otherIdentity,
      directoryUrl: otherIdentity + '/keys',
      ipLists: [],
    },
  ];
  const calls = new Map();
  const fetcher = async (url) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    await new Promise((resolve) => setImmediate(resolve));
    if (url === directoryUrl) return Response.json({ keys: [jwk] });
    if (url.endsWith('/ips')) return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    throw Error('offline');
  };
  const v = makeVerifier({ registry, fetcher });
  const [a, b] = await Promise.all([v.warm(), v.warm(), v.verify(signed())]);
  assert.deepEqual(a, { ok: [directoryUrl], failed: [otherIdentity + '/keys'] });
  assert.deepEqual(b, a);
  assert.equal(calls.get(directoryUrl), 1);
  assert.equal(calls.get(otherIdentity + '/keys'), 1);
  const feeds = await v.warm({ ipLists: true });
  assert.deepEqual(feeds.ok.sort(), [directoryUrl, 'https://agent.example/ips'].sort());
  assert.deepEqual(
    feeds.failed.sort(),
    [otherIdentity + '/keys', 'https://agent.example/bad'].sort(),
  );
  assert.equal(calls.get(directoryUrl), 1);
  const broken = makeVerifier({
    registry,
    fetcher,
    now: () => {
      throw Error('clock');
    },
  });
  const failed = await broken.warm({ ipLists: true, refreshAhead: true });
  assert.deepEqual(failed.ok, []);
  assert.equal(failed.failed.length, 4);
  broken.close();
});

test('refreshAhead refreshes before soft expiry; close() stops the timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = clock;
  let calls = 0;
  const v = makeVerifier({
    now: () => now,
    fetcher: async () => {
      calls++;
      return Response.json({ keys: [jwk] }, noStore);
    },
  });
  assert.deepEqual(await v.warm({ refreshAhead: true }), { ok: [directoryUrl], failed: [] });
  assert.equal(calls, 1);
  // 300 s retention for no-store; the refresh is due 30 s before soft expiry.
  now = clock + 269;
  t.mock.timers.tick(269_000);
  await settle();
  assert.equal(calls, 1);
  now = clock + 270;
  t.mock.timers.tick(1_000);
  await settle();
  assert.equal(calls, 2);
  now = clock + 540;
  t.mock.timers.tick(270_000);
  await settle();
  assert.equal(calls, 3);
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  assert.equal(calls, 3);
  v.close();
  now = clock + 100_000;
  t.mock.timers.tick(100_000_000);
  await settle();
  assert.equal(calls, 3);
});
