import { isIP } from 'node:net';
import { Failure } from './errors.js';

export interface SailDocument {
  expiresAfter: number;
  services: Map<string, Array<{ ipv4Prefix?: string; ipv6Prefix?: string; exclusive?: boolean }>>;
}
type Table = Record<string, unknown>;
function invalid(): never {
  throw new Failure('invalid_sail', true);
}
function stringArray(raw: string): string[] {
  const result: string[] = [];
  let i = 1;
  function whitespace() {
    while (i < raw.length && /[ \t\r\n]/.test(raw[i])) i++;
  }
  whitespace();
  while (raw[i] !== ']') {
    if (raw[i] !== '"') invalid();
    const start = i++;
    while (i < raw.length && raw[i] !== '"') {
      if (raw[i] === '\\') {
        i++;
        if (!'"\\btnfru'.includes(raw[i] ?? '')) invalid();
      }
      i++;
    }
    if (i >= raw.length) invalid();
    result.push(JSON.parse(raw.slice(start, ++i)) as string);
    if (result.length > 8192) invalid();
    whitespace();
    if (raw[i] === ']') break;
    if (raw[i++] !== ',') invalid();
    whitespace();
  }
  if (i !== raw.length - 1) invalid();
  return result;
}
/** Minimal schema-specific TOML reader: not a general TOML parser. Unknown syntax fails closed. */
export function parseSail(text: string): SailDocument {
  if (
    typeof text !== 'string' ||
    text.length > 65536 ||
    Buffer.byteLength(text) > 65536 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
  )
    invalid();
  // Remove comments only outside basic quoted strings; preserve LF for scalar boundaries.
  let cleaned = '';
  let quoted = false;
  let escaped = false;
  let comment = false;
  for (const c of text) {
    if (c === '\n') comment = false;
    if (comment) continue;
    if (!quoted && c === '#') {
      comment = true;
      continue;
    }
    cleaned += c;
    if (escaped) escaped = false;
    else if (quoted && c === '\\') escaped = true;
    else if (c === '"') quoted = !quoted;
  }
  if (quoted) invalid();
  const top: Table = Object.create(null);
  const sets: Table[] = [];
  const services: Table[] = [];
  let current = top;
  let pending = '';
  let arrayKey = '';
  let arrayLines: string[] = [];
  for (const line of cleaned.split(/\r?\n/)) {
    const value = line.trim();
    if (!value && !arrayKey) continue;
    if (arrayKey) {
      arrayLines.push(value);
      if (!value.endsWith(']')) continue;
      pending = arrayKey + ' = ' + arrayLines.join(' ');
      arrayKey = '';
      arrayLines = [];
    } else pending = value;
    const table = /^\[\[(prefix_sets|services)\]\]$/.exec(pending);
    if (table) {
      current = Object.create(null) as Table;
      (table[1] === 'prefix_sets' ? sets : services).push(current);
      pending = '';
      if (sets.length > 32 || services.length > 32) invalid();
      continue;
    }
    const assignment = /^([a-z][a-z0-9_]*)\s*=\s*(.*)$/.exec(pending);
    if (!assignment) invalid();
    const [, key, raw] = assignment;
    if (raw.startsWith('[') && !raw.endsWith(']')) {
      arrayKey = key;
      arrayLines = [raw];
      pending = '';
      continue;
    }
    const allowed =
      current === top
        ? ['schema', 'modified', 'expires_after']
        : sets.includes(current)
          ? ['name', 'exclusive', 'ipv4_prefixes', 'ipv6_prefixes']
          : ['name', 'exhaustive', 'prefix_sets'];
    if (!allowed.includes(key) || Object.hasOwn(current, key)) invalid();
    try {
      if (key === 'modified') {
        if (
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(raw) ||
          !Number.isFinite(Date.parse(raw)) ||
          new Date(raw).toISOString() !== raw.replace('Z', '.000Z')
        )
          invalid();
        current[key] = raw;
      } else if (raw.startsWith('[')) {
        current[key] = stringArray(raw);
      } else {
        if (!(raw.startsWith('"') || /^(?:true|false|0|[1-9]\d*)$/.test(raw))) invalid();
        if (raw.startsWith('"')) {
          const strings = stringArray('[' + raw + ']');
          if (strings.length !== 1) invalid();
          current[key] = strings[0];
        } else current[key] = JSON.parse(raw) as unknown;
      }
    } catch {
      invalid();
    }
    pending = '';
  }
  if (
    pending ||
    arrayKey ||
    top.schema !== 'draft-kelley-webbotauth-sail-00' ||
    typeof top.modified !== 'string' ||
    !Number.isSafeInteger(top.expires_after) ||
    (top.expires_after as number) <= 0 ||
    !sets.length ||
    !services.length
  )
    invalid();
  const prefixes = new Map<
    string,
    Array<{ ipv4Prefix?: string; ipv6Prefix?: string; exclusive?: boolean }>
  >();
  for (const table of sets) {
    if (
      typeof table.name !== 'string' ||
      !table.name ||
      prefixes.has(table.name) ||
      typeof table.exclusive !== 'boolean' ||
      !Array.isArray(table.ipv4_prefixes) ||
      !Array.isArray(table.ipv6_prefixes)
    )
      invalid();
    const values: Array<{ ipv4Prefix?: string; ipv6Prefix?: string; exclusive?: boolean }> = [];
    for (const [key, family, width] of [
      ['ipv4_prefixes', 4, 32],
      ['ipv6_prefixes', 6, 128],
    ] as const) {
      for (const value of table[key] as unknown[]) {
        if (typeof value !== 'string' || value.length > 64) invalid();
        const [ip, bits, extra] = value.split('/');
        if (
          isIP(ip) !== family ||
          extra !== undefined ||
          (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) > width))
        )
          invalid();
        values.push(family === 4 ? { ipv4Prefix: value } : { ipv6Prefix: value });
        if (values.length > 8192) invalid();
      }
    }
    prefixes.set(
      table.name,
      values.map((value) => ({ ...value, exclusive: table.exclusive as boolean })),
    );
  }
  const result: SailDocument = { expiresAfter: top.expires_after as number, services: new Map() };
  for (const table of services) {
    if (
      typeof table.name !== 'string' ||
      !table.name ||
      result.services.has(table.name) ||
      typeof table.exhaustive !== 'boolean' ||
      !Array.isArray(table.prefix_sets) ||
      !table.prefix_sets.length
    )
      invalid();
    const values: Array<{ ipv4Prefix?: string; ipv6Prefix?: string; exclusive?: boolean }> = [];
    const seen = new Set<string>();
    for (const name of table.prefix_sets as unknown[]) {
      if (typeof name !== 'string' || !prefixes.has(name) || seen.has(name)) invalid();
      seen.add(name);
      values.push(...prefixes.get(name)!);
      if (values.length > 8192) invalid();
    }
    result.services.set(table.name, values);
  }
  return result;
}
