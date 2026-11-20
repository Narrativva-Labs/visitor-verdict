import type { SailDocument } from './sail.js';
import { BlockList, isIP } from 'node:net';
import { Failure } from './errors.js';
import type { Registry, AgentVerdict } from './types.js';
import type { AgentCache } from './cache.js';

export function compilePrefixes(prefixes: unknown): BlockList {
  if (!Array.isArray(prefixes) || prefixes.length > 8192)
    throw new Failure('invalid_ip_list', true);
  const list = new BlockList();
  for (const p of prefixes) {
    if (!p || typeof p !== 'object') throw new Failure('invalid_ip_list', true);
    const value = p.ipv4Prefix ?? p.ipv6Prefix;
    if (typeof value !== 'string') throw new Failure('invalid_ip_list', true);
    const [address, bits, extra] = value.split('/');
    const family = isIP(address);
    const width = family === 4 ? 32 : 128;
    if (
      !family ||
      extra !== undefined ||
      (bits !== undefined && (!/^\d+$/.test(bits) || Number(bits) > width))
    )
      throw new Failure('invalid_ip_list', true);
    list.addSubnet(
      address,
      bits === undefined ? width : Number(bits),
      family === 4 ? 'ipv4' : 'ipv6',
    );
  }
  return list;
}
export function decodeList(data: unknown): BlockList {
  return compilePrefixes((data as { prefixes?: unknown })?.prefixes);
}
export function matchesIp(ip: string, prefixes: unknown): boolean {
  if (!isIP(ip)) return false;
  try {
    return compilePrefixes(prefixes).check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
  } catch {
    return false;
  }
}
export function decodeSail(data: unknown): Map<string, BlockList> {
  const doc = data as SailDocument;
  let count = 0;
  for (const prefixes of doc.services.values()) count += prefixes.length;
  if (count > 8192) throw new Failure('invalid_ip_list', true);
  return new Map([...doc.services].map(([name, prefixes]) => [name, compilePrefixes(prefixes)]));
}
export function staticBlocks(registry: Registry): Map<string, BlockList> {
  return new Map(
    registry
      .filter((operator) => operator.staticPrefixes?.length)
      .map((operator) => [
        operator.operator,
        compilePrefixes(operator.staticPrefixes!.map((value) => ({ ipv4Prefix: value }))),
      ]),
  );
}
export async function ipEvidence(
  ip: string | undefined,
  ua: string[],
  registry: Registry,
  cache: AgentCache,
  now: number,
  staticRanges?: Map<string, BlockList>,
): Promise<{ ip?: AgentVerdict['ip']; unavailable: boolean }> {
  if (typeof ip !== 'string' || !isIP(ip)) return { unavailable: false };
  for (const operator of registry) {
    if (!operator.extraUaTokens?.some((token) => ua.includes(token))) continue;
    if (staticRanges?.get(operator.operator)?.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6'))
      return { ip: { operator: operator.operator, list: 'published_static' }, unavailable: false };
  }
  const tasks: Promise<AgentVerdict['ip']>[] = [];
  for (const operator of registry)
    for (const list of operator.ipLists) {
      if (list.uaTokens && !list.uaTokens.some((token) => ua.includes(token))) continue;
      tasks.push(
        (list.format === 'sail'
          ? cache.load(list.url, 'sail', now, decodeSail).then((services) => {
              const block = services.get(list.service!);
              if (!block) throw new Failure('invalid_sail', true);
              return block;
            })
          : cache.load(list.url, 'ip', now, decodeList)
        ).then((block) => {
          if (block.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6'))
            return { operator: operator.operator, list: list.name };
        }),
      );
    }
  const results = await Promise.allSettled(tasks);
  for (const result of results)
    if (result.status === 'fulfilled' && result.value)
      return { ip: result.value, unavailable: false };
  return { unavailable: results.some((result) => result.status === 'rejected') };
}
