# Visitor Verdict server verifier

An internal TypeScript package in the public MIT Visitor Verdict repository. Node 22+, ESM. Its purpose is analytics and conversion hygiene. It labels traffic using operator evidence, never humanity, consent, purchase approval or application authorization. The library does not itself withhold anything; conversion policy belongs to the integrator.

## Build and validate

```sh
cd server
npm ci
npm test
npm run typecheck
npm run format:check
npm run tokens # regenerate only when browser defaults change
```

The package is marked `private: true` to prevent accidental npm publication. `files` includes the built `dist`, documentation and licence; `prepare` builds it when packaging. npm cannot install a git dependency directly from this repository’s server/ subfolder. From a checkout, run `npm pack` inside server/, then install the resulting tarball in the consuming application (`npm install /path/to/visitor-verdict-server-0.3.1.tgz`). Do not point npm at the repository root and expect it to select this package. pnpm/yarn subdirectory syntax is a separate package-manager capability; check its version-specific documentation. `server/dist` and node_modules are ignored. CI runs server tests, typechecking and formatting on Node 22 and 24, independently of browser checks.

Dependencies are pinned: runtime **structured-headers 2.1.1 (MIT)** for SF parsing/serialization; dev TypeScript 5.6.3, Node declarations 22.20.1 and Prettier 3.3.3. Crypto uses only `node:crypto`; CIDR matching uses `node:net.BlockList`. A linear lexical guard checks duplicates, base64 alphabet (accepting omitted padding and nonzero pad bits per RFC 8941 §4.2.7), and integer timestamp types before the SF parser can lose that information. UA token regexes are compiled once per verifier from generated browser defaults plus registry `extraUaTokens`. The drift test keeps the generated browser list unchanged and checks it remains a subset; bingbot is explicitly server-only. No DOM lib is required. The test suite also compiles a public API consumer against Node 22 declarations without DOM or skipLibCheck.

## API

```ts
import { createVerifier, defaultRegistry, visitorLabels } from './dist/index.js';

// Construct once at application startup; invalid configuration throws.
const verifier = createVerifier({
  registry: defaultRegistry,
  authorities: ['analytics.example.com'],
  deadlineMs: 1500,
  fetchTimeoutMs: 1000,
});

const verdict = await verifier.verify({
  method: req.method,
  host: 'analytics.example.com', // fixed configured external host for this collector route
  headers: req.rawHeaders,
  clientIp: trustedTransportIp,
  target: req.url, // preserve raw escapes, dot segments and query
});
const fields = visitorLabels({ verdict, browserClass: 'human', browserPhase: 'final' });
```

`createVerifier` snapshots the registry and owns its cache. `maxLifetimeSeconds` defaults to 86400; reverseDns is optional and disabled by default (details below). Reuse the verifier across requests. There is no global cache keyed by incidental object/function identity, no `mode` option, and no legacy `verifyAgentRequest` API.

