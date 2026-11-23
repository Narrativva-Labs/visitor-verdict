import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, constants } from 'node:crypto';
import { createVerifier, visitorLabels, defaultRegistry } from '../dist/index.js';
import { parsePoppyJwt, poppyKeys, PoppyVerifier } from '../dist/poppy.js';
import { signed, operator as wbaOperator, fetcher as wbaFetcher } from './helpers.mjs';
const now = 1800000000;
const client = 'https://muse.ai/poppy/agent.json';
const jwks = 'https://muse.ai/poppy/jwks.json';
const agent = JSON.parse(
  await (
    await import('node:fs/promises')
  ).readFile(new URL('./fixtures/poppy-agent.json', import.meta.url), 'utf8'),
);
const ec = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const root = ec(),
  delegated = ec(),
  wrong = ec();
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pub = (pair) => pair.publicKey.export({ format: 'jwk' });
const hash = (s) => createHash('sha256').update(s).digest('base64url');
const dk = pub(delegated);
const thumb = hash(JSON.stringify({ crv: dk.crv, kty: dk.kty, x: dk.x, y: dk.y }));
const op = {
  operator: 'meta',
  poppyClientId: client,
  poppyJwksUri: jwks,
  verifiedByCapture: false,
  source: client,
  checked: '2026-11-23',
  ipLists: [],
  extraUaTokens: ['Muse'],
  staticPrefixes: ['192.0.2.0/24'],
};
function jwt(h, p, pair) {
  const bytes = [h, p].map((x) => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  const options =
    h.alg === 'PS384'
      ? { key: pair.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 48 }
      : { key: pair.privateKey, dsaEncoding: 'ieee-p1363' };
  return (
    bytes +
    '.' +
    sign(h.alg === 'PS384' ? 'sha384' : 'sha256', Buffer.from(bytes), options).toString('base64url')
  );
}
function request(opts = {}) {
  const dlg = jwt(
    { alg: opts.rootAlg ?? 'ES256', typ: 'poppy-delegation+jwt', kid: 'root', ...opts.dh },
    {
      iss: client,
      cnf: { jwk: dk },
      iat: now - 100,
      exp: now + 600,
      jti: 'delegation',
      ...opts.dp,
    },
    opts.rootAlg === 'PS384' ? rsa : root,
  );
  const token = jwt(
    { alg: 'ES256', typ: 'poppy-session+jwt', kid: thumb, poppy_dlg: dlg, ...opts.h },
    {
      iss: client,
      aud: 'https://example.com',
      sid: 'session',
      sub: 'private-subject@example.invalid',
      htm: 'GET',
      htu: 'https://example.com/page',
      iat: now,
      jti: 'unique-request',
      ...opts.p,
    },
    opts.signer ?? delegated,
  );
  return {
    method: 'GET',
    host: 'example.com',
    target: '/page?secret=1',
    secure: true,
    headers: { 'poppy-session': token, 'poppy-version': '1.0', ...opts.headers },
  };
}
function verifier(options = {}) {
  const calls = [];
  const v = createVerifier({
    registry: [op],
    authorities: ['example.com'],
    now: () => now,
    poppy: { enabled: true },
    fetcher: async (url, init) => {
      calls.push(url);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.credentials, 'omit');
      return new Response(
        JSON.stringify(
          url === client ? agent : { keys: [{ ...pub(options.ps ? rsa : root), kid: 'root' }] },
        ),
      );
    },
    ...options,
  });
  return { v, calls };
}
test('Poppy signed-out ES256 and PS384 delegation authenticate operator, never user', async () => {
  for (const alg of ['ES256', 'PS384']) {
    const { v } = verifier({ ps: alg === 'PS384' });
    const verdict = await v.verify(request({ rootAlg: alg }));
    assert.equal(verdict.verification, 'signature_valid');
    assert.equal(verdict.verified.operator, 'meta');
    assert.equal(verdict.verified.method, 'poppy');
    assert.equal(visitorLabels({ verdict }).vv_type, 'agent_verified');
    assert.match(visitorLabels({ verdict }).vv_detail, /\|poppy_session\|/);
    assert.ok(visitorLabels({ verdict }).vv_detail.length <= 100);
    assert.doesNotMatch(JSON.stringify(verdict), /private-subject|eyJ|authorized|delegated/);
    const replay = await v.verify(request({ rootAlg: alg }));
    assert.equal(replay.reason, 'poppy_replay');
    assert.equal(replay.verification, 'none');
    assert.equal(replay.poppy.result, 'none');
    assert.equal(replay.verified, undefined);
    assert.equal(visitorLabels({ verdict: replay }).vv_type, 'agent_unverified');
  }
});
for (const [name, opts, reason] of [
  ['expired session', { p: { iat: now - 61 } }, 'poppy_time'],
  ['future session', { p: { iat: now + 61 } }, 'poppy_time'],
  ['wrong audience', { p: { aud: 'https://other.test' } }, 'poppy_audience'],
  ['array audience', { p: { aud: ['https://example.com'] } }, 'poppy_audience'],
  ['unknown client', { p: { iss: 'https://attacker.test/agent.json' } }, 'poppy_unknown_client'],
  ['wrong algorithm', { h: { alg: 'HS256' } }, 'poppy_algorithm'],
  ['none algorithm', { h: { alg: 'none' } }, 'poppy_algorithm'],
  ['expired delegation', { dp: { exp: now } }, 'poppy_time'],
  ['future delegation', { dp: { iat: now + 61 } }, 'poppy_time'],
  ['long delegation', { dp: { exp: now + 86400 } }, 'poppy_time'],
  ['delegation issuer', { dp: { iss: 'https://attacker.test' } }, 'poppy_claims'],
  [
    'private delegated key',
    { dp: { cnf: { jwk: { ...dk, d: 'private' } } } },
    'poppy_key_unavailable',
  ],
  ['thumbprint mismatch', { h: { kid: 'wrong' } }, 'poppy_claims'],
  ['wrong method', { p: { htm: 'POST' } }, 'poppy_request'],
  ['wrong URL', { p: { htu: 'https://example.com/other' } }, 'poppy_request'],
  ['ath signed out', { p: { ath: 'hash' } }, 'poppy_oauth_unsupported'],
  [
    'OAuth unsupported',
    { headers: { authorization: 'Bearer private' } },
    'poppy_oauth_unsupported',
  ],
  ['long sid', { p: { sid: 'a'.repeat(257) } }, 'poppy_claims'],
  ['missing sub', { p: { sub: undefined } }, 'poppy_claims'],
  ['missing delegation', { h: { poppy_dlg: undefined } }, 'poppy_malformed'],
  ['session exp', { p: { exp: now + 30 } }, 'poppy_claims'],
  ['incompatible version', { headers: { 'poppy-version': '2.0' } }, 'poppy_version'],
])
  test(name + ' remains unverified', async () => {
    const { v, calls } = verifier();
    const verdict = await v.verify(request(opts));
    assert.equal(verdict.reason, reason);
    assert.equal(verdict.verification, 'none');
    assert.equal(verdict.verified, undefined);
    assert.equal(visitorLabels({ verdict }).vv_type, 'agent_unverified');
    if (name === 'unknown client') assert.equal(calls.length, 0);
  });
