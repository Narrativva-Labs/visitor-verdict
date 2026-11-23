import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerifier, defaultRegistry, visitorLabels } from '../dist/index.js';
import { purposeFor } from '../dist/purpose.js';
import { clock, operator, jwk, signed, makeVerifier, directoryUrl } from './helpers.mjs';

const evidence = (operator, token, list, method = 'ip') => ({
  agent_purpose: 'unknown',
  claimed: { uaTokens: token ? [token] : [], signatureAgents: [] },
  verification: method === 'signature' ? 'signature_valid' : 'ip_match',
  reason: 'verified',
  signatures: [],
  verified: {
    operator,
    method,
    ...(method === 'signature'
      ? {
          signatureAgent: defaultRegistry.find((entry) => entry.operator === operator)
            ?.signatureAgent,
        }
      : {}),
  },
  ...(list ? { ip: { operator, list } } : {}),
});

for (const [id, token, list, expected] of [
  ['openai', 'ChatGPT-User', 'chatgpt-user', 'user_directed'],
  ['openai', 'GPTBot', 'gptbot', 'crawler'],
  ['openai', 'OAI-SearchBot', 'searchbot', 'crawler'],
  ['openai', 'OAI-AdsBot', 'adsbot', 'crawler'],
  ['anthropic', 'Claude-Agent', 'sail', 'user_directed'],
  ['anthropic', 'Claude-User', 'bots', 'user_directed'],
  ['anthropic', 'ClaudeBot', 'bots', 'crawler'],
  ['anthropic', 'Claude-SearchBot', 'bots', 'crawler'],
  ['perplexity', 'Perplexity-User', 'perplexity-user', 'user_directed'],
  ['perplexity', 'PerplexityBot', 'perplexitybot', 'crawler'],
  ['mistral', 'MistralAI-User', 'mistralai-user', 'user_directed'],
  ['mistral', 'MistralAI-Index', 'mistralai-index', 'crawler'],
  ['kimi', 'Kimi-User', 'kimi-user', 'user_directed'],
  ['kimi', 'KimiBot', 'kimibot', 'crawler'],
  ['kimi', 'Kimi-SearchBot', 'kimi-searchbot', 'crawler'],
  ['google', 'Google-Agent', 'user-triggered-agents', 'user_directed'],
  ['google', 'Google-NotebookLM', 'user-triggered-fetchers-google', 'user_directed'],
  ['google', '', 'user-triggered-fetchers', 'user_directed'],
  ['google', 'Googlebot', 'common-crawlers', 'crawler'],
  ['google', 'Google-CloudVertexBot', 'common-crawlers', 'crawler'],
  ['apple', 'Applebot', 'applebot', 'crawler'],
  ['microsoft', 'bingbot', 'bingbot', 'crawler'],
  ['commoncrawl', 'CCBot', 'ccbot', 'crawler'],
  ['seznam', 'SeznamBot', 'seznambot', 'crawler'],
  ['naver', 'Yeti', 'naverbot', 'crawler'],
  ['naver', 'Blueno', 'naverbot', 'unknown'],
  ['kagi', 'Kagibot', 'published_static', 'crawler'],
  ['duckduckgo', 'DuckAssistBot', 'duckassistbot', 'crawler'],
])
  test('registry purpose: ' + id + '/' + token, () => {
    assert.equal(purposeFor(evidence(id, token, list), defaultRegistry), expected);
  });

