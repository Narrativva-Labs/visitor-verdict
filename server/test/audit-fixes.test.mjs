import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { makeVerifier, signed, operator, jwk } from './helpers.mjs';
import { visitorLabels, MemoryNonceStore } from '../dist/index.js';
import { parseSail } from '../dist/sail.js';
import { decodeSail } from '../dist/ip.js';

test('audit: incomplete, orphan, expired and replay evidence never proves spoofing', async () => {
  for (const headers of [
    { signature: 'other=:AA==:' },
    {
      'signature-input': 'other=("@method");tag="unrelated"',
      signature: 'other=:AA==:, orphan=:AA==:',
    },
  ])
    assert.equal(
      (await makeVerifier().verify({ method: 'GET', host: 'example.com', headers })).verification,
      'none',
    );
  assert.equal(
    (await makeVerifier().verify(signed({ expires: 1800000000 - 31, created: 1800000000 - 100 })))
      .verification,
    'none',
  );
  const v = makeVerifier({ nonceStore: new MemoryNonceStore() });
  await v.verify(signed());
  assert.equal((await v.verify(signed())).verification, 'none');
});
test('audit: explicit insecure WBA context is insufficient', async () => {
  const verdict = await makeVerifier().verify({ ...signed(), secure: false });
  assert.equal(verdict.verification, 'none');
  assert.equal(verdict.reason, 'insufficient_context');
});
test('audit: known alias mismatch refreshes once with single flight and cooldown', async () => {
  const old = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  let calls = 0;
  const v = makeVerifier({
    registry: [{ ...operator, allowKidAlias: true }],
    fetcher: async () =>
      Response.json({ keys: [{ ...(++calls === 1 ? old : jwk), kid: 'alias' }] }),
  });
  await v.warm();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => v.verify(signed({ kid: 'alias' }))),
  );
  assert.ok(results.every((v) => v.verification === 'signature_valid'));
  assert.equal(calls, 2);
});
test('audit: unavailable alias refresh is indeterminate including cooldown', async () => {
  let calls = 0;
  const v = makeVerifier({
    registry: [{ ...operator, allowKidAlias: true }],
    fetcher: async () => {
      if (++calls > 1) throw Error('offline');
      return Response.json({ keys: [{ ...jwk, kid: 'alias' }] });
    },
  });
  await v.warm();
  const req = signed({ kid: 'alias' });
  req.headers.signature = 's=:' + Buffer.alloc(64).toString('base64') + ':';
  for (let i = 0; i < 2; i++) assert.equal((await v.verify(req)).verification, 'none');
  assert.equal(calls, 2);
});
test('audit: nonexclusive SAIL ranges never verify IP identity', () => {
  const doc = parseSail(
    readFileSync(
      new URL('./fixtures/anthropic-sail-2026-11-20.toml', import.meta.url),
      'utf8',
    ).replace(/exclusive\s*= true/g, 'exclusive = false'),
  );
  for (const blocks of decodeSail(doc).values())
    assert.equal(blocks.check('136.71.21.147', 'ipv4'), false);
});
test('audit: browser dom_host remains distinct and bounded', () => {
  const input = { browserClass: 'declared_agent', browserAgent: 'anthropic' };
  assert.equal(
    visitorLabels({ ...input, browserAgentClaim: 'dom_host' }).vv_detail.split('|')[3],
    'dom_host',
  );
  assert.equal(
    visitorLabels({ ...input, browserAgentClaim: 'arbitrary|input' }).vv_detail.split('|')[3],
    'dom_marker',
  );
});
test('audit: intermediary proof labels verified automation, direct proof retains precedence', async () => {
  const directIdentity = 'https://direct.example';
  const v = makeVerifier({
    registry: [
      { ...operator, intermediary: true },
      {
        ...operator,
        operator: 'direct',
        signatureAgent: directIdentity,
        directoryUrl: directIdentity + '/keys',
      },
    ],
  });
  const browser = {
    browserClass: 'declared_agent',
    browserAgent: 'anthropic',
    browserAgentClaim: 'dom_host',
  };
  const verdict = await v.verify(signed());
  assert.equal(visitorLabels({ verdict, ...browser }).vv_type, 'automation_verified');
  assert.equal(visitorLabels({ verdict, ...browser }).vv_detail.split('|')[2], 'intermediary');
  assert.equal(visitorLabels({ verdict, ...browser }).vv_detail.split('|')[3], 'signature_agent');
  const agent = `s="${operator.signatureAgent}", d="${directIdentity}"`;
  const infra = signed({
    agent,
    components: ['"@authority"', '"@method"', '"signature-agent";key="s"'],
    values: { '"signature-agent";key="s"': JSON.stringify(operator.signatureAgent) },
  });
  const direct = signed({
    agent,
    label: 'd',
    components: ['"@authority"', '"@method"', '"signature-agent";key="d"'],
    values: { '"signature-agent";key="d"': JSON.stringify(directIdentity) },
  });
  for (const peers of [
    [infra, direct],
    [direct, infra],
  ]) {
    const req = {
      ...direct,
      headers: {
        ...direct.headers,
        signature: peers.map((p) => p.headers.signature).join(', '),
        'signature-input': peers.map((p) => p.headers['signature-input']).join(', '),
      },
    };
    const verified = await v.verify(req);
    assert.equal(verified.verified?.operator, 'direct');
    assert.ok(verified.signatures.every((s) => s.result === 'signature_valid'));
    assert.equal(visitorLabels({ verdict: verified, ...browser }).vv_type, 'agent_verified');
    assert.equal(
      visitorLabels({ verdict: verified, ...browser }).vv_detail.split('|')[3],
      'signature_agent',
    );
  }
  const bad = signed();
  bad.headers.signature = 's=:' + Buffer.alloc(64).toString('base64') + ':';
  const spoofed = visitorLabels({ verdict: await v.verify(bad), ...browser });
  assert.equal(spoofed.vv_type, 'bot_spoofed');
  assert.equal(spoofed.vv_detail.split('|')[0], 'none');
  assert.equal(spoofed.vv_detail.split('|')[3], 'signature_agent');
});
test('audit: shared SAIL evidence cannot label a copied UA as verified', async () => {
  const body = readFileSync(
    new URL('./fixtures/anthropic-sail-2026-11-20.toml', import.meta.url),
    'utf8',
  ).replace(/exclusive\s*= true/g, 'exclusive = false');
  const v = makeVerifier({
    registry: [
      {
        ...operator,
        ipLists: [
          {
            name: 'sail',
            url: 'https://agent.example/sail',
            format: 'sail',
            service: 'Claude-Agent',
            uaTokens: ['Claude-Agent'],
          },
        ],
        extraUaTokens: ['Claude-Agent'],
      },
    ],
    fetcher: async () =>
      new Response(body, { headers: { 'content-type': 'application/sail+toml' } }),
  });
  const verdict = await v.verify({
    method: 'GET',
    host: 'example.com',
    clientIp: '136.71.21.147',
    headers: { 'user-agent': 'Claude-Agent' },
  });
  assert.equal(verdict.verified, undefined);
  assert.deepEqual(verdict.evidence, ['shared_ip_range']);
  assert.equal(visitorLabels({ verdict }).vv_type, 'agent_unverified');
});
test('audit: orphan signature cannot poison valid intermediary proof', async () => {
  const v = makeVerifier({ registry: [{ ...operator, intermediary: true }] });
  const req = signed();
  req.headers.signature += ', orphan=:AA==:';
  const verdict = await v.verify(req);
  assert.equal(visitorLabels({ verdict }).vv_type, 'automation_verified');
});
test('audit: cache-only alias mismatch refreshes in background and respects cooldown', async () => {
  const old = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const v = makeVerifier({
    registry: [{ ...operator, allowKidAlias: true }],
    fetcher: async () => {
      calls++;
      if (calls > 1) await pending;
      return Response.json({ keys: [{ ...old, kid: 'alias' }] });
    },
  });
  await v.warm();
  assert.equal(
    (await v.verify(signed({ kid: 'alias' }), { cacheOnly: true })).verification,
    'none',
  );
  assert.equal(calls, 2);
  assert.equal(
    (await v.verify(signed({ kid: 'alias' }), { cacheOnly: true })).verification,
    'none',
  );
  assert.equal(calls, 2);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await v.verify(signed({ kid: 'alias' }))).verification, 'none');
  assert.equal(calls, 2);
});
for (const warm of [false, true])
  test(`round2: WBA alias mismatch uses its own fresh document (warm=${warm})`, async () => {
    let calls = 0;
    const v = makeVerifier({
      registry: [{ ...operator, allowKidAlias: true }],
      fetcher: async () =>
        Response.json({ keys: [{ ...jwk, kid: ++calls === 1 && warm ? 'old' : 'new' }] }),
    });
    if (warm) await v.warm();
    const req = signed({ kid: 'new' });
    req.headers.signature = 's=:' + Buffer.alloc(64).toString('base64') + ':';
    const verdict = await v.verify(req);
    assert.equal(verdict.reason, 'crypto_mismatch');
    assert.equal(verdict.verification, 'signature_invalid');
    assert.equal(calls, warm ? 2 : 1);
  });
