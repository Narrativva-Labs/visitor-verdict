import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { dictionary, signatureBase, headers } from '../dist/fields.js';
import { clock, signed, verifier, makeVerifier, jwk, identity } from './helpers.mjs';

test('sec-F1: preserve raw @path escapes; dot-segment mutation cannot reuse a signature', async () => {
  const r = signed({
    components: ['"@authority"', '"signature-agent"', '"@path"'],
    values: { '"@path"': '/b' },
  });
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  r.target = 'https://example.com/a/%2e%2e/b';
  assert.equal((await verifier.verify(r)).reason, 'crypto_mismatch');
  const proper = signed({
    components: ['"@authority"', '"signature-agent"', '"@path"'],
    values: { '"@path"': '/a/%2e%2e/b' },
  });
  proper.target = r.target;
  assert.equal((await verifier.verify(proper)).verification, 'signature_valid');
  proper.target = '/a/%2e%2e/b';
  assert.equal((await verifier.verify(proper)).verification, 'signature_valid');
});
test('sec-F1: @target-uri uses raw target octets without WHATWG normalization', async () => {
  const target = 'https://example.com/a/%2e%2e/b?x=%2f';
  const r = signed({
    components: ['"@target-uri"', '"signature-agent"'],
    values: { '"@target-uri"': target },
  });
  r.target = target;
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  r.target = 'https://example.com/b?x=%2f';
  assert.equal((await verifier.verify(r)).reason, 'crypto_mismatch');
  for (const target of [
    'bad target',
    'http://example.com/b',
    'https://other.example/b',
    '/a\\b',
    '/bad%escape',
    null,
    {},
  ]) {
    r.target = target;
    assert.equal((await verifier.verify(r)).reason, 'insufficient_context');
  }
});
test('sec-F2: NBSP is signed obs-text, not removable OWS', async () => {
  const r = signed({
    components: ['"@authority"', '"signature-agent"', '"x-intent"'],
    values: { '"x-intent"': 'read' },
  });
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  r.headers['x-intent'] = '\u00a0read\u00a0';
  assert.equal((await verifier.verify(r)).reason, 'non_ascii_component');
  r.headers['x-intent'] = '\t read \t';
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  for (const c of ['\0', '\r', '\n', '\v', '\f', '\x1f', '\x7f']) {
    r.headers['x-intent'] = c + 'read';
    assert.equal((await verifier.verify(r)).reason, 'malformed_header');
  }
});
test('sec-F3: SF Decimal timestamps are rejected before lossy serialization', async () => {
  for (const field of ['created', 'expires']) {
    const r = signed();
    r.headers['signature-input'] = r.headers['signature-input'].replace(
      new RegExp(field + '=(\\d+)'),
      field + '=$1.0',
    );
    const v = await verifier.verify(r);
    assert.deepEqual([v.verification, v.reason], ['none', 'invalid_timestamp_type']);
  }
});
test('sec-F4: aggregate count/bytes/UA caps are enforced on first pass', async () => {
  for (const mutate of [
    (r) => (r.headers['x-padding'] = 'x'.repeat(2 * 1024 * 1024)),
    (r) => (r.headers['user-agent'] = 'x'.repeat(1025)),
    (r) =>
      (r.headers = [
        ...Object.entries(r.headers).flat(),
        ...Array.from({ length: 32000 }, () => ['x-pad', '']).flat(),
      ]),
  ]) {
    const r = signed();
    mutate(r);
    assert.equal((await verifier.verify(r)).reason, 'headers_too_large');
  }
  assert.throws(
    () => headers(Array.from({ length: 257 }, () => ['x', '']).flat()),
    /headers_too_large/,
  );
});
test('sec-F5: successful no-store and short TTL responses retain verification data without cooldown outage', async () => {
  for (const cc of [
    'no-store, no-transform',
    'no-cache',
    'max-age=0, must-revalidate',
    'max-age=10',
  ]) {
    let now = clock;
    let calls = 0;
    const v = makeVerifier({
      now: () => now,
      fetcher: async () => {
        calls++;
        return Response.json({ keys: [jwk] }, { headers: { 'cache-control': cc, age: '100' } });
      },
    });
    for (const offset of [0, 1, 11, 60, 299, 300]) {
      now = clock + offset;
      assert.equal((await v.verify(signed())).verification, 'signature_valid');
    }
    assert.equal(calls, 2);
  }
});
test('sec-F6: early redirect/size/url rejections cancel bodies and abort transport', async () => {
  for (const kind of ['redirect', 'oversize', 'redirected', 'url']) {
    let cancelled = false;
    let signal;
    const body = new ReadableStream({
      pull() {},
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, {
      status: kind === 'redirect' ? 302 : 200,
      headers: kind === 'oversize' ? { 'content-length': '65537' } : {},
    });
    if (kind === 'redirected') Object.defineProperty(response, 'redirected', { value: true });
    if (kind === 'url')
      Object.defineProperty(response, 'url', { value: 'https://other.example/keys' });
    const v = makeVerifier({
      fetcher: async (_url, init) => {
        signal = init.signal;
        return response;
      },
    });
    const result = await v.verify(signed());
    assert.equal(
      result.reason,
      kind === 'oversize' ? 'directory_too_large' : 'directory_http_error',
    );
    assert.equal(signal.aborted, true);
    assert.equal(cancelled, true);
  }
});
test('sec-F6: late response after timeout is canceled too', async () => {
  let release;
  let cancelled = false;
  const v = makeVerifier({
    fetchTimeoutMs: 10,
    fetcher: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  assert.equal((await v.verify(signed())).reason, 'directory_timeout');
  release(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});
test('sec-F7: whitespace lexing remains bounded and handles SF token colons', async () => {
  const start = performance.now();
  for (let i = 0; i < 20; i++) dictionary('s=(' + ' '.repeat(15000) + ')');
  assert.ok(performance.now() - start < 1000, '20 maximum-size inputs must not block for seconds');
  const r = signed();
  r.headers['signature-input'] = 's=(' + ' '.repeat(15000) + ')';
  assert.equal((await verifier.verify(r)).reason, 'ignored_non_wba');
  assert.doesNotThrow(() => dictionary('s=(a;p=1 b;p=2);ctx=urn:foo:bar'));
});
test('signature-agent dictionary lines combine with SP/HTAB trimming per line', async () => {
  const agent = `s="${identity}", x="https://unknown.example"`;
  const r = signed({
    agent,
    components: ['"@authority"', '"signature-agent";key="s"'],
    values: { '"signature-agent";key="s"': JSON.stringify(identity) },
  });
  r.headers['signature-agent'] = [` \ts="${identity}" \t`, ' x="https://unknown.example"\t'];
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  const context = { method: 'GET', authority: 'example.com' };
  const inner = dictionary('s=("signature-agent")').get('s');
  assert.equal(
    signatureBase(context, headers(r.headers), inner).split('\n')[0],
    '"signature-agent": ' + agent,
  );
});
test('sec-F6: streamed directory size overflow cancels the active reader', async () => {
  let cancelled = false;
  const v = makeVerifier({
    fetcher: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(65537));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  assert.equal((await v.verify(signed())).reason, 'directory_too_large');
  assert.equal(cancelled, true);
});