test('known delegation/session bad cryptographic signatures are spoofed', async () => {
  for (const opts of [{ signer: wrong }, { dh: { kid: 'root' } }]) {
    const { v } = verifier(
      opts.signer
        ? {}
        : {
            fetcher: async (url) =>
              new Response(
                JSON.stringify(url === client ? agent : { keys: [{ ...pub(wrong), kid: 'root' }] }),
              ),
          },
    );
    const verdict = await v.verify(request(opts));
    assert.equal(verdict.reason, 'poppy_signature_invalid');
    assert.equal(visitorLabels({ verdict }).vv_type, 'bot_spoofed');
  }
});
test('disabled by default, registry pinning and metadata binding', async () => {
  const { v, calls } = verifier({ poppy: undefined });
  assert.equal((await v.verify(request())).verification, 'no_signature');
  assert.equal(calls.length, 0);
  assert.throws(() =>
    verifier({ registry: [{ ...op, poppyJwksUri: 'https://attacker.test/keys' }] }),
  );
  assert.throws(() => verifier({ fetcher: undefined }));
  assert.equal(defaultRegistry.find((o) => o.operator === 'meta').poppyClientId, client);
  for (const data of [
    { ...agent, client_id: 'https://attacker.test' },
    { ...agent, jwks_uri: 'https://attacker.test/keys' },
  ]) {
    const x = verifier({ fetcher: async () => new Response(JSON.stringify(data)) });
    assert.equal((await x.v.verify(request())).reason, 'poppy_document_unavailable');
  }
});
test('bounded documents, timeout, backoff and cache-only warm', async () => {
  for (const response of [
    () => new Response(' '.repeat(65537)),
    () => new Response('{}', { headers: { 'content-length': '65537' } }),
    () => new Response('{}', { status: 302 }),
  ]) {
    let n = 0;
    const { v } = verifier({
      fetcher: async () => {
        n++;
        return response();
      },
    });
    assert.equal((await v.verify(request())).verification, 'none');
    await v.verify(request());
    assert.equal(n, 1);
  }
  const timed = verifier({ fetchTimeoutMs: 5, fetcher: async () => new Promise(() => {}) });
  assert.equal((await timed.v.verify(request())).reason, 'poppy_document_unavailable');
  const { v, calls } = verifier();
  assert.equal((await v.warm()).ok.length, 2);
  assert.equal((await v.verify(request(), { cacheOnly: true })).verification, 'signature_valid');
  assert.equal(calls.length, 2);
});
test('Poppy proofs outrank IP; unavailable/invalid claims suppress IP fallback', async () => {
  for (const opts of [{}, { signer: wrong }, { p: { aud: 'https://other.test' } }]) {
    const { v } = verifier();
    const req = request(opts);
    req.clientIp = '192.0.2.1';
    req.headers['user-agent'] = 'Muse';
    const verdict = await v.verify(req);
    assert.ok(verdict.ip);
    assert.equal(verdict.verified?.method, opts.signer || opts.p ? undefined : 'poppy');
    assert.equal(
      verdict.verification,
      opts.signer ? 'signature_invalid' : opts.p ? 'none' : 'signature_valid',
    );
  }
});
test('Poppy parser/header fuzz is bounded and never rejects verify()', async () => {
  const { v } = verifier();
  let state = 7;
  for (let i = 0; i < 300; i++) {
    let raw = '';
    for (let j = 0; j < i % 100; j++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      raw += String.fromCharCode(32 + (state % 96));
    }
    try {
      parsePoppyJwt(raw);
    } catch {}
    const req = request();
    req.headers['poppy-session'] = raw;
    assert.notEqual((await v.verify(req)).verification, 'signature_valid');
  }
  const req = request();
  req.headers['poppy-session'] = [req.headers['poppy-session'], req.headers['poppy-session']];
  assert.equal((await v.verify(req)).reason, 'poppy_malformed');
});

