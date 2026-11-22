// Signing operators added or re-checked in 0.4.0: Meta Muse, Browserbase (intermediary),
// Manus and Google (dictionary label g). Every test runs against the default registry, so the
// exact production identities and directory URLs are exercised; keys are generated locally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createVerifier, defaultRegistry, MemoryNonceStore, visitorLabels } from '../dist/index.js';
import { publicKeys } from '../dist/keys.js';
import { headers, parsedDictionary, signatureBase, agents } from '../dist/fields.js';

const clock = 1800000000;
const entry = (identity) => defaultRegistry.find((o) => o.signatureAgent === identity);
const operators = [
  { name: 'meta', identity: 'https://muse.ai', purpose: 'user_directed' },
  { name: 'kernel', identity: 'https://www.kernel.sh', purpose: 'intermediary' },
  {
    name: 'cloudflare_browser_run',
    identity: 'https://web-bot-auth.cloudflare-browser-rendering-085.workers.dev',
    purpose: 'intermediary',
  },
  { name: 'shopify_cloudsurf', identity: 'https://cloudsurf.shopify.io', purpose: 'intermediary' },
  { name: 'browserbase', identity: 'https://www.browserbase.com', purpose: 'intermediary' },
  { name: 'manus', identity: 'https://api.manus.im', purpose: 'user_directed' },
  { name: 'google', identity: 'https://agent.bot.goog', purpose: 'user_directed', label: 'g' },
  { name: 'openai', identity: 'https://chatgpt.com', purpose: 'user_directed' },
];
function keyPair(kid) {
  const pair = generateKeyPairSync('ed25519');
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const thumbprint = createHash('sha256')
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))
    .digest('base64url');
  return { pair, jwk: kid ? { ...jwk, kid } : jwk, keyid: kid || thumbprint };
}
const keys = new Map(operators.map((o) => [o.identity, keyPair(o.name === 'google' ? 'Gx1' : '')]));
const stranger = keyPair();

/** Fetcher that serves only the configured directories and records every requested URL. */
function network() {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    const owner = defaultRegistry.find((o) => o.directoryUrl === url);
    if (!owner || !keys.has(owner.signatureAgent)) return new Response('no', { status: 404 });
    return Response.json({ keys: [keys.get(owner.signatureAgent).jwk] });
  };
  return { urls, fetcher };
}
const verifierWith = (extra = {}) =>
  createVerifier({
    registry: defaultRegistry,
    authorities: ['shop.example'],
    now: () => clock,
    ...extra,
  });

/**
 * Independent RFC 9421 signer for one label. `members` maps dictionary keys to identities;
 * `cover` lists the member keys this label signs (default: its own label).
 */
function labelled({
  label,
  identity,
  members,
  cover = [label],
  key = keys.get(identity),
  created = clock,
  expires = clock + 3600,
  nonce = 'n-' + label,
  extra = [],
  paramsExtra = '',
}) {
  const components = ['"@authority"', '"@method"'];
  const lines = ['"@authority": shop.example', '"@method": GET'];
  if (members)
    for (const member of cover) {
      components.push(`"signature-agent";key="${member}"`);
      lines.push(`"signature-agent";key="${member}": ${JSON.stringify(members[member])}`);
    }
  else {
    components.push('"signature-agent"');
    lines.push(`"signature-agent": ${JSON.stringify(identity)}`);
  }
  for (const [id, value] of extra) {
    components.push(id);
    lines.push(`${id}: ${value}`);
  }
  const params =
    `(${components.join(' ')});created=${created};expires=${expires}` +
    `;keyid=${JSON.stringify(key.keyid)};alg="ed25519";nonce=${JSON.stringify(nonce)}` +
    ';tag="web-bot-auth"' +
    paramsExtra;
  const base = lines.join('\n') + '\n"@signature-params": ' + params;
  const signature = sign(null, Buffer.from(base, 'ascii'), key.pair.privateKey).toString('base64');
  return { input: `${label}=${params}`, signature: `${label}=:${signature}:`, params };
}
function request(agentHeader, ...signatures) {
  return {
    method: 'GET',
    host: 'shop.example',
    target: '/cart',
    headers: {
      'signature-agent': agentHeader,
      'signature-input': signatures.map((s) => s.input).join(', '),
      signature: signatures.map((s) => s.signature).join(', '),
    },
  };
}
const dictionary = (members) =>
  Object.entries(members)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');

