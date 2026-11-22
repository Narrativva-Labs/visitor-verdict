import test from 'node:test';
import assert from 'node:assert/strict';
import { visitorLabels } from '../dist/index.js';

const verifications = ['none', 'no_signature', 'signature_invalid', 'signature_valid', 'ip_match'];
const purposes = ['unknown', 'crawler', 'user_directed', 'intermediary'];
const browsers = [undefined, 'human', 'suspicious', 'automated', 'declared_agent'];
const phases = [undefined, 'initial', 'final', 'agent'];
const claims = ['none', 'ua_token', 'signature_agent', 'both'];
const verdict = (verification, purpose, claim) => ({
  verification,
  agent_purpose: purpose,
  claimed: {
    uaTokens: ['ua_token', 'both'].includes(claim) ? ['RAW UA'] : [],
    signatureAgents: ['signature_agent', 'both'].includes(claim) ? ['https://raw.example/'] : [],
  },
  verified: { operator: 'openai', method: 'signature' },
  signatures: [],
  reason: 'PRIVATE REASON',
});
// Independent truth table: rows are the five browser classes, columns the four claim forms.
const fallback = [
  ['pending', 'agent_unverified', 'agent_unverified', 'agent_unverified'],
  ['human', 'agent_unverified', 'agent_unverified', 'agent_unverified'],
  ['bot_suspicious', 'agent_unverified', 'agent_unverified', 'agent_unverified'],
  ['bot_automation', 'bot_automation', 'bot_automation', 'bot_automation'],
  ['agent_unverified', 'agent_unverified', 'agent_unverified', 'agent_unverified'],
];
for (const verification of verifications)
  for (const purpose of purposes) {
    test(`label matrix ${verification}/${purpose}`, () => {
      for (const [bi, browserClass] of browsers.entries())
        for (const [ci, claim] of claims.entries())
          for (const browserPhase of phases) {
            const verified = ['signature_valid', 'ip_match'].includes(verification);
            const expected =
              verification === 'signature_invalid'
                ? 'bot_spoofed'
                : verified
                  ? {
                      unknown: 'agent_verified',
                      crawler: 'crawler_verified',
                      user_directed: 'agent_verified',
                      intermediary: 'agent_verified',
                    }[purpose]
                  : fallback[bi][ci];
            const actual = visitorLabels({
              verdict: verdict(verification, purpose, claim),
              browserClass,
              browserPhase,
            });
            assert.deepEqual(actual, {
              vv_type: expected,
              vv_detail: [
                verified ? 'openai' : 'none',
                verification,
                verified ? purpose : 'unknown',
                claim === 'both' ? 'signature_agent' : claim,
                browserClass ?? '-',
                browserPhase ?? '-',
              ].join('|'),
            });
            assert.ok(actual.vv_detail.length <= 100);
          }
    });
  }
test('absent evidence, invalid browser values and pure frozen input', () => {
  assert.deepEqual(visitorLabels(), { vv_type: 'pending', vv_detail: 'none|-|-|-|-|-' });
  assert.deepEqual(visitorLabels({ browserClass: 'human', browserPhase: 'final' }), {
    vv_type: 'human',
    vv_detail: 'none|-|-|-|human|final',
  });
  assert.deepEqual(
    visitorLabels({ browserClass: 'RAW|PRIVATE', browserPhase: 'unknown' }),
    visitorLabels(),
  );
  const v = verdict('signature_valid', 'crawler', 'ua_token');
  Object.freeze(v.verified);
  Object.freeze(v.claimed.uaTokens);
  Object.freeze(v.claimed.signatureAgents);
  Object.freeze(v.claimed);
  Object.freeze(v);
  const input = Object.freeze({ verdict: v });
  assert.deepEqual(visitorLabels(input), visitorLabels(input));
});
test('operator validation and 100-character limit never truncate structural fields', () => {
  for (const operator of [
    'x|injected',
    'PRIVATE ADDRESS',
    'é',
    'a'.repeat(33),
    'a'.repeat(32),
    '',
  ]) {
    const v = verdict('signature_invalid', 'user_directed', 'signature_agent');
    v.verified.operator = operator;
    assert.equal(visitorLabels({ verdict: v }).vv_detail.split('|')[0], 'none');
    v.verification = 'signature_valid';
    const result = visitorLabels({
      verdict: v,
      browserClass: 'declared_agent',
      browserPhase: 'initial',
    });
    assert.ok(result.vv_detail.length <= 100);
    assert.equal(result.vv_detail.split('|').length, 6);
    assert.equal(result.vv_detail.split('|')[0], 'none');
  }
  const v = verdict('signature_valid', 'user_directed', 'signature_agent');
  v.verified.operator = 'a'.repeat(24);
  const bounded = visitorLabels({
    verdict: v,
    browserClass: 'declared_agent',
    browserPhase: 'initial',
  });
  assert.equal(bounded.vv_detail.split('|')[0], 'a'.repeat(24));
  assert.ok(bounded.vv_detail.length <= 100);
  v.verified.operator += 'a';
  assert.equal(visitorLabels({ verdict: v }).vv_detail.split('|')[0], 'none');
});

