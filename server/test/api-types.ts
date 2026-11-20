import { Resolver } from 'node:dns/promises';
// Public declarations must work with Node 22 types and no DOM lib or skipLibCheck.
import type { IncomingHttpHeaders } from 'node:http';
import {
  createVerifier,
  defaultRegistry,
  coveredHeaderNames,
  requiredHeaderNames,
} from '../dist/index.js';
const verifier = createVerifier({ registry: defaultRegistry, authorities: ['example.com'] });
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