test('registry: added operators have exact HTTPS identities and allowlisted directories', () => {
  for (const { name, identity } of operators) {
    const o = entry(identity);
    assert.equal(o.operator, name);
    assert.equal(o.directoryUrl, identity + '/.well-known/http-message-signatures-directory');
    assert.equal(o.verifiedByCapture, name === 'openai');
  }
  assert.equal(entry('https://www.browserbase.com').intermediary, true);
  assert.equal(defaultRegistry.filter((o) => o.directoryUrl).length, 9);
  assert.ok(entry('https://muse.ai').evidence.some((e) => e.level === 'observed'));
  for (const o of defaultRegistry)
    assert.equal(
      o.intermediary === true,
      ['browserbase', 'kernel', 'cloudflare_browser_run', 'shopify_cloudsurf'].includes(o.operator),
      o.operator,
    );
  // Amazon Bedrock AgentCore publishes no directory; the old Meta origin is not trusted for Muse.
  assert.equal(entry('https://www.meta.com'), undefined);
  assert.ok(!defaultRegistry.some((o) => /amazonaws|agentcore/i.test(o.directoryUrl ?? '')));
});

for (const { name, identity, purpose, label = 'sig1' } of operators) {
  const legacy = name !== 'google';
  const header = legacy ? JSON.stringify(identity) : dictionary({ [label]: identity });
  const members = legacy ? undefined : { [label]: identity };

  test(`${name}: valid signature verifies with purpose ${purpose}`, async () => {
    const { urls, fetcher } = network();
    const v = await verifierWith({ fetcher }).verify(
      request(header, labelled({ label, identity, members })),
    );
    assert.equal(v.verification, 'signature_valid');
    assert.equal(v.verified.operator, name);
    assert.equal(v.verified.signatureAgent, identity);
    assert.equal(v.agent_purpose, purpose);
    assert.equal(v.verified.keyidForm, name === 'google' ? 'kid' : 'thumbprint');
    assert.deepEqual(urls, [entry(identity).directoryUrl]);
    assert.deepEqual(visitorLabels({ verdict: v, browserClass: 'human', browserPhase: 'final' }), {
      vv_type: 'agent_verified',
      vv_detail: `${name}|signature_valid|${purpose}|signature_agent|human|final`,
    });
  });

  test(`${name}: wrong key, expired and replayed signatures never verify`, async () => {
    const { fetcher } = network();
    const verifier = verifierWith({ fetcher });
    const forged = labelled({
      label,
      identity,
      members,
      key: { ...stranger, keyid: keys.get(identity).keyid },
    });
    assert.equal((await verifier.verify(request(header, forged))).reason, 'crypto_mismatch');
    const unknownKey = labelled({ label, identity, members, key: stranger });
    const unknown = await verifier.verify(request(header, unknownKey));
    assert.deepEqual([unknown.verification, unknown.reason], ['none', 'unknown_keyid']);
    const old = labelled({
      label,
      identity,
      members,
      created: clock - 7200,
      expires: clock - 3600,
    });
    const expired = await verifier.verify(request(header, old));
    assert.deepEqual([expired.verification, expired.reason], ['signature_invalid', 'expired']);
    assert.equal(visitorLabels({ verdict: expired }).vv_detail.split('|')[0], 'none');
    const store = new MemoryNonceStore(100, () => clock);
    const replaying = verifierWith({ fetcher, nonceStore: store });
    const once = labelled({ label, identity, members });
    assert.equal((await replaying.verify(request(header, once))).verification, 'signature_valid');
    const again = await replaying.verify(request(header, once));
    assert.deepEqual([again.verification, again.reason], ['signature_invalid', 'replay']);
    assert.equal(visitorLabels({ verdict: again }).vv_type, 'bot_spoofed');
  });

  test(`${name}: dictionary member with one key verifies with label attribution`, async () => {
    const { fetcher } = network();
    const v = await verifierWith({ fetcher }).verify(
      request(
        dictionary({ a: identity }),
        labelled({ label: 'a', identity, members: { a: identity } }),
      ),
    );
    assert.equal(v.verification, 'signature_valid');
    assert.equal(v.verified.attribution, 'label');
  });
}

