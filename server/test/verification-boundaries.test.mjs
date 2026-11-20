import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { createVerifier, visitorLabels } from '../dist/index.js';
import {
  clock,
  identity,
  directoryUrl,
  jwk,
  operator,
  fetcher,
  makeVerifier,
  verifier,
  signed,
} from './helpers.mjs';

const thumb = (k) =>
  createHash('sha256')
    .update(JSON.stringify({ crv: k.crv, kty: k.kty, x: k.x }))
    .digest('base64url');

test('duplicate covered component is rejected', async () => {
  const v = await verifier.verify(
    signed({ components: ['"@authority"', '"@method"', '"@method"', '"signature-agent"'] }),
  );
  assert.equal(v.reason, 'duplicate_component');
  assert.equal(v.verification, 'signature_invalid');
});

test('signature that covers neither @authority nor @target-uri is rejected', async () => {
  const v = await verifier.verify(signed({ components: ['"@method"', '"signature-agent"'] }));
  assert.equal(v.reason, 'required_component_missing');
  assert.equal(v.verification, 'signature_invalid');
});

test('empty keyid is missing_keyid (invalid), not unknown_keyid', async () => {
  const v = await verifier.verify(signed({ kid: '' }));
  assert.equal(v.reason, 'missing_keyid');
  assert.equal(v.verification, 'signature_invalid');
});

test('65-byte signature reports invalid_signature_length', async () => {
  const r = signed();
  r.headers.signature = 's=:' + Buffer.alloc(65, 1).toString('base64') + ':';
  assert.equal((await verifier.verify(r)).reason, 'invalid_signature_length');
});

test('cache-only with unknown keyid never waits for the forced refetch', async () => {
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  let calls = 0;
  const v = makeVerifier({
    fetcher: async () => {
      calls++;
      if (calls === 1) return Response.json({ keys: [other] });
      return new Promise(() => {}); // the forced refetch hangs
    },
    deadlineMs: 400,
  });
  await v.warm();
  const started = Date.now();
  const verdict = await v.verify(signed(), { cacheOnly: true });
  assert.equal(verdict.reason, 'cache_miss');
  assert.ok(Date.now() - started < 200);
  assert.equal(calls, 2); // a background refetch was started
});

test('an OKP key with crv X25519 is not used as an Ed25519 key', async () => {
  const v = makeVerifier({
    fetcher: async () => Response.json({ keys: [{ ...jwk, crv: 'X25519' }] }),
  });
  const r = signed({ kid: thumb({ ...jwk, crv: 'X25519' }) });
  assert.notEqual((await v.verify(r)).verification, 'signature_valid');
});

test('two keys with the same kid alias are ambiguous (none), never first-wins', async () => {
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  const v = makeVerifier({
    registry: [{ ...operator, allowKidAlias: true }],
    fetcher: async () =>
      Response.json({
        keys: [
          { ...other, kid: 'k' },
          { ...jwk, kid: 'k' },
        ],
      }),
  });
  const verdict = await v.verify(signed({ kid: 'k' }));
  assert.equal(verdict.reason, 'ambiguous_keyid');
  assert.equal(verdict.verification, 'none');
});

test('a directory with more than 32 keys is rejected', async () => {
  const keys = Array.from({ length: 33 }, () => jwk);
  const v = makeVerifier({ fetcher: async () => Response.json({ keys }) });
  const verdict = await v.verify(signed());
  assert.equal(verdict.reason, 'invalid_directory');
});

test('a key whose key_ops lack verify is skipped', async () => {
  const v = makeVerifier({
    fetcher: async () => Response.json({ keys: [{ ...jwk, key_ops: ['sign'] }] }),
  });
  assert.equal((await v.verify(signed())).reason, 'unknown_keyid');
});

test('directory fetch uses redirect manual and omits credentials', async () => {
  const seen = [];
  const v = makeVerifier({
    fetcher: async (url, init) => {
      seen.push(init);
      return Response.json({ keys: [jwk] });
    },
  });
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  assert.equal(seen[0].redirect, 'manual');
  assert.equal(seen[0].credentials, 'omit');
});

const ipOperator = {
  operator: 'iptest',
  verifiedByCapture: false,
  source: 'synthetic',
  checked: '2026-11-20',
  extraUaTokens: ['TestBot'],
  ipLists: [{ name: 'ips', url: 'https://agent.example/ips', uaTokens: ['TestBot'] }],
};
const ipVerifier = (prefixes, extra = {}) =>
  createVerifier({
    registry: [ipOperator],
    authorities: ['example.com'],
    now: () => clock,
    fetcher: async () => Response.json({ prefixes }),
    ...extra,
  });
const uaReq = (ua, ip, headers = {}) => ({
  method: 'GET',
  host: 'example.com',
  target: '/',
  clientIp: ip,
  headers: { 'user-agent': ua, ...headers },
});

test('a bare address (no /bits) matches only itself', async () => {
  const v = ipVerifier([{ ipv4Prefix: '192.0.2.1' }]);
  assert.equal((await v.verify(uaReq('TestBot/1.0', '192.0.2.1'))).verification, 'ip_match');
  assert.notEqual((await v.verify(uaReq('TestBot/1.0', '198.51.100.7'))).verification, 'ip_match');
});

test('static operator ranges require the operator UA claim', async () => {
  const v = createVerifier({
    registry: [{ ...ipOperator, ipLists: [], staticPrefixes: ['192.0.2.0/24'] }],
    authorities: ['example.com'],
    now: () => clock,
    fetcher,
  });
  assert.equal((await v.verify(uaReq('TestBot/1.0', '192.0.2.9'))).verification, 'ip_match');
  assert.notEqual((await v.verify(uaReq('Mozilla/5.0', '192.0.2.9'))).verification, 'ip_match');
});

