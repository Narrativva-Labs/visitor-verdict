import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identity, operator, signed, makeVerifier } from './helpers.mjs';

const otherIdentity = 'https://other.example';
const otherOperator = {
  ...operator,
  operator: 'other',
  signatureAgent: otherIdentity,
  directoryUrl: otherIdentity + '/keys',
};
const signatureVerifier = makeVerifier({ registry: [operator, otherOperator] });

function dictionaryRequest(keys, agent, label = 's') {
  return signed({
    label,
    agent,
    components: ['"@authority"', ...keys.map((key) => '"signature-agent";key="' + key + '"')],
    values: Object.fromEntries(
      keys.map((key) => [
        '"signature-agent";key="' + key + '"',
        JSON.stringify(key === 'other' ? otherIdentity : identity),
      ]),
    ),
  });
}

test('an intermediary may relabel Signature and Signature-Input without changing covered identity', async () => {
  const request = dictionaryRequest(['original'], `original="${identity}"`, 'original');
  for (const name of ['signature', 'signature-input'])
    request.headers[name] = request.headers[name].replace(/^original=/, 'relabeled=');
  const verdict = await signatureVerifier.verify(request);
  assert.equal(verdict.verification, 'signature_valid');
  assert.equal(verdict.verified.operator, 'test');
  assert.equal(verdict.verified.attribution, 'relabeled');
  assert.equal(verdict.signatures[0].label, 'relabeled');
  assert.equal(verdict.signatures[0].attribution, 'relabeled');
});

for (const keys of [
  ['s', 'other'],
  ['other', 's'],
])
  test(
    'a covered member matching the current label wins regardless of component order: ' + keys,
    async () => {
      const request = dictionaryRequest(keys, `s="${identity}", other="${otherIdentity}"`);
      const verdict = await signatureVerifier.verify(request);
      assert.equal(verdict.verification, 'signature_valid');
      assert.equal(verdict.verified.operator, 'test');
      assert.equal(verdict.verified.attribution, 'label');
      assert.equal(verdict.signatures[0].attribution, 'label');
    },
  );

test('an uncovered member matching the current label cannot override a sole covered member', async () => {
  const request = dictionaryRequest(['other'], `s="${identity}", other="${otherIdentity}"`);
  const verdict = await signatureVerifier.verify(request);
  assert.equal(verdict.verification, 'signature_valid');
  assert.equal(verdict.verified.operator, 'other');
  assert.equal(verdict.verified.signatureAgent, otherIdentity);
  assert.equal(verdict.verified.attribution, 'relabeled');
  request.headers['signature-agent'] = `s="https://uncovered.example", other="${otherIdentity}"`;
  assert.equal((await signatureVerifier.verify(request)).verification, 'signature_valid');
});

test('several covered keyed members without a current-label match are indeterminate without fetching', async () => {
  let fetches = 0;
  const verifier = makeVerifier({
    registry: [operator, otherOperator],
    fetcher: async () => {
      fetches++;
      throw new Error('Must not fetch');
    },
  });
  for (const other of [identity, otherIdentity]) {
    const key = other === identity ? 'another' : 'other';
    const request = dictionaryRequest(
      ['original', key],
      `original="${identity}", ${key}="${other}"`,
    );
    const verdict = await verifier.verify(request);
    assert.equal(verdict.verification, 'none');
    assert.equal(verdict.reason, 'ambiguous_signature_agent');
    assert.equal(verdict.verified, undefined);
    assert.equal(verdict.signatures[0].result, 'none');
  }
  assert.equal(fetches, 0);
});

test('an uncovered trusted identity cannot supply the operator or key directory', async () => {
  let fetches = 0;
  const verifier = makeVerifier({
    fetcher: async () => {
      fetches++;
      throw new Error('Must not fetch');
    },
  });
  const request = dictionaryRequest(['other'], `s="${identity}", other="${otherIdentity}"`);
  const verdict = await verifier.verify(request);
  assert.equal(verdict.verification, 'none');
  assert.equal(verdict.reason, 'untrusted_signature_agent');
  assert.equal(verdict.verified, undefined);
  assert.equal(fetches, 0);
});

test('a covered but untrusted current-label member cannot fall back to a different covered identity', async () => {
  const request = dictionaryRequest(['s', 'other'], `s="${identity}", other="${otherIdentity}"`);
  const verdict = await makeVerifier({ registry: [otherOperator] }).verify(request);
  assert.equal(verdict.verification, 'none');
  assert.equal(verdict.reason, 'untrusted_signature_agent');
  assert.equal(verdict.verified, undefined);
});

test('a valid peer wins while ambiguous attribution remains visible per label', async () => {
  const agent = `s="${identity}", original="${identity}", other="${otherIdentity}"`;
  const request = dictionaryRequest(['original', 'other'], agent, 'ambiguous');
  const peer = dictionaryRequest(['s'], agent);
  for (const name of ['signature', 'signature-input'])
    request.headers[name] += ', ' + peer.headers[name];
  const verdict = await signatureVerifier.verify(request);
  assert.equal(verdict.verification, 'signature_valid');
  assert.equal(verdict.verified.attribution, 'label');
  assert.deepEqual(
    verdict.signatures.map(({ label, result, reason }) => ({ label, result, reason })),
    [
      { label: 'ambiguous', result: 'none', reason: 'ambiguous_signature_agent' },
      { label: 's', result: 'signature_valid', reason: 'verified' },
    ],
  );
});

