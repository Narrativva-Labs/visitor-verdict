import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { MemoryNonceStore } from '../dist/index.js';
import { makeVerifier, signed, clock } from './helpers.mjs';
test('capacity failure from an independent package copy retains its typed reason', async () => {
  const dir = await mkdtemp(new URL('../.round19-', import.meta.url));
  let v;
  try {
    await cp(new URL('../dist/', import.meta.url), dir, { recursive: true });
    const duplicate = await import(pathToFileURL(join(dir, 'replay.js')));
    const store = new duplicate.MemoryNonceStore(1, () => clock);
    await store.insertIfAbsent('occupied', 100);
    v = makeVerifier({ nonceStore: store });
    await v.warm();
    assert.equal(
      (await v.verify(signed(), { cacheOnly: true })).reason,
      'replay_capacity_exhausted',
    );
  } finally {
    v?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('status reclaims expired entries while retaining the inclusive boundary', async () => {
  let now = 100;
  const s = new MemoryNonceStore(2, () => now, 2);
  await s.insertIfAbsent('one', 10);
  now = 110;
  assert.equal(s.status().entries, 1);
  now = 111;
  assert.equal(s.status().entries, 0);
  assert.equal(s.status().saturation, 0);
});
