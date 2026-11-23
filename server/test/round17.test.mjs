import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryNonceStore } from '../dist/index.js';
import { selectOutcome } from '../dist/policy.js';
import { makeVerifier, signed, clock } from './helpers.mjs';

test('replay wins over prepended invalid candidate, while a fresh valid proof wins', async () => {
  const v = makeVerifier({ nonceStore: new MemoryNonceStore() });
  await v.warm();
  const req = signed();
  await v.verify(req);
  const headers = {
    ...req.headers,
    'signature-input': 'bad=();tag="web-bot-auth", ' + req.headers['signature-input'],
    signature: 'bad=:AA==:, ' + req.headers.signature,
  };
  assert.equal((await v.verify({ ...req, headers })).reason, 'replay');
  v.close();
});
test('capacity failure has a typed verifier reason', async () => {
  const store = new MemoryNonceStore(1, () => clock);
  await store.insertIfAbsent('occupied', 100);
  const v = makeVerifier({ nonceStore: store });
  assert.equal((await v.verify(signed())).reason, 'replay_capacity_exhausted');
  v.close();
});
test('operator budget reserves room for another operator and exposes exhaustion', async () => {
  const s = new MemoryNonceStore(4, () => clock, 2);
  await s.insertIfAbsent('a', 100, { scope: 'one' });
  await s.insertIfAbsent('b', 100, { scope: 'one' });
  await assert.rejects(s.insertIfAbsent('c', 100, { scope: 'one' }), /replay_capacity_exhausted/);
  assert.equal(await s.insertIfAbsent('d', 100, { scope: 'two' }), true);
  assert.equal(s.status().exhaustions, 1);
});
test('absolute fractional deadline survives separate store clock and inclusive skew', async () => {
  let storeTime = clock - 100;
  const s = new MemoryNonceStore(10, () => storeTime);
  const v = makeVerifier({ nonceStore: s, now: () => clock + 0.9 });
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  storeTime = clock + 3630;
  assert.equal(await s.insertIfAbsent('other', 100), true);
  assert.equal((await v.verify(signed())).reason, 'replay');
  v.close();
});
test('duplicated module store supports cacheOnly via the shared brand', async () => {
  const duplicate = await import('../dist/replay.js?duplicate');
  const v = makeVerifier({ nonceStore: new duplicate.MemoryNonceStore() });
  await v.warm();
  assert.equal((await v.verify(signed(), { cacheOnly: true })).verification, 'signature_valid');
  v.close();
});
test('external store sees fixed-length digests and relabeling still replays', async () => {
  const keys = new Set();
  const v = makeVerifier({
    nonceStore: {
      async insertIfAbsent(key) {
        assert.match(key, /^[a-f0-9]{64}$/);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      },
    },
  });
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  assert.equal((await v.verify(signed({ label: 'other' }))).reason, 'replay');
  v.close();
});
test('live insertion and replay do not scan map entries', async () => {
  const s = new MemoryNonceStore(100);
  await s.insertIfAbsent('one', 100);
  const iterator = Map.prototype[Symbol.iterator];
  Map.prototype[Symbol.iterator] = function () {
    throw new Error('full map scan');
  };
  try {
    assert.equal(await s.insertIfAbsent('one', 100), false);
    assert.equal(await s.insertIfAbsent('two', 100), true);
  } finally {
    Map.prototype[Symbol.iterator] = iterator;
  }
});
test('expiry heap clears out-of-order deadlines without evicting live history', async () => {
  let now = 0;
  const s = new MemoryNonceStore(4, () => now, 4);
  await s.insertIfAbsent('long', 100);
  await s.insertIfAbsent('short', 10);
  await s.insertIfAbsent('middle', 50);
  now = 11;
  assert.equal(await s.insertIfAbsent('short', 10), true);
  assert.equal(await s.insertIfAbsent('long', 10), false);
  now = 51;
  assert.equal(await s.insertIfAbsent('middle', 1), true);
  assert.equal(await s.insertIfAbsent('long', 10), false);
});

test('valid candidate takes precedence over replay regardless of order', () => {
  const valid = { label: 'v', result: 'signature_valid', reason: 'verified' };
  const replay = { label: 'r', result: 'signature_invalid', reason: 'replay' };
  for (const candidates of [
    [valid, replay],
    [replay, valid],
  ])
    assert.equal(selectOutcome(candidates, true).verification, 'signature_valid');
});
test('local nonce insertion does not allocate the external store timeout', async () => {
  const v = makeVerifier({ nonceStore: new MemoryNonceStore(), fetchTimeoutMs: 137 });
  await v.warm();
  const original = globalThis.setTimeout;
  let nonceTimers = 0;
  globalThis.setTimeout = function (callback, delay, ...args) {
    if (delay === 137) nonceTimers++;
    return original(callback, delay, ...args);
  };
  try {
    assert.equal((await v.verify(signed(), { cacheOnly: true })).verification, 'signature_valid');
    assert.equal(nonceTimers, 0);
  } finally {
    globalThis.setTimeout = original;
    v.close();
  }
});