| Construction option | Contract                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry`          | Trusted operator entries with exact identity and directory/feed URLs, source and date. Up to 128 operators and 128 distinct endpoints. Never accept this from requests. |
| `authorities`       | Nonempty list of up to 128 allowed external authorities. Case and default HTTPS port are normalized at construction.                                                              |
| `fetcher`           | Optional `(url, RequestInit) => Promise<Response>`. Defaults to fetch. Preserve HTTPS/TLS validation and manual redirects.                                              |
| `deadlineMs`        | Best-effort overall deadline over bounded synchronous work, default 1500 ms. Expiry returns none/deadline_exceeded.                                                     |
| `maxLifetimeSeconds` | Positive safe integer, default 86400 s; maximum expires-created lifetime. |
| `reverseDns` | Optional FCrDNS configuration, disabled by default; see the DNS section below. |
| `onRefresh` | Optional public-document refresh callback; exceptions are ignored. |
| `fetchTimeoutMs`    | Per-fetch and nonce-store timeout, default 1000 ms. Positive integer, at most 60 seconds, as for deadlineMs.                                                            |
| `staleMaxSeconds`   | Positive values cap total document age, fresh or stale, default 86400 s (0–86400). 0 disables stale serving and retains the ordinary HTTP-derived fresh TTL.            |
| `nonceStore`        | Optional atomic `insertIfAbsent(key, ttlSeconds): Promise<boolean>`. Default absent: no nonce retention.                                                                |
| `now`               | Function returning Unix **seconds**, default Date.now()/1000. Values above 1e11/nonfinite return none/invalid_clock; clock exceptions return none/internal_error.       |

`verify` accepts Node IncomingHttpHeaders, WHATWG Headers, Map, or a Node rawHeaders array of alternating names/values. Unsupported containers reject with TypeError (programmer error). Malformed contents return a verdict. Arrays of pairs are not rawHeaders. Prefer rawHeaders where original field occurrences matter; WHATWG Headers may already have combined occurrences before the library sees them.

The explicit request `host` is trimmed only by SP/HTAB, lowercased, and stripped of default :443. It must match a configured authority; otherwise the result is **none/unknown_authority**, including unsigned visits. The signature base uses that configured authority. Raw Host/:authority field values are not compared or tried as alternative authorities. `target` is optional unless signed components require it. Only its type and size are checked eagerly. Syntax is validated lazily when a signature covers @path or @target-uri; an uncovered query ending in a lone % and OPTIONS \* do not change verification. Covered target context must be raw origin-form (including //path) or absolute HTTPS form with the same authority; unusable covered context returns none/insufficient_context. Absolute HTTPS scheme/authority and empty path are normalized consistently, while raw path/query octets are preserved. Paths/target URIs preserve raw percent encoding and dot segments instead of applying WHATWG URL normalization.

A single-host collector should use its fixed configured external host, as above, after routing to that collector. Multi-host adapters must map a trusted route to the correct configured host rather than trying candidates until a signature verifies. Fastify req.host reads X-Forwarded-Host when trustProxy is enabled; do not pass it unchecked. Keep a local aggregate reason counter or health check (without request data) so a spike of unknown_authority, invalid_clock or feed errors exposes integration problems.

Transport adapters must supply the external host and genuine client IP from a trusted boundary. The library never derives either from X-Forwarded-Host/X-Forwarded-For. For nginx use `proxy_set_header Host $host;` (and account for nondefault ports in your adapter). Caddy normally keeps Host; verify your deployed upstream configuration rather than assuming it. Sanitize forwarding headers and authenticate any original-request envelope passed to an sGTM/verifier service. The service's own HTTP request is not the signed browser request.

`coveredHeaderNames(signatureInput)` returns the ordinary covered field names, excluding derived components; malformed/duplicate/oversize inputs throw only public TypeError, never an internal Failure class. `requiredHeaderNames(signatureInput?)` never throws and returns user-agent, signature, signature-input, signature-agent plus covered ordinary field names; malformed or absent input yields the four base names. It helps adapters collect required fields without silently discarding coverage. It does not itself verify a signature or declare supported component parameters.

## Purpose and health

`verdict.agent_purpose` and the purpose segment in `visitorLabels({ verdict }).vv_detail` are
`user_directed`, `crawler` or `unknown`. Only signature_valid/ip_match can carry a
known purpose. This describes the documented product role, not whether this request
has a real customer behind it. A signed identity wins over unsigned UA claims;
a specific feed wins over token rules; conflicting shared-feed tokens yield unknown.
Unknown operators/roles and every unverified result stay unknown.

Registry `purposes` contains signature identity, IP-list-name and UA-token mappings,
primary-source URLs and a checked date. See [registry-purposes.ts](src/registry-purposes.ts):
[OpenAI](https://developers.openai.com/api/docs/bots),
[Google](https://developers.google.com/crawling/docs/crawlers-fetchers/overview-google-crawlers),
[Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler),
[Perplexity](https://docs.perplexity.ai/docs/resources/perplexity-crawlers),
[Mistral](https://docs.mistral.ai/robots) and
[Kimi](https://www.kimi.ai/policies/kimi-crawlers) distinguish user fetches from crawlers.
The other crawler mappings cite their operator's bot documentation in that file.
Verified [Browserbase](https://docs.browserbase.com/welcome/introduction) and
[Manus](https://manus.im/docs/features/cloud-browser) signature identities map to
`user_directed` as cloud browsers for AI agents (owner policy based on their documented
products). DuckDuckGo's signature identity maps to `crawler`, consistent with its
[DuckAssistBot policy](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot)
and verified feed matches. Unlisted purposes remain `unknown`. Purpose does not
expand verification capability: Google's currently unassigned user-triggered-fetchers
feed still has no eligible tokens in the default registry.

`verifier.status()` returns `{ directories: { loaded, total }, ipLists: { loaded, total },
lastRefreshOk, lastRefreshAt }`. Counts use distinct endpoints (SAIL counts as one feed);
loaded means a parsed cached document still within its hard age limit, including usable
stale data. It does not guarantee an active signing key or verify a visitor. The last
refresh outcome covers any directory/feed; time is Unix seconds, null before completion.
The method never fetches and contains no request data. Optional `onRefresh(event)` receives
`{ kind: 'directory' | 'ip' | 'sail', ok, at, hostname?, reason? }` after each completed refresh,
including background work. `hostname` is the public endpoint hostname, never a URL. Failure reasons are short codes, never transport messages.
Callback exceptions are ignored. The library itself never logs; the integrator can use
this callback for rate-limited operational warnings.

`serverAgentTokens(defaultRegistry)` returns the deduplicated browser and server-only UA tokens used for claims.

## Cache-only verification for collectors

`await verifier.verify(input, { cacheOnly: true })` decides from already trusted cached
material and static ranges. It never waits for a directory/feed fetch, including an existing
warm-up or forced-refresh flight. Missing or hard-expired material returns `none/cache_miss`
immediately and starts one background refresh, subject to the existing flight and cooldown
limits. Soft-expired material remains usable only within its hard age limit while refresh runs.
Unknown keyids can start a controlled background forced refresh; no signature is accepted
without a currently trusted matching key. A cached matching IP feed can still supply evidence
when a different feed is missing. Valid/invalid WBA signature precedence is unchanged.

Warm once at startup (`void verifier.warm({ refreshAhead: true })`) and reuse the verifier.
Collectors may omit agent labels on cache_miss and send the hit immediately; that hit is not
relabeled later. Fetch latency affects evidence availability for future hits, not delivery of
the current hit. Parsing and crypto still perform bounded synchronous work, so this is a
network-independent path rather than a hard real-time guarantee. DNS is skipped in this mode.
A configured external NonceStore is never called: a signature that needs replay-store validation
returns `none/insufficient_context` rather than weakening replay policy.

## Warm-up, stale-while-revalidate and shutdown

```ts
const verifier = createVerifier({
  registry: defaultRegistry,
  authorities: ['analytics.example.com'],
});
void verifier.warm({ refreshAhead: true }); // never rejects; does not block startup
// ...on shutdown
verifier.close();
```

After a document's soft TTL (`max-age` minus `Age`, 300 seconds for no-store, bounded to 300 s–24 h) the verifier keeps serving the last validly fetched directory, IP list or SAIL document while exactly one background refresh runs, up to `staleMaxSeconds` after that document was fetched (default 24 hours). Requests therefore do not wait for a slow operator endpoint: a directory that takes about a second to fetch no longer causes the requests made during each refresh to miss their deadline. A positive staleMaxSeconds also shortens the fresh TTL when it is smaller than the HTTP/SAIL TTL: max-age=3600 with staleMaxSeconds=600 cannot be used at age 600 or later without a successful new fetch. Zero disables stale serving without shortening the ordinary fresh TTL. JWK nbf/exp are still checked on every use, also for stale data. A newer successful fetch replaces the document entirely, so keys removed there stop verifying immediately. A failed refresh keeps the stale document, with the usual 60-second cooldown between attempts, until the hard maximum age; after that the result is indeterminate (none) until a fetch succeeds. Unknown-keyid forced refreshes keep their separate single flight and cooldown.

`verifier.warm(options?)` prefetches every key directory in the registry and, with `{ ipLists: true }`, every JSON IP list and SAIL feed. It resolves to `{ ok: string[]; failed: string[] }` (endpoint URLs), never rejects, and shares flights with request-driven loads, so it is safe to call repeatedly; fresh entries are not fetched again. Call it once at startup, fire-and-forget, so the first verified request does not pay the fetch latency.

`{ refreshAhead: true }` additionally schedules a refresh of each warmed entry shortly before its effective soft expiry, capped by a positive staleMaxSeconds (a tenth of that effective TTL, between 1 and 60 seconds early), so entries stay fresh without waiting for a request. Cost: one fetch per warmed endpoint per soft TTL, which for no-store directories is one fetch every 270 seconds per directory (about 320 a day); a failing endpoint is retried after each 60-second cooldown. Timers are unref'd and never keep the process alive. `verifier.close()` cancels them; `verify()` and `warm()` keep working afterwards without timers. Fetches already in flight end on their own `fetchTimeoutMs`.

## Server-side GTM

Use the canonical [Server-side GTM reference design](../docs/conversion-guidance.md#server-side-gtm-reference-design).
It places this Node library in a verifying proxy before sGTM; the library does not run
inside the template sandbox. The reference specifies raw-header preservation, trusted
X-VV-\* headers, Request Header variables, tag routing and transformations. It is not a
shipped template or implemented conversion-routing feature. Authenticate the proxy-to-sGTM
boundary and do not log the request envelope.

IP evidence is only as trustworthy as the original source address. getRemoteAddress is best-effort and can use Forwarded/X-Forwarded-For; it is not proof of a peer IP. Sanitize forwarding metadata at a trusted proxy, or omit clientIp when that chain cannot be trusted. Propagate a service deadline/error as none, never as human. Monitor only aggregate reason counts locally. The library labels traffic and does not itself withhold anything; the integrator owns conversion policy.

## Verdicts and analytics

The verdict contains claimed known UA tokens and parsed Signature-Agent strings; both remain untrusted claims. A successful `verified` field identifies an operator and method; signature evidence includes keyid, identity and `keyidForm` (`thumbprint` or `kid`). Successful dictionary signatures also report `attribution: 'label' | 'relabeled'` in `verified` and the per-label result; legacy bare-string identities omit it. `signatures` retains per-label results, including peers that fail. Whole-header syntax/resource errors fail before label evaluation. Signature and Signature-Input duplicates stay strict; duplicate dictionary keys in Signature-Agent return none/ambiguous_signature_agent instead of asserting a bad signature. Optional `ip` contains operator/list evidence only, never the client IP.

| verification        | Meaning / reasons                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signature_valid`   | A trusted signature passes policy and crypto: verified.                                                                                                                                                                                                                                                          |
| `signature_invalid` | A WBA signature was presented and demonstrably failed: crypto_mismatch, expired, invalid_timestamp_type, missing_keyid, signature_agent_not_covered, etc. Never returned merely for an unsigned visitor.                                                                                                         |
| `none`              | Indeterminate/untrusted/context failure: untrusted_signature_agent, unknown_keyid, unsupported_component, insufficient_context, unknown_authority, invalid_clock, internal_error, directory_timeout, deadline_exceeded, ip_evidence_unavailable, cache_miss, reverse_dns_unavailable, ambiguous_signature_agent. |
| `no_signature`      | No WBA signature and no official IP match: signature_headers_absent, ignored_non_wba or reverse_dns_not_confirmed. A relevant failed feed with no match instead returns none/ip_evidence_unavailable. UA alone never verifies.                                                                                   |
| `ip_match`          | No WBA signature presented and a relevant operator-published range matches: official_ip_range_match, or optional FCrDNS: reverse_dns_match.                                                                                                                                                                      |

