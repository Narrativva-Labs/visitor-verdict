import { Failure } from './errors.js';

export type GuardMode = 'dictionary' | 'signature-input' | 'signature' | 'item';

interface Lexeme {
  start: number;
  end: number;
  kind: 'bare' | 'string' | 'bytes' | 'punct';
  value: string;
}
/** One pass over SF text. Colons inside tokens are never treated as byte delimiters. */
function lex(raw: string): Lexeme[] {
  const out: Lexeme[] = [];
  let i = 0;
  while (i < raw.length) {
    const start = i;
    const c = raw[i++];
    if (c === ' ' || c === '\t') continue;
    if ('=;(),'.includes(c)) {
      out.push({ kind: 'punct', value: c, start, end: i });
      continue;
    }
    if (c === '"' || (c === '%' && raw[i] === '"')) {
      if (c === '%') i++;
      let closed = false;
      while (i < raw.length) {
        const next = raw[i++];
        if (next === '\\' && c === '"') i++;
        else if (next === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) throw new Failure('malformed_structured_field');
      out.push({ kind: 'string', value: raw.slice(start, i), start, end: i });
      continue;
    }
    if (c === ':') {
      while (i < raw.length && raw[i] !== ':') i++;
      if (i === raw.length) throw new Failure('malformed_structured_field');
      const value = raw.slice(start + 1, i++);
      if (
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value) ||
        Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '') !==
          value.replace(/=+$/, '')
      ) {
        throw new Failure('malformed_base64');
      }
      out.push({ kind: 'bytes', value, start, end: i });
      continue;
    }
    while (i < raw.length && !' \t=;(),"'.includes(raw[i])) i++;
    out.push({ kind: 'bare', value: raw.slice(start, i), start, end: i });
  }
  return out;
}
/** Guard only: upstream parser remains responsible for the full SF grammar. */
export function guard(raw: string, mode: GuardMode): Set<string> {
  const tokens = lex(raw);
  const dictionary = mode !== 'item';
  const invalidTimestamps = new Set<string>();
  let label = '';
  const labels = new Set<string>();
  let parameters = new Set<string>();
  let depth = 0;
  let memberStart = dictionary;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (memberStart && t.kind === 'bare') {
      if (labels.has(t.value)) throw new Failure('duplicate_key');
      labels.add(t.value);
      label = t.value;
      memberStart = false;
    }
    if (t.kind === 'punct') {
      if (t.value === '(') depth++;
      if (t.value === ')') depth--;
      if (t.value === ',' && depth === 0) memberStart = dictionary;
      if (t.value === ';') {
        const key = tokens[++i];
        if (!key || key.kind !== 'bare') throw new Failure('malformed_structured_field');
        if (parameters.has(key.value)) throw new Failure('duplicate_key');
        parameters.add(key.value);
        if (tokens[i + 1]?.value === '=') {
          const value = tokens[i + 2];
          if (
            mode === 'signature-input' &&
            (key.value === 'created' || key.value === 'expires') &&
            depth === 0 &&
            (!value || value.kind !== 'bare' || !/^-?\d+$/.test(value.value))
          ) {
            invalidTimestamps.add(label);
          }
          i += 2;
        }
      } else if (t.value !== '=') parameters = new Set();
    } else {
      // Each bare/string/bytes item starts its own parameter scope, including inner-list tokens.
      parameters = new Set();
    }
  }
  return invalidTimestamps;
}

/** Work around upstream Date parsing consuming following delimiters; restore Date types after SF parsing. */
export function dateCompatibleInput(raw: string): { text: string; dates: Map<string, Date> } {
  const tokens = lex(raw);
  const used = new Set(tokens.filter((t) => t.kind === 'bare').map((t) => t.value));
  const dates = new Map<string, Date>();
  const parts: string[] = [];
  let offset = 0;
  let counter = 0;
  for (const token of tokens) {
    if (token.kind !== 'bare' || !token.value.startsWith('@')) continue;
    if (!/^@-?\d{1,15}$/.test(token.value)) throw new Failure('malformed_structured_field');
    const date = new Date(Number(token.value.slice(1)) * 1000);
    if (!Number.isFinite(date.getTime())) throw new Failure('malformed_structured_field');
    let name: string;
    do {
      name = 'vvdate' + counter++;
    } while (used.has(name));
    used.add(name);
    dates.set(name, date);
    parts.push(raw.slice(offset, token.start), name);
    offset = token.end;
  }
  if (!dates.size) return { text: raw, dates };
  parts.push(raw.slice(offset));
  return { text: parts.join(''), dates };
}