// Browser markers: observed operator evidence, never verification.
const markers = [undefined, 'openai', 'anthropic', 'google', 'OpenAI', 'anthropic|x', ''];
for (const verification of verifications)
  test(`browser marker matrix ${verification}`, () => {
    for (const purpose of purposes)
      for (const browserClass of browsers)
        for (const claim of claims)
          for (const browserAgent of markers) {
            const input = { verdict: verdict(verification, purpose, claim), browserClass };
            const base = visitorLabels({ ...input, browserPhase: 'agent' });
            const actual = visitorLabels({ ...input, browserPhase: 'agent', browserAgent });
            const verified = ['signature_valid', 'ip_match'].includes(verification);
            const used =
              !verified &&
              verification !== 'signature_invalid' &&
              browserClass === 'declared_agent' &&
              ['openai', 'anthropic'].includes(browserAgent);
            // The marker never changes the visitor type.
            assert.equal(actual.vv_type, base.vv_type);
            if (!used) {
              assert.deepEqual(actual, base);
              continue;
            }
            assert.equal(actual.vv_type, 'agent_unverified');
            const detail = base.vv_detail.split('|');
            detail[0] = browserAgent;
            detail[3] = 'dom_marker';
            assert.equal(actual.vv_detail, detail.join('|'));
          }
  });
test('browser marker without server evidence and precedence of verified identity', () => {
  assert.deepEqual(
    visitorLabels({
      browserClass: 'declared_agent',
      browserPhase: 'agent',
      browserAgent: 'anthropic',
    }),
    { vv_type: 'agent_unverified', vv_detail: 'anthropic|-|-|dom_marker|declared_agent|agent' },
  );
  assert.deepEqual(
    visitorLabels({
      browserClass: 'declared_agent',
      browserPhase: 'initial',
      browserAgent: 'openai',
    }),
    { vv_type: 'agent_unverified', vv_detail: 'openai|-|-|dom_marker|declared_agent|initial' },
  );
  // A marker counts only with declared_agent; any other class keeps its label and names no operator.
  assert.deepEqual(
    visitorLabels({ browserClass: 'human', browserPhase: 'final', browserAgent: 'openai' }),
    { vv_type: 'human', vv_detail: 'none|-|-|-|human|final' },
  );
  // Verified OpenAI signature with an Anthropic marker: the verified operator and claim stay.
  assert.deepEqual(
    visitorLabels({
      verdict: verdict('signature_valid', 'user_directed', 'signature_agent'),
      browserClass: 'declared_agent',
      browserPhase: 'agent',
      browserAgent: 'anthropic',
    }),
    {
      vv_type: 'agent_verified',
      vv_detail: 'openai|signature_valid|user_directed|signature_agent|declared_agent|agent',
    },
  );
  // An invalid signature stays spoofed and names no operator, whatever the page shows.
  assert.deepEqual(
    visitorLabels({
      verdict: verdict('signature_invalid', 'user_directed', 'signature_agent'),
      browserClass: 'declared_agent',
      browserPhase: 'agent',
      browserAgent: 'openai',
    }),
    {
      vv_type: 'bot_spoofed',
      vv_detail: 'none|signature_invalid|unknown|signature_agent|declared_agent|agent',
    },
  );
});

test('unlisted purpose values never reach vv_detail', () => {
  for (const purpose of ['RAW|PRIVATE', 'direct', '', undefined, 'x'.repeat(200)]) {
    const v = verdict('signature_valid', purpose, 'signature_agent');
    assert.deepEqual(visitorLabels({ verdict: v }), {
      vv_type: 'agent_verified',
      vv_detail: 'openai|signature_valid|unknown|signature_agent|-|-',
    });
  }
});

test('evidence vs identity: every named operator states its source in the same detail', () => {
  // The operator segment is filled only by (a) verification on this hit or (b) a page marker
  // (claim dom_marker). A UA token or an unverified Signature-Agent never names an operator.
  for (const verification of [undefined, ...verifications])
    for (const purpose of purposes)
      for (const claim of claims)
        for (const browserClass of browsers)
          for (const browserAgent of [undefined, 'openai', 'anthropic', 'google'])
            for (const browserPhase of phases) {
              const { vv_type, vv_detail } = visitorLabels({
                verdict: verification && verdict(verification, purpose, claim),
                browserClass,
                browserPhase,
                browserAgent,
              });
              const [operator, verified, , source] = vv_detail.split('|');
              if (operator === 'none') continue;
              if (['signature_valid', 'ip_match'].includes(verified))
                assert.ok(['agent_verified', 'crawler_verified'].includes(vv_type));
              else {
                assert.equal(source, 'dom_marker', vv_detail);
                assert.equal(vv_type, 'agent_unverified', vv_detail);
                assert.ok(['openai', 'anthropic'].includes(operator));
              }
            }
});
