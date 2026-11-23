import { Resolver } from 'node:dns/promises';
// Public declarations must work with Node 22 types and no DOM lib or skipLibCheck.
import type { IncomingHttpHeaders } from 'node:http';
import {
  serverAgentTokens,
  createVerifier,
  defaultRegistry,
  coveredHeaderNames,
  requiredHeaderNames,
} from '../dist/index.js';
const verifier = createVerifier({
  registry: defaultRegistry,
  authorities: ['example.com'],
  onRefresh: (event) => {
    const hostname: string | undefined = event.hostname;
    void hostname;
  },
});
const nodeHeaders: IncomingHttpHeaders = { host: 'example.com' };
const supported = [nodeHeaders, new Headers(), new Map<string, string>(), ['host', 'example.com']];
for (const headers of supported) {
  void verifier.verify({ method: 'GET', host: 'example.com', headers });
  void verifier.verify({ method: 'GET', host: 'example.com', headers }, { cacheOnly: true });
}
const fields: string[] = coveredHeaderNames('s=("@authority" "signature-agent")');
void fields;

const required: string[] = requiredHeaderNames();
void required;

void createVerifier({
  registry: defaultRegistry,
  authorities: ['example.com'],
  reverseDns: { enabled: true, resolver: new Resolver() },
  maxLifetimeSeconds: 86400,
});

const warmed = createVerifier({
  registry: defaultRegistry,
  authorities: ['example.com'],
  staleMaxSeconds: 86400,
});
void warmed.warm({ ipLists: true, refreshAhead: true }).then((result) => {
  const urls: string[] = [...result.ok, ...result.failed];
  void urls;
  warmed.close();
});

const health = verifier.status();
const lastRefresh: boolean | null = health.lastRefreshOk;
void lastRefresh;

import { visitorLabels, type VisitorType, type BrowserAgent } from '../dist/index.js';
const label: VisitorType = visitorLabels({ browserClass: 'human', browserPhase: 'final' }).vv_type;
void label;
const marker: BrowserAgent = 'anthropic';
const marked: VisitorType = visitorLabels({
  browserClass: 'declared_agent',
  browserPhase: 'agent',
  browserAgent: marker,
}).vv_type;
void marked;

const tokens: string[] = serverAgentTokens(defaultRegistry);
void tokens;

import type { PurposePolicy } from '../dist/index.js';
const role: PurposePolicy = {
  sources: ['https://infra.example/docs'],
  checked: '2026-11-22',
  // @ts-expect-error Infrastructure is configured by Operator.intermediary, never a purpose mapping.
  signatureAgent: 'intermediary',
  // @ts-expect-error IP mappings cannot turn a product into signing infrastructure.
  ipLists: { feed: 'intermediary' },
  // @ts-expect-error UA mappings cannot identify signing infrastructure.
  uaTokens: { Bot: 'intermediary' },
};
void role;

const automationType: VisitorType = 'automation_verified';
visitorLabels({ browserAgentClaim: 'dom_host' });
createVerifier({
  registry: [],
  authorities: ['example.com'],
  poppy: {
    enabled: true,
    replayStore: {
      async insertIfAbsent() {
        return true;
      },
    },
  },
  fetcher: async () => new Response('{}'),
});
