import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/index.js';
import { makeVerifier, signed, clock, fixture } from './helpers.mjs';
test('real captures have distinct signatures and nonces per request', () => {
  const r = fixture('chatgpt-agent-2026-11-20.json').requests;
  assert.equal(r.length, 32);
  assert.equal(new Set(r.map((x) => x.headers.signature)).size, 32);
  assert.equal(
    new Set(r.map((x) => /nonce="([^"]+)"/.exec(x.headers['signature-input'])[1])).size,
    32,
  );
});
test('bounded local replay store works atomically in cacheOnly through inclusive skew', async () => {
  let now = clock;
  const store = new api.MemoryNonceStore(2, () => now);
  const v = makeVerifier({ nonceStore: store, now: () => now });
  await v.warm();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => v.verify(signed(), { cacheOnly: true })),
  );
  assert.equal(results.filter((x) => x.verification === 'signature_valid').length, 1);
  assert.equal(results.filter((x) => x.reason === 'replay').length, 11);
  assert.equal(results.find((x) => x.verified).verified.expiresAt, clock + 3600);
  now = clock + 3630;
  assert.equal((await v.verify(signed(), { cacheOnly: true })).reason, 'replay');
  now++;
  assert.equal((await v.verify(signed(), { cacheOnly: true })).reason, 'expired');
  v.close();
});
test('full store fails closed without evicting unexpired replay history', async () => {
  let now = 0;
  const store = new api.MemoryNonceStore(1, () => now);
  assert.equal(await store.insertIfAbsent('a', 10), true);
  await assert.rejects(store.insertIfAbsent('b', 10));
  now = 10;
  assert.equal(await store.insertIfAbsent('a', 1), false);
  now++;
  assert.equal(await store.insertIfAbsent('b', 10), true);
});
