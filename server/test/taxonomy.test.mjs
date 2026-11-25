import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createVerifier,
  defaultRegistry,
  defaultTokenClasses,
  serverAgentTokens,
  tokenClassesFor,
  visitorLabels,
} from '../dist/index.js';
import { jwk, signed } from './helpers.mjs';

const now = 1800000000;
const sailFixture = readFileSync(
  new URL('./fixtures/anthropic-sail-2026-11-20.toml', import.meta.url),
  'utf8',
);

function mockIpVerifier(extra = {}) {
  const fetcher = async (url) => {
    if (url.includes('directory')) return Response.json({ keys: [jwk] });
    if (url.includes('sail'))
      return new Response(sailFixture, {
        headers: { 'content-type': 'application/sail+toml' },
      });
    if (url.includes('chatgpt-user.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    if (url.includes('gptbot.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '198.51.100.0/24' }] });
    if (url.includes('searchbot.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '203.0.113.0/24' }] });
    if (url.includes('user-triggered-agents.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    if (url.includes('user-triggered-fetchers-google.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '198.51.100.0/24' }] });
    if (url.includes('googlebot.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '203.0.113.0/24' }] });
    if (url.includes('perplexity-user.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    if (url.includes('perplexitybot.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '198.51.100.0/24' }] });
    if (url.includes('mistralai-user-ips.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    if (url.includes('kimi')) return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    if (url.includes('bingbot.json'))
      return Response.json({ prefixes: [{ ipv4Prefix: '198.51.100.0/24' }] });
    if (url.includes('naver')) return Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] });
    return Response.json({ prefixes: [] });
  };
  return createVerifier({
    authorities: ['example.com'],
    registry: defaultRegistry,
    fetcher,
    now: () => now,
    ...extra,
  });
}

test('defaultTokenClasses covers all documented tokens explicitly without suffix guessing', () => {
  const tokens = serverAgentTokens(defaultRegistry);
  const mapped = tokenClassesFor(defaultRegistry);
  const unmapped = tokens.filter((t) => !Object.hasOwn(mapped, t));
  // Only Naver's undocumented Blueno is intentionally unmapped.
  assert.deepEqual(unmapped, ['Blueno']);
  assert.equal(defaultTokenClasses['meta-externalagent'], 'crawler');
  assert.equal(defaultTokenClasses['Claude-Agent'], 'agent');
  assert.equal(defaultTokenClasses['Google-Agent'], 'agent');
  assert.equal(defaultTokenClasses['ChatGPT-User'], 'fetcher');
  assert.equal(defaultTokenClasses['Claude-User'], 'fetcher');
  assert.equal(defaultTokenClasses['Perplexity-User'], 'fetcher');
  assert.equal(defaultTokenClasses['MistralAI-User'], 'fetcher');
  assert.equal(defaultTokenClasses['Kimi-User'], 'fetcher');
  assert.equal(defaultTokenClasses['Gemini-Deep-Research'], 'fetcher');
  assert.equal(defaultTokenClasses['Google-NotebookLM'], 'fetcher');
  assert.equal(defaultTokenClasses['BingPreview'], 'fetcher');
  assert.equal(defaultTokenClasses['Googlebot'], 'crawler');
  assert.equal(defaultTokenClasses['GPTBot'], 'crawler');
  assert.equal(defaultTokenClasses['bingbot'], 'crawler');
});