Other/absent signature tags are reported per-label as none/ignored_non_wba and do not suppress IP matching or override an indeterminate WBA peer. A malformed SF header can still fail before tag selection.

Selection is pure and tested: valid signature wins; otherwise definitive invalid wins over indeterminate. An invalid presented signature never becomes ip_match, though independent IP evidence is attached after evaluable signature failures. Early malformed/resource/context failures avoid further fetches. Unknown WBA Signature-Agent identities trigger no network I/O. Identity claims attached only to ignored non-WBA signatures do not restrict independent IP checks. Unsupported dictionary members are untrusted for their label without poisoning valid peers.

Version 0.3.0 replaces the public `toAnalyticsFields` API with pure `visitorLabels({ verdict?, browserClass?, browserPhase? })`. It returns exactly two GA4 event parameters; register both as **event-scoped custom dimensions** (`customEvent:vv_type` and `customEvent:vv_detail` in the Data API).

| `vv_type`          | First matching evidence                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `bot_spoofed`      | Server `signature_invalid`                                                |
| `agent_verified`   | Server `signature_valid`/`ip_match`, purpose `user_directed` or `unknown` |
| `crawler_verified` | Server `signature_valid`/`ip_match`, purpose `crawler`                    |
| `bot_automation`   | Browser `automated`                                                       |
| `agent_unverified` | Browser `declared_agent` or unverified UA/Signature-Agent claim           |
| `bot_suspicious`   | Browser `suspicious`                                                      |
| `human`            | Browser `human`                                                           |
| `pending`          | No browser class or qualifying server evidence                            |

