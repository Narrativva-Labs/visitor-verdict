import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { Failure } from './errors.js';

export interface PublicKeyRecord {
  key: KeyObject;
  thumbprint: string;
  kid?: string;
  nbf?: number;
  exp?: number;
}
type Jwk = Record<string, unknown>;
const keyRules: Array<(key: Jwk) => boolean> = [
  (k) => k.kty === 'OKP' && k.crv === 'Ed25519',
  (k) => k.alg === undefined || k.alg === 'EdDSA' || k.alg === 'Ed25519',
  (k) => k.use === undefined || k.use === 'sig',
  (k) => k.key_ops === undefined || (Array.isArray(k.key_ops) && k.key_ops.includes('verify')),
  (k) => k.kid === undefined || (typeof k.kid === 'string' && k.kid.length > 0),
  (k) => k.nbf === undefined || Number.isSafeInteger(k.nbf),
  (k) => k.exp === undefined || Number.isSafeInteger(k.exp),
  (k) =>
    typeof k.x === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(k.x) &&
    Buffer.from(k.x, 'base64url').toString('base64url') === k.x,
];
export function activeKey(key: PublicKeyRecord, now: number): boolean {
  return (key.nbf === undefined || now >= key.nbf) && (key.exp === undefined || now < key.exp);
}
export function publicKeys(data: unknown, now?: number): Map<string, PublicKeyRecord> {
  const keys = (data as { keys?: unknown[] })?.keys;
  if (!Array.isArray(keys) || keys.length > 32) throw new Failure('invalid_directory', true);
  const result = new Map<string, PublicKeyRecord>();
  for (const value of keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Failure('invalid_directory', true);
    const k = value as Jwk;
    if ('d' in k) throw new Failure('private_jwk', true);
    if (!keyRules.every((rule) => rule(k))) continue;
    const x = k.x as string;
    const thumbprint = createHash('sha256')
      .update(JSON.stringify({ crv: k.crv, kty: k.kty, x }))
      .digest('base64url');
    const record: PublicKeyRecord = {
      key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }),
      thumbprint,
      kid: k.kid as string | undefined,
      nbf: k.nbf as number | undefined,
      exp: k.exp as number | undefined,
    };
    for (const id of new Set([thumbprint, record.kid].filter((v): v is string => !!v))) {
      if (result.has(id)) throw new Failure('ambiguous_keyid', true);
      result.set(id, record);
    }
  }
  if (now !== undefined)
    for (const [id, record] of result) if (!activeKey(record, now)) result.delete(id);
  return result;
}