test('verified WBA signatures: browser agents -> agent_verified, intermediaries -> automation_verified, crawlers -> crawler_verified', async () => {
  const fetcher = async () => Response.json({ keys: [jwk] });
  const verifier = createVerifier({
    authorities: ['example.com'],
    registry: defaultRegistry,
    fetcher,
    now: () => now,
  });
  try {
    const cases = [
      ['https://chatgpt.com', 'openai', 'user_directed', 'agent_verified', 'ChatGPT-User/1.0'],
      ['https://api.manus.im', 'manus', 'user_directed', 'agent_verified', 'Mozilla/5.0'],
      ['https://muse.ai', 'meta', 'user_directed', 'agent_verified', 'meta-externalagent/1.0'],
      [
        'https://assistbot.duckduckgo.com',
        'duckduckgo',
        'crawler',
        'crawler_verified',
        'DuckAssistBot',
      ],
      [
        'https://www.browserbase.com',
        'browserbase',
        'intermediary',
        'automation_verified',
        'Mozilla/5.0',
      ],
      ['https://www.kernel.sh', 'kernel', 'intermediary', 'automation_verified', 'Mozilla/5.0'],
    ];
    for (const [identity, operator, purpose, expectedType, ua] of cases) {
      const req = signed({
        agent: `"${identity}"`,
        components: ['"@authority"', '"signature-agent"'],
        values: { '"signature-agent"': `"${identity}"` },
      });
      req.headers['user-agent'] = ua;
      const verdict = await verifier.verify(req);
      assert.equal(verdict.verification, 'signature_valid', identity);
      assert.equal(verdict.verified?.operator, operator, identity);
      assert.equal(verdict.agent_purpose, purpose, identity);
      const labels = visitorLabels({ verdict });
      assert.equal(labels.vv_type, expectedType, identity);
      assert.equal(
        labels.vv_detail,
        `${operator}|signature_valid|${purpose}|signature_agent|-|-`,
        identity,
      );
    }
  } finally {
    verifier.close();
  }
});

test('IP-verified fetchers map to crawler_verified while preserving user_directed in vv_detail', async () => {
  const verifier = mockIpVerifier();
  try {
    const cases = [
      ['ChatGPT-User/1.0', '192.0.2.10', 'openai', 'user_directed', 'fetcher'],
      ['Perplexity-User/1.0', '192.0.2.11', 'perplexity', 'user_directed', 'fetcher'],
      ['MistralAI-User/1.0', '192.0.2.12', 'mistral', 'user_directed', 'fetcher'],
      ['Kimi-User/1.0', '192.0.2.13', 'kimi', 'user_directed', 'fetcher'],
      ['Google-NotebookLM', '198.51.100.13', 'google', 'user_directed', 'fetcher'],
      ['Gemini-Deep-Research', '198.51.100.14', 'google', 'user_directed', 'fetcher'],
    ];
    for (const [ua, clientIp, operator, purpose, tokenClass] of cases) {
      const verdict = await verifier.verify({
        method: 'GET',
        host: 'example.com',
        clientIp,
        headers: { 'user-agent': ua },
      });
      assert.equal(verdict.verification, 'ip_match', ua);
      assert.equal(verdict.verified?.operator, operator, ua);
      assert.equal(verdict.agent_purpose, purpose, ua);
      assert.equal(verdict.token_class, tokenClass, ua);
      assert.deepEqual(visitorLabels({ verdict }), {
        vv_type: 'crawler_verified',
        vv_detail: `${operator}|ip_match|${purpose}|ua_token|-|-`,
      });
    }
  } finally {
    verifier.close();
  }
});

test('IP-verified agents (Claude-Agent via SAIL, Google-Agent via IP) map to agent_verified', async () => {
  const verifier = mockIpVerifier();
  try {
    // Claude-Agent via SAIL exclusive prefix 136.71.21.147/32 from fixture
    const claude = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      clientIp: '136.71.21.147',
      headers: { 'user-agent': 'Mozilla/5.0 Claude-Agent/1.0' },
    });
    assert.equal(claude.verification, 'ip_match');
    assert.equal(claude.verified?.operator, 'anthropic');
    assert.equal(claude.agent_purpose, 'user_directed');
    assert.equal(claude.token_class, 'agent');
    assert.deepEqual(visitorLabels({ verdict: claude }), {
      vv_type: 'agent_verified',
      vv_detail: 'anthropic|ip_match|user_directed|ua_token|-|-',
    });

    // Google-Agent via user-triggered-agents.json
    const google = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      clientIp: '192.0.2.20',
      headers: { 'user-agent': 'Google-Agent/1.0' },
    });
    assert.equal(google.verification, 'ip_match');
    assert.equal(google.verified?.operator, 'google');
    assert.equal(google.agent_purpose, 'user_directed');
    assert.equal(google.token_class, 'agent');
    assert.deepEqual(visitorLabels({ verdict: google }), {
      vv_type: 'agent_verified',
      vv_detail: 'google|ip_match|user_directed|ua_token|-|-',
    });
  } finally {
    verifier.close();
  }
});