Every verified result (`signature_valid` or `ip_match`) with unknown purpose yields `agent_verified`, never `pending`, even if browser evidence exists. The purpose segment remains `unknown`: `agent_verified` confirms identity and does not by itself establish a user-directed product role. Only an explicit crawler purpose yields `crawler_verified`.

`vv_detail` is `operator|verification|purpose|claim|browser_class|browser_phase`, e.g. `openai|signature_valid|user_directed|signature_agent|human|final`. Missing segments are `-`, unknown operator is `none`. With a verdict, claim is `signature_agent` (takes precedence), `ua_token` or `none`; unverified purpose is `unknown`. Browser classes are `human`, `suspicious`, `automated`, `declared_agent`; phases initial/final. Invalid browser values become `-`. Operators must begin with a lowercase ASCII letter, followed by at most 23 lowercase ASCII letters, digits or underscores; invalid/long configured names become `none`, never truncated. Detail is at most 100 characters, with no version segment or raw claims.

The helper is stateless. Collectors can retain the strongest type per session without delaying hits: ranks are pending=0, human=1, bot_suspicious=2, agent_unverified=3, bot_automation=4, crawler_verified=agent_verified=5, bot_spoofed=6. Equal ranks keep the earlier type. Detail describes the current hit, optionally using a previously verified operator. Scope full events to client_id + session_id and denied pings to page_id, with a bounded memory-only LRU/TTL and no stored IPs.

Filter `vv_type` beginning with `agent_` or `bot_`, or `vv_detail` beginning with `openai|`. In Looker Studio derive operator with `REGEXP_EXTRACT(vv_detail, '^([^|]+)')`. Browser/GTM-only sites keep `traffic_class` for now.

Do not forward the entire diagnostic verdict or raw requests to GA4/sGTM. Do not use these signals for pre-consent advertising.

## Signature profile and key rules

Request-only Ed25519, optional signature alg="ed25519". Required tag="web-bot-auth", keyid, SF **Integer** created/expires, bare @authority or @target-uri, and coverage of present Signature-Agent. Created may be 30 seconds in the future; expires may be 30 seconds behind now; the default maximum lifetime is 86400 seconds. `maxLifetimeSeconds` configures a positive integer lifetime limit; exceeding it returns none/invalid_validity_window (local policy, not proof of an invalid signature). Inverted windows remain invalid. Integer-valued Decimals such as created=1800000000.0 are rejected per WBA label using lexical type metadata. These timestamp rules apply only to Signature-Input metadata; an extension named created/expires in Signature-Agent cannot poison peers.

Both legacy quoted-string (OpenAI) and dictionary forms are supported. Dictionary coverage uses `"signature-agent";key="g"`. Draft-01 §5.2.1/§5.2.2 require signers to cover the member keyed to their signature label; verifiers attribute only to covered members. Intermediaries may relabel Signature and Signature-Input without changing the covered member key (§6.6.1; RFC 9421 §7.2.5). The verifier prefers a covered member matching the current label; otherwise a sole covered keyed member is accepted with `attribution: 'relabeled'`. Several covered keyed members without a current-label match return none/ambiguous_signature_agent, even if they name the same identity. An uncovered member never supplies attribution. A signature may cover several keyed members. Cloudflare web-bot-auth 0.2.0 README examples with ;type=directory members are ignored here (none), as required by draft-01. Protocol-01 §5.2.1 forbids member parameters. All parameterized members are therefore ignored for identity, including both `type=directory` (SF Token) and `type="directory"` (SF String); neither is normative in that revision. Legacy quoted-string compatibility remains explicit. Each field line is trimmed by SP/HTAB before comma-space joining. Other control characters are rejected; raw field strings are interpreted as Latin-1 octets (0–255); Unicode above 255 is rejected. Unwrapped non-ASCII covered fields return none/non_ascii_component, per RFC 9421 §2.5. Binary wrapping via `;bs` base64-encodes each trimmed field occurrence using Latin-1 bytes, never UTF-8, before combining. The final ASCII base is encoded explicitly as ASCII.

A covered ordinary header absent from the request headers returns
`none/unsupported_component`, rather than `required_component_missing`.

Components supported: @authority, @method, @target-uri, @path, @query (raw query prefixed by ?, or ? when absent), @scheme (https for the configured HTTPS authorities); bare/member Signature-Agent; ordinary lowercase RFC 9110 tchar header names (including dots, underscores and leading digits), bare or with `;bs`. Unsupported covered components are never omitted. Covered content-digest returns none/insufficient_context: body integrity is outside this API.

