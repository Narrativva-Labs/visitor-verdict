import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import {
  clock,
  identity,
  keyid,
  pair,
  operator,
  fetcher,
  makeVerifier,
  signed,
} from './helpers.mjs';

// Own signer so the nonce can be chosen (helpers.signed hard-codes nonce="synthetic").
function signedNonce(nonce) {
  const params = `("@authority" "@method" "signature-agent");created=${clock};expires=${clock + 3600};keyid=${JSON.stringify(keyid)};tag="web-bot-auth";nonce=${JSON.stringify(nonce)}`;
  const agent = JSON.stringify(identity);
  const base = `"@authority": example.com\n"@method": GET\n"signature-agent": ${agent}\n"@signature-params": ${params}`;
  return {
    method: 'GET',
    host: 'example.com',
    target: '/b',
    headers: {
      'signature-agent': agent,
      'signature-input': 's=' + params,
      signature: 's=:' + sign(null, Buffer.from(base), pair.privateKey).toString('base64') + ':',
    },
  };
}

test('empty nonce with a nonce store is missing_nonce, never valid', async () => {
  const seen = new Set();
  const nonceStore = {
    async insertIfAbsent(k) {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    },
  };
  const v = makeVerifier({ nonceStore });
  assert.equal((await v.verify(signedNonce('fresh'))).verification, 'signature_valid'); // signer sanity
  const verdict = await v.verify(signedNonce(''));
  assert.equal(verdict.reason, 'missing_nonce');
  assert.equal(verdict.verification, 'signature_invalid');
});

test('"@authority" with a parameter does not satisfy the required coverage', async () => {
  const verdict = await makeVerifier().verify(
    signed({
      components: ['"@authority";req', '"@method"', '"signature-agent"'],
      values: { '"@authority";req': 'example.com' },
    }),
  );
  assert.equal(verdict.reason, 'required_component_missing');
  assert.equal(verdict.verification, 'signature_invalid');
});

test('cache-only during the post-failure cooldown still reports cache_miss', async () => {
  let calls = 0;
  const v = makeVerifier({
    fetcher: async () => {
      calls++;
      throw new Error('down');
    },
  });
  const first = await v.verify(signed(), { cacheOnly: true });
  assert.equal(first.reason, 'cache_miss');
  await new Promise((r) => setTimeout(r, 20)); // background fetch fails -> cooldown
  assert.equal(calls, 1);
  const second = await v.verify(signed(), { cacheOnly: true });
  assert.equal(second.reason, 'cache_miss');
  assert.equal(second.verification, 'none');
  assert.equal(calls, 1); // no new fetch inside the cooldown
});
