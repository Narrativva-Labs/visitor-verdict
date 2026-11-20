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
}
const fields: string[] = coveredHeaderNames('s=("@authority" "signature-agent")');
void fields;

const required: string[] = requiredHeaderNames();
void required;