test('dictionary with several members: each label attributes only to its own member (D.2 shape)', async () => {
  // Draft-01 Appendix D.2: an outer signer covers its own member and the inner signer's member.
  const members = { agent: 'https://api.manus.im', browser: 'https://www.browserbase.com' };
  const inner = labelled({ label: 'agent', identity: members.agent, members });
  const outer = labelled({
    label: 'browser',
    identity: members.browser,
    members,
    cover: ['browser', 'agent'],
    extra: [
      ['"signature-input";key="agent"', inner.params],
      ['"signature";key="agent"', inner.signature.slice('agent='.length)],
    ],
  });
  for (const order of [
    [inner, outer],
    [outer, inner],
  ]) {
    const { urls, fetcher } = network();
    const v = await verifierWith({ fetcher }).verify(request(dictionary(members), ...order));
    assert.deepEqual(
      v.signatures.map((s) => [s.label, s.result, s.attribution]),
      order.map((s) => [s === inner ? 'agent' : 'browser', 'signature_valid', 'label']),
    );
    // The direct agent wins over the intermediary regardless of header order.
    assert.equal(v.verified.operator, 'manus');
    assert.equal(v.agent_purpose, 'user_directed');
    assert.equal(new Set(urls).size, 2);
  }
});

test('D.2 outer signature binds inner signatures; absent members fail, lossy members are indeterminate', async () => {
  const members = { agent: 'https://api.manus.im', browser: 'https://www.browserbase.com' };
  const outerOver = (inner, label = 'agent') =>
    labelled({
      label: 'browser',
      identity: members.browser,
      members,
      cover: ['browser', 'agent'],
      extra: [
        [`"signature-input";key="${label}"`, inner.params],
        [`"signature";key="${label}"`, inner.signature.slice(inner.signature.indexOf('=') + 1)],
      ],
    });
  const { fetcher } = network();
  const verifier = verifierWith({ fetcher });
  const inner = labelled({ label: 'agent', identity: members.agent, members });
  // The outer signer signed one inner signature; a different (also valid) inner one breaks it.
  const other = labelled({ label: 'agent', identity: members.agent, members, nonce: 'other' });
  const swapped = await verifier.verify(request(dictionary(members), other, outerOver(inner)));
  assert.deepEqual(
    swapped.signatures.map((s) => [s.label, s.result, s.reason]),
    [
      ['agent', 'signature_valid', 'verified'],
      ['browser', 'signature_invalid', 'crypto_mismatch'],
    ],
  );
  assert.equal(swapped.verified.operator, 'manus');
  // Stripping a covered member is a definitive verification failure (RFC 9421 §2.1.2).
  const ghost = labelled({ label: 'ghost', identity: members.agent, members });
  const absent = await verifier.verify(request(dictionary(members), outerOver(ghost, 'ghost')));
  assert.deepEqual(
    [absent.verification, absent.reason],
    ['signature_invalid', 'required_component_missing'],
  );
  // A Decimal timestamp in the covered member would not re-serialize to the signed octets.
  const decimal = {
    ...inner,
    input: inner.input.replace(`created=${clock}`, `created=${clock}.0`),
  };
  decimal.params = decimal.input.slice('agent='.length);
  const lossy = await verifier.verify(request(dictionary(members), decimal, outerOver(decimal)));
  assert.deepEqual(
    lossy.signatures.map((s) => [s.label, s.result, s.reason]),
    [
      ['agent', 'none', 'invalid_timestamp_type'],
      ['browser', 'none', 'unsupported_component'],
    ],
  );
});

