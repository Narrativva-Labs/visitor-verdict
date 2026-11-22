import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defaultRegistry } from '../dist/index.js';
import { publicKeys } from '../dist/keys.js';
import { parsedDictionary } from '../dist/fields.js';

for (const [name, stem, count] of [
  ['kernel', 'kernel', 1],
  ['cloudflare_browser_run', 'cloudflare-browser-run', 3],
  ['shopify_cloudsurf', 'shopify-cloudsurf', 1],
]) {
  test(`${name}: live Ed25519 directory and every authority-binding proof verify at capture time`, () => {
    const entry = defaultRegistry.find((o) => o.operator === name);
    assert.equal(entry.intermediary, true);
    assert.equal(entry.verifiedByCapture, false);
    const read = (suffix) =>
      readFileSync(
        new URL(`fixtures/${stem}-directory-2026-11-23${suffix}`, import.meta.url),
        'utf8',
      );
    const body = JSON.parse(read('.json'));
    const raw = read('.headers.txt');
    assert.match(raw, /^HTTP\/2 200/);
    assert.doesNotMatch(raw, /set-cookie|x-request-id/i);
    const h = Object.fromEntries(
      raw
        .split('\n')
        .filter((l) => l.includes(': '))
        .map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 2)]),
    );
    assert.equal(h['content-type'], 'application/http-message-signatures-directory+json');
    const capturedAt = Date.parse(h.date) / 1000 + Number(h.age ?? 0);
    assert.ok(Number.isFinite(capturedAt));
    const keys = publicKeys(body, capturedAt);
    assert.equal(keys.size, count);
    assert.equal(body.keys.length, count);
    const sigs = parsedDictionary(h.signature, 'signature').members;
    const inputs = parsedDictionary(h['signature-input'], 'signature-input').members;
    assert.equal(sigs.size, count);
    assert.equal(inputs.size, count);
    const rawInputs = [...h['signature-input'].matchAll(/([\w]+)=(\([^)]*\)[^,]*)/g)];
    assert.equal(rawInputs.length, count);
    for (const [, label, params] of rawInputs) {
      const [components, parameters] = inputs.get(label);
      assert.equal(components.length, 1);
      assert.equal(components[0][0], '@authority');
      assert.deepEqual([...components[0][1]], [['req', true]]);
      assert.equal(parameters.get('tag'), 'http-message-signatures-directory');
      assert.equal(parameters.get('alg'), 'ed25519');
      assert.ok(parameters.get('created') <= capturedAt);
      assert.ok(parameters.get('expires') > capturedAt);
      const key = keys.get(parameters.get('keyid'));
      assert.ok(key, 'proof keyid is the published JWK thumbprint; aliases not needed');
      const signature = Buffer.from(sigs.get(label)[0]);
      const authority = new URL(entry.signatureAgent).host;
      const base = (host) =>
        Buffer.from(`"@authority";req: ${host}\n"@signature-params": ${params}`, 'ascii');
      assert.equal(verify(null, base(authority), key.key, signature), true, label);
      assert.equal(
        verify(null, base('evil.example'), key.key, signature),
        false,
        'wrong authority',
      );
      const corrupted = Buffer.from(signature);
      corrupted[0] ^= 1;
      assert.equal(verify(null, base(authority), key.key, corrupted), false, 'corrupted proof');
    }
    if (name === 'kernel') {
      assert.equal(publicKeys(body, body.keys[0].nbf - 1).size, 0);
      assert.equal(publicKeys(body, body.keys[0].exp).size, 0);
    }
    // These authority proofs contain no Content-Digest: no body binding is claimed.
    assert.equal(h['content-digest'], undefined);
  });
}
