import type { HeadersInput } from './types.js';
import { Failure } from './errors.js';

export function trimOws(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && (value[start] === ' ' || value[start] === '\t')) start++;
  while (end > start && (value[end - 1] === ' ' || value[end - 1] === '\t')) end--;
  return value.slice(start, end);
}

/** Unsupported containers are programmer errors; malformed contents are request errors. */
export function assertHeadersInput(input: unknown): asserts input is HeadersInput {
  if (input instanceof Headers || input instanceof Map || Array.isArray(input)) return;
  if (
    input &&
    typeof input === 'object' &&
    (Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null)
  )
    return;
  throw new TypeError('Unsupported headers container');
}
export function headers(input: HeadersInput): Map<string, string[]> {
  assertHeadersInput(input);
  const out = new Map<string, string[]>();
  let bytes = 0;
  let related = 0;
  let count = 0;
  let uaBytes = 0;
  function append(name: unknown, value: unknown) {
    if (typeof name !== 'string' || typeof value !== 'string')
      throw new Failure('malformed_header');
    if (name.length > 65536 || value.length > 65536) throw new Failure('headers_too_large');
    const k = name.toLowerCase();
    const size = Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    bytes += size;
    count++;
    if (k === 'user-agent') uaBytes += Buffer.byteLength(value);
    if (k === 'signature' || k === 'signature-input' || k === 'signature-agent') related += size;
    if (bytes > 65536 || count > 256 || related > 16384 || uaBytes > 1024)
      throw new Failure('headers_too_large');
    if (
      (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(k) && !/^:(?:authority|method|scheme|path)$/.test(k)) ||
      /[\x00-\x08\x0a-\x1f\x7f\u0100-\uffff]/.test(value)
    )
      throw new Failure('malformed_header');
    let values = out.get(k);
    if (!values) {
      values = [];
      out.set(k, values);
    }
    values.push(trimOws(value));
  }
  if (Array.isArray(input)) {
    if (input.length % 2) throw new Failure('malformed_header');
    for (let i = 0; i < input.length; i += 2) append(input[i], input[i + 1]);
  } else if (input instanceof Headers || input instanceof Map) {
    for (const [name, value] of input) {
      if (Array.isArray(value)) for (const v of value) append(name, v);
      else append(name, value);
    }
  } else {
    for (const name of Object.keys(input)) {
      const value = (input as Record<string, unknown>)[name];
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) append(name, v);
      else append(name, value);
    }
  }
  return out;
}
export function field(h: Map<string, string[]>, name: string): string {
  return h.get(name)?.join(', ') ?? '';
}
