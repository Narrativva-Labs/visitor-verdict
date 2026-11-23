// RFC example licence: fixtures/IETF-NOTICE.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createVerifier } from '../dist/index.js';
import { dictionary, headers, signatureBase } from '../dist/fields.js';
const read = (f) => JSON.parse(readFileSync(new URL(`fixtures/${f}`, import.meta.url)));
const jwk = { kty: 'OKP', crv: 'Ed25519', x: 'JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs' };
test('RFC 9421 Appendix B.2.6 canonicalisation + B.1.4 Ed25519 key', () => {
  const input = {
    method: 'POST',
    authority: 'example.com',
    target: 'https://example.com/foo?param=Value&Pet=dog',
    headers: {
      date: 'Tue, 20 Apr 2021 02:07:55 GMT',
      'content-type': 'application/json',
      'content-length': '18',
    },
  };
  const params =
    '("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"';
  const actual = signatureBase(
    input,
    headers(input.headers),
    dictionary('sig-b26=' + params).get('sig-b26'),
  );
  const expected =
    '"date": Tue, 20 Apr 2021 02:07:55 GMT\n"@method": POST\n"@path": /foo\n"@authority": example.com\n"content-type": application/json\n"content-length": 18\n"@signature-params": ' +
    params;
  assert.equal(actual, expected);
  const signature = Buffer.from(
    'wqcAqbmYJ2ji2glfAMaRy4gruYYnx2nEFN2HN6jrnDnQCK1u02Gb04v9EDgwUPiu4A0w6vuQv5lIp5WPpBKRCw==',
    'base64',
  );
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  assert.ok(verify(null, Buffer.from(actual), key, signature));
  assert.equal(verify(null, Buffer.from(actual + 'x'), key, signature), false);
});
let vectorNow = 1735689600;
const registry = [
  {
    operator: 'fixture',
    signatureAgent: 'https://signature-agent.test',
    directoryUrl: 'https://signature-agent.test/keys',
    verifiedByCapture: false,
    source: 'Cloudflare fixtures',
    checked: '2026-11-20',
    ipLists: [],
  },
];
const verifier = createVerifier({
  registry,
  authorities: ['example.com', 'signature-agent.test'],
  now: () => vectorNow,
  fetcher: async () => Response.json({ keys: [jwk] }),
});
for (const version of ['v1', 'v2'])
  for (const [index, vector] of read(`web_bot_auth_architecture_${version}.json`).entries()) {
    test(`Cloudflare architecture ${version} vector ${index + 1}: documented policy`, async () => {
      const input = {
        method: 'GET',
        authority: new URL(vector.target_url).host,
        target: vector.target_url,
        headers: {
          signature: vector.signature,
          'signature-input': vector.signature_input,
          ...(vector.signature_agent ? { 'signature-agent': vector.signature_agent } : {}),
        },
      };
      const params = dictionary(vector.signature_input).get(vector.label);
      // Independent crypto check on Ed25519 vectors even when WBA policy rejects the fixture.
      if (vector.key.kty === 'OKP') {
        const base = signatureBase(input, headers(input.headers), params);
        assert.ok(
          verify(
            null,
            Buffer.from(base),
            createPublicKey({ key: jwk, format: 'jwk' }),
            Buffer.from(dictionary(vector.signature).get(vector.label)[0]),
          ),
        );
      }
      vectorNow = vector.created_ms / 1000;
      const v = await verifier.verify({ ...input, host: input.authority });
      const expected =
        version === 'v2'
          ? 'invalid_validity_window'
          : vector.key.kty === 'RSA'
            ? 'unsupported_algorithm'
            : !vector.signature_agent
              ? 'untrusted_signature_agent'
              : 'verified';
      assert.equal(v.reason, expected);
    });
  }
test('Cloudflare v2 Ed25519 agent2/sig2 verifies as relabeled with a test-only lifetime override', async () => {
  const vector = read('web_bot_auth_architecture_v2.json')[3];
  const params = dictionary(vector.signature_input).get(vector.label)[1];
  const verifier = createVerifier({
    registry,
    authorities: ['example.com'],
    now: () => vector.created_ms / 1000,
    maxLifetimeSeconds: params.get('expires') - params.get('created'),
    fetcher: async () => Response.json({ keys: [jwk] }),
  });
  const verdict = await verifier.verify({
    method: 'GET',
    host: 'example.com',
    target: vector.target_url,
    headers: {
      signature: vector.signature,
      'signature-input': vector.signature_input,
      'signature-agent': vector.signature_agent,
    },
  });
  assert.equal(verdict.verification, 'signature_valid');
  assert.equal(verdict.verified.operator, 'fixture');
  assert.equal(verdict.verified.attribution, 'relabeled');
  assert.equal(verdict.signatures[0].label, 'sig2');
  assert.equal(verdict.signatures[0].attribution, 'relabeled');
});
test('Cloudflare directory response fixture: digest and crypto, excluded from request policy', async () => {
  const [v] = read('web_bot_auth_directory_response_v1.json');
  const expected =
    'sha-256=:' + createHash('sha256').update(v.response.body).digest('base64') + ':';
  assert.equal(v.response.headers['content-digest'], expected);
  const sig = Buffer.from(dictionary(v.response.headers.Signature).get('binding0')[0]);
  assert.ok(
    verify(
      null,
      Buffer.from(v.signature_base),
      createPublicKey({ key: v.public_key, format: 'jwk' }),
      sig,
    ),
  );
  vectorNow = 1735689600;
  const result = await verifier.verify({
    method: 'GET',
    host: 'signature-agent.test',
    headers: v.response.headers,
  });
  assert.equal(result.reason, 'ignored_non_wba');
});
test('fixture checksums match the provenance manifest', () => {
  const manifest = read('sha256.json');
  for (const [file, sha] of Object.entries(manifest))
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(`fixtures/${file}`, import.meta.url)))
        .digest('hex'),
      sha,
      file,
    );
});
