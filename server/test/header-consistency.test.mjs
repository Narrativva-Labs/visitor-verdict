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
  assert.equal(visitorLabels({ verdict: invalid }).vv_type, 'pending');
});

const ua = (v) => `Mozilla/5.0 (X11; Linux x86_64) Chrome/${v}.0.0.0 Safari/537.36`;
const nav = {
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'sec-ch-ua': '"Chromium";v="92"',
  'sec-ch-ua-mobile': '?0',
};
for (const version of [89, 90, 91, 92, 93])
  test(`platform default gate ${version}`, async () => {
    for (const suffix of ['', ` Edg/${version}.0`])
      assert.equal(
        !!(
          await verifier.verify({
            method: 'GET',
            host: 'shop.example',
            headers: { ...nav, 'user-agent': ua(version) + suffix },
          })
        ).evidence,
        version >= 93,
      );
  });
for (const dest of ['empty', 'object', 'embed', 'iframe'])
  test(`cross-origin HTML ${dest}`, async () => {
    assert.equal(
      (
        await verifier.verify({
          method: 'GET',
          host: 'shop.example',
          headers: {
            'user-agent': ua(142),
            accept: 'text/html',
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': dest === 'iframe' ? 'navigate' : 'cors',
            'sec-fetch-dest': dest,
          },
        })
      ).evidence,
      undefined,
    );
  });
for (const token of [
  'WebView',
  'FBAN',
  'FBAV',
  'Instagram',
  'Line/',
  'MicroMessenger',
  'BytedanceWebview',
  'GSA/',
  'Version/4.0 Chrome/',
  'Electron/',
  'QtWebEngine/',
  'iPod',
  'Vivaldi/',
  'YaBrowser/',
  'DuckDuckGo/',
  'MiuiBrowser',
  'Silk/',
  'UCBrowser/',
  'Googlebot',
])
  test(`skip ${token}`, async () => {
    assert.equal(
      (
        await verifier.verify({
          method: 'GET',
          host: 'shop.example',
          headers: { 'user-agent': ua(142) + ' ' + token, accept: 'text/html' },
        })
      ).evidence,
      undefined,
    );
  });
test('adapter opt-outs, HEAD and Android desktop mode', async () => {
  for (const override of [{ secure: false }, { headerDiagnostics: false }, { method: 'HEAD' }])
    assert.equal(
      (
        await verifier.verify({
          method: 'GET',
          host: 'shop.example',
          headers: { 'user-agent': ua(142), accept: 'text/html' },
          ...override,
        })
      ).evidence,
      undefined,
    );
  assert.equal(
    (
      await verifier.verify({
        method: 'GET',
        host: 'shop.example',
        headers: { ...nav, 'user-agent': ua(142), 'sec-ch-ua-platform': '"Android"' },
      })
    ).evidence,
    undefined,
  );
});
