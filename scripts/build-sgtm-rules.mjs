/** Build with: npm --prefix server run build && node scripts/build-sgtm-rules.mjs.
 * --source-dir DIR reads public source documents from DIR/<operator>--<list>.txt.
 * --allow-partial is for offline development only; default fails on any missing feed.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { defaultRegistry } from '../server/dist/registry.js';
import { serverAgentTokens } from '../server/dist/server-tokens.js';
import { parseSail } from '../server/dist/sail.js';
const args = process.argv.slice(2);
const sourceDir = args.includes('--source-dir') ? args[args.indexOf('--source-dir') + 1] : undefined;
const partial = args.includes('--allow-partial');
const tokens = serverAgentTokens(defaultRegistry);
const tokenIds = values => values === undefined ? null : values.map(t => tokens.indexOf(t)).filter(i => i >= 0);
const groups = [], missing = [];
function ipv6(ip) {
  if (ip.includes('.')) { const i = ip.lastIndexOf(':'); const p = ip.slice(i + 1).split('.').map(Number); ip = ip.slice(0,i+1) + ((p[0]*256+p[1]).toString(16)) + ':' + ((p[2]*256+p[3]).toString(16)); }
  const halves = ip.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  return [...left,...Array(8-left.length-right.length).fill('0'),...right].map(x => x.padStart(4,'0')).join('');
}
function compile(prefixes) {
  const v4 = [], v6 = [];
  for (const item of prefixes) {
    const prefix = typeof item === 'string' ? item : item.ipv4Prefix ?? item.ipv6Prefix;
    if (typeof prefix !== 'string') throw Error('Invalid prefix');
    const [ip, rawBits, extra] = prefix.split('/'); const family = isIP(ip), bits = rawBits === undefined ? (family === 4 ? 32 : 128) : Number(rawBits);
    if (!family || extra !== undefined || (rawBits !== undefined && !/^\d+$/.test(rawBits)) || !Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)) throw Error('Invalid CIDR: '+prefix);
    if (family === 4) { const n = ip.split('.').reduce((a,b)=>a*256+Number(b),0), span = 2 ** (32-bits), start = Math.floor(n/span)*span; v4.push([start,start+span-1]); }
    else { const hex = ipv6(ip); const n = BigInt('0x'+hex); const shift = BigInt(128-bits); v6.push([(n >> shift << shift).toString(16).padStart(32,'0'),bits]); }
  }
  v4.sort((a,b)=>a[0]-b[0] || a[1]-b[1]); const merged = [];
  for (const row of v4) { const prev = merged.at(-1); if (prev && row[0] <= prev[1]+1) prev[1] = Math.max(prev[1],row[1]); else merged.push(row); }
  v6.sort((a,b)=>a[0].localeCompare(b[0]) || a[1]-b[1]);
  return {v4:merged,v6:v6.filter((x,i,a)=>!i || x[0]!==a[i-1][0] || x[1]!==a[i-1][1])};
}
// Static evidence precedes fetched evidence in the verifier.
for (const [operator, o] of defaultRegistry.entries()) if (o.staticPrefixes?.length) groups.push({operator,list:'published_static',tokens:tokenIds(o.extraUaTokens),...compile(o.staticPrefixes)});
for (const [operator, o] of defaultRegistry.entries()) for (const list of o.ipLists) {
  try {
    let body;
    if (sourceDir) body = await readFile(`${sourceDir}/${o.operator}--${list.name}.txt`,'utf8');
    else { const r = await fetch(list.url,{redirect:'error',signal:AbortSignal.timeout(15000)}); if (!r.ok) throw Error('HTTP '+r.status); body = await r.text(); }
    if (Buffer.byteLength(body)>2_000_000) throw Error('Source too large');
    const prefixes = list.format === 'sail' ? parseSail(body).services.get(list.service) : JSON.parse(body).prefixes;
    if (!Array.isArray(prefixes) || prefixes.length>8192) throw Error('Invalid prefixes');
    groups.push({operator,list:list.name,tokens:tokenIds(list.uaTokens),...compile(prefixes)});
  } catch(e) { missing.push({operator:o.operator,list:list.name,url:list.url}); console.error(`${o.operator}/${list.name}: ${e.message}`); }
}
if (missing.length && !partial) throw Error('Missing public feeds; existing output unchanged. Use --source-dir for archived sources.');
const rules = {schema:1,complete:!missing.length,operators:defaultRegistry.map(o=>({id:o.operator,purposes:o.purposes ?? {},signatureAgent:o.signatureAgent ?? ''})),tokens,groups,missing};
const body = JSON.stringify(rules)+'\n'; if (Buffer.byteLength(body)>200_000) throw Error('Rules exceed 200 KB');
const out = args.includes('--output') ? args[args.indexOf('--output')+1] : fileURLToPath(new URL('../dist/sgtm-rules.json',import.meta.url)); await mkdir(new URL('../dist/',import.meta.url),{recursive:true}); await writeFile(out,body); console.log(`${out}: ${Buffer.byteLength(body)} bytes; ${groups.length} groups; complete=${rules.complete}`);