test('intermediary alone is reported as infrastructure, never as the agent', async () => {
  const { fetcher } = network();
  const identity = 'https://www.browserbase.com';
  const r = request(JSON.stringify(identity), labelled({ label: 'sig1', identity }));
  r.headers['user-agent'] = 'Mozilla/5.0 ChatGPT-User/1.0';
  const v = await verifierWith({ fetcher }).verify(r);
  assert.equal(v.verified.operator, 'browserbase');
  // A UA claim of another operator cannot replace the intermediary role.
  assert.equal(v.agent_purpose, 'intermediary');
  const labels = visitorLabels({
    verdict: v,
    browserClass: 'declared_agent',
    browserAgent: 'openai',
  });
  assert.equal(labels.vv_type, 'agent_verified');
  assert.equal(
    labels.vv_detail,
    'browserbase|signature_valid|intermediary|signature_agent|declared_agent|-',
  );
});

test('two valid direct identities keep header order; an intermediary never wins over either', async () => {
  const members = {
    m: 'https://muse.ai',
    b: 'https://www.browserbase.com',
    o: 'https://chatgpt.com',
  };
  const sig = (label) => labelled({ label, identity: members[label], members });
  const { fetcher } = network();
  const verifier = verifierWith({ fetcher });
  const v = await verifier.verify(request(dictionary(members), sig('b'), sig('m'), sig('o')));
  assert.equal(v.verified.operator, 'meta');
  const w = await verifier.verify(request(dictionary(members), sig('b'), sig('o'), sig('m')));
  assert.equal(w.verified.operator, 'openai');
});

test('several covered members without a current-label match are ambiguous, a sole one relabeled', async () => {
  const members = { x: 'https://muse.ai', y: 'https://api.manus.im' };
  const { urls, fetcher } = network();
  const verifier = verifierWith({ fetcher });
  const both = labelled({ label: 'z', identity: members.x, members, cover: ['x', 'y'] });
  const ambiguous = await verifier.verify(request(dictionary(members), both));
  assert.deepEqual(
    [ambiguous.verification, ambiguous.reason],
    ['none', 'ambiguous_signature_agent'],
  );
  assert.deepEqual(urls, []);
  const sole = labelled({ label: 'z', identity: members.x, members, cover: ['x'] });
  const relabeled = await verifier.verify(request(dictionary(members), sole));
  assert.equal(relabeled.verification, 'signature_valid');
  assert.equal(relabeled.verified.attribution, 'relabeled');
  assert.equal(relabeled.verified.operator, 'meta');
});

test('unknown Signature-Agent is never fetched, also beside a trusted member', async () => {
  const { urls, fetcher } = network();
  const verifier = verifierWith({ fetcher });
  for (const identity of [
    'https://www.meta.com',
    'https://muse.ai/',
    'https://evil.example',
    'http://muse.ai',
  ]) {
    const v = await verifier.verify(
      request(JSON.stringify(identity), labelled({ label: 's', identity, key: stranger })),
    );
    assert.deepEqual([v.verification, v.reason], ['none', 'untrusted_signature_agent'], identity);
  }
  assert.deepEqual(urls, []);
  const members = { u: 'https://evil.example/.well-known/x', m: 'https://muse.ai' };
  const v = await verifier.verify(
    request(
      dictionary(members),
      labelled({ label: 'u', identity: members.u, members, key: stranger }),
      labelled({ label: 'm', identity: members.m, members }),
    ),
  );
  assert.equal(v.verification, 'signature_valid');
  assert.equal(v.signatures[0].reason, 'untrusted_signature_agent');
  assert.deepEqual(urls, [entry('https://muse.ai').directoryUrl]);
});