test('valid direct WBA and Poppy share precedence; direct proof wins invalid peer', async () => {
  for (const intermediary of [false, true])
    for (const bad of [false, true]) {
      const { v } = verifier({
        registry: [op, { ...wbaOperator, intermediary }],
        fetcher: async (url, init) =>
          url === client
            ? Response.json(agent)
            : url === jwks
              ? Response.json({ keys: [{ ...pub(root), kid: 'root' }] })
              : wbaFetcher(url, init),
      });
      const req = signed();
      Object.assign(req.headers, request(bad ? { signer: wrong } : {}).headers);
      req.target = '/page';
      const verdict = await v.verify(req);
      assert.equal(
        verdict.verification,
        intermediary && bad ? 'signature_invalid' : 'signature_valid',
      );
      if (!bad && intermediary) assert.equal(verdict.verified.method, 'poppy');
      if (!intermediary) assert.equal(verdict.verified.method, 'signature');
      if (verdict.verified)
        assert.equal(
          visitorLabels({ verdict }).vv_detail.split('|')[3],
          verdict.verified.method === 'poppy' ? 'poppy_session' : 'signature_agent',
        );
    }
});
test('valid Poppy wins bad WBA peer', async () => {
  const { v } = verifier({
    registry: [op, wbaOperator],
    fetcher: async (url, init) =>
      url === client
        ? Response.json(agent)
        : url === jwks
          ? Response.json({ keys: [{ ...pub(root), kid: 'root' }] })
          : wbaFetcher(url, init),
  });
  const req = signed();
  req.headers.signature = req.headers.signature.replace(/=:[A-Za-z0-9+/]/, (match) =>
    match === '=:A' ? '=:B' : '=:A',
  );
  Object.assign(req.headers, request().headers);
  req.target = '/page';
  const verdict = await v.verify(req);
  assert.equal(verdict.verification, 'signature_valid');
  assert.equal(verdict.verified.method, 'poppy');
});