test('unknown Signature-Agent without a signature is none/untrusted', async () => {
  const v = await verifier.verify({
    method: 'GET',
    host: 'example.com',
    headers: { 'signature-agent': '"https://unknown.example"' },
  });
  assert.equal(v.reason, 'untrusted_signature_agent');
  assert.equal(v.verification, 'none');
});

test('untrusted Signature-Agent claim never loads IP lists', async () => {
  let ipFetches = 0;
  const v = ipVerifier([{ ipv4Prefix: '192.0.2.0/24' }], {
    fetcher: async () => {
      ipFetches++;
      return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    },
  });
  const r = signed({ agent: '"https://unknown.example"' });
  r.clientIp = '192.0.2.9';
  r.headers['user-agent'] = 'TestBot/1.0';
  const verdict = await v.verify(r);
  assert.equal(verdict.ip, undefined);
  assert.equal(ipFetches, 0);
});

test('no reverse DNS lookup after a verified signature', async () => {
  let reverse = 0;
  const resolver = {
    reverse: async () => (reverse++, []),
    resolve4: async () => [],
    resolve6: async () => [],
  };
  const v = createVerifier({
    registry: [
      {
        ...operator,
        reverseDns: [
          { uaTokens: ['TestBot'], suffixes: ['agent.example'], source: 's', checked: 'c' },
        ],
        extraUaTokens: ['TestBot'],
      },
    ],
    authorities: ['example.com'],
    now: () => clock,
    fetcher,
    reverseDns: { enabled: true, resolver },
  });
  const r = signed();
  r.clientIp = '192.0.2.9';
  r.headers['user-agent'] = 'TestBot/1.0';
  assert.equal((await v.verify(r)).verification, 'signature_valid');
  assert.equal(reverse, 0);
});

test('IP-list purpose uses only UA tokens eligible for that list', async () => {
  const v = createVerifier({
    registry: [
      {
        ...ipOperator,
        extraUaTokens: ['TestBot', 'OtherBot'],
        purposes: {
          uaTokens: { TestBot: 'crawler', OtherBot: 'user_directed' },
          sources: ['https://agent.example/docs'],
          checked: '2026-11-20',
        },
      },
    ],
    authorities: ['example.com'],
    now: () => clock,
    fetcher: async () => Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }),
  });
  const verdict = await v.verify(uaReq('TestBot/1.0 OtherBot/1.0', '192.0.2.9'));
  assert.equal(verdict.verification, 'ip_match');
  assert.equal(verdict.agent_purpose, 'crawler');
});

test('visitorLabels reports agent_claim signature_agent', async () => {
  const fields = visitorLabels({ verdict: await verifier.verify(signed()) });
  assert.equal(fields.vv_detail.split('|')[3], 'signature_agent');
  assert.equal(fields.vv_detail.split('|')[0], 'test');
});

test('invalid signature from a listed IP exports no operator', async () => {
  const v = createVerifier({
    registry: [
      { ...operator, ...ipOperator, operator: 'test', signatureAgent: identity, directoryUrl },
    ],
    authorities: ['example.com'],
    now: () => clock,
    fetcher: async (url) =>
      url.endsWith('/ips')
        ? Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] })
        : Response.json({ keys: [jwk] }),
  });
  const r = signed();
  r.method = 'POST'; // crypto mismatch
  r.clientIp = '192.0.2.9';
  r.headers['user-agent'] = 'TestBot/1.0';
  const verdict = await v.verify(r);
  assert.equal(verdict.verification, 'signature_invalid');
  const fields = visitorLabels({ verdict });
  assert.equal(fields.vv_detail.split('|')[0], 'none');
  assert.equal(fields.vv_detail.split('|')[2], 'unknown');
});

test('UA token needs a left word boundary', async () => {
  const v = await verifier.verify(uaReq('Mozilla/5.0 NotGPTBot/1.0', undefined));
  assert.ok(!v.claimed.uaTokens.includes('GPTBot'));
  const ok = await verifier.verify(uaReq('Mozilla/5.0 (compatible; GPTBot/1.0)', undefined));
  assert.ok(ok.claimed.uaTokens.includes('GPTBot'));
});

test('replay keys are scoped per Signature-Agent identity', async () => {
  const keys = new Set();
  const nonceStore = {
    async insertIfAbsent(key) {
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    },
  };
  const second = {
    ...operator,
    operator: 'test2',
    signatureAgent: 'https://agent2.example',
    directoryUrl: 'https://agent2.example/keys',
  };
  const v = makeVerifier({ registry: [operator, second], nonceStore });
  assert.equal((await v.verify(signed())).verification, 'signature_valid');
  const r = signed({ agent: JSON.stringify('https://agent2.example') });
  assert.equal((await v.verify(r)).verification, 'signature_valid');
});

test('ipv4Only reverse-DNS rules never query IPv6 clients', async () => {
  let reverse = 0;
  const resolver = {
    reverse: async () => (reverse++, []),
    resolve4: async () => [],
    resolve6: async () => [],
  };
  const v = createVerifier({
    registry: [
      {
        ...ipOperator,
        ipLists: [],
        reverseDns: [
          {
            uaTokens: ['TestBot'],
            suffixes: ['agent.example'],
            source: 's',
            checked: 'c',
            ipv4Only: true,
          },
        ],
      },
    ],
    authorities: ['example.com'],
    now: () => clock,
    fetcher,
    reverseDns: { enabled: true, resolver },
  });
  await v.verify(uaReq('TestBot/1.0', '2001:db8::1'));
  assert.equal(reverse, 0);
});