test('IP-verified crawlers map to crawler_verified and rDNS fetchers/crawlers follow token class', async () => {
  const resolver = {
    reverse: async () => ['crawl-66-249-66-1.google.com'],
    resolve4: async () => ['66.249.66.1'],
    resolve6: async () => [],
  };
  const verifier = mockIpVerifier({ reverseDns: { enabled: true, resolver } });
  try {
    const gptbot = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      clientIp: '198.51.100.5',
      headers: { 'user-agent': 'GPTBot/1.0' },
    });
    assert.equal(gptbot.verification, 'ip_match');
    assert.equal(gptbot.token_class, 'crawler');
    assert.deepEqual(visitorLabels({ verdict: gptbot }), {
      vv_type: 'crawler_verified',
      vv_detail: 'openai|ip_match|crawler|ua_token|-|-',
    });

    // rDNS-verified Google-Read-Aloud (fetcher, user_directed) -> crawler_verified
    const readAloud = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      clientIp: '66.249.66.1',
      headers: { 'user-agent': 'Google-Read-Aloud' },
    });
    assert.equal(readAloud.verification, 'ip_match');
    assert.equal(readAloud.verified?.method, 'rdns');
    assert.equal(readAloud.agent_purpose, 'user_directed');
    assert.equal(readAloud.token_class, 'fetcher');
    assert.deepEqual(visitorLabels({ verdict: readAloud }), {
      vv_type: 'crawler_verified',
      vv_detail: 'google|ip_match|user_directed|ua_token|-|-',
    });
  } finally {
    verifier.close();
  }
});

test('unverified crawler/fetcher tokens -> crawler_unverified; unverified agent/unknown/mixed -> agent_unverified', async () => {
  const verifier = mockIpVerifier();
  try {
    const crawlerOrFetcherUAs = [
      'Googlebot/2.1',
      'GPTBot/1.0',
      'ChatGPT-User/1.0',
      'Claude-User/1.0',
      'Perplexity-User/1.0',
      'MistralAI-User/1.0',
      'Kimi-User/1.0',
      'Amzn-User/1.0',
      'meta-externalagent/1.1',
      'meta-externalfetcher/1.1',
      'BingPreview/1.0',
      'GPTBot ChatGPT-User',
    ];
    for (const ua of crawlerOrFetcherUAs) {
      const verdict = await verifier.verify({
        method: 'GET',
        host: 'example.com',
        headers: { 'user-agent': ua },
      });
      assert.equal(verdict.verification, 'no_signature', ua);
      assert.equal(visitorLabels({ verdict }).vv_type, 'crawler_unverified', ua);
      assert.equal(
        visitorLabels({ verdict, browserClass: 'human', browserPhase: 'final' }).vv_type,
        'crawler_unverified',
        ua,
      );
      assert.equal(
        visitorLabels({ verdict, browserClass: 'automated', browserPhase: 'final' }).vv_type,
        'bot_automation',
        ua,
      );
      assert.equal(
        visitorLabels({
          verdict,
          browserClass: 'declared_agent',
          browserAgent: 'openai',
        }).vv_type,
        'agent_unverified',
        ua,
      );
    }

    // Unverified agent tokens, unmapped Blueno, and mixed agent+crawler stay agent_unverified
    const agentOrUnknownUAs = [
      'Claude-Agent/1.0',
      'Google-Agent/1.0',
      'Blueno/1.0',
      'Claude-Agent/1.0 GPTBot/1.0',
    ];
    for (const ua of agentOrUnknownUAs) {
      const verdict = await verifier.verify({
        method: 'GET',
        host: 'example.com',
        headers: { 'user-agent': ua },
      });
      assert.equal(verdict.verification, 'no_signature', ua);
      assert.equal(visitorLabels({ verdict }).vv_type, 'agent_unverified', ua);
    }

    // Unverified WBA Signature-Agent alongside a crawler UA stays agent_unverified
    const sigAgent = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      headers: { 'user-agent': 'GPTBot/1.0', 'signature-agent': '"https://chatgpt.com"' },
    });
    assert.equal(visitorLabels({ verdict: sigAgent }).vv_type, 'agent_unverified');
    assert.equal(
      visitorLabels({ verdict: sigAgent }).vv_detail,
      'none|no_signature|unknown|signature_agent|-|-',
    );

    // Unverified Poppy session stays agent_unverified
    const poppyVerdict = {
      verification: 'no_signature',
      agent_purpose: 'unknown',
      claimed: { uaTokens: ['GPTBot'], signatureAgents: [], poppySession: true },
      signatures: [],
    };
    assert.equal(visitorLabels({ verdict: poppyVerdict }).vv_type, 'agent_unverified');

    // Browser declared_agent (dom_marker / dom_host) stays agent_unverified
    assert.deepEqual(
      visitorLabels({
        browserClass: 'declared_agent',
        browserPhase: 'agent',
        browserAgent: 'anthropic',
        browserAgentClaim: 'dom_host',
      }),
      { vv_type: 'agent_unverified', vv_detail: 'anthropic|-|-|dom_host|declared_agent|agent' },
    );

    // No browser class and no server claim -> unclassified
    const plain = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    assert.deepEqual(visitorLabels({ verdict: plain }), {
      vv_type: 'unclassified',
      vv_detail: 'none|no_signature|unknown|none|-|-',
    });
    assert.deepEqual(visitorLabels(), {
      vv_type: 'unclassified',
      vv_detail: 'none|-|-|-|-|-',
    });
  } finally {
    verifier.close();
  }
});