test('signed identity wins over a different or contradictory unsigned UA claim', () => {
  assert.equal(
    purposeFor(evidence('openai', 'GPTBot', undefined, 'signature'), defaultRegistry),
    'user_directed',
  );
  assert.equal(
    purposeFor(evidence('google', 'Googlebot', undefined, 'signature'), defaultRegistry),
    'user_directed',
  );
  // Intermediary infrastructure never takes the role of the agent behind it.
  assert.equal(
    purposeFor(evidence('browserbase', 'ChatGPT-User', undefined, 'signature'), defaultRegistry),
    'intermediary',
  );
});
for (const [id, expected, type] of [
  ['browserbase', 'intermediary', 'automation_verified'],
  ['manus', 'user_directed', 'agent_verified'],
  ['meta', 'user_directed', 'agent_verified'],
  ['duckduckgo', 'crawler', 'crawler_verified'],
]) {
  test('signature purpose and labels: ' + id, () => {
    // No UA claim is needed; purpose follows this operator's verified signature identity.
    const v = evidence(id, '', undefined, 'signature');
    v.claimed.signatureAgents = [v.verified.signatureAgent];
    v.agent_purpose = purposeFor(v, defaultRegistry);
    assert.equal(v.agent_purpose, expected);
    assert.deepEqual(visitorLabels({ verdict: v }), {
      vv_type: type,
      vv_detail: `${id}|signature_valid|${expected}|signature_agent|-|-`,
    });
    // A contradictory unsigned UA cannot replace the signature's policy.
    v.claimed.uaTokens = expected === 'crawler' ? ['ChatGPT-User'] : ['GPTBot'];
    assert.equal(purposeFor(v, defaultRegistry), expected);
    for (const verification of ['signature_invalid', 'none', 'no_signature']) {
      v.verification = verification;
      assert.equal(purposeFor(v, defaultRegistry), 'unknown');
    }
  });
}
test('ambiguous shared-feed claims and unverified outcomes stay unknown', () => {
  const v = evidence('anthropic', 'Claude-User', 'bots');
  v.claimed.uaTokens.push('ClaudeBot');
  assert.equal(purposeFor(v, defaultRegistry), 'unknown');
  for (const verification of ['signature_invalid', 'no_signature', 'none']) {
    v.verification = verification;
    v.agent_purpose = 'user_directed';
    assert.equal(purposeFor(v, defaultRegistry), 'unknown');
    assert.equal(visitorLabels({ verdict: v }).vv_detail.split('|')[2], 'unknown');
  }
});
test('purpose is applied by public verification only after evidence and is snapshotted', async () => {
  const purposes = {
    signatureAgent: 'user_directed',
    sources: ['https://agent.example/docs'],
    checked: '2026-11-20',
  };
  const v = makeVerifier({ registry: [{ ...operator, purposes }] });
  purposes.signatureAgent = 'crawler';
  assert.equal((await v.verify(signed())).agent_purpose, 'user_directed');
  assert.equal(
    visitorLabels({ verdict: await v.verify(signed()) }).vv_detail.split('|')[2],
    'user_directed',
  );
  const broken = signed();
  broken.method = 'POST';
  assert.equal((await v.verify(broken)).agent_purpose, 'unknown');
});
test('public IP and static verification exports the purpose of the winning evidence', async () => {
  const openai = defaultRegistry.find((entry) => entry.operator === 'openai');
  const verifier = makeVerifier({
    registry: [openai],
    fetcher: async () => Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }),
  });
  for (const [token, expected] of [
    ['ChatGPT-User', 'user_directed'],
    ['GPTBot', 'crawler'],
  ]) {
    const v = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      clientIp: '192.0.2.1',
      headers: { 'user-agent': token },
    });
    assert.equal(v.verification, 'ip_match');
    assert.equal(v.agent_purpose, expected);
    assert.equal(visitorLabels({ verdict: v }).vv_detail.split('|')[2], expected);
  }
  const kagi = createVerifier({
    registry: defaultRegistry.filter((entry) => entry.operator === 'kagi'),
    authorities: ['example.com'],
  });
  assert.equal(
    (
      await kagi.verify({
        method: 'GET',
        host: 'example.com',
        clientIp: '216.18.205.234',
        headers: { 'user-agent': 'Kagibot' },
      })
    ).agent_purpose,
    'crawler',
  );
});
test('multiple signature identities for one operator retain their own purpose policy', async () => {
  const purposes = {
    signatureAgent: 'user_directed',
    sources: ['https://agent.example/docs'],
    checked: '2026-11-20',
  };
  const alternate = {
    ...operator,
    signatureAgent: 'https://other.example',
    directoryUrl: 'https://other.example/keys',
    purposes: { ...purposes, signatureAgent: 'crawler' },
  };
  const verifier = makeVerifier({ registry: [{ ...operator, purposes }, alternate] });
  const result = await verifier.verify(signed({ agent: JSON.stringify(alternate.signatureAgent) }));
  assert.equal(result.verification, 'signature_valid');
  assert.equal(result.agent_purpose, 'crawler');
});
test('bad purpose config and refresh callbacks fail at construction', () => {
  assert.throws(
    () =>
      makeVerifier({
        registry: [
          {
            ...operator,
            purposes: {
              signatureAgent: 'human',
              sources: ['https://agent.example'],
              checked: '2026-11-20',
            },
          },
        ],
      }),
    TypeError,
  );
  assert.throws(() => makeVerifier({ onRefresh: true }), TypeError);
});

