import { agentTokens } from './tokens.generated.js';
import type { Registry } from './types.js';

/** Browser default UA tokens plus explicit server-only registry tokens, deduplicated. */
export function serverAgentTokens(registry: Registry): string[] {
  return [...new Set([...agentTokens, ...registry.flatMap((o) => o.extraUaTokens ?? [])])];
}
