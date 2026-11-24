import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerifier } from '../dist/index.js';
import { AgentCache } from '../dist/cache.js';
import { clock, jwk, operator, signed, makeVerifier } from './helpers.mjs';

test('shared authority batches warm once and remain usable after a sibling closes', async (t) => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ keys: [jwk] });
  };
  const cache = new AgentCache(fetcher, 1000, { now: () => clock });
  t.after(() => cache.close());
  const options = { registry: [operator], authorities: ['example.com'], now: () => clock, fetcher };
  const first = createVerifier(options, cache),
    second = createVerifier(options, cache);
  t.after(() => second.close());
  await Promise.all([first.warm(), second.warm()]);
  assert.equal(calls, 1);
  first.close();
  assert.equal(
    (await second.verify(signed(), { cacheOnly: true })).verification,
    'signature_valid',
  );
  assert.equal(calls, 1);
});

test('replay rejection of one candidate preserves a separately admitted valid peer', async (t) => {
  const verifier = makeVerifier();
  t.after(() => verifier.close());
  await verifier.warm();
  const request = signed({ label: 'old' }),
    peer = signed({ label: 'fresh' });
  request.headers.signature += ', ' + peer.headers.signature;
  request.headers['signature-input'] += ', ' + peer.headers['signature-input'];
  const accepted = [];
  const result = await verifier.verify(request, {
    cacheOnly: true,
    isReplay: (label) => label === 'old',
    acceptSignature: (label) => {
      accepted.push(label);
      return true;
    },
  });
  assert.equal(result.verification, 'signature_valid');
  assert.deepEqual(accepted, ['fresh']);
  assert.equal(result.signatures.find((s) => s.label === 'old').reason, 'replay');
});

test('admission is atomic across simultaneous envelopes and runs only after successful cryptography', async (t) => {
  const verifier = makeVerifier();
  t.after(() => verifier.close());
  await verifier.warm();
  let admitted = false,
    calls = 0;
  const options = {
    cacheOnly: true,
    acceptSignature: () => {
      calls++;
      if (admitted) return false;
      admitted = true;
      return true;
    },
  };
  const results = await Promise.all([
    verifier.verify(signed(), options),
    verifier.verify(signed({ label: 'other' }), options),
  ]);
  assert.deepEqual(results.map((r) => r.verification).sort(), ['none', 'signature_valid']);
  assert.equal(calls, 2);
  const broken = signed();
  const bytes = Buffer.from(broken.headers.signature.split(':')[1], 'base64');
  bytes[0] ^= 1;
  broken.headers.signature = 's=:' + bytes.toString('base64') + ':';
  assert.equal((await verifier.verify(broken, options)).verification, 'signature_invalid');
  assert.equal(calls, 2);
});