test('JWT parser rejects duplicate/escaped JSON members, excessive depth and size', () => {
  for (const raw of [
    '{"alg":"none","alg":"ES256"}',
    '{"alg":"none","\\u0061lg":"ES256"}',
    '{"x":' + '['.repeat(20) + '0' + ']'.repeat(20) + '}',
  ]) {
    assert.throws(() => parsePoppyJwt(Buffer.from(raw).toString('base64url') + '.e30.AA'));
  }
  assert.throws(() => parsePoppyJwt('x'.repeat(16385)));
  assert.throws(() => parsePoppyJwt('e30=.e30.AA'));
});

test('JWKS limits, missing keys, private roots and duplicate kid remain unverified', async () => {
  for (const keys of [
    [],
    Array.from({ length: 33 }, () => ({ ...pub(root), kid: 'root' })),
    [{ ...pub(root), kid: 'other' }],
    [{ ...pub(root), kid: 'root', d: 'private' }],
    [
      { ...pub(root), kid: 'root' },
      { ...pub(wrong), kid: 'root' },
    ],
  ]) {
    let n = 0;
    const { v } = verifier({
      fetcher: async (url) => {
        n++;
        return Response.json(url === client ? agent : { keys });
      },
    });
    const verdict = await v.verify(request());
    assert.equal(verdict.verification, 'none');
    assert.equal(verdict.verified, undefined);
    const before = n;
    await v.verify(request());
    assert.equal(n, before);
  }
});
test('cold cache-only Poppy stays unverified while documents warm', async () => {
  const { v } = verifier();
  assert.equal((await v.verify(request(), { cacheOnly: true })).verification, 'none');
  await v.warm();
  assert.equal((await v.verify(request(), { cacheOnly: true })).verification, 'signature_valid');
});
test('oversized JWT and header inputs remain unverified', async () => {
  const { v } = verifier();
  for (const size of [16385, 65537]) {
    const req = request();
    req.headers['poppy-session'] = 'A'.repeat(size);
    assert.notEqual((await v.verify(req)).verification, 'signature_valid');
  }
});