Directories may contain up to 32 keys. Structural problems, ambiguous aliases, or **any private d** reject the directory. Unsupported/invalid public keys are skipped independently. Supported keys: OKP/Ed25519, canonical 32-byte x, alg absent/EdDSA/Ed25519, use absent/sig, key_ops absent or containing verify. Each key is indexed by its RFC 7638/RFC 8037 thumbprint. A registry `allowKidAlias: true` explicitly enables custom kid compatibility; only Google has that flag in the default registry. Cache entries retain keys by thumbprint, and alias selection is operator-scoped. Google uses short custom kids; the live Google fixture is tested. JWK nbf/exp are checked on every use, even on cache hits. An expired/inactive key never establishes validity.

Default analytics verification stores no nonce. Optional NonceStore receives a JSON tuple of identity, thumbprint and nonce only after crypto success, TTL through expires + 30 seconds. It is caller-owned storage and an explicit change to default privacy/replay behavior. Use atomic shared storage across instances and do not log keys. Calls are time-boxed; the interface cannot forcibly cancel external store work already started. Missing nonce/replay fail; store exceptions are indeterminate. No signature proves integrity of components it does not cover.

## Network, retention and resource limits

Only exact HTTPS registry endpoints are fetched, without credentials, fragments, alternate ports or redirects. Require status 200 and unchanged response URL. Streaming and declared-size limits apply; every rejection aborts/cancels the response, including responses arriving after timeout. All fetchers are injectable; tests never hit the network. Directory proofs are outside request verification; trust rests on the exact configured URL over HTTPS.

