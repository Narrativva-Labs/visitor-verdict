import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createVerifier,
  defaultRegistry,
  toAnalyticsFields,
  coveredHeaderNames,
} from '../dist/index.js';
import { publicKeys } from '../dist/keys.js';
import { generated } from '../scripts/generate-tokens.mjs';
import {
  clock,
  identity,
  jwk,
  keyid,
  operator,
  fixture,
  signed,
  verifier,
  makeVerifier,
} from './helpers.mjs';

const captures = fixture('chatgpt-agent-2026-11-20.json').requests;
let capturedNow = Date.parse(captures[0].ts) / 1000;
let captureFetches = 0;
const realHeaders = Object.fromEntries(
  readFileSync(new URL('fixtures/openai-directory-2026-11-20.headers.txt', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes(':'))
    .map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
);
const captureVerifier = createVerifier({
  registry: defaultRegistry,
  authorities: [captures[0].headers.host],
  now: () => capturedNow,
  fetcher: async () => {
    captureFetches++;
    return Response.json(fixture('openai-directory-2026-11-20.json'), { headers: realHeaders });
  },
});
test('int-1/sec-F5: replay all 32 captures through ONE verifier with REAL no-store headers', async () => {
  assert.equal(captures.length, 32);
  assert.match(realHeaders['cache-control'], /no-store/);
  for (const r of captures) {
    capturedNow = Date.parse(r.ts) / 1000;
    const v = await captureVerifier.verify({
      method: r.method,
      host: r.headers.host,
      headers: r.headers,
    });
    assert.equal(v.verification, 'signature_valid');
    assert.equal(v.verified.operator, 'openai');
    assert.equal(v.verified.keyidForm, 'thumbprint');
  }
  assert.equal(captureFetches, 1);
  for (const r of captures) {
    capturedNow = Date.parse(r.ts) / 1000 + 7200;
    const v = await captureVerifier.verify({
      method: r.method,
      host: r.headers.host,
      headers: r.headers,
    });
    assert.equal(v.verification, 'signature_invalid');
    assert.equal(v.reason, 'expired');
  }
});
test('UA tokens match generated browser defaults', () => {
  assert.equal(
    readFileSync(new URL('../src/tokens.generated.ts', import.meta.url), 'utf8'),
    generated(),
  );
});
test('baseline independent signature', async () => {
  assert.equal((await verifier.verify(signed())).verification, 'signature_valid');
});
const mutations = [
  ['unknown_authority', (r) => (r.host = 'other.example')],
  ['crypto_mismatch', (r) => (r.method = 'POST')],
  [
    'untrusted_signature_agent',
    (r) => (r.headers['signature-agent'] = '"https://unknown.example"'),
  ],
  [
    'signature_agent_not_covered',
    (r) =>
      (r.headers['signature-input'] = r.headers['signature-input'].replace(
        ' "signature-agent"',
        '',
      )),
  ],
  [
    'ignored_non_wba',
    (r) =>
      (r.headers['signature-input'] = r.headers['signature-input'].replace(
        'web-bot-auth',
        'wrong',
      )),
  ],
  [
    'missing_keyid',
    (r) =>
      (r.headers['signature-input'] = r.headers['signature-input'].replace(/;keyid="[^"]*"/, '')),
  ],
  [
    'future_created',
    (r) =>
      (r.headers['signature-input'] = r.headers['signature-input'].replace(
        'created=' + clock,
        'created=' + (clock + 31),
      )),
  ],
  [
    'invalid_validity_window',
    (r) =>
      (r.headers['signature-input'] = r.headers['signature-input'].replace(
        'expires=' + (clock + 3600),
        'expires=' + (clock + 86401),
      )),
  ],
  ['duplicate_key', (r) => (r.headers.signature += ', ' + r.headers.signature)],
  ['duplicate_key', (r) => (r.headers['signature-input'] += ';tag="web-bot-auth"')],
  [
    'duplicate_key',
    (r) =>
      (r.headers['signature-input'] = r.headers['signature-input'].replace(
        '"@method"',
        '"@method";x=1;x=2',
      )),
  ],
  ['headers_too_large', (r) => (r.headers.signature = 'x'.repeat(16385))],
  ['malformed_base64', (r) => (r.headers.signature = 's=:%%%:')],
  ['malformed_structured_field', (r) => (r.headers.signature = 's=:AAA=AAAA:')],
  ['invalid_signature_length', (r) => (r.headers.signature = 's=:YQ==:')],
  [
    'unsupported_component',
    (r) =>
      (r.headers['signature-input'] = r.headers['signature-input'].replace(
        '"@method"',
        '"@unsupported"',
      )),
  ],
  [
    'insufficient_context',
    (r) =>
      (r.headers['signature-input'] = r.headers['signature-input'].replace(
        '"@method"',
        '"content-digest"',
      )),
  ],
  [
    'too_many_signatures',
    (r) => (r.headers.signature = Array.from({ length: 5 }, (_, i) => `s${i}=:YQ==:`).join(', ')),
  ],
  [
    'too_many_components',
    (r) =>
      (r.headers['signature-input'] = r.headers['signature-input'].replace(
        '"@method"',
        Array(33).fill('"@method"').join(' '),
      )),
  ],
  ['incomplete_signature_headers', (r) => delete r.headers.signature],
];
for (const [reason, mutate] of mutations)
  test('negative: ' + reason, async () => {
    const r = signed();
    mutate(r);
    const v = await verifier.verify(r);
    assert.equal(v.reason, reason);
    assert.notEqual(v.verification, 'signature_valid');
  });
for (const host of [undefined, '', ' EXAMPLE.COM:443\t', 'internal.local', {}, 'example.com/path'])
  test('int-2/std-5: unsigned host ' + JSON.stringify(host), async () => {
    const v = await verifier.verify({ host, method: 'GET', headers: {} });
    assert.notEqual(v.verification, 'signature_invalid');
    assert.equal(
      v.reason,
      host === ' EXAMPLE.COM:443\t' ? 'signature_headers_absent' : 'unknown_authority',
    );
  });
test('configured authority is canonicalized; raw Host is not guessed/compared', async () => {
  const r = signed();
  r.host = ' \tExAmPlE.Com:443\t';
  r.headers.host = '127.0.0.1:3000';
  assert.equal((await verifier.verify(r)).verification, 'signature_valid');
});
for (const wrap of [
  (h) => new Headers(h),
  (h) => new Map(Object.entries(h)),
  (h) => Object.entries(h).flat(),
  (h) => ({ ...h }),
])
  test('int-5: supported transport headers ' + wrap.toString(), async () => {
    const r = signed();
    r.headers = wrap(r.headers);
    assert.equal((await verifier.verify(r)).verification, 'signature_valid');
  });
for (const bad of [null, undefined, 'headers', 3, new Date(), new Set()])
  test('unsupported header container is a programmer error ' + String(bad), async () => {
    await assert.rejects(
      verifier.verify({ host: 'example.com', method: 'GET', headers: bad }),
      TypeError,
    );
  });
for (const change of [
  (o) => (o.authorities = []),
  (o) => (o.authorities = ['bad/path']),
  (o) => (o.authorities = ['example.com', 'EXAMPLE.COM:443']),
  (o) => (o.deadlineMs = 0),
  (o) => (o.fetchTimeoutMs = NaN),
  (o) => (o.fetcher = 3),
  (o) => (o.nonceStore = {}),
  (o) => (o.registry = [{ ...operator, directoryUrl: 'http://agent.example/keys' }]),
  (o) => (o.registry = [{ ...operator, directoryUrl: 'https://agent.example/keys#x' }]),
  (o) => (o.registry = [operator, operator]),
])
  test('construction rejects bad config: ' + change.toString(), () => {
    const options = { registry: [operator], authorities: ['example.com'] };
    change(options);
    assert.throws(() => createVerifier(options));
  });
test('int-4: milliseconds, nonfinite or throwing clocks are indeterminate', async () => {
  for (const now of [
    () => Date.now(),
    () => NaN,
    () => {
      throw Error('do not leak');
    },
  ]) {
    const v = await makeVerifier({ now }).verify(signed());
    assert.equal(v.verification, 'none');
    assert.ok(['invalid_clock', 'internal_error'].includes(v.reason));
  }
});
test('unknown identity never fetches, including IP lists', async () => {
  const v = makeVerifier({ fetcher: async () => assert.fail('network forbidden') });
  const r = signed({ agent: '"https://unknown.example"' });
  r.clientIp = '192.0.2.1';
  assert.equal((await v.verify(r)).reason, 'untrusted_signature_agent');
});
test('synthetic Google dictionary signature with generated key', async () => {
  const r = signed({
    label: 'g',
    agent: 'g="https://agent.bot.goog"',
    components: ['"@authority"', '"signature-agent";key="g"'],
    values: { '"signature-agent";key="g"': '"https://agent.bot.goog"' },
  });
  const v = makeVerifier({
    registry: [{ ...operator, operator: 'google', signatureAgent: 'https://agent.bot.goog' }],
  });
  assert.equal((await v.verify(r)).verification, 'signature_valid');
});
test('std-1: unparameterized dictionary works; unsupported peers do not poison valid signature', async () => {
  const r = signed({
    agent: `s="${identity}", other="https://other.example";type="jwks_uri"`,
    components: ['"@authority"', '"signature-agent";key="s"'],
    values: { '"signature-agent";key="s"': `"${identity}"` },
  });
  r.headers['signature-input'] +=
    ', other=("@authority" "signature-agent";key="other");created=' +
    clock +
    ';expires=' +
    (clock + 100) +
    ';keyid="unknown";tag="web-bot-auth"';
  r.headers.signature += ', other=:' + Buffer.alloc(64).toString('base64') + ':';
  const v = await verifier.verify(r);
  assert.equal(v.verification, 'signature_valid');
  assert.equal(v.signatures[1].reason, 'untrusted_signature_agent');
});
test('std-7: tokens with colons and separate inner-list parameter scopes remain valid SF', async () => {
  const r = signed();
  r.headers['signature-input'] += ', other=(a;p=1 b;p=2);ctx=urn:foo:bar';
  r.headers.signature += ', other=:YQ==:';
  const v = await verifier.verify(r);
  assert.equal(v.verification, 'signature_valid');
  assert.equal(v.signatures.length, 2);
});
test('std-7: each Signature-Agent field line has OWS stripped', async () => {
  const r = signed({
    agent: `s="${identity}", other="https://other.example"`,
    components: ['"@authority"', '"signature-agent"'],
  });
  r.headers['signature-agent'] = [` \ts="${identity}"\t `, ' other="https://other.example" '];
  // Bare dictionary coverage is not sufficient policy; test member coverage separately.
  assert.equal((await verifier.verify(r)).reason, 'signature_agent_not_covered');
  const legacy = signed();
  legacy.headers['signature-agent'] = '\t ' + legacy.headers['signature-agent'] + ' \t';
  assert.equal((await verifier.verify(legacy)).verification, 'signature_valid');
});
for (const name of ['google', 'duckduckgo', 'browserbase', 'manus', 'openai'])
  test('live ' + name + ' directory parses', () => {
    const keys = publicKeys(
      fixture(name + '-directory-2026-11-20.json'),
      undefined,
      name === 'google',
    );
    assert.ok(keys.size > 0);
    if (name === 'google') assert.ok(keys.has('mhxuPw'));
  });
test('std-2: custom kid AND thumbprint index, Ed25519 alg, multiple key_ops and mixed keys', async () => {
  const data = {
    keys: [
      { kty: 'RSA', alg: 'PS512' },
      { ...jwk, kid: 'custom', alg: 'Ed25519', key_ops: ['verify', 'sign'] },
    ],
  };
  const keys = publicKeys(data, undefined, true);
  assert.equal(keys.get('custom'), keys.get(keyid));
  const v = makeVerifier({
    registry: [{ ...operator, allowKidAlias: true }],
    fetcher: async () => Response.json(data),
  });
  assert.equal((await v.verify(signed({ kid: 'custom' }))).verified.keyidForm, 'kid');
  assert.equal((await v.verify(signed())).verified.keyidForm, 'thumbprint');
});
test('unsupported/broken keys skipped, structural/private directories rejected', () => {
  assert.equal(publicKeys({ keys: [{ ...jwk, x: 'short' }, { ...jwk, use: 'enc' }, jwk] }).size, 1);
  for (const data of [
    {},
    { keys: [null] },
    { keys: Array(33).fill(jwk) },
    { keys: [{ ...jwk, d: 'private' }] },
    { keys: [jwk, jwk] },
  ])
    assert.throws(() => publicKeys(data));
});
test('nbf and exp honored on cached keys', async () => {
  let now = clock;
  let calls = 0;
  const v = makeVerifier({
    now: () => now,
    fetcher: async () => {
      calls++;
      return Response.json({ keys: [{ ...jwk, nbf: clock + 1, exp: clock + 3 }] });
    },
  });
  assert.equal((await v.verify(signed())).reason, 'unknown_keyid');
  now++;
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  now += 2;
  assert.equal((await v.verify(signed())).reason, 'unknown_keyid');
  assert.equal(calls, 1);
});
test('atomic replay store is optional and called after crypto only', async () => {
  const keys = new Set();
  const v = makeVerifier({
    nonceStore: {
      async insertIfAbsent(key, ttl) {
        assert.ok(ttl > 3600);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      },
    },
  });
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  assert.equal((await v.verify(signed())).reason, 'replay');
  const bad = signed();
  bad.method = 'POST';
  assert.equal((await v.verify(bad)).reason, 'crypto_mismatch');
});
test('nonce store and overall verification are time-boxed', async () => {
  const nonceStore = { insertIfAbsent: () => new Promise(() => {}) };
  const v = makeVerifier({ nonceStore, fetchTimeoutMs: 20 });
  assert.equal((await v.verify(signed())).reason, 'nonce_store_timeout');
  const overall = makeVerifier({ nonceStore, deadlineMs: 20, fetchTimeoutMs: 500 });
  assert.equal((await overall.verify(signed())).reason, 'deadline_exceeded');
});
test('unknown key single-flight forced refresh then cooldown', async () => {
  let calls = 0;
  const v = makeVerifier({
    fetcher: async () => {
      calls++;
      return Response.json({ keys: [jwk] });
    },
  });
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  await Promise.all(Array.from({ length: 20 }, () => v.verify(signed({ kid: 'unknown' }))));
  assert.equal(calls, 2);
  assert.equal((await v.verify(signed({ kid: 'random' }))).reason, 'unknown_keyid');
  assert.equal(calls, 2);
});
test('coveredHeaderNames identifies fields, not derived components', () => {
  assert.deepEqual(coveredHeaderNames('s=("@authority" "signature-agent";key="s" "date")'), [
    'signature-agent',
    'date',
  ]);
  assert.throws(() => coveredHeaderNames('s=() , s=()'));
});
test('UA-only claim is unverified and analytics fields exclude raw claims', async () => {
  const v = await verifier.verify({
    method: 'GET',
    host: 'example.com',
    headers: { 'user-agent': 'ChatGPT-User' },
  });
  assert.equal(v.verification, 'no_signature');
  assert.deepEqual(toAnalyticsFields(v), {
    agent_claim: 'ua_token',
    agent_verification: 'no_signature',
    agent_operator: 'none',
  });
});
for (const parameter of ['type="jwks_uri"', 'type="cimd"', 'type=directory', 'other="x"'])
  test('unsupported member parameter is untrusted: ' + parameter, async () => {
    const r = signed({
      agent: `s="${identity}";${parameter}`,
      components: ['"@authority"', '"signature-agent";key="s"'],
      values: { '"signature-agent";key="s"': `"${identity}";${parameter}` },
    });
    assert.equal((await verifier.verify(r)).reason, 'untrusted_signature_agent');
  });
test('a covered unknown member cannot attribute a signature to an uncovered trusted member', async () => {
  const r = signed({
    agent: `s="${identity}", other="https://untrusted.example"`,
    components: ['"@authority"', '"signature-agent";key="other"'],
    values: { '"signature-agent";key="other"': '"https://untrusted.example"' },
  });
  assert.equal((await verifier.verify(r)).reason, 'untrusted_signature_agent');
});
for (const options of [
  { created: clock + 30 },
  { created: clock - 100, expires: clock - 30 },
  { expires: clock + 86400 },
])
  test('freshness boundary accepted: ' + JSON.stringify(options), async () => {
    assert.equal((await verifier.verify(signed(options))).verification, 'signature_valid');
  });
for (const options of [{ created: clock - 100, expires: clock - 31 }, { expires: clock - 1 }])
  test('freshness failure: ' + JSON.stringify(options), async () => {
    assert.equal((await verifier.verify(signed(options))).verification, 'signature_invalid');
  });
test('constructor snapshots caller registry configuration', async () => {
  const entry = { ...operator, ipLists: [] };
  const v = makeVerifier({ registry: [entry] });
  entry.directoryUrl = 'https://untrusted.example/keys';
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
});