test('live Muse directory (2026-11-22) parses, and its own directory signatures verify', () => {
  const read = (file) => readFileSync(new URL(`fixtures/${file}`, import.meta.url), 'latin1');
  const body = JSON.parse(read('muse-directory-2026-11-22.json'));
  const parsed = publicKeys(body);
  assert.equal(parsed.size, 2);
  const headers = Object.fromEntries(
    read('muse-directory-2026-11-22.headers.txt')
      .split('\n')
      .filter((line) => line.includes(': '))
      .map((line) => [
        line.slice(0, line.indexOf(':')).toLowerCase(),
        line.slice(line.indexOf(':') + 2),
      ]),
  );
  // Directory proofs (draft-meunier-webbotauth-httpsig-directory) are checked here only as
  // interop evidence; the verifier trusts the configured HTTPS URL, not these proofs.
  const inputs = [...headers['signature-input'].matchAll(/(sig\d)=(\([^)]*\)[^,]*)/g)];
  const sigs = Object.fromEntries(
    [...headers.signature.matchAll(/(sig\d)=:([^:]+):/g)].map((m) => [m[1], m[2]]),
  );
  assert.equal(inputs.length, 2);
  for (const [, label, params] of inputs) {
    const keyid = /keyid="([^"]+)"/.exec(params)[1];
    assert.ok(parsed.has(keyid), 'keyid is a JWK thumbprint of a published key');
    const jwk = body.keys.find((k) => k.kid === keyid);
    const base = `"@authority";req: muse.ai\n"@signature-params": ${params}`;
    assert.ok(
      verify(
        null,
        Buffer.from(base, 'ascii'),
        createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' }),
        Buffer.from(sigs[label], 'base64'),
      ),
      label,
    );
  }
});

test('intermediary flag is validated configuration', () => {
  const base = {
    operator: 'infra',
    signatureAgent: 'https://infra.example',
    directoryUrl: 'https://infra.example/keys',
    verifiedByCapture: false,
    source: 'https://infra.example/docs',
    checked: '2026-11-22',
    ipLists: [],
  };
  const make = (operator) =>
    createVerifier({ registry: [operator], authorities: ['shop.example'] });
  assert.doesNotThrow(() => make({ ...base, intermediary: true }));
  assert.doesNotThrow(() => make({ ...base, intermediary: false }));
  assert.throws(() => make({ ...base, intermediary: 'yes' }), TypeError);
  const { signatureAgent, directoryUrl, ...unsigned } = base;
  assert.throws(() => make({ ...unsigned, intermediary: true }), TypeError);
});

test('an intermediary cannot hide forged or replayed direct signatures in either order', async () => {
  const members = { a: 'https://chatgpt.com', b: 'https://www.browserbase.com' };
  for (const reason of ['crypto_mismatch', 'replay']) {
    for (const reverse of [false, true]) {
      const { fetcher } = network();
      const verifier = verifierWith({
        fetcher,
        nonceStore: new MemoryNonceStore(100, () => clock),
      });
      const direct = labelled({
        label: 'a',
        identity: members.a,
        members,
        key:
          reason === 'crypto_mismatch'
            ? { ...stranger, keyid: keys.get(members.a).keyid }
            : undefined,
      });
      if (reason === 'replay')
        assert.equal(
          (await verifier.verify(request(dictionary(members), direct))).verification,
          'signature_valid',
        );
      const infra = labelled({ label: 'b', identity: members.b, members });
      const v = await verifier.verify(
        request(dictionary(members), ...(reverse ? [infra, direct] : [direct, infra])),
      );
      assert.deepEqual(
        [v.verification, v.reason, v.verified, v.agent_purpose],
        ['signature_invalid', reason, undefined, 'unknown'],
      );
      assert.equal(v.signatures.find((s) => s.label === 'b').result, 'signature_valid');
      assert.equal(
        visitorLabels({ verdict: v, browserClass: 'declared_agent', browserAgent: 'openai' })
          .vv_type,
        'bot_spoofed',
      );
      assert.equal(visitorLabels({ verdict: v }).vv_detail.split('|')[0], 'none');
    }
  }
});