test('round2: insecure unrelated signature still permits independent IP verification', async () => {
  const v = makeVerifier({
    registry: [{ ...operator, extraUaTokens: ['Test-Agent'], staticPrefixes: ['192.0.2.0/24'] }],
  });
  const verdict = await v.verify({
    method: 'GET',
    host: 'example.com',
    secure: false,
    clientIp: '192.0.2.1',
    headers: {
      'user-agent': 'Test-Agent',
      'signature-input': 'x=("@method");tag="other"',
      signature: 'x=:AA==:',
    },
  });
  assert.equal(verdict.verification, 'ip_match');
  assert.deepEqual(verdict.signatures, [{ label: 'x', result: 'none', reason: 'ignored_non_wba' }]);
});
test('round2: labels in one request share fresh WBA directory provenance', async () => {
  let calls = 0;
  const v = makeVerifier({
    registry: [{ ...operator, allowKidAlias: true }],
    fetcher: async () => {
      calls++;
      return Response.json({ keys: [{ ...jwk, kid: 'alias' }] });
    },
  });
  const good = signed({ kid: 'alias' });
  const bad = signed({ kid: 'alias', label: 'bad' });
  good.headers['signature-input'] += ', ' + bad.headers['signature-input'];
  good.headers.signature += ', bad=:' + Buffer.alloc(64).toString('base64') + ':';
  const verdict = await v.verify(good);
  assert.equal(verdict.verification, 'signature_valid');
  assert.equal(verdict.signatures.find((s) => s.label === 'bad').reason, 'crypto_mismatch');
  assert.equal(calls, 1);
});