test('status reports unique usable directory/feed counts, never fetches and contains no visitors', async () => {
  let now = clock;
  let fetches = 0;
  const verifier = makeVerifier({
    now: () => now,
    staleMaxSeconds: 600,
    registry: [
      {
        ...operator,
        ipLists: [
          { name: 'a', url: 'https://agent.example/ips' },
          { name: 'b', url: 'https://agent.example/ips' },
        ],
      },
    ],
    fetcher: async (url) => {
      fetches++;
      return Response.json(url === directoryUrl ? { keys: [jwk] } : { prefixes: [] });
    },
  });
  assert.deepEqual(verifier.status(), {
    directories: { loaded: 0, total: 1 },
    ipLists: { loaded: 0, total: 1 },
    lastRefreshOk: null,
    lastRefreshAt: null,
  });
  assert.equal(fetches, 0);
  await verifier.warm();
  assert.deepEqual(verifier.status(), {
    directories: { loaded: 1, total: 1 },
    ipLists: { loaded: 0, total: 1 },
    lastRefreshOk: true,
    lastRefreshAt: clock,
  });
  await verifier.warm({ ipLists: true });
  assert.equal(verifier.status().ipLists.loaded, 1);
  now += 301;
  assert.equal(verifier.status().directories.loaded, 1);
  now = clock + 600;
  assert.equal(verifier.status().directories.loaded, 0);
  assert.equal(verifier.status().ipLists.loaded, 0);
  assert.equal(fetches, 2);
  assert.deepEqual(Object.keys(verifier.status()), [
    'directories',
    'ipLists',
    'lastRefreshOk',
    'lastRefreshAt',
  ]);
});
test('a failed refresh is visible even when stale data remains usable; successful recovery clears it', async () => {
  let now = clock;
  let fail = false;
  const events = [];
  const verifier = makeVerifier({
    now: () => now,
    onRefresh: (event) => events.push(event),
    fetcher: async () => {
      if (fail) throw Error('raw transport details');
      return Response.json({ keys: [jwk] });
    },
  });
  await verifier.warm();
  now += 301;
  fail = true;
  await verifier.warm();
  assert.equal(verifier.status().directories.loaded, 1);
  assert.equal(verifier.status().lastRefreshOk, false);
  assert.equal(verifier.status().lastRefreshAt, now);
  assert.deepEqual(events[1], {
    kind: 'directory',
    ok: false,
    at: now,
    hostname: 'agent.example',
    reason: 'directory_unavailable',
  });
  assert.equal(JSON.stringify(events[1]).includes('/'), false, 'hostname only, never a URL');
  now += 61;
  fail = false;
  await verifier.warm();
  assert.equal(verifier.status().lastRefreshOk, true);
  for (const index of [0, 2]) {
    assert.equal(events[index].ok, true);
    assert.equal(events[index].hostname, 'agent.example');
    assert.equal(events[index].hostname.includes('/'), false);
  }
  assert.ok(!JSON.stringify(events).includes('raw transport details'));
});
test('refresh-ahead status updates without a request; callback exceptions do not poison the cache', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = clock;
  let fail = false;
  const v = makeVerifier({
    now: () => now,
    onRefresh: () => {
      throw Error('diagnostic');
    },
    fetcher: async () => {
      if (fail) throw Error();
      return Response.json({ keys: [jwk] });
    },
  });
  t.after(() => v.close());
  await v.warm({ refreshAhead: true });
  assert.equal(v.status().lastRefreshOk, true);
  now += 270;
  fail = true;
  t.mock.timers.tick(270000);
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(v.status().lastRefreshOk, false);
  assert.equal(v.status().lastRefreshAt, now);
});
