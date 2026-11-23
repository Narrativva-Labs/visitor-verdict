import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import { MemoryNonceStore } from '../dist/index.js';
import { clock, identity, keyid, pair, makeVerifier } from './helpers.mjs';

test('zero replay lifetime is rejected without reserving the key', async () => {
  const store = new MemoryNonceStore(1, () => clock);
  await assert.rejects(store.insertIfAbsent('a', 0), RangeError);
  assert.equal(await store.insertIfAbsent('a', 1), true);
});

test('distinct nonces from the same signing key are admitted independently', async () => {
  const v = makeVerifier({ nonceStore: new MemoryNonceStore(10, () => clock) });
  function request(nonce) {
    const agent = JSON.stringify(identity);
    const params = `("@authority" "@method" "signature-agent");created=${clock};expires=${clock + 3600};keyid=${JSON.stringify(keyid)};tag="web-bot-auth";nonce=${JSON.stringify(nonce)}`;
    const base = `"@authority": example.com\n"@method": GET\n"signature-agent": ${agent}\n"@signature-params": ${params}`;
    return {
      method: 'GET',
      host: 'example.com',
      target: '/',
      headers: {
        'signature-agent': agent,
        'signature-input': 's=' + params,
        signature: 's=:' + sign(null, Buffer.from(base), pair.privateKey).toString('base64') + ':',
      },
    };
  }
  try {
    await v.warm();
    for (const nonce of ['first', 'second']) {
      assert.equal(
        (await v.verify(request(nonce), { cacheOnly: true })).verification,
        'signature_valid',
      );
      assert.equal((await v.verify(request(nonce), { cacheOnly: true })).reason, 'replay');
    }
  } finally {
    v.close();
  }
});