function shorten(token) {
  const parts = token.split('.');
  parts[2] = Buffer.from(parts[2], 'base64url').subarray(0, 63).toString('base64url');
  return parts.join('.');
}
test('short ES256 session and delegation signatures remain malformed, never spoofed', async () => {
  for (const layer of ['session', 'delegation']) {
    const req = request();
    if (layer === 'session') req.headers['poppy-session'] = shorten(req.headers['poppy-session']);
    else {
      const parsed = parsePoppyJwt(req.headers['poppy-session']);
      req.headers['poppy-session'] = jwt(
        { ...parsed.h, poppy_dlg: shorten(parsed.h.poppy_dlg) },
        parsed.p,
        delegated,
      );
    }
    const { v } = verifier();
    const verdict = await v.verify(req);
    assert.equal(verdict.reason, 'poppy_malformed');
    assert.equal(verdict.verification, 'none');
    assert.equal(verdict.poppy.result, 'none');
    assert.equal(verdict.verified, undefined);
    assert.equal(visitorLabels({ verdict }).vv_type, 'agent_unverified');
  }
});
test('Poppy purpose stays unknown despite same-operator IP/UA crawler policies', async () => {
  for (const policy of [
    { ipLists: { published_static: 'crawler' } },
    { uaTokens: { Muse: 'crawler' } },
  ]) {
    const { v } = verifier({
      registry: [{ ...op, purposes: { ...policy, sources: [client], checked: '2026-11-23' } }],
    });
    const req = request();
    req.clientIp = '192.0.2.1';
    req.headers['user-agent'] = 'Muse';
    const verdict = await v.verify(req);
    assert.ok(verdict.ip);
    assert.equal(verdict.verified.method, 'poppy');
    assert.equal(verdict.agent_purpose, 'unknown');
    assert.equal(visitorLabels({ verdict }).vv_type, 'agent_verified');
    assert.equal(visitorLabels({ verdict }).vv_detail.split('|')[2], 'unknown');
  }
});
test('delegation iat permits 60 seconds skew, preserving expiration and 24h bounds', async () => {
  for (const offset of [-60, 0, 2, 60, 61]) {
    const { v } = verifier();
    const verdict = await v.verify(
      request({ dp: { iat: now + offset }, p: { iat: now + offset } }),
    );
    assert.equal(verdict.verification, offset <= 60 ? 'signature_valid' : 'none');
    assert.equal(
      visitorLabels({ verdict }).vv_type,
      offset <= 60 ? 'agent_verified' : 'agent_unverified',
    );
  }
  for (const dp of [
    { iat: now, exp: now },
    { iat: now - 86400, exp: now + 1 },
  ]) {
    const { v } = verifier();
    assert.equal((await v.verify(request({ dp }))).reason, 'poppy_time');
  }
});
test('JWKS keeps supported public roots alongside unsupported peers', async () => {
  const unsupported = [
    { kty: 'OKP', crv: 'Ed25519', x: 'public', kid: 'ed' },
    {
      ...generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey.export({ format: 'jwk' }),
      kid: 'p384',
    },
    { ...pub(rsa), kid: 'rs', alg: 'RS256' },
    { ...pub(root), kid: 'enc', use: 'enc' },
    { ...pub(root) },
    { ...pub(root), kid: 'bad', x: 'malformed' },
    null,
    1,
  ];
  for (const alg of ['ES256', 'PS384']) {
    const keys = [...unsupported, { ...pub(alg === 'PS384' ? rsa : root), kid: 'root' }];
    const parsed = poppyKeys({ keys });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].key.type, 'public');
    const { v } = verifier({
      fetcher: async (url) => Response.json(url === client ? agent : { keys }),
    });
    assert.equal((await v.verify(request({ rootAlg: alg }))).verification, 'signature_valid');
  }
  // Even an unsupported key must not smuggle private material into the public document.
  assert.throws(() =>
    poppyKeys({
      keys: [
        { ...pub(root), kid: 'root' },
        { kty: 'OKP', d: 'private' },
      ],
    }),
  );
});
test('diagnostics fingerprint only the operator root kid across distinct delegated keys', async () => {
  const { v } = verifier();
  const first = await v.verify(request());
  const parsed = parsePoppyJwt(request().headers['poppy-session']);
  const otherJwk = pub(wrong);
  const otherThumb = hash(
    JSON.stringify({ crv: otherJwk.crv, kty: otherJwk.kty, x: otherJwk.x, y: otherJwk.y }),
  );
  const dlg = parsePoppyJwt(parsed.h.poppy_dlg);
  const newDlg = jwt(dlg.h, { ...dlg.p, cnf: { jwk: otherJwk } }, root);
  const req = request();
  req.headers['poppy-session'] = jwt(
    { ...parsed.h, kid: otherThumb, poppy_dlg: newDlg },
    { ...parsed.p, jti: 'second' },
    wrong,
  );
  const second = await v.verify(req);
  assert.equal(second.verification, 'signature_valid');
  assert.equal(first.poppy.kidFingerprint, hash('root').slice(0, 16));
  assert.equal(second.poppy.kidFingerprint, first.poppy.kidFingerprint);
  for (const verdict of [first, second]) {
    assert.doesNotMatch(
      JSON.stringify(verdict),
      new RegExp(
        [thumb, otherThumb, hash(thumb).slice(0, 16), hash(otherThumb).slice(0, 16)].join('|'),
      ),
    );
  }
});
test('compatible 1.x version headers use 1.0 verification, rejecting other major/invalid syntax', async () => {
  for (const version of ['1.0', '1.1', '1.27', '0.3', '2.0', '1', '1.0.0', '1.none', '1.-1']) {
    const { v } = verifier();
    const verdict = await v.verify(request({ headers: { 'poppy-version': version } }));
    assert.equal(verdict.verification, /^1\.[0-9]+$/.test(version) ? 'signature_valid' : 'none');
    if (verdict.verified) assert.equal(verdict.poppy.version, version);
  }
});
test('invalid and ambiguously normalized request URLs remain poppy_request', async () => {
  for (const target of [
    'https://[invalid',
    '/a/../page',
    '/a/%2e%2e/page',
    '/a/./page',
    '/a\\..\\page',
    ' /page',
    'page',
  ]) {
    const { v } = verifier();
    const req = request();
    req.target = target;
    const verdict = await v.verify(req);
    assert.equal(verdict.reason, 'poppy_request');
    assert.equal(verdict.verification, 'none');
    assert.equal(visitorLabels({ verdict }).vv_type, 'agent_unverified');
  }
});
test('expired or aborted Poppy evaluation never fetches or consumes replay', async () => {
  let loads = 0;
  const poppy = new PoppyVerifier(
    [op],
    {
      load: async (url) => {
        loads++;
        return url === client ? jwks : poppyKeys({ keys: [{ ...pub(root), kid: 'root' }] });
      },
    },
    () => now,
  );
  const req = request();
  const h = new Map(Object.entries(req.headers).map(([k, v]) => [k, [v]]));
  for (const aborted of [false, true]) {
    const ctrl = new AbortController();
    if (aborted) ctrl.abort();
    const out = await poppy.evaluate(
      h,
      req,
      now,
      false,
      ctrl.signal,
      aborted ? Infinity : performance.now() - 1,
    );
    assert.equal(out.diagnostic.reason, 'poppy_deadline');
    assert.equal(out.diagnostic.result, 'none');
    assert.equal(loads, 0);
  }
  assert.equal(
    (await poppy.evaluate(h, req, now, false, new AbortController().signal, Infinity)).diagnostic
      .result,
    'signature_valid',
  );
});
test('deadline during shared metadata fetch stops follow-up JWKS fetch and leaves retry usable', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const { v } = verifier({
    deadlineMs: 20,
    fetchTimeoutMs: 1000,
    fetcher: async (url) => {
      calls.push(url);
      if (url === client) await gate;
      return Response.json(url === client ? agent : { keys: [{ ...pub(root), kid: 'root' }] });
    },
  });
  const verdict = await v.verify(request());
  assert.equal(verdict.reason, 'deadline_exceeded');
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, [client]);
  const retry = await v.verify(request());
  assert.equal(retry.verification, 'signature_valid');
});
test('IP fetch deadline cannot consume a Poppy replay nonce', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ipUrl = 'https://muse.ai/ips.json';
  const { v } = verifier({
    deadlineMs: 20,
    fetchTimeoutMs: 1000,
    registry: [
      {
        ...op,
        staticPrefixes: undefined,
        ipLists: [{ name: 'feed', url: ipUrl, uaTokens: ['Muse'] }],
      },
    ],
    fetcher: async (url) => {
      if (url === ipUrl) {
        await gate;
        return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
      }
      return Response.json(url === client ? agent : { keys: [{ ...pub(root), kid: 'root' }] });
    },
  });
  await v.warm();
  const req = request();
  req.clientIp = '192.0.2.1';
  req.headers['user-agent'] = 'Muse';
  assert.equal((await v.verify(req)).reason, 'deadline_exceeded');
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await v.verify(req)).verification, 'signature_valid');
});

