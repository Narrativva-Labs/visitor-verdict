import { normalizeAuthority } from './fields.js';
import type { Registry, VerifierOptions, Operator, IpList } from './types.js';

function httpsUrl(value: unknown): void {
  if (typeof value !== 'string' || value.length > 2048) throw new TypeError('Invalid registry URL');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    throw new TypeError('Invalid registry URL');
}
function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 60000)
    throw new TypeError('Invalid ' + name);
  return value;
}
export function validateConfig(options: VerifierOptions) {
  if (
    !options ||
    !Array.isArray(options.authorities) ||
    !options.authorities.length ||
    options.authorities.length > 128
  )
    throw new TypeError('authorities must be a nonempty array');
  const authorities = new Set<string>();
  for (const value of options.authorities) {
    const normalized = normalizeAuthority(value);
    if (!normalized || authorities.has(normalized))
      throw new TypeError('Invalid or duplicate authority');
    authorities.add(normalized);
  }
  if (!Array.isArray(options.registry) || options.registry.length > 128)
    throw new TypeError('Invalid registry');
  const identities = new Set<string>();
  const urls = new Set<string>();
  const registry: Registry = options.registry.map((operator: Operator) => {
    if (
      !operator ||
      typeof operator.operator !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(operator.operator) ||
      !Array.isArray(operator.ipLists) ||
      typeof operator.verifiedByCapture !== 'boolean' ||
      typeof operator.source !== 'string' ||
      typeof operator.checked !== 'string'
    )
      throw new TypeError('Invalid operator');
    if (
      operator.extraUaTokens !== undefined &&
      (!Array.isArray(operator.extraUaTokens) ||
        operator.extraUaTokens.length > 64 ||
        !operator.extraUaTokens.every(
          (t) => typeof t === 'string' && t.length > 0 && t.length <= 128,
        ))
    )
      throw new TypeError('Invalid extra UA tokens');
    if (operator.signatureAgent !== undefined || operator.directoryUrl !== undefined) {
      httpsUrl(operator.signatureAgent);
      httpsUrl(operator.directoryUrl);
      if (identities.has(operator.signatureAgent!)) throw new TypeError('Duplicate identity');
      identities.add(operator.signatureAgent!);
      urls.add(operator.directoryUrl!);
    }
    const ipLists = operator.ipLists.map((list: IpList) => {
      if (
        !list ||
        typeof list.name !== 'string' ||
        !list.name.length ||
        (list.uaTokens !== undefined &&
          (!Array.isArray(list.uaTokens) ||
            !list.uaTokens.every((t: unknown) => typeof t === 'string')))
      )
        throw new TypeError('Invalid IP list');
      if (list.format !== undefined && list.format !== 'json' && list.format !== 'sail')
        throw new TypeError('Invalid feed format');
      if (
        list.format === 'sail' &&
        (typeof list.service !== 'string' || !list.service.length || list.service.length > 128)
      )
        throw new TypeError('Invalid SAIL service');
      httpsUrl(list.url);
      urls.add(list.url);
      return { ...list, uaTokens: list.uaTokens ? [...list.uaTokens] : undefined };
    });
    return {
      ...operator,
      ipLists,
      extraUaTokens: operator.extraUaTokens ? [...operator.extraUaTokens] : undefined,
    };
  });
  if (urls.size > 128) throw new TypeError('Too many registry endpoints');
  if (options.fetcher !== undefined && typeof options.fetcher !== 'function')
    throw new TypeError('Invalid fetcher');
  if (options.now !== undefined && typeof options.now !== 'function')
    throw new TypeError('Invalid clock');
  if (options.nonceStore !== undefined && typeof options.nonceStore?.insertIfAbsent !== 'function')
    throw new TypeError('Invalid nonceStore');
  return {
    registry,
    authorities,
    fetcher: options.fetcher ?? fetch,
    now: options.now ?? (() => Date.now() / 1000),
    nonceStore: options.nonceStore,
    deadlineMs: positive(options.deadlineMs ?? 1500, 'deadlineMs'),
    fetchTimeoutMs: positive(options.fetchTimeoutMs ?? 1000, 'fetchTimeoutMs'),
  };
}