test('covered members require byte sequences and string component identifiers', async () => {
  const members = { a: 'https://api.manus.im', b: 'https://www.browserbase.com' };
  for (const [field, value] of [
    ...['"not-bytes"', '123', '?1', 'foo', '("x")'].map((value) => ['signature', value]),
    ...['"not-a-list"', '(123)', '(foo)', '(?1)', '(:AA==:)'].map((value) => [
      'signature-input',
      value,
    ]),
  ]) {
    const outer = labelled({
      label: 'b',
      identity: members.b,
      members,
      extra: [[`"${field}";key="a"`, value]],
    });
    const r = request(dictionary(members), outer);
    r.headers[field] += `, a=${value}`;
    const { fetcher } = network();
    const v = await verifierWith({ fetcher }).verify(r);
    assert.deepEqual(
      v.signatures.find((s) => s.label === 'b'),
      { label: 'b', result: 'signature_invalid', reason: 'malformed_signature' },
      `${field}=${value}`,
    );
  }
});

test('stripping either kind of covered signature member is a definitive failure', async () => {
  const identity = 'https://www.browserbase.com';
  for (const name of ['signature-input', 'signature']) {
    const outer = labelled({
      label: 'b',
      identity,
      extra: [[`"${name}";key="missing"`, 'unused']],
    });
    const { fetcher } = network();
    const v = await verifierWith({ fetcher }).verify(request(JSON.stringify(identity), outer));
    assert.deepEqual(
      [v.verification, v.reason],
      ['signature_invalid', 'required_component_missing'],
    );
    assert.equal(visitorLabels({ verdict: v }).vv_type, 'bot_spoofed');
  }
});

test('lossy integral Decimals stay indeterminate; fractional and quoted extensions survive', async () => {
  const members = { a: 'https://api.manus.im', b: 'https://www.browserbase.com' };
  for (const extension of [
    ';v=1.0',
    ';v=0.0',
    ';v=-0.0',
    ';v=1.000',
    ';v=1.5',
    ';v="1.0"',
    ';v=:MS4w:',
  ]) {
    const inner = labelled({ label: 'a', identity: members.a, members, paramsExtra: extension });
    const outer = labelled({
      label: 'b',
      identity: members.b,
      members,
      extra: [
        ['"signature-input";key="a"', inner.params],
        ['"signature";key="a"', inner.signature.slice(2)],
      ],
    });
    const { fetcher } = network();
    const v = await verifierWith({ fetcher }).verify(request(dictionary(members), inner, outer));
    const lossy = [';v=1.0', ';v=0.0', ';v=-0.0', ';v=1.000'].includes(extension);
    assert.deepEqual(
      v.signatures.map((s) => [s.result, s.reason]),
      lossy
        ? [
            ['none', 'unsupported_component'],
            ['none', 'unsupported_component'],
          ]
        : [
            ['signature_valid', 'verified'],
            ['signature_valid', 'verified'],
          ],
      extension,
    );
  }
  for (const [field, value] of [
    ['signature', ':AA==:;v=1.0'],
    ['signature-input', '("@authority";v=-0.0)'],
  ]) {
    const outer = labelled({
      label: 'b',
      identity: members.b,
      members,
      extra: [[`"${field}";key="a"`, value]],
    });
    const r = request(dictionary(members), outer);
    r.headers[field] += `, a=${value}`;
    const { fetcher } = network();
    const v = await verifierWith({ fetcher }).verify(r);
    assert.equal(v.signatures.find((s) => s.label === 'b').result, 'none');
    assert.equal(v.signatures.find((s) => s.label === 'b').reason, 'unsupported_component');
  }
});

