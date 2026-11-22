import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVerifier, visitorLabels } from '../dist/index.js';
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/header-consistency.json', import.meta.url)),
);
const verifier = createVerifier({ registry: [], authorities: ['shop.example'] });
for (const fixture of fixtures) {
  test(`header consistency: ${fixture.name}`, async () => {
    for (const headers of [
      fixture.headers,
      Object.entries(fixture.headers).flat(),
      new Headers(fixture.headers),
      new Map(Object.entries(fixture.headers)),
    ]) {
      const v = await verifier.verify({
        method: fixture.method ?? 'GET',
        host: 'shop.example',
        headers,
      });
      assert.deepEqual(v.evidence ?? [], fixture.mismatch ? ['header_mismatch'] : []);
      assert.equal(v.verification, 'no_signature');
      assert.equal(v.verified, undefined);
      assert.equal(v.agent_purpose, 'unknown');
      assert.deepEqual(
        visitorLabels({ verdict: v, browserClass: 'human', browserPhase: 'final' }),
        {
          vv_type: 'human',
          vv_detail: 'none|no_signature|unknown|none|human|final',
        },
      );
    }
  });
}
test('mismatch never suppresses page markers or invalid-signature precedence', async () => {
  const headers = fixtures.find((f) => f.mismatch).headers;
  const v = await verifier.verify({ method: 'GET', host: 'shop.example', headers });
  assert.equal(
    visitorLabels({
      verdict: v,
      browserClass: 'declared_agent',
      browserAgent: 'openai',
    }).vv_detail.split('|')[0],
    'openai',
  );
  const invalid = await verifier.verify({
    method: 'GET',
    host: 'shop.example',
    headers: { ...headers, signature: 'bad' },
  });
  assert.deepEqual(invalid.evidence, ['header_mismatch']);
  assert.equal(visitorLabels({ verdict: invalid }).vv_type, 'bot_spoofed');
});
