import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createVerifier, defaultRegistry } from '../dist/index.js';
import { fixture } from './helpers.mjs';

test('2000 fixed-seed mutations: bounded, no throws/IP leakage, no changed signed data accepted', async () => {
  const captures = fixture('chatgpt-agent-2026-11-20.json').requests;
  const directory = fixture('openai-directory-2026-11-20.json');
  let seed = 0x94218941;
  function random(n) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % n;
  }
  let now;
  const deadlineMs = 500;
  const ip = '192.0.2.123';
  const verifier = createVerifier({
    registry: defaultRegistry,
    authorities: [captures[0].headers.host, 'other.example'],
    now: () => now,
    deadlineMs,
    fetcher: async () => Response.json(directory, { headers: { 'cache-control': 'no-store' } }),
  });
  const chars = ['\0', '\r', '\n', '\t', ' ', 'é', '中', '\ud800', ';', ':', '"'];
  for (let i = 0; i < 2000; i++) {
    const capture = captures[random(captures.length)];
    now = Date.parse(capture.ts) / 1000;
    const request = {
      method: capture.method,
      host: capture.headers.host,
      headers: { ...capture.headers },
      target: capture.path,
      clientIp: ip,
    };
    const h = request.headers;
    const kind = i % 10;
    if (kind === 0) {
      const bytes = Buffer.from(h.signature.match(/:([^:]+):/)[1], 'base64');
      bytes[random(bytes.length)] ^= 1 << random(8);
      h.signature = 'sig1=:' + bytes.toString('base64') + ':';
    }
    if (kind === 1) request.method += 'X';
    if (kind === 2) request.host = 'other.example';
    if (kind === 3)
      h['signature-input'] = h['signature-input'].replace(/nonce="([^"]+)"/, 'nonce="$1x"');
    if (kind === 4) h['signature-agent'] = '"https://unknown.example"';
    if (kind === 5)
      h['signature-input'] = h['signature-input'].replace(/created=(\d+)/, 'created=$1.0');
    if (kind === 6) h.signature = 'x'.repeat(17000);
    if (kind === 7) {
      const key = ['signature', 'signature-agent', 'signature-input'][random(3)];
      h[key] += chars[random(chars.length)];
    }
    if (kind === 8) {
      delete h.signature;
      delete h['signature-input'];
      request.target = '/?utm_campaign=sleva-50%';
      h['x-random'] = chars[random(chars.length)];
    }
    if (kind === 9) {
      request.target = '/uncovered/' + random(1000) + '?pct=50%';
      request.headers = Object.entries(h).flatMap(([key, value]) => [
        key.toUpperCase(),
        ' \t' + value + '\t ',
      ]);
    }
    const start = performance.now();
    const result = await verifier.verify(request);
    assert.ok(performance.now() - start < deadlineMs);
    assert.ok(!JSON.stringify(result).includes(ip));
    if (kind <= 6) assert.notEqual(result.verification, 'signature_valid');
    if (kind === 8) assert.notEqual(result.verification, 'signature_invalid');
    if (kind === 9) assert.equal(result.verification, 'signature_valid');
  }
});