Verification retention is deliberately separate from HTTP caching: successfully parsed operator directories/IP lists are given a nominal fresh TTL of **300 seconds to 24 hours**, even for no-store/no-cache/max-age=0. A positive staleMaxSeconds additionally caps both fresh and stale document age, including every cooldown/cache reuse path; a configured cap below 300 seconds shortens the nominal minimum. Cache-Control max-age minus Age supplies the intermediate TTL. This is public operator data, not retained request data. Ordinary and forced refreshes have separate flights per URL/document kind. Fresh data is returned before joining a forced refresh, so an unknown-key request cannot stall other valid cached signatures. A 60-second cooldown applies only after failures or forced unknown-key refreshes; successful ordinary refreshes do not cause outages. Unknown keyids permit one controlled refresh per cooldown. After the soft TTL, stale data is served while one background refresh runs, never beyond `staleMaxSeconds` since its fetch (default and maximum 24 hours); a failed refresh never extends that hard maximum. See [Warm-up, stale-while-revalidate and shutdown](#warm-up-stale-while-revalidate-and-shutdown). The feed cache is LRU-bounded to **32 completed/in-flight feed entries** (JSON and SAIL combined); entries with active refreshes are not evicted, and saturation is indeterminate. Directories have a separate 128-entry bound. Retained feed capacity is at most **262144 compiled prefixes**, plus 8192 static ranges; directory capacity is 4096 keys. Aggregate admitted response bodies are capped at 32 MiB of feeds plus 8 MiB of directories at a time; concatenation, JSON parsing and decoding create additional temporary copies. Native BlockList/V8 overhead and transient representation size are implementation-dependent, so these are entry/prefix/wire bounds, not an exact RSS promise. IP feeds compile BlockList once per successful fetch; relevant feeds are fetched in parallel with allSettled. Registry order selects evidence deterministically. SAIL uses expires_after instead of HTTP max-age, with the same retention bounds. The deadline timer starts before verification work; deadlines are best effort because one event loop cannot interrupt bounded synchronous parsing/crypto. Hard interruption would require a separate execution context.

Limits: total headers 64 KiB / 256 field occurrences, user-agent 1 KiB, signature-related headers 16 KiB, four paired labels, 32 components/signature; directories 64 KiB / 32 keys; JSON IP feeds **1 MiB / 8192 prefixes**; SAIL **64 KiB**, up to 32 prefix sets/services and 8192 compiled prefixes total across services per feed. Context caps before scanning/copying: method 32 characters, host 2048, target 65536, clientIp 64. Limits are counted on the first aggregation pass, using push rather than repeated copies. The linear lexer handles commas/semicolons in strings, colons in SF Tokens and literal backslashes in Display Strings. A small parser compatibility path restores SF Date values after parsing without consuming following member delimiters. With default settings no raw request header/IP/signature/nonce is logged or retained in cache. Optional rDNS deliberately retains bounded IP-keyed verification results in memory; see its privacy note below. IP matching supports v4, v6 and mapped v4.

Shared cache refreshes have their own bounded lifetime: one caller's deadline does not cancel a fetch needed by other callers. A timed-out request cannot proceed to nonce insertion after its shared fetch finishes. HTTPS allowlisting does not prevent compromised domains/DNS; deploy outbound network controls and application rate limits. Node fetch does not pin DNS resolution.

## Optional forward-confirmed reverse DNS

`reverseDns: { enabled: true, resolver?, timeoutMs?, cacheSize?, ttlSec? }` explicitly opts in. The default is OFF and creates no DNS queries or IP cache. With no matching IP range and no already-valid signature, the verifier considers only claimed tokens whose registry entry has a primary-source-confirmed suffix rule. It queries PTR, checks a valid hostname against an allowed suffix on a label boundary, then queries A for IPv4 or AAAA for IPv6 and requires the original normalized IP among those addresses. PTR alone never verifies. evilbaidu.com and baidu.com.evil.net cannot match baidu.com. Suffix mismatches return immediately without forward queries. Cache results are scoped to the eligible operator rules so a different UA claim cannot reuse a proof for another operator.

Production transport uses node:dns/promises Resolver; tests inject an object with `reverse(ip)`, `resolve4(host)`, `resolve6(host)`, and optional `cancel()`, each returning string arrays. Defaults: 500 ms lookup timeout, 1024 LRU IP entries, 300 second positive/negative TTL. Limits: cacheSize 1–4096, ttlSec 1–3600, timeoutMs 1–60000, **four concurrent lookup transactions**, at most eight PTR names and 32 addresses per answer. Each transaction queries the matching address family sequentially across eligible PTR names. Saturation returns indeterminate without an unbounded queue. A timed-out injected resolver that ignores cancellation retains its concurrency slot until actual work settles; it cannot spawn unlimited background work. The overall deadline still applies, and aborted requests do not start further forward queries. Cached entries expire on access and are evicted by LRU. Common Crawl DNS is v4-only per its documentation; v6 uses its feed.

A successful result uses `verification: 'ip_match'`, `reason: 'reverse_dns_match'`, `verified.method: 'rdns'`, plus optional `rdns: { operator }`. No IP or PTR is returned. Operational resolver errors/timeouts return none/reverse_dns_unavailable if no other evidence decides the request. A PTR suffix mismatch, forward NODATA/NXDOMAIN or forward answer without the original IP is definitive unconfirmed evidence: no_signature/reverse_dns_not_confirmed. Both outcomes are cached. Valid/invalid WBA precedence is unchanged, so DNS cannot rescue an invalid signature. An IP-feed failure without another match remains none/ip_evidence_unavailable.

Baidu's published forward-confirmation method cannot confirm at least some crawler IPs: the owner's 2026-11-20 live check found a PTR for 180.76.15.5 (baiduspider-180-76-15-5.crawl.baidu.com) without a forward A record. Such traffic remains unverified unless FCrDNS succeeds; a Baidu-looking PTR alone is insufficient.

Missing PTR records (PTR ENOTFOUND/ENODATA) currently follow the resolver-error
path: `none/reverse_dns_unavailable`, cached for ttlSec. A returned PTR with a
suffix mismatch, or forward ENODATA/ENOTFOUND, yields
`no_signature/reverse_dns_not_confirmed`.

**Privacy:** PTR queries disclose the client IP to the configured DNS resolver. Opting in also retains IPs as bounded in-memory cache keys; this is an explicit exception to the default no-IP-retention behavior. It runs only for bot claims with configured DNS rules, never ordinary browser traffic. Results are network attribution, not human detection, authorization or proof of the exact bot process. Google-owned DNS zones can include user-controlled cloud infrastructure; common-crawler claims use only googlebot.com, not googleusercontent.com. DNS is not DNSSEC authentication and depends on resolver trust. Nothing is logged by this library. The integrator decides whether this disclosure and retention fit the deployment.

## Operator coverage and sources (checked 2026-11-20)

**Kimi registry evidence (checked 2026-11-21):** Kimi publishes identical IP prefixes
for `kimi-user`, `kimibot` and `kimi-searchbot`. An `ip_match` therefore proves
only the operator; purpose comes from the claimed UA token selecting the feed
and its purpose mapping. It does not independently verify that product role.


`rDNS` below always means optional FCrDNS, off by default. `claim` means a token is recognized but does not verify anything. All entries have verifiedByCapture=false except OpenAI. Unverified tokens are deliberately included as claims, not assertions that an operator officially uses them. Operator sources and dates are also stored in the registry.

| Operator                        | Tokens / capability in this package                                                                                                                                                                                                                                                                                             | Primary source                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI                          | ChatGPT-User, OAI-SearchBot, GPTBot, OAI-AdsBot: IP lists; https://chatgpt.com: signature, verifiedByCapture=true                                                                                                                                                                                                               | [agent access](https://developers.openai.com/commerce/agent-access), [bots](https://developers.openai.com/api/docs/bots)                                                                        |
| Google | Common-crawlers IP + googlebot.com rDNS: Googlebot, Googlebot-Image, Googlebot-Video, Storebot-Google, Google-InspectionTool, GoogleOther, GoogleOther-Image, GoogleOther-Video, Google-CloudVertexBot. Managed-fetchers-google IP: Google-GeminiNotebook, Google-NotebookLM, Gemini-Deep-Research, Google-Pinpoint, Google-Read-Aloud, GoogleProducer, Google-Site-Verification, Google-CWS, FeedFetcher-Google. Google-Agent and Gemini-Deep-Research also map to user-triggered-agents IP. google.com rDNS covers Google-Agent plus all nine managed-fetcher tokens (customer googleusercontent.com excluded). Gemini-Deep-Research remains observed with inferred mapping. https://agent.bot.goog signature with opt-in kid aliases. | [verification](https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests), [agent](https://developers.google.com/crawling/docs/crawlers-fetchers/allow-google-agent) |
| Anthropic                       | Claude-Agent: SAIL IP; ClaudeBot/Claude-SearchBot/Claude-User: bots.json IP                                                                                                                                                                                                                                                     | [SAIL](https://claude.com/.well-known/sail), [bots](https://claude.com/crawling/bots.json)                                                                                                      |
| Perplexity                      | PerplexityBot/Perplexity-User: IP                                                                                                                                                                                                                                                                                               | [crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)                                                                                                                       |
| DuckDuckGo                      | DuckAssistBot: IP; provisional https://assistbot.duckduckgo.com signature identity                                                                                                                                                                                                                                              | [operator](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot), [directory](https://radar.cloudflare.com/bots/directory/duckassistbot)                                          |
| Browserbase / Manus             | Provisional signature origins https://www.browserbase.com / https://api.manus.im; no captured requests                                                                                                                                                                                                                          | [Browserbase](https://radar.cloudflare.com/bots/directory/browserbase), [Manus](https://radar.cloudflare.com/bots/directory/manus-bot)                                                          |
| Apple                           | Applebot: JSON IP + applebot.apple.com rDNS                                                                                                                                                                                                                                                                                     | [Applebot](https://support.apple.com/en-sg/119829)                                                                                                                                              |
| Microsoft                       | bingbot: JSON IP + search.msn.com rDNS; AdIdxBot/BingPreview/MicrosoftPreview/BingVideoPreview: claim                                                                                                                                                                                                                                                                                          | [Bingbot](https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26)                                                                                                                  |
| Mistral                         | MistralAI-User/MistralAI-Index: separate JSON IP feeds; MistralAI-Training: claim                                                                                                                                                                                                                                               | [robots](https://docs.mistral.ai/robots)                                                                                                                                                        |
| Moonshot Kimi                   | KimiBot/Kimi-SearchBot/Kimi-User: three separate JSON IP feeds                                                                                                                                                                                                                                                                  | [policy](https://www.kimi.ai/policies/kimi-crawlers)                                                                                                                                            |
| Common Crawl                    | CCBot: JSON IP (top-level synctoken/notes ignored) + crawl.commoncrawl.org rDNS for v4                                                                                                                                                                                                                                          | [CCBot](https://commoncrawl.org/ccbot)                                                                                                                                                          |
| Seznam                          | SeznamBot: JSON IP + seznam.cz rDNS                                                                                                                                                                                                                                                                                             | [crawler](https://o-seznam.cz/napoveda/vyhledavani/en/seznambot-crawler/)                                                                                                                       |
| Naver                           | Yeti/Ads-Naver/Blueno: JSON IP + naver.com rDNS                                                                                                                                                                                                                                                                                 | [firewall guide](https://searchadvisor.naver.com/guide/seo-basic-firewall)                                                                                                                      |
| Kagi                            | Kagibot: four static IPv4 addresses + kagibot.org rDNS                                                                                                                                                                                                                                                                          | [bot](https://kagi.com/bot)                                                                                                                                                                     |
| Baidu                           | Baiduspider: baidu.com/baidu.jp rDNS                                                                                                                                                                                                                                                                                            | [verification](https://help.baidu.com/question?class=476&id=2996&prod_id=99)                                                                                                                            |
| Petal                           | PetalBot: petalsearch.com/aspiegel.com rDNS; the primary guide's step names aspiegel.com while its worked example uses petalsearch.com                                                                                                                                                                                          | [guide](https://webmaster.petalsearch.com/site/petalbot)                                                                                                                                        |
| Yandex                          | YandexBot/YandexAdditional: yandex.ru/yandex.net/yandex.com rDNS                                                                                                                                                                                                                                                                | [verification](https://yandex.com/support/webmaster/en/robot-workings/check-yandex-robots)                                                                                                      |
| Amazon crawler family           | Amazonbot/Amzn-SearchBot/Amzn-User: claim; HTML-wrapped address documents are not registered as JSON feeds; crawl.amazonbot.amazon not confirmed at the current primary source                                                                                                                                                  | [Amazonbot](https://developer.amazon.com/amazonbot)                                                                                                                                             |
| Amazon Ads                      | AmazonAdBot: amazonadbot.com rDNS; HTML-wrapped address document not registered as a JSON feed                                                                                                                                                                                                                                  | [AdBot](https://adbot.amazon.com/)                                                                                                                                                              |
| Meta | meta-externalagent/meta-externalfetcher/meta-webindexer: claim only | [crawlers](https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers) |
| You.com                         | YouBot: claim only pending exact Signature-Agent confirmation; live directory existence supplied by owner is not proof of its wire identity                                                                                                                                                                                     | [directory listing](https://radar.cloudflare.com/bots/directory/youbot)                                                                          |
| Sogou                           | Sogou (matches Sogou web spider): claim; crawl.sogou.com not confirmed in the retrieved primary guide                                                                                                                                                                                                                           | [guide](https://www.sogou.com/docs/help/webmasters.htm)                                                                                                                                         |
| ByteDance                       | Bytespider/TikTokSpider: claim                                                                                                                                                                                                                                                                                                  | [webmaster](https://zhanzhang.toutiao.com/)                                                                                                                                                     |
| DeepSeek / Zhipu / Shenma / 360 | DeepSeekBot/ChatGLM-Spider/YisouSpider/360Spider: claim                                                                                                                                                                                                                                                                         | [DeepSeek](https://www.deepseek.com/), [Zhipu](https://chatglm.cn/), [Shenma](https://zhanzhang.sm.cn/), [360](https://www.so.com/help/spider_ip.html)                                          |
| Diffbot / Timpi                 | Diffbot/Timpibot: claim; no verification capability confirmed                                                                                                                                                                                                                                                                   | [Diffbot](https://docs.diffbot.com/reference/crawl-faq), [Timpi](https://timpi.io/)                                                                                                             |

Kagi's checked static addresses are 216.18.205.234, 35.212.27.76, 104.254.65.50 and 209.151.156.194. They require manual review when the operator changes its page. `staticPrefixes` is configuration, never scraped from a request; total static ranges are capped at 8192 and gated by the operator's explicit extraUaTokens. Registry extra tokens extend claim detection without editing the browser list; tests keep browser tokens a subset.

Chinese-operator coverage is uneven. Kimi publishes separate machine-readable feed endpoints with identical prefixes as checked on 2026-11-21; their names do not independently prove product purpose. In this registry Baidu and Petal can use optional FCrDNS; Sogou, ByteDance, DeepSeek, Zhipu, Shenma and 360 remain claims. No crawler identity or verification method is inferred for a separate AI product simply from its brand. A claim-only result is not a verified operator and does not establish that a visitor is human.

Amazon's primary pages show JSON examples embedded in HTML: Amazonbot/Amzn-User/AdBot use ipv4Prefix examples, SearchBot uses ip_prefix. A raw JSON response endpoint could not be confirmed, so no second JSON shape or HTML scraper was added. You.com's docs were unavailable here: exact Signature-Agent, the reported 68.67.112.0/24 range and search.you.com suffix remain unconfirmed and disabled. The operator-confirmed directory contains public key material but does not independently prove the wire identity. No You.com signing origin is guessed. Sogou's suffix and crawl.amazonbot.amazon remain disabled for lack of current primary documentation; Petal's two suffixes are both present in its indexed primary guide. Claims without public verification docs are explicitly not promoted to network evidence.

The generic Google user-triggered-fetchers feed has an empty token mapping; it does not verify Google-CloudVertexBot. SAIL uses the supplied strict TOML schema, resolves services to prefix sets, and honours bounded expires_after retention. Unknown syntax, keys, duplicate fields, invalid ranges and dangling references reject the feed. Browser Run/AWS signing remain candidates until an exact deployment directory and wire identity are confirmed. Own-browser agents and partial Google signing remain limits.

Standards: [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html), [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638), [RFC 8037 A.3](https://www.rfc-editor.org/rfc/rfc8037#appendix-A.3), [RFC 9864](https://www.rfc-editor.org/rfc/rfc9864), evolving [WBA draft](https://www.ietf.org/archive/id/draft-ietf-webbotauth-httpsig-protocol-01.txt). The supported compatibility policy is documented here; this is not a claim of full RFC/draft conformance.

Own code: MIT, LICENSE. Cloudflare fixtures: Apache-2.0, pinned commit and licence in test/fixtures/NOTICE.md. RFC code examples: test/fixtures/IETF-NOTICE.txt, linked from the interop test. Dependency licences stay with installed packages. Fixture hashes cover local copies; live public directories and approved sanitized capture fixtures are test data, not a request logging facility.

## Changelog

- **Unreleased:** strengthen public API, declaration isolation and successful-refresh hostname regression tests; update documentation.
- **0.3.1 (2026-11-20):** export `serverAgentTokens(registry)` and report endpoint hostnames in refresh events.

- **0.3.0 (2026-11-20):** replace `toAnalyticsFields` with bounded pure `visitorLabels`; two event dimensions, verified unknown-purpose agent result and exhaustive label matrix tests.
- **0.2.1 (2026-11-20):** exclude customer Google Cloud DNS, bind purpose to the matching DNS rule/list, add crawler roles, server-only Google tokens and registry evidence provenance; strengthen signature/cache and delivery boundary coverage.
- **0.2.0 (2026-11-20):** add verified-only agent_purpose, cache status and public refresh metadata; retain cache-only verification and bounded stale-while-revalidate.

## Registry evidence levels

Each default operator has an `evidence` array containing `level`, `source`, `checked`
and `note`, optionally scoped to `uaTokens`. `documented` records an operator's
published description; `observed` records captures or credible bot directories;
`inferred` records an explicit mapping or attribution without direct documentation.
Evidence is descriptive metadata, independent of `verifiedByCapture`, and never
bypasses signature, IP or forward-confirmed DNS verification. Custom registries may
omit it. Different facts about one operator can have different levels.

Gemini-Deep-Research remains supported: the token is observed (Known Agents,
Dark Visitors and Cloudflare AI-assistant reporting, checked 2026-11-19); its
mapping to `user-triggered-agents`, `user-triggered-fetchers-google` and
`google.com` DNS is inferred. Google does not document this token. Customer
`googleusercontent.com` DNS never establishes Google operator identity.

Meta's three tokens remain claims: its [crawler documentation](https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers)
documents the UAs but establishes no configured token-specific IP feed or DNS
rule. MistralAI-Training is documented as a training crawler, but has no published
feed in the cited operator page; it remains claim-only with unknown verified
purpose. AdIdxBot, BingPreview, MicrosoftPreview and BingVideoPreview are
server-side claims; the primary page documents their roles but we have not
confirmed that all belong to `bingbot.json`, so only bingbot uses that feed/rule.

Crawler purpose policies cite operator descriptions for OAI-AdsBot (ad landing
page review), Ads-Naver (ads), Baiduspider, PetalBot and Yandex (search indexing),
AmazonAdBot (ad content scanning), DuckAssistBot (answer retrieval crawler) and
MistralAI-Training (training). The last remains unverified until independent
operator evidence is configured. On shared feeds, an eligible token with no known
role makes conflicting purpose unknown; tokens outside the winning list or DNS
rule cannot decide purpose.

Kimi's `.com` policy URL currently resolves through the browsing service to `.ai`,
and `.ai` JSON is accessible there. Direct HTTP redirect verification was blocked
by sandbox DNS, so the existing `.ai` feeds are retained pending a direct check.
YouBot's unavailable documentation link is replaced with an observed directory
source; no verification capability is added.

### Local replay enforcement (0.3.2)

`new MemoryNonceStore(capacity = 10000, now = () => Date.now() / 1000)` can be
passed as `nonceStore`, including with `cacheOnly: true`. Its clock should match
the verifier clock. It performs an atomic check and insertion within one process,
retains entries through expiry plus 30 seconds (inclusive), and fails closed when
full rather than evicting live entries. Store failures yield an indeterminate
verdict. External stores remain unavailable in cache-only verification.

Successful signature evidence now includes `verified.expiresAt` (Unix seconds,
without skew), so callers can cap the lifetime of derived evidence.
