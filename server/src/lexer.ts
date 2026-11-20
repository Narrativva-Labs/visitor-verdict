import { Failure } from './errors.js';

interface Lexeme {
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
      out.push({ kind: 'punct', value: c });
      continue;
    }
    if (c === '"' || (c === '%' && raw[i] === '"')) {
      if (c === '%') i++;
      let closed = false;
      while (i < raw.length) {
        const next = raw[i++];
        if (next === '\\') i++;
        else if (next === '"') {
          closed = true;
          break;
        }
      }
      if (!closed) throw new Failure('malformed_structured_field');
      out.push({ kind: 'string', value: raw.slice(start, i) });
      continue;
    }
    if (c === ':') {
      while (i < raw.length && raw[i] !== ':') i++;
      if (i === raw.length) throw new Failure('malformed_structured_field');
      const value = raw.slice(start + 1, i++);
      if (
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value) ||
        Buffer.from(value, 'base64').toString('base64') !== value
      ) {
        throw new Failure('malformed_base64');
      }
      out.push({ kind: 'bytes', value });
      continue;
    }
    while (i < raw.length && !' \t=;(),"'.includes(raw[i])) i++;
    out.push({ kind: 'bare', value: raw.slice(start, i) });
  }
  return out;
}
/** Guard only: upstream parser remains responsible for the full SF grammar. */
export function guard(raw: string, dictionary: boolean): void {
  const tokens = lex(raw);
  const labels = new Set<string>();
  let parameters = new Set<string>();
  let depth = 0;
  let memberStart = dictionary;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (memberStart && t.kind === 'bare') {
      if (labels.has(t.value)) throw new Failure('duplicate_key');
      labels.add(t.value);
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
            (key.value === 'created' || key.value === 'expires') &&
            depth === 0 &&
            (!value || value.kind !== 'bare' || !/^-?\d+$/.test(value.value))
          ) {
            throw new Failure('invalid_timestamp_type');
          }
          i += 2;
        }
      } else if (t.value !== '=') parameters = new Set();
    } else {
      // Each bare/string/bytes item starts its own parameter scope, including inner-list tokens.
      parameters = new Set();
    }
  }
}