test('relabeling never allows changing a covered member key', async () => {
  const request = dictionaryRequest(['original'], `original="${identity}"`);
  request.headers['signature-agent'] = `changed="${identity}"`;
  request.headers['signature-input'] = request.headers['signature-input'].replace(
    ';key="original"',
    ';key="changed"',
  );
  const verdict = await signatureVerifier.verify(request);
  assert.equal(verdict.verification, 'signature_invalid');
  assert.equal(verdict.reason, 'crypto_mismatch');
});

const dnsRequest = (token = 'Baiduspider', clientIp = '192.0.2.1') => ({
  method: 'GET',
  host: 'example.com',
  clientIp,
  headers: { 'user-agent': token },
});
function dnsVerifier(resolver, options = {}) {
  return makeVerifier({
    registry: [
      {
        ...operator,
        extraUaTokens: ['Baiduspider', 'PetalBot'],
        reverseDns: [
          {
            uaTokens: ['Baiduspider'],
            suffixes: ['baidu.com'],
            source: 'test fixture',
            checked: '2026-11-20',
          },
          {
            uaTokens: ['PetalBot'],
            suffixes: ['petalsearch.com'],
            source: 'test fixture',
            checked: '2026-11-20',
          },
        ],
      },
    ],
    reverseDns: { enabled: true, resolver, timeoutMs: 100, ...options },
  });
}
const resolver = (extra = {}) => ({
  reverse: async () => ['baiduspider-180-76-15-5.crawl.baidu.com'],
  resolve4: async () => [],
  resolve6: async () => [],
  ...extra,
});
const dnsError = (code) => Object.assign(new Error('DNS test failure'), { code });

for (const code of ['ENODATA', 'ENOTFOUND'])
  test(
    'forward ' + code + ' is definitive and does not wait for the other address family',
    async () => {
      let reverseCalls = 0;
      let wrongFamilyCalls = 0;
      const verifier = dnsVerifier(
        resolver({
          reverse: async () => {
            reverseCalls++;
            return ['baiduspider-180-76-15-5.crawl.baidu.com'];
          },
          resolve4: async () => {
            throw dnsError(code);
          },
          resolve6: () => {
            wrongFamilyCalls++;
            return new Promise(() => {});
          },
        }),
      );
      for (let i = 0; i < 2; i++) {
        const verdict = await verifier.verify(dnsRequest());
        assert.equal(verdict.verification, 'no_signature');
        assert.equal(verdict.reason, 'reverse_dns_not_confirmed');
        assert.equal(verdict.verified, undefined);
      }
      assert.equal(reverseCalls, 1);
      assert.equal(wrongFamilyCalls, 0);
    },
  );

for (const token of ['Baiduspider', 'PetalBot'])
  test('suffix mismatch is immediately definitive with no forward lookups: ' + token, async () => {
    let forwardCalls = 0;
    const hang = () => {
      forwardCalls++;
      return new Promise(() => {});
    };
    const verifier = dnsVerifier(
      resolver({
        reverse: async () => ['ecs-114-119-132-1.compute.hwclouds-dns.com'],
        resolve4: hang,
        resolve6: hang,
      }),
    );
    const verdict = await verifier.verify(dnsRequest(token));
    assert.equal(verdict.verification, 'no_signature');
    assert.equal(verdict.reason, 'reverse_dns_not_confirmed');
    assert.equal(forwardCalls, 0);
  });

test('an empty or mismatching forward answer is definitive for either address family', async () => {
  for (const [ip, records] of [
    ['192.0.2.1', []],
    ['192.0.2.1', ['192.0.2.2']],
    ['2001:db8::1', ['2001:db8::2']],
  ]) {
    const verdict = await dnsVerifier(
      resolver({
        resolve4: async () => records,
        resolve6: async () => records,
      }),
    ).verify(dnsRequest('Baiduspider', ip));
    assert.equal(verdict.verification, 'no_signature');
    assert.equal(verdict.reason, 'reverse_dns_not_confirmed');
  }
});

for (const stage of ['reverse', 'resolve4'])
  test('operational resolver error stays unavailable: ' + stage, async () => {
    const verdict = await dnsVerifier(
      resolver({
        [stage]: async () => {
          throw dnsError('ESERVFAIL');
        },
      }),
    ).verify(dnsRequest());
    assert.equal(verdict.verification, 'none');
    assert.equal(verdict.reason, 'reverse_dns_unavailable');
  });

test('a DNS timeout stays unavailable', async () => {
  const verifier = dnsVerifier(resolver({ resolve4: () => new Promise(() => {}) }), {
    timeoutMs: 10,
  });
  const verdict = await verifier.verify(dnsRequest());
  assert.equal(verdict.verification, 'none');
  assert.equal(verdict.reason, 'reverse_dns_unavailable');
});

test('a later PTR can forward-confirm despite an earlier negative answer', async () => {
  const verdict = await dnsVerifier(
    resolver({
      reverse: async () => ['missing.baidu.com', 'valid.baidu.com'],
      resolve4: async (name) => {
        if (name.startsWith('missing')) throw dnsError('ENODATA');
        return ['192.0.2.1'];
      },
    }),
  ).verify(dnsRequest());
  assert.equal(verdict.verification, 'ip_match');
  assert.equal(verdict.reason, 'reverse_dns_match');
});

test('requests without an eligible DNS claim keep the ordinary unsigned reason', async () => {
  const verdict = await dnsVerifier(resolver()).verify(dnsRequest('Mozilla/5.0'));
  assert.equal(verdict.verification, 'no_signature');
  assert.equal(verdict.reason, 'signature_headers_absent');
});
