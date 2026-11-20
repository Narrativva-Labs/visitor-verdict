import { parseDictionary, parseItem, serializeItem, serializeInnerList } from 'structured-headers';
import type { Dictionary, Item, InnerList } from 'structured-headers';
import { guard } from './lexer.js';
import { Failure } from './errors.js';
import { field, trimOws } from './headers.js';
export { Failure } from './errors.js';
export { headers } from './headers.js';

export function dictionary(raw: string): Dictionary {
  guard(raw, true);
  try {
    return parseDictionary(raw);
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
    guard(raw, false);
    try {
      const item = parseItem(raw);
      if (typeof item[0] !== 'string' || item[1].size) throw new Error();
      return { legacy: item[0], values: [item[0]], identities };
    } catch {
      throw new Failure('malformed_signature_agent');
    }
  }
  const members = dictionary(raw);
  const values: string[] = [];
  for (const [label, item] of members) {
    if (typeof item[0] !== 'string') continue;
    values.push(item[0]);
    if (!item[1].size || (item[1].size === 1 && item[1].get('type') === 'directory'))
      identities.set(label, item[0]);
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
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return { path: raw.split('?')[0], uri: 'https://' + context.authority + raw };
  }
  const absolute = /^https:\/\/([^/?#]+)(\/[^#]*|\?[^#]*)?$/i.exec(raw);
  if (!absolute || normalizeAuthority(absolute[1]) !== context.authority)
    throw new Failure('insufficient_context', true);
  const suffix = absolute[2] || '/';
  return { path: suffix.startsWith('?') ? '/' : suffix.split('?')[0], uri: raw };
}
export function signatureBase(input: Context, h: Map<string, string[]>, inner: InnerList): string {
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
    else if (name === '@method' && !params.size) value = input.method;
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
    } else if (/^[a-z][a-z0-9-]*$/.test(name) && !params.size && h.has(name)) {
      value = field(h, name);
    } else throw new Failure('unsupported_component', true);
    return `${id}: ${value}`;
  });
  return [...lines, `"@signature-params": ${serializeInnerList(inner)}`].join('\n');
}
/** Return ordinary covered field names for transport adapters. Throws on malformed/oversize SF input. */
export function coveredHeaderNames(signatureInput: string): string[] {
  if (typeof signatureInput !== 'string') throw new TypeError('signatureInput must be a string');
  if (Buffer.byteLength(signatureInput) > 16384) throw new Failure('headers_too_large');
  const inputs = dictionary(signatureInput);
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
