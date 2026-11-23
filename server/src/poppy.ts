import {
  constants,
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
  type JsonWebKey,
} from 'node:crypto';
import { AgentCache } from './cache.js';
import { MemoryNonceStore } from './replay.js';
import type { AgentRequest, AgentVerdict, Registry } from './types.js';

export type PoppyReason =
  | 'poppy_valid'
  | 'poppy_malformed'
  | 'poppy_version'
  | 'poppy_unknown_client'
  | 'poppy_algorithm'
  | 'poppy_key_unavailable'
  | 'poppy_signature_invalid'
  | 'poppy_claims'
  | 'poppy_time'
  | 'poppy_audience'
  | 'poppy_request'
  | 'poppy_oauth_unsupported'
  | 'poppy_replay'
  | 'poppy_replay_capacity'
  | 'poppy_document_unavailable'
  | 'poppy_deadline';
export interface PoppyResult {
  result: 'signature_valid' | 'signature_invalid' | 'none';
  reason: PoppyReason;
  version?: string;
  alg?: 'ES256';
  kidFingerprint?: string;
}
type Obj = Record<string, any>;
function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw 0;
  return value;
}
function decode(s: string): Buffer {
  if (!s || !/^[A-Za-z0-9_-]+$/.test(s)) throw 0;
  const b = Buffer.from(s, 'base64url');
  if (b.toString('base64url') !== s) throw 0;
  return b;
}
/** Bounded, compact JWS only. No embedded keys, alternate encodings or critical extensions. */
function json(bytes: Buffer): Obj {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const stack: (Set<string> | undefined)[] = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '{' || c === '[') {
      if (stack.length >= 16) throw 0;
      stack.push(c === '{' ? new Set() : undefined);
    } else if (c === '}' || c === ']') stack.pop();
    else if (c === '"') {
      const start = i++;
      for (; i < source.length; i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === '"') break;
      }
      let next = i + 1;
      while (/\s/.test(source[next] ?? '') && next < source.length) next++;
      if (source[next] === ':') {
        const key = JSON.parse(source.slice(start, i + 1));
        const keys = stack[stack.length - 1];
        if (!keys || keys.has(key)) throw 0;
        keys.add(key);
      }
    }
  }
  return object(JSON.parse(source));
}
export function parsePoppyJwt(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 16384) throw 0;
  const parts = raw.split('.');
  if (parts.length !== 3) throw 0;
  const h = json(decode(parts[0]));
  const p = json(decode(parts[1]));
  if (
    h.crit !== undefined ||
    h.b64 !== undefined ||
    h.jwk !== undefined ||
    h.jku !== undefined ||
    h.x5u !== undefined
  )
    throw 0;
  return { h, p, sig: decode(parts[2]), bytes: Buffer.from(parts[0] + '.' + parts[1]) };
}
const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
const text = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 512;
const time = (s: unknown) => Number.isSafeInteger(s) && (s as number) >= 0;
function publicJwk(value: unknown, alg: string): Obj {
  const k = object(value);
  if (['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((x) => x in k)) throw 0;
  if (k.use !== undefined && k.use !== 'sig') throw 0;
  if (k.alg !== undefined && k.alg !== alg) throw 0;
  if (
    k.key_ops !== undefined &&
    (!Array.isArray(k.key_ops) || k.key_ops.length !== 1 || k.key_ops[0] !== 'verify')
  )
    throw 0;
  if (alg === 'ES256') {
    if (
      k.kty !== 'EC' ||
      k.crv !== 'P-256' ||
      decode(k.x).length !== 32 ||
      decode(k.y).length !== 32
    )
      throw 0;
  } else if (
    k.kty !== 'RSA' ||
    decode(k.n).length < 256 ||
    decode(k.n).length > 1024 ||
    decode(k.e).length > 8
  )
    throw 0;
  return k;
}
export function poppyMetadata(data: unknown, client: string, jwks: string): string {
  const doc = object(data);
  if (doc.client_id !== client || doc.jwks_uri !== jwks) throw 0;
  return jwks;
}
interface PoppyKey {
  kid: string;
  alg: 'ES256' | 'PS384';
  key: KeyObject;
}
const privateMembers = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];
/** Import supported public roots once per document refresh, never once per request. */
export function poppyKeys(data: unknown): PoppyKey[] {
  const doc = object(data);
  if (!Array.isArray(doc.keys) || doc.keys.length > 32) throw 0;
  const result: PoppyKey[] = [];
  for (const value of doc.keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (privateMembers.some((member) => member in value)) throw 0;
    try {
      const k = object(value);
      if (!text(k.kid)) continue;
      const alg = k.kty === 'EC' ? 'ES256' : 'PS384';
      publicJwk(k, alg);
      result.push({
        kid: k.kid,
        alg,
        key: createPublicKey({ key: k as JsonWebKey, format: 'jwk' }),
      });
    } catch {
      // Unsupported/malformed public keys do not invalidate supported peers.
    }
  }
  return result;
}
function signed(jwt: ReturnType<typeof parsePoppyJwt>, key: KeyObject): boolean {
  if (jwt.h.alg === 'ES256')
    return verify('sha256', jwt.bytes, { key, dsaEncoding: 'ieee-p1363' }, jwt.sig);
  return verify(
    'sha384',
    jwt.bytes,
    { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 48 },
    jwt.sig,
  );
}
/** Only pinned registry URLs are fetched; no request-controlled network destinations. */
export class PoppyVerifier {
  private replay: MemoryNonceStore;
  /** Bounded public-key cache; never exported as visitor diagnostics. */
  private delegatedKeys = new Map<string, KeyObject>();
  constructor(
    private registry: Registry,
    private cache: AgentCache,
    now: () => number,
  ) {
    this.replay = new MemoryNonceStore(10000, now);
  }
  async evaluate(
    h: Map<string, string[]>,
    input: AgentRequest,
    now: number,
    cacheOnly: boolean,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<{ diagnostic: PoppyResult; verified?: AgentVerdict['verified'] }> {
    let reason: PoppyReason = 'poppy_malformed';
    const diagnostic: PoppyResult = { result: 'none', reason };
    const fail = (why: PoppyReason, invalid = false) => ({
      diagnostic: {
        ...diagnostic,
        reason: why,
        result: invalid ? ('signature_invalid' as const) : ('none' as const),
      },
    });
    const active = () => !signal.aborted && performance.now() < deadlineAt;
    try {
      if (!active()) return fail('poppy_deadline');
      if (h.get('poppy-session')?.length !== 1) return fail(reason);
      const version = h.get('poppy-version')?.[0] ?? '';
      if (
        h.get('poppy-version')?.length !== 1 ||
        version.length > 32 ||
        !/^1\.[0-9]+$/.test(version)
      )
        return fail('poppy_version');
      diagnostic.version = version;
      const jwt = parsePoppyJwt(h.get('poppy-session')![0]);
      if (jwt.h.alg !== 'ES256') return fail('poppy_algorithm');
      diagnostic.alg = 'ES256';
      if (jwt.sig.length !== 64) return fail('poppy_malformed');
      const op = this.registry.find((o) => o.poppyClientId === jwt.p.iss);
      if (!op?.poppyClientId || !op.poppyJwksUri) return fail('poppy_unknown_client');
      const dlg = parsePoppyJwt(jwt.h.poppy_dlg);
      if (!['ES256', 'PS384'].includes(dlg.h.alg)) return fail('poppy_algorithm');
      if (dlg.h.alg === 'ES256' && dlg.sig.length !== 64) return fail('poppy_malformed');
      if (
        jwt.h.typ !== 'poppy-session+jwt' ||
        dlg.h.typ !== 'poppy-delegation+jwt' ||
        !text(dlg.h.kid)
      )
        return fail('poppy_claims');
      if (!active()) return fail('poppy_deadline');
      reason = 'poppy_document_unavailable';
      const mode = cacheOnly ? 'cached' : 'request';
      await this.cache.load(
        op.poppyClientId,
        'directory',
        now,
        (d) => poppyMetadata(d, op.poppyClientId!, op.poppyJwksUri!),
        mode,
      );
      if (!active()) return fail('poppy_deadline');
      let keys = await this.cache.load(op.poppyJwksUri, 'directory', now, poppyKeys, mode);
      if (!active()) return fail('poppy_deadline');
      let candidates = keys.filter((k) => k.kid === dlg.h.kid);
      if (!candidates.length) {
        if (!active()) return fail('poppy_deadline');
        keys = await this.cache.load(
          op.poppyJwksUri,
          'directory',
          now,
          poppyKeys,
          cacheOnly ? 'cached-forced' : 'forced',
        );
        candidates = keys.filter((k) => k.kid === dlg.h.kid);
      }
      if (!active()) return fail('poppy_deadline');
      if (candidates.length !== 1) return fail('poppy_key_unavailable');
      reason = 'poppy_key_unavailable';
      const root = candidates[0];
      if (root.alg !== dlg.h.alg) return fail('poppy_key_unavailable');
      diagnostic.kidFingerprint = hash(root.kid).slice(0, 16);
      if (!signed(dlg, root.key)) return fail('poppy_signature_invalid', true);
      if (!active()) return fail('poppy_deadline');
      if (
        dlg.p.iss !== jwt.p.iss ||
        !text(dlg.p.jti) ||
        ['aud', 'sub', 'sid', 'agent_id'].some((k) => k in dlg.p)
      )
        return fail('poppy_claims');
      if (
        !time(dlg.p.iat) ||
        !time(dlg.p.exp) ||
        dlg.p.iat > now + 60 ||
        dlg.p.exp <= now ||
        dlg.p.exp <= dlg.p.iat ||
        dlg.p.exp - dlg.p.iat > 86400
      )
        return fail('poppy_time');
      const delegated = publicJwk(dlg.p.cnf?.jwk, 'ES256');
      const thumb = hash(
        JSON.stringify({ crv: delegated.crv, kty: delegated.kty, x: delegated.x, y: delegated.y }),
      );
      if (jwt.h.kid !== thumb) return fail('poppy_claims');
      let delegatedKey = this.delegatedKeys.get(thumb);
      if (!delegatedKey) {
        delegatedKey = createPublicKey({ key: delegated as JsonWebKey, format: 'jwk' });
        if (this.delegatedKeys.size >= 128)
          this.delegatedKeys.delete(this.delegatedKeys.keys().next().value!);
        this.delegatedKeys.set(thumb, delegatedKey);
      }
      if (!signed(jwt, delegatedKey)) return fail('poppy_signature_invalid', true);
      if (!active()) return fail('poppy_deadline');
      if (
        !text(jwt.p.sub) ||
        !text(jwt.p.sid) ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(jwt.p.sid) ||
        !text(jwt.p.jti) ||
        (jwt.p.agent_id !== undefined && !text(jwt.p.agent_id)) ||
        jwt.p.exp !== undefined
      )
        return fail('poppy_claims');
      if (
        !time(jwt.p.iat) ||
        Math.abs(now - jwt.p.iat) > 60 ||
        jwt.p.iat > dlg.p.exp ||
        jwt.p.iat < dlg.p.iat
      )
        return fail('poppy_time');
      reason = 'poppy_request';
      if (
        input.target &&
        (/[\\\x00-\x20\x7f]/.test(input.target) ||
          !(input.target.startsWith('/') || input.target.startsWith('https://')) ||
          input.target
            .split(/[?#]/, 1)[0]
            .split('/')
            .some((part) => /^\.\.?$/.test(part.replace(/%2e/gi, '.'))))
      )
        return fail(reason);
      if (input.secure === false || !input.target) return fail('poppy_request');
      const origin = new URL('https://' + input.host).origin;
      if (jwt.p.aud !== origin) return fail('poppy_audience');
      const url = new URL(input.target, origin);
      if (url.origin !== origin || url.username || url.password) return fail('poppy_request');
      url.search = '';
      url.hash = '';
      if (jwt.p.htm !== input.method || jwt.p.htu !== url.href) return fail('poppy_request');
      if (h.has('authorization') || jwt.p.ath !== undefined) return fail('poppy_oauth_unsupported');
      reason = 'poppy_replay_capacity';
      const key = 'poppy:' + hash(JSON.stringify([jwt.p.iss, jwt.p.aud, jwt.p.jti]));
      const expires = Math.min(jwt.p.iat + 60, dlg.p.exp);
      if (!active()) return fail('poppy_deadline');
      if (
        !(await this.replay.insertIfAbsent(key, Math.max(1, expires - now), {
          now,
          scope: op.operator,
          expiresAt: expires,
        }))
      )
        return fail('poppy_replay');
      return {
        diagnostic: { ...diagnostic, result: 'signature_valid', reason: 'poppy_valid' },
        verified: { operator: op.operator, method: 'poppy', expiresAt: expires },
      };
    } catch {
      return fail(active() ? reason : 'poppy_deadline');
    }
  }
}
