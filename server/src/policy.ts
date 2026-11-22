import type { InnerList } from 'structured-headers';
import type { AgentRequest, AgentVerdict, SignatureResult } from './types.js';
import { Failure } from './errors.js';
import { normalizeAuthority, type Context } from './fields.js';

export function checkContext(input: AgentRequest, authorities: Set<string>): Context {
  const authority = normalizeAuthority(input.host);
  if (!authority || !authorities.has(authority)) throw new Failure('unknown_authority', true);
  if (
    typeof input.method !== 'string' ||
    input.method.length > 32 ||
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(input.method)
  )
    throw new Failure('insufficient_context', true);
  const context = { method: input.method, authority, target: input.target };
  if (
    input.target !== undefined &&
    (typeof input.target !== 'string' || input.target.length > 65536)
  )
    throw new Failure('insufficient_context', true);
  if (
    input.clientIp !== undefined &&
    (typeof input.clientIp !== 'string' || input.clientIp.length > 64)
  )
    throw new Failure('insufficient_context', true);
  return context;
}
export function checkSignaturePolicy(
  inner: InnerList,
  now: number,
  maxLifetimeSeconds = 86400,
): string {
  const params = inner[1];
  const created = params.get('created');
  const expires = params.get('expires');
  const keyid = params.get('keyid');
  if (params.get('tag') !== 'web-bot-auth') throw new Failure('wrong_tag');
  if (typeof keyid !== 'string' || !keyid) throw new Failure('missing_keyid');
  if (
    typeof created !== 'number' ||
    typeof expires !== 'number' ||
    !Number.isSafeInteger(created) ||
    !Number.isSafeInteger(expires)
  )
    throw new Failure('missing_timestamps');
  if (created > now + 30) throw new Failure('future_created');
  if (expires < now - 30) throw new Failure('expired');
  if (expires < created) throw new Failure('invalid_validity_window');
  if (expires - created > maxLifetimeSeconds) throw new Failure('invalid_validity_window', true);
  if (params.has('alg') && params.get('alg') !== 'ed25519')
    throw new Failure('unsupported_algorithm', true);
  if (
    !inner[0].some(
      ([name, parameters]) => (name === '@authority' || name === '@target-uri') && !parameters.size,
    )
  )
    throw new Failure('required_component_missing');
  return keyid;
}
/** Direct valid > invalid > intermediary valid > indeterminate; IP needs no signatures. */
export function selectOutcome(
  signatures: SignatureResult[],
  presented: boolean,
  ip?: AgentVerdict['ip'],
  ipUnavailable = false,
  intermediaryOnly = false,
): Pick<AgentVerdict, 'verification' | 'reason'> {
  const relevant = signatures.filter((s) => s.reason !== 'ignored_non_wba');
  if (presented && signatures.length && !relevant.length) presented = false;
  if (!presented)
    return ip
      ? { verification: 'ip_match', reason: 'official_ip_range_match' }
      : ipUnavailable
        ? { verification: 'none', reason: 'ip_evidence_unavailable' }
        : {
            verification: 'no_signature',
            reason: signatures.length ? 'ignored_non_wba' : 'signature_headers_absent',
          };
  const invalid =
    relevant.find((s) => s.result === 'signature_invalid' && s.reason === 'replay') ??
    relevant.find((s) => s.result === 'signature_invalid');
  const selected =
    (intermediaryOnly ? invalid : undefined) ??
    relevant.find((s) => s.result === 'signature_valid') ??
    invalid ??
    relevant[0];
  return selected
    ? { verification: selected.result, reason: selected.reason }
    : { verification: 'signature_invalid', reason: 'malformed_signature' };
}