test('valid WBA retains signature_agent claim with unreadable or incompatible Poppy headers', async () => {
  for (const poppyHeaders of [
    { 'poppy-session': 'unreadable', 'poppy-version': '1.0' },
    { 'poppy-session': request().headers['poppy-session'], 'poppy-version': '2.0' },
  ]) {
    const { v } = verifier({ registry: [op, wbaOperator], fetcher: wbaFetcher });
    const req = signed();
    Object.assign(req.headers, poppyHeaders);
    const verdict = await v.verify(req);
    assert.equal(verdict.verification, 'signature_valid');
    assert.equal(verdict.verified.method, 'signature');
    assert.equal(visitorLabels({ verdict }).vv_detail.split('|')[3], 'signature_agent');
    assert.equal(visitorLabels({ verdict }).vv_type, 'agent_verified');
  }
});
test('absolute deadline crossed during synchronous crypto never consumes replay', async () => {
  const record = poppyKeys({ keys: [{ ...pub(root), kid: 'root' }] })[0];
  let delay = true;
  const slowRecord = {
    ...record,
    get key() {
      if (delay) {
        const until = performance.now() + 15;
        while (performance.now() < until) {}
      }
      return record.key;
    },
  };
  const poppy = new PoppyVerifier(
    [op],
    { load: async (url) => (url === client ? jwks : [slowRecord]) },
    () => now,
  );
  const req = request();
  const h = new Map(Object.entries(req.headers).map(([k, v]) => [k, [v]]));
  const signal = new AbortController().signal;
  const out = await poppy.evaluate(h, req, now, false, signal, performance.now() + 10);
  assert.equal(signal.aborted, false);
  assert.equal(out.diagnostic.reason, 'poppy_deadline');
  delay = false;
  assert.equal(
    (await poppy.evaluate(h, req, now, false, signal, Infinity)).diagnostic.result,
    'signature_valid',
  );
});