test('a fractional Decimal timestamp is indeterminate itself but faithfully covered by an outer signer', async () => {
  const members = { a: 'https://api.manus.im', b: 'https://www.browserbase.com' };
  const inner = labelled({ label: 'a', identity: members.a, members, created: clock + 0.5 });
  const outer = labelled({
    label: 'b',
    identity: members.b,
    members,
    extra: [
      ['"signature-input";key="a"', inner.params],
      ['"signature";key="a"', inner.signature.slice(2)],
    ],
  });
  const { fetcher } = network();
  const v = await verifierWith({ fetcher }).verify(request(dictionary(members), inner, outer));
  assert.deepEqual(
    v.signatures.map((s) => [s.result, s.reason]),
    [
      ['none', 'invalid_timestamp_type'],
      ['signature_valid', 'verified'],
    ],
  );
  assert.equal(v.agent_purpose, 'intermediary');
});

test('unkeyed, binary-wrapped and self-covered signature fields are unsupported', async () => {
  const identity = 'https://chatgpt.com';
  for (const name of ['signature', 'signature-input']) {
    for (const suffix of ['', ';bs', ';key="s"']) {
      const one = labelled({ label: 's', identity, extra: [[`"${name}"${suffix}`, 'unused']] });
      const { fetcher } = network();
      const v = await verifierWith({ fetcher }).verify(request(JSON.stringify(identity), one));
      assert.deepEqual([v.verification, v.reason], ['none', 'unsupported_component']);
    }
  }
});

test('short signatures stop before base construction or directory lookup, within existing caps', async () => {
  const identity = 'https://chatgpt.com';
  const { fetcher, urls } = network();
  const one = labelled({
    label: 's',
    identity,
    extra: [['"signature-input";key="missing"', 'unused']],
  });
  one.signature = 's=:AA==:';
  const v = await verifierWith({ fetcher }).verify(request(JSON.stringify(identity), one));
  assert.deepEqual([v.verification, v.reason], ['signature_invalid', 'invalid_signature_length']);
  assert.deepEqual(urls, []);
  const oversize = request(
    JSON.stringify(identity),
    ...Array.from({ length: 20 }, (_, i) => ({
      ...one,
      input: one.input.replace(/^s=/, `s${i}=`),
      signature: `s${i}=:AA==:`,
    })),
  );
  assert.equal((await verifierWith({ fetcher }).verify(oversize)).reason, 'too_many_signatures');
});

test('base construction reuses parsed request dictionaries', () => {
  const members = { a: 'https://api.manus.im', b: 'https://www.browserbase.com' };
  const inner = labelled({ label: 'a', identity: members.a, members });
  const outer = labelled({
    label: 'b',
    identity: members.b,
    members,
    extra: [
      ['"signature-input";key="a"', inner.params],
      ['"signature";key="a"', inner.signature.slice(2)],
    ],
  });
  const r = request(dictionary(members), inner, outer);
  const inputs = parsedDictionary(r.headers['signature-input'], 'signature-input');
  const signatures = parsedDictionary(r.headers.signature, 'signature');
  const h = headers(r.headers);
  const original = h.get.bind(h);
  h.get = (name) => {
    assert.ok(
      name !== 'signature' && name !== 'signature-input',
      'must not read/reparse raw signature fields',
    );
    return original(name);
  };
  assert.ok(
    signatureBase({ method: 'GET', authority: 'shop.example' }, h, inputs.members.get('b'), {
      inputs,
      signatures,
      agent: agents(r.headers['signature-agent']),
      label: 'b',
    }).includes(inner.params),
  );
});

test('purpose mappings cannot declare intermediary or conflict with its flag', () => {
  const base = entry('https://www.browserbase.com');
  const policy = { checked: '2026-11-22', sources: ['https://infra.example/docs'] };
  for (const mapping of [
    { signatureAgent: 'intermediary' },
    { ipLists: { feed: 'intermediary' } },
    { uaTokens: { Bot: 'intermediary' } },
    { signatureAgent: 'user_directed' },
  ]) {
    assert.throws(
      () => verifierWith({ registry: [{ ...base, purposes: { ...policy, ...mapping } }] }),
      TypeError,
    );
  }
});

