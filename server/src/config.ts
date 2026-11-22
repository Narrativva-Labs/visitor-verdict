import { dnsConfig } from './rdns.js';
import { compilePrefixes } from './ip.js';
import { normalizeAuthority } from './fields.js';
import type {
  Registry,
  VerifierOptions,
  Operator,
  IpList,
  PurposePolicy,
  RegistryEvidence,
} from './types.js';

function registryEvidence(value: readonly RegistryEvidence[] | undefined) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 16) throw new TypeError('Invalid registry evidence');
  return value.map((entry: RegistryEvidence) => {
    if (
      !entry ||
      !['documented', 'observed', 'inferred'].includes(entry.level) ||
      typeof entry.checked !== 'string' ||
      entry.checked.length > 32 ||
      typeof entry.note !== 'string' ||
      entry.note.length > 2048 ||
      (entry.uaTokens !== undefined &&
        (!Array.isArray(entry.uaTokens) ||
          entry.uaTokens.length > 64 ||
          !entry.uaTokens.every(
            (token) => typeof token === 'string' && token.length > 0 && token.length <= 128,
          )))
    )
      throw new TypeError('Invalid registry evidence');
    httpsUrl(entry.source);
    return { ...entry, uaTokens: entry.uaTokens ? [...entry.uaTokens] : undefined };
  });
}

function purposePolicy(value: PurposePolicy | undefined): PurposePolicy | undefined {
  if (value === undefined) return;
  const valid = (purpose: unknown) =>
    ['user_directed', 'crawler', 'unknown'].includes(purpose as string);
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > 8 ||
    typeof value.checked !== 'string' ||
    (value.signatureAgent !== undefined && !valid(value.signatureAgent))
  )
    throw new TypeError('Invalid purpose policy');
  value.sources.forEach(httpsUrl);
  for (const map of [value.ipLists, value.uaTokens])
    if (
      map !== undefined &&
      (!map ||
        typeof map !== 'object' ||
        Array.isArray(map) ||
        Object.entries(map).length > 64 ||
        Object.entries(map).some(
          ([key, purpose]) => !key.length || key.length > 128 || !valid(purpose),
        ))
    )
      throw new TypeError('Invalid purpose mapping');
  return {
    ...value,
    sources: [...value.sources],
    ipLists: value.ipLists ? { ...value.ipLists } : undefined,
    uaTokens: value.uaTokens ? { ...value.uaTokens } : undefined,
  };
}

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
  let staticCount = 0;
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
    if (operator.staticPrefixes !== undefined) {
      if (!Array.isArray(operator.staticPrefixes) || !operator.extraUaTokens?.length)
        throw new TypeError('Invalid static ranges');
      staticCount += operator.staticPrefixes.length;
      if (
        staticCount > 8192 ||
        !operator.staticPrefixes.every((value) => typeof value === 'string' && value.length <= 64)
      )
        throw new TypeError('Too many static ranges');
      compilePrefixes(operator.staticPrefixes.map((value) => ({ ipv4Prefix: value })));
    }
    if (
      operator.reverseDns !== undefined &&
      (!Array.isArray(operator.reverseDns) || operator.reverseDns.length > 16)
    )
      throw new TypeError('Invalid reverse DNS rules');
    const reverseDns = operator.reverseDns?.map((rule) => {
      if (
        !rule ||
        !Array.isArray(rule.uaTokens) ||
        !rule.uaTokens.length ||
        rule.uaTokens.length > 64 ||
        !rule.uaTokens.every(
          (token: unknown) => typeof token === 'string' && token.length > 0 && token.length <= 128,
        ) ||
        !Array.isArray(rule.suffixes) ||
        !rule.suffixes.length ||
        rule.suffixes.length > 16 ||
        !rule.suffixes.every(
          (suffix: unknown) =>
            typeof suffix === 'string' &&
            suffix.length <= 253 &&
            suffix.includes('.') &&
            suffix === suffix.toLowerCase() &&
            suffix
              .split('.')
              .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
        ) ||
        typeof rule.source !== 'string' ||
        typeof rule.checked !== 'string' ||
        (rule.ipv4Only !== undefined && typeof rule.ipv4Only !== 'boolean')
      )
        throw new TypeError('Invalid reverse DNS rule');
      return { ...rule, uaTokens: [...rule.uaTokens], suffixes: [...rule.suffixes] };
    });
    if (operator.allowKidAlias !== undefined && typeof operator.allowKidAlias !== 'boolean')
      throw new TypeError('Invalid kid alias flag');
    if (
      operator.intermediary !== undefined &&
      (typeof operator.intermediary !== 'boolean' ||
        (operator.intermediary && operator.signatureAgent === undefined))
    )
      throw new TypeError('Invalid intermediary flag');
    if (operator.intermediary && operator.purposes?.signatureAgent !== undefined)
      throw new TypeError('Intermediary cannot declare a signature purpose mapping');
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
      evidence: registryEvidence(operator.evidence),
      purposes: purposePolicy(operator.purposes),
      ipLists,
      reverseDns,
      staticPrefixes: operator.staticPrefixes ? [...operator.staticPrefixes] : undefined,
      extraUaTokens: operator.extraUaTokens ? [...operator.extraUaTokens] : undefined,
    };
  });
  if (urls.size > 128) throw new TypeError('Too many registry endpoints');
  if (options.fetcher !== undefined && typeof options.fetcher !== 'function')
    throw new TypeError('Invalid fetcher');
  if (options.now !== undefined && typeof options.now !== 'function')
    throw new TypeError('Invalid clock');
  if (options.onRefresh !== undefined && typeof options.onRefresh !== 'function')
    throw new TypeError('Invalid refresh callback');
  if (options.nonceStore !== undefined && typeof options.nonceStore?.insertIfAbsent !== 'function')
    throw new TypeError('Invalid nonceStore');
  const maxLifetimeSeconds = options.maxLifetimeSeconds ?? 86400;
  if (!Number.isSafeInteger(maxLifetimeSeconds) || maxLifetimeSeconds < 1)
    throw new TypeError('Invalid maxLifetimeSeconds');
  const staleMaxSeconds = options.staleMaxSeconds ?? 86400;
  if (!Number.isSafeInteger(staleMaxSeconds) || staleMaxSeconds < 0 || staleMaxSeconds > 86400)
    throw new TypeError('Invalid staleMaxSeconds');
  return {
    maxLifetimeSeconds,
    staleMaxSeconds,
    registry,
    authorities,
    reverseDns: dnsConfig(options.reverseDns),
    fetcher: options.fetcher ?? fetch,
    now: options.now ?? (() => Date.now() / 1000),
    onRefresh: options.onRefresh,
    nonceStore: options.nonceStore,
    deadlineMs: positive(options.deadlineMs ?? 1500, 'deadlineMs'),
    fetchTimeoutMs: positive(options.fetchTimeoutMs ?? 1000, 'fetchTimeoutMs'),
  };
}
