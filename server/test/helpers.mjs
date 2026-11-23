import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createVerifier } from '../dist/index.js';
export const clock = 1800000000;
export const identity = 'https://agent.example';
export const directoryUrl = identity + '/keys';
export const pair = generateKeyPairSync('ed25519');
export const jwk = pair.publicKey.export({ format: 'jwk' });
export const keyid = createHash('sha256')
  .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))
  .digest('base64url');
export const operator = {
  operator: 'test',
  signatureAgent: identity,
  directoryUrl,
  verifiedByCapture: false,
  source: 'synthetic',
  checked: '2026-11-20',
  ipLists: [],
};
export const fetcher = async () => Response.json({ keys: [jwk] });
export const makeVerifier = (extra = {}) =>
  createVerifier({
    registry: [operator],
    authorities: ['example.com'],
    now: () => clock,
    fetcher,
    ...extra,
  });
export const verifier = makeVerifier();
export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
// Independent RFC 9421 base construction: never use the library canonicalizer to sign regressions.
export function signed({
  components = ['"@authority"', '"@method"', '"signature-agent"'],
  values = {},
  agent = JSON.stringify(identity),
  label = 's',
  created = clock,
  expires = clock + 3600,
  kid = keyid,
  tag = 'web-bot-auth',
  extraParams = '',
} = {}) {
  const params =
    '(' +
    components.join(' ') +
    ');created=' +
    created +
    ';expires=' +
    expires +
    ';keyid=' +
    JSON.stringify(kid) +
    ';tag=' +
    JSON.stringify(tag) +
    ';nonce="synthetic"' +
    extraParams;
  const all = {
    '"@authority"': 'example.com',
    '"@method"': 'GET',
    '"signature-agent"': agent,
    ...values,
  };
  const base =
    components.map((id) => id + ': ' + all[id]).join('\n') + '\n"@signature-params": ' + params;
  const headers = {
    'signature-agent': agent,
    'signature-input': label + '=' + params,
    signature:
      label + '=:' + sign(null, Buffer.from(base), pair.privateKey).toString('base64') + ':',
  };
  for (const id of components) {
    const name = JSON.parse(id.split(';')[0]);
    if (!name.startsWith('@') && name !== 'signature-agent') headers[name] = all[id];
  }
  return { method: 'GET', host: 'example.com', target: '/b', headers };
}