test('custom registry tokenClasses validation and snapshotting', async () => {
  const baseOp = {
    operator: 'custom',
    source: 'https://example.test/docs',
    checked: '2026-11-25',
    verifiedByCapture: false,
    extraUaTokens: ['CustomFetcher'],
    ipLists: [
      {
        name: 'ips',
        source: 'https://example.test/docs',
        checked: '2026-11-25',
        url: 'https://example.test/ips.json',
        uaTokens: ['CustomFetcher'],
      },
    ],
  };

  assert.throws(
    () =>
      createVerifier({
        authorities: ['example.com'],
        registry: [{ ...baseOp, tokenClasses: { CustomFetcher: 'invalid' } }],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      createVerifier({
        authorities: ['example.com'],
        registry: [{ ...baseOp, tokenClasses: { '': 'fetcher' } }],
      }),
    TypeError,
  );

  const mutableClasses = { CustomFetcher: 'fetcher' };
  const verifier = createVerifier({
    authorities: ['example.com'],
    registry: [{ ...baseOp, tokenClasses: mutableClasses }],
    fetcher: async () => Response.json({ prefixes: [{ ipv4Prefix: '192.0.2.0/24' }] }),
    now: () => now,
  });
  // Mutating caller map after construction must not alter verifier snapshot.
  mutableClasses.CustomFetcher = 'agent';
  try {
    const unverified = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      headers: { 'user-agent': 'CustomFetcher/1.0' },
    });
    assert.equal(unverified.token_class, 'fetcher');
    assert.equal(visitorLabels({ verdict: unverified }).vv_type, 'crawler_unverified');

    const verified = await verifier.verify({
      method: 'GET',
      host: 'example.com',
      clientIp: '192.0.2.5',
      headers: { 'user-agent': 'CustomFetcher/1.0' },
    });
    assert.equal(verified.verification, 'ip_match');
    assert.equal(verified.token_class, 'fetcher');
    assert.equal(visitorLabels({ verdict: verified }).vv_type, 'crawler_verified');
  } finally {
    verifier.close();
  }
});
