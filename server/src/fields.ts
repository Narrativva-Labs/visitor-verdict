import {
  parseDictionary,
  parseItem,
  serializeItem,
  serializeInnerList,
  Token,
} from 'structured-headers';
import type { Dictionary, Item, InnerList, BareItem } from 'structured-headers';
import { guard, dateCompatibleInput, type GuardMode } from './lexer.js';
import { Failure } from './errors.js';
import { field, trimOws } from './headers.js';
export { Failure } from './errors.js';
export { headers } from './headers.js';

export function dictionary(raw: string, mode: GuardMode = 'dictionary'): Dictionary {
  guard(raw, mode);
  try {
    const compatible = dateCompatibleInput(raw);
    const parsed = parseDictionary(compatible.text);
    if (compatible.dates.size) {
      const restore = (value: BareItem): BareItem =>
        value instanceof Token ? (compatible.dates.get(value.toString()) ?? value) : value;
      const restoreParams = (item: Item | InnerList) => {
        for (const [name, value] of item[1]) item[1].set(name, restore(value));
      };
      for (const item of parsed.values()) {
        restoreParams(item);
        if (Array.isArray(item[0]))
          for (const component of item[0]) {
            component[0] = restore(component[0]);
            restoreParams(component);
          }
        else item[0] = restore(item[0]);
      }
    }
    return parsed;
  } catch {
    throw new Failure('malformed_structured_field');
  }
}
export interface AgentClaims {
  legacy?: string;
  members?: Dictionary;
  identities: Map<string, string>;
  values: string[];
}
export function agents(raw: string): AgentClaims {
  const identities = new Map<string, string>();
  if (!raw) return { values: [], identities };
  if (trimOws(raw).startsWith('"')) {
    guard(raw, 'item');
    try {
      const item = parseItem(raw);
      if (typeof item[0] !== 'string' || item[1].size) throw new Error();
      return { legacy: item[0], values: [item[0]], identities };
    } catch {
      throw new Failure('malformed_signature_agent');
    }
  }
  let members: Dictionary;
  try {
    members = dictionary(raw);
  } catch (error) {
    if (error instanceof Failure && error.reason === 'duplicate_key')
      throw new Failure('ambiguous_signature_agent', true);
    throw error;
  }
  const values: string[] = [];
  for (const [label, item] of members) {
    if (typeof item[0] !== 'string') continue;
    values.push(item[0]);
    if (!item[1].size) identities.set(label, item[0]);
  }
  return { members, values, identities };
}
export interface Context {
  method: string;
  authority: string;
  target?: string;
}
export function normalizeAuthority(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  const raw = trimOws(value).toLowerCase().replace(/:443$/, '');
  if (!raw || /[^\x21-\x7e]|[/?#@\\]/.test(raw)) return;
  try {
    const u = new URL('https://' + raw);
    if (u.host !== raw || u.username || u.password) return;
    return raw;
  } catch {
    return;
  }
}
/** Extract raw octets, without WHATWG dot-segment, backslash or percent normalization. */
export function targetParts(context: Context): { path: string; uri: string } {
  const raw = context.target;
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > 65536 ||
    /[\x00-\x20\x7f\\#]/.test(raw) ||
    /%(?![0-9a-fA-F]{2})/.test(raw)
  )
    throw new Failure('insufficient_context', true);
  if (raw.startsWith('/')) {
    return { path: raw.split('?')[0], uri: 'https://' + context.authority + raw };
  }
  const absolute = /^https:\/\/([^/?#]+)(\/[^#]*|\?[^#]*)?$/i.exec(raw);
  if (!absolute || normalizeAuthority(absolute[1]) !== context.authority)
    throw new Failure('insufficient_context', true);
  const suffix = absolute[2] || '/';
  const pathAndQuery = suffix.startsWith('?') ? '/' + suffix : suffix;
  return { path: pathAndQuery.split('?')[0], uri: 'https://' + context.authority + pathAndQuery };
}
/**
 * Build the RFC 9421 signature base. `lossyLabels` are Signature-Input members whose timestamps
 * the lexical guard found to be Decimals: their re-serialization would not reproduce the signed
 * octets, so covering them is indeterminate rather than a definitive mismatch.
 */
export function signatureBase(
  input: Context,
  h: Map<string, string[]>,
  inner: InnerList,
  lossyLabels: ReadonlySet<string> = new Set(),
): string {
  const seen = new Set<string>();
  const lines = inner[0].map((component: Item) => {
    const [name, params] = component;
    const id = serializeItem(component);
    if (seen.has(id)) throw new Failure('duplicate_component');
    seen.add(id);
    if (typeof name !== 'string') throw new Failure('unsupported_component', true);
    if (name === 'content-digest') throw new Failure('insufficient_context', true);
    let value: string;
    if (name === '@authority' && !params.size) value = input.authority;
    else if (name === '@scheme' && !params.size) value = 'https';
    else if (name === '@query' && !params.size) {
      const uri = targetParts(input).uri;
      const offset = uri.indexOf('?', uri.indexOf('://') + 3);
      value = offset < 0 ? '?' : uri.slice(offset);
    } else if (name === '@method' && !params.size) value = input.method;
    else if ((name === '@target-uri' || name === '@path') && !params.size) {
      const target = targetParts(input);
      value = name === '@path' ? target.path : target.uri;
    } else if (name === 'signature-agent') {
      const raw = field(h, name);
      if (!raw) throw new Failure('required_component_missing');
      if (!params.size) value = raw;
      else if (params.size === 1 && typeof params.get('key') === 'string') {
        const member = dictionary(raw).get(params.get('key') as string);
        if (!member || Array.isArray(member[0])) throw new Failure('required_component_missing');
        value = serializeItem(member as Item);
      } else throw new Failure('unsupported_component', true);
    } else if (
      (name === 'signature-input' || name === 'signature') &&
      params.size === 1 &&
      typeof params.get('key') === 'string'
    ) {
      // Draft-01 §5.2.2: a signer may cover another label's signature and its parameters as
      // dictionary members (RFC 9421 §2.1.2), serialized per RFC 8941.
      const key = params.get('key') as string;
      if (name === 'signature-input' && lossyLabels.has(key))
        throw new Failure('unsupported_component', true);
      const raw = field(h, name);
      const member = raw ? dictionary(raw, name).get(key) : undefined;
      if (!member) throw new Failure('unsupported_component', true);
      if (name === 'signature-input' ? !Array.isArray(member[0]) : Array.isArray(member[0]))
        throw new Failure('unsupported_component', true);
      value = Array.isArray(member[0])
        ? serializeInnerList(member as InnerList)
        : serializeItem(member as Item);
    } else if (/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) && h.has(name)) {
      if (!params.size) value = field(h, name);
      else if (params.size === 1 && params.get('bs') === true)
        value = h
          .get(name)!
          .map((v) => ':' + Buffer.from(v, 'latin1').toString('base64') + ':')
          .join(', ');
      else throw new Failure('unsupported_component', true);
    } else throw new Failure('unsupported_component', true);
    return `${id}: ${value}`;
  });
  const base = [...lines, `"@signature-params": ${serializeInnerList(inner)}`].join('\n');
  if (/[^\x00-\x7f]/.test(base)) throw new Failure('non_ascii_component', true);
  return base;
}
/** Return ordinary covered field names for transport adapters. Throws on malformed/oversize SF input. */
function collectHeaderNames(signatureInput: string): string[] {
  if (typeof signatureInput !== 'string') throw new TypeError('signatureInput must be a string');
  if (signatureInput.length > 16384 || Buffer.byteLength(signatureInput) > 16384)
    throw new Failure('headers_too_large');
  const inputs = dictionary(signatureInput, 'signature-input');
  if (inputs.size > 4) throw new Failure('too_many_signatures');
  const names = new Set<string>();
  for (const item of inputs.values()) {
    if (!Array.isArray(item[0])) throw new Failure('malformed_signature');
    if (item[0].length > 32) throw new Failure('too_many_components');
    for (const [name] of item[0])
      if (typeof name === 'string' && !name.startsWith('@')) names.add(name);
  }
  return [...names];
}

/** Return covered header names; malformed input throws only public TypeError. */
export function coveredHeaderNames(signatureInput: string): string[] {
  try {
    return collectHeaderNames(signatureInput);
  } catch {
    throw new TypeError('Invalid Signature-Input');
  }
}
/** Always returns the base collector set, even for missing/malformed Signature-Input. */
export function requiredHeaderNames(signatureInput?: string): string[] {
  const base = ['user-agent', 'signature', 'signature-input', 'signature-agent'];
  try {
    return [...new Set([...base, ...collectHeaderNames(signatureInput!)])];
  } catch {
    return base;
  }
}
