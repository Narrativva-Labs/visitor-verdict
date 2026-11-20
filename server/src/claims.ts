import { agentTokens } from './tokens.generated.js';
import { agents } from './fields.js';
import { field } from './headers.js';
const tokenMatchers = agentTokens.map((token) => ({
  token,
  pattern: new RegExp(
    '(?:^|[^A-Za-z0-9_-])' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^A-Za-z0-9_-])',
    'i',
  ),
}));
export function parseClaims(headers: Map<string, string[]>) {
  const ua = field(headers, 'user-agent');
  return {
    uaTokens: tokenMatchers
      .filter((matcher) => matcher.pattern.test(ua))
      .map((matcher) => matcher.token),
    agent: agents(field(headers, 'signature-agent')),
  };
}
