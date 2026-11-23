import { agents } from './fields.js';
import { field } from './headers.js';
import { serverAgentTokens } from './server-tokens.js';
import type { Registry } from './types.js';

export { serverAgentTokens };
/** Compile once for each constructed verifier, including explicit server-only registry claims. */
export function createClaimParser(registry: Registry) {
  const matchers = serverAgentTokens(registry).map((token) => ({
    token,
    pattern: new RegExp(
      '(?:^|[^A-Za-z0-9_-])' +
        token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '(?=$|[^A-Za-z0-9_-])',
      'i',
    ),
  }));
  return (headers: Map<string, string[]>) => {
    const ua = field(headers, 'user-agent');
    return {
      uaTokens: matchers.filter((m) => m.pattern.test(ua)).map((m) => m.token),
      agent: agents(field(headers, 'signature-agent')),
    };
  };
}