test('blocking provisional Muse leaves eight of nine directories loaded and a failed refresh', async () => {
  let failMuse;
  const blocked = new Promise((_, reject) => {
    failMuse = reject;
  });
  const verifier = verifierWith({
    fetcher: async (url) => {
      if (url === entry('https://muse.ai').directoryUrl) return blocked;
      return Response.json({ keys: [stranger.jwk] });
    },
  });
  const warming = verifier.warm();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(verifier.status().directories, { loaded: 8, total: 9 });
  failMuse(new Error('egress blocked'));
  const result = await warming;
  assert.deepEqual(result.failed, [entry('https://muse.ai').directoryUrl]);
  assert.equal(verifier.status().lastRefreshOk, false);
  verifier.close();
});

test('intermediary config describes signatures; separate IP proof retains its product purpose', async () => {
  const base = entry('https://www.browserbase.com');
  const verifier = verifierWith({
    registry: [
      {
        ...base,
        extraUaTokens: ['InfraBot'],
        staticPrefixes: ['192.0.2.0/24'],
        purposes: {
          checked: '2026-11-22',
          sources: ['https://infra.example/docs'],
          uaTokens: { InfraBot: 'crawler' },
        },
      },
    ],
    fetcher: async () => {
      throw new Error('no network needed');
    },
  });
  const v = await verifier.verify({
    method: 'GET',
    host: 'shop.example',
    clientIp: '192.0.2.1',
    headers: { 'user-agent': 'InfraBot' },
  });
  assert.deepEqual([v.verification, v.agent_purpose], ['ip_match', 'crawler']);
});

test('weak header mismatch preserves a verified intermediary identity', async () => {
  const identity = 'https://www.browserbase.com';
  const r = request(JSON.stringify(identity), labelled({ label: 'sig1', identity }));
  r.headers['user-agent'] =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.0.0 Safari/537.36';
  r.headers.accept = 'text/html';
  const { fetcher } = network();
  const v = await verifierWith({ fetcher }).verify(r);
  assert.deepEqual(v.evidence, ['header_mismatch']);
  assert.equal(v.verification, 'signature_valid');
  assert.equal(v.verified.operator, 'browserbase');
  assert.equal(v.agent_purpose, 'intermediary');
  assert.equal(visitorLabels({ verdict: v }).vv_type, 'agent_verified');
});

for (const { name, identity } of operators.filter((o) => o.purpose === 'intermediary')) {
  test(`${name}: unsigned identity cannot verify or name an operator`, async () => {
    const { fetcher, urls } = network();
    const v = await verifierWith({ fetcher }).verify({
      method: 'GET',
      host: 'shop.example',
      headers: { 'signature-agent': JSON.stringify(identity) },
    });
    assert.equal(v.verification, 'no_signature');
    assert.equal(v.verified, undefined);
    assert.equal(v.agent_purpose, 'unknown');
    assert.deepEqual(urls, []);
    assert.equal(visitorLabels({ verdict: v }).vv_type, 'agent_unverified');
    assert.equal(visitorLabels({ verdict: v }).vv_detail.split('|')[0], 'none');
  });

  test(`${name}: infrastructure purpose beats unsigned UA/marker claims, direct proof wins in either order`, async () => {
    const { fetcher } = network();
    const v = verifierWith({ fetcher });
    const infra = request(JSON.stringify(identity), labelled({ label: 's', identity }));
    infra.headers['user-agent'] = 'ChatGPT-User/1.0';
    const proof = await v.verify(infra);
    assert.equal(proof.agent_purpose, 'intermediary');
    assert.equal(
      visitorLabels({
        verdict: proof,
        browserClass: 'declared_agent',
        browserAgent: 'openai',
      }).vv_detail.split('|')[0],
      name,
    );
    const members = { agent: 'https://chatgpt.com', infra: identity };
    const a = labelled({ label: 'agent', identity: members.agent, members });
    const b = labelled({ label: 'infra', identity, members });
    for (const signatures of [
      [a, b],
      [b, a],
    ]) {
      const direct = await v.verify(request(dictionary(members), ...signatures));
      assert.equal(direct.verified.operator, 'openai');
      assert.equal(direct.agent_purpose, 'user_directed');
    }
  });
}