test('audit: shared Poppy replay store covers multiple verifier instances and fails indeterminate', async () => {
  const seen = new Set();
  const replayStore = {
    async insertIfAbsent(key, ttl) {
      assert.ok(ttl > 0 && ttl <= 120);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
  const a = verifier({ poppy: { enabled: true, replayStore } }).v;
  const b = verifier({ poppy: { enabled: true, replayStore } }).v;
  const results = await Promise.all([a.verify(request()), b.verify(request())]);
  assert.deepEqual(results.map((x) => x.verification).sort(), ['none', 'signature_valid']);
  const broken = verifier({
    poppy: {
      enabled: true,
      replayStore: {
        insertIfAbsent: async () => {
          throw Error('offline');
        },
      },
    },
  }).v;
  assert.equal((await broken.verify(request())).verification, 'none');
});
test('audit: Poppy root mismatch refreshes known kid before spoofing and cooldown is indeterminate', async () => {
  let n = 0;
  const { v } = verifier({
    fetcher: async (url) =>
      Response.json(
        url === client ? agent : { keys: [{ ...pub(++n === 1 ? wrong : root), kid: 'root' }] },
      ),
  });
  await v.warm();
  assert.equal((await v.verify(request())).verification, 'signature_valid');
  assert.equal(n, 2);
  const bad = verifier({
    fetcher: async (url) => {
      if (url !== client && ++n > 1) throw Error('offline');
      return Response.json(url === client ? agent : { keys: [{ ...pub(wrong), kid: 'root' }] });
    },
  }).v;
  n = 0;
  await bad.warm();
  for (let i = 0; i < 2; i++) assert.equal((await bad.verify(request())).verification, 'none');
});
test('audit: external Poppy replay timeout and cache-only avoid verification', async () => {
  let calls = 0;
  const replayStore = {
    insertIfAbsent: async () => {
      calls++;
      return new Promise(() => {});
    },
  };
  const { v } = verifier({ fetchTimeoutMs: 5, poppy: { enabled: true, replayStore } });
  await v.warm();
  assert.equal((await v.verify(request(), { cacheOnly: true })).verification, 'none');
  assert.equal(calls, 0);
  assert.equal((await v.verify(request())).verification, 'none');
  assert.equal(calls, 1);
});
test('audit: concurrent Poppy root rotation uses a single refresh', async () => {
  let calls = 0;
  const { v } = verifier({
    fetcher: async (url) =>
      Response.json(
        url === client ? agent : { keys: [{ ...pub(++calls === 1 ? wrong : root), kid: 'root' }] },
      ),
  });
  await v.warm();
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => v.verify(request({ p: { jti: 'rotation-' + i } }))),
  );
  assert.ok(results.every((v) => v.verification === 'signature_valid'));
  assert.equal(calls, 2);
});
