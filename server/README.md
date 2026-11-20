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

The package is marked `private: true` to prevent accidental npm publication. `files` includes the built `dist`, documentation and licence; `prepare` builds it when packaging. npm cannot install a git dependency directly from this repository’s server/ subfolder. From a checkout, run `npm pack` inside server/, then install the resulting tarball in the consuming application (`npm install /path/to/visitor-verdict-server-0.1.0.tgz`). Do not point npm at the repository root and expect it to select this package. pnpm/yarn subdirectory syntax is a separate package-manager capability; check its version-specific documentation. `server/dist` and node_modules are ignored. CI runs server tests, typechecking and formatting on Node 22 and 24, independently of browser checks.

Dependencies are pinned: runtime **structured-headers 2.1.1 (MIT)** for SF parsing/serialization; dev TypeScript 5.6.3, Node declarations 22.20.1 and Prettier 3.3.3. Crypto uses only `node:crypto`; CIDR matching uses `node:net.BlockList`. A linear lexical guard checks duplicates, base64 syntax (accepting omitted padding), and integer timestamp types before the SF parser can lose that information. UA token regexes are compiled once per verifier from generated browser defaults plus registry `extraUaTokens`. The drift test keeps the generated browser list unchanged and checks it remains a subset; bingbot is explicitly server-only. No DOM lib is required. The test suite also compiles a public API consumer against Node 22 declarations without DOM or skipLibCheck.

## API

```ts
import { createVerifier, defaultRegistry, toAnalyticsFields } from './dist/index.js';

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
const fields = toAnalyticsFields(verdict);
```

`createVerifier` snapshots the registry and owns its cache. Reuse the verifier across requests. There is no global cache keyed by incidental object/function identity, no `mode` option, and no legacy `verifyAgentRequest` API.

| Construction option | Contract                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry`          | Trusted operator entries with exact identity and directory/feed URLs, source and date. Up to 128 operators and 128 distinct endpoints. Never accept this from requests. |
| `authorities`       | Nonempty list of allowed external authorities. Case and default HTTPS port are normalized at construction.                                                              |
| `fetcher`           | Optional `(url, RequestInit) => Promise<Response>`. Defaults to fetch. Preserve HTTPS/TLS validation and manual redirects.                                              |
| `deadlineMs`        | Best-effort overall deadline over bounded synchronous work, default 1500 ms. Expiry returns none/deadline_exceeded.                                                     |
| `fetchTimeoutMs`    | Per-fetch and nonce-store timeout, default 1000 ms. Positive integer, at most 60 seconds, as for deadlineMs.                                                            |
| `nonceStore`        | Optional atomic `insertIfAbsent(key, ttlSeconds): Promise<boolean>`. Default absent: no nonce retention.                                                                |
| `now`               | Function returning Unix **seconds**, default Date.now()/1000. Values above 1e11/nonfinite return none/invalid_clock; clock exceptions return none/internal_error.       |

`verify` accepts Node IncomingHttpHeaders, WHATWG Headers, Map, or a Node rawHeaders array of alternating names/values. Unsupported containers reject with TypeError (programmer error). Malformed contents return a verdict. Arrays of pairs are not rawHeaders. Prefer rawHeaders where original field occurrences matter; WHATWG Headers may already have combined occurrences before the library sees them.

The explicit request `host` is trimmed only by SP/HTAB, lowercased, and stripped of default :443. It must match a configured authority; otherwise the result is **none/unknown_authority**, including unsigned visits. The signature base uses that configured authority. Raw Host/:authority field values are not compared or tried as alternative authorities. `target` is optional unless signed components require it. Only its type and size are checked eagerly. Syntax is validated lazily when a signature covers @path or @target-uri; an uncovered query ending in a lone % and OPTIONS \* do not change verification. Covered target context must be raw origin-form (including //path) or absolute HTTPS form with the same authority; unusable covered context returns none/insufficient_context. Absolute HTTPS scheme/authority and empty path are normalized consistently, while raw path/query octets are preserved. Paths/target URIs preserve raw percent encoding and dot segments instead of applying WHATWG URL normalization.

A single-host collector should use its fixed configured external host, as above, after routing to that collector. Multi-host adapters must map a trusted route to the correct configured host rather than trying candidates until a signature verifies. Fastify req.host reads X-Forwarded-Host when trustProxy is enabled; do not pass it unchecked. Keep a local aggregate reason counter or health check (without request data) so a spike of unknown_authority, invalid_clock or feed errors exposes integration problems.

Transport adapters must supply the external host and genuine client IP from a trusted boundary. The library never derives either from X-Forwarded-Host/X-Forwarded-For. For nginx use `proxy_set_header Host $host;` (and account for nondefault ports in your adapter). Caddy normally keeps Host; verify your deployed upstream configuration rather than assuming it. Sanitize forwarding headers and authenticate any original-request envelope passed to an sGTM/verifier service. The service's own HTTP request is not the signed browser request.

`coveredHeaderNames(signatureInput)` returns the ordinary covered field names, excluding derived components; malformed/duplicate/oversize inputs throw only public TypeError, never an internal Failure class. `requiredHeaderNames(signatureInput?)` never throws and returns user-agent, signature, signature-input, signature-agent plus covered ordinary field names; malformed or absent input yields the four base names. It helps adapters collect required fields without silently discarding coverage. It does not itself verify a signature or declare supported component parameters.

## Server-side GTM

Run this Node library in an authenticated verifier service, not inside the sandboxed template. sGTM [request APIs](https://developers.google.com/tag-platform/tag-manager/server-side/api) read headers by name with getRequestHeader; they do not enumerate raw header names. Deploy a configured name set produced by requiredHeaderNames(signatureInput), always including its four base fields. If the sandbox cannot run the parser, preconfigure the required names for the supported profile; a service cannot reconstruct omitted signed fields after the fact. Forward the original method, these header values, and a **fixed configured collector host**, not an unchecked forwarded host.

Construct target from the original path and query: `path + (query ? '?' + query : '')`, preserving raw escaping and parameter order (and an explicit empty ? if the transport exposes it). Use getRequestPath/getRequestQueryString without decoding/re-encoding. Set sendHttpRequest timeout to approximately `deadlineMs + 500` milliseconds; its default timeout need not match verifier latency. Authenticate the service call, require the relevant read_request/send_http permissions and do not log the request envelope. This section describes the adapter contract, not a shipped sGTM template.

IP evidence is only as trustworthy as the original source address. getRemoteAddress is best-effort and can use Forwarded/X-Forwarded-For; it is not proof of a peer IP. Sanitize forwarding metadata at a trusted proxy, or omit clientIp when that chain cannot be trusted. Propagate a service deadline/error as none, never as human. Monitor only aggregate reason counts locally. The library labels traffic and does not itself withhold anything; the integrator owns conversion policy.

## Verdicts and analytics

The verdict contains claimed known UA tokens and parsed Signature-Agent strings; both remain untrusted claims. A successful `verified` field identifies an operator and method; signature evidence includes keyid, identity and `keyidForm` (`thumbprint` or `kid`). `signatures` retains per-label results, including peers that fail. Whole-header syntax/duplicate/resource errors fail before label evaluation. Optional `ip` contains operator/list evidence only, never the client IP.

| verification        | Meaning / reasons                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `signature_valid`   | A trusted signature passes policy and crypto: verified.                                                                                                                                                                                          |
| `signature_invalid` | A signature was presented and demonstrably failed: crypto_mismatch, expired, invalid_timestamp_type, missing_keyid, signature_agent_not_covered, etc. Never returned merely for an unsigned visitor.                                             |
| `none`              | Indeterminate/untrusted/context failure: untrusted_signature_agent, unknown_keyid, unsupported_component, insufficient_context, unknown_authority, invalid_clock, internal_error, directory_timeout, deadline_exceeded, ip_evidence_unavailable. |
| `no_signature`      | No WBA signature and no official IP match: signature_headers_absent or ignored_non_wba. A relevant failed feed with no match instead returns none/ip_evidence_unavailable. UA alone never verifies.                                              |
| `ip_match`          | No WBA signature presented and a relevant operator-published range matches: official_ip_range_match.                                                                                                                                             |

Other/absent signature tags are reported per-label as none/ignored_non_wba and do not suppress IP matching or override an indeterminate WBA peer. A malformed SF header can still fail before tag selection.

Selection is pure and tested: valid signature wins; otherwise definitive invalid wins over indeterminate. An invalid presented signature never becomes ip_match, though independent IP evidence is attached after evaluable signature failures. Early malformed/resource/context failures avoid further fetches. Unknown WBA Signature-Agent identities trigger no network I/O. Identity claims attached only to ignored non-WBA signatures do not restrict independent IP checks. Unsupported dictionary members are untrusted for their label without poisoning valid peers.

`toAnalyticsFields` exports only flat strings: agent_claim = signature_agent / ua_token / none, agent_verification = the enum, agent_operator = verified operator / none. Do not forward the entire diagnostic verdict or raw requests to GA4/sGTM. Do not use these signals for pre-consent advertising.

## Signature profile and key rules

Request-only Ed25519, optional signature alg="ed25519". Required tag="web-bot-auth", keyid, SF **Integer** created/expires, bare @authority or @target-uri, and coverage of present Signature-Agent. Created may be 30 seconds in the future; expires may be 30 seconds behind now; lifetime is 0–24 hours. Integer-valued Decimals such as created=1800000000.0 are rejected per WBA label using lexical type metadata. These timestamp rules apply only to Signature-Input metadata; an extension named created/expires in Signature-Agent cannot poison peers.

Both legacy quoted-string (OpenAI) and dictionary forms are supported. Dictionary coverage must use `"signature-agent";key="g"` for label g. Protocol-01 §5.2.1 forbids member parameters. All parameterized members are therefore ignored for identity, including both `type=directory` (SF Token) and `type="directory"` (SF String); neither is normative in that revision. Legacy quoted-string compatibility remains explicit. Each field line is trimmed by SP/HTAB before comma-space joining. Other control characters are rejected; raw field strings are interpreted as Latin-1 octets (0–255); Unicode above 255 is rejected. Unwrapped non-ASCII covered fields return none/non_ascii_component, per RFC 9421 §2.5. Binary wrapping via `;bs` base64-encodes each trimmed field occurrence using Latin-1 bytes, never UTF-8, before combining. The final ASCII base is encoded explicitly as ASCII.

Components supported: @authority, @method, @target-uri, @path; bare/member Signature-Agent; ordinary lowercase RFC 9110 tchar header names (including dots, underscores and leading digits), bare or with `;bs`. Unsupported covered components are never omitted. Covered content-digest returns none/insufficient_context: body integrity is outside this API.

Directories may contain up to 32 keys. Structural problems, ambiguous aliases, or **any private d** reject the directory. Unsupported/invalid public keys are skipped independently. Supported keys: OKP/Ed25519, canonical 32-byte x, alg absent/EdDSA/Ed25519, use absent/sig, key_ops absent or containing verify. Each key is indexed by its RFC 7638/RFC 8037 thumbprint and its optional custom kid. Google uses short custom kids; the live Google fixture is tested. JWK nbf/exp are checked on every use, even on cache hits. An expired/inactive key never establishes validity.

Default analytics verification stores no nonce. Optional NonceStore receives a JSON tuple of identity, thumbprint and nonce only after crypto success, TTL through expires + 30 seconds. It is caller-owned storage and an explicit change to default privacy/replay behavior. Use atomic shared storage across instances and do not log keys. Calls are time-boxed; the interface cannot forcibly cancel external store work already started. Missing nonce/replay fail; store exceptions are indeterminate. No signature proves integrity of components it does not cover.

## Network, retention and resource limits

Only exact HTTPS registry endpoints are fetched, without credentials, fragments, alternate ports or redirects. Require status 200 and unchanged response URL. Streaming and declared-size limits apply; every rejection aborts/cancels the response, including responses arriving after timeout. All fetchers are injectable; tests never hit the network. Directory proofs are outside request verification; trust rests on the exact configured URL over HTTPS.

Verification retention is deliberately separate from HTTP caching: successfully parsed operator directories/IP lists are kept for **at least 300 seconds and at most 24 hours**, even for no-store/no-cache/max-age=0. Cache-Control max-age minus Age supplies the intermediate TTL. This is public operator data, not retained request data. Ordinary and forced refreshes have separate flights per URL/document kind. Fresh data is returned before joining a forced refresh, so an unknown-key request cannot stall other valid cached signatures. A 60-second cooldown applies only after failures or forced unknown-key refreshes; successful ordinary refreshes do not cause outages. Unknown keyids permit one controlled refresh per cooldown. Hard expiry never uses stale data after failed refresh. IP feeds compile BlockList once per successful fetch; relevant feeds are fetched in parallel with allSettled. Registry order selects evidence deterministically. SAIL uses expires_after instead of HTTP max-age, with the same retention bounds. The deadline timer starts before verification work; deadlines are best effort because one event loop cannot interrupt bounded synchronous parsing/crypto. Hard interruption would require a separate execution context.

Limits: total headers 64 KiB / 256 field occurrences, user-agent 1 KiB, signature-related headers 16 KiB, four paired labels, 32 components/signature; directories 64 KiB / 32 keys; JSON IP feeds **1 MiB / 8192 prefixes**; SAIL **64 KiB**, up to 32 prefix sets/services and 8192 prefixes per service. Context caps before scanning/copying: method 32 characters, host 2048, target 65536, clientIp 64. Limits are counted on the first aggregation pass, using push rather than repeated copies. The linear lexer handles commas/semicolons in strings, colons in SF Tokens and literal backslashes in Display Strings. A small parser compatibility path restores SF Date values after parsing without consuming following member delimiters. No raw request header/IP/signature/nonce is logged or retained in cache. IP matching supports v4, v6 and mapped v4.

Shared cache refreshes have their own bounded lifetime: one caller's deadline does not cancel a fetch needed by other callers. A timed-out request cannot proceed to nonce insertion after its shared fetch finishes. HTTPS allowlisting does not prevent compromised domains/DNS; deploy outbound network controls and application rate limits. Node fetch does not pin DNS resolution.

## Operators and sources

| operator    | identity                                       | verifiedByCapture | IP evidence / source                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| openai      | https://chatgpt.com                            | true              | chatgpt-user/searchbot/gptbot/adsbot; [agent access](https://developers.openai.com/commerce/agent-access), [bots](https://developers.openai.com/api/docs/bots)                                                                                                                                                 |
| google      | https://agent.bot.goog                         | false             | user-triggered-agents, user-triggered-fetchers-google; **common-crawlers for Google-CloudVertexBot**; [agent guide](https://developers.google.com/crawling/docs/crawlers-fetchers/allow-google-agent), [common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) |
| duckduckgo  | https://assistbot.duckduckgo.com (provisional) | false             | duckassistbot.json; [operator reference](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot), [directory listing](https://radar.cloudflare.com/bots/directory/duckassistbot)                                                                                                                   |
| browserbase | https://www.browserbase.com (provisional)      | false             | [program](https://www.browserbase.com/contact-web-bot-auth), [directory listing](https://radar.cloudflare.com/bots/directory/browserbase)                                                                                                                                                                      |
| manus       | https://api.manus.im (provisional)             | false             | [directory listing](https://radar.cloudflare.com/bots/directory/manus-bot)                                                                                                                                                                                                                                     |
| anthropic   | no WBA identity configured                     | false             | [bots.json](https://claude.com/crawling/bots.json) for ClaudeBot/Claude-SearchBot/Claude-User; [SAIL](https://claude.com/.well-known/sail) for Claude-Agent                                                                                                                                                    |
| perplexity  | no WBA identity configured                     | false             | [operator reference](https://docs.perplexity.ai/docs/resources/perplexity-crawlers); perplexitybot/perplexity-user.json                                                                                                                                                                                        |

Additional IP-only operators (all verifiedByCapture=false):

| operator  | token                 | IP feed                                          | operator documentation                                                                   |
| --------- | --------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| apple     | Applebot              | https://search.developer.apple.com/applebot.json | [Applebot](https://support.apple.com/en-sg/119829)                                       |
| microsoft | bingbot (server-only) | https://www.bing.com/toolbox/bingbot.json        | [Verifying Bingbot](https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26) |
| mistral   | MistralAI-User        | https://mistral.ai/mistralai-user-ips.json       | [Mistral crawlers](https://docs.mistral.ai/robots)                                       |

The generic Google user-triggered-fetchers feed remains registered with an empty token mapping: no currently generated token is assigned to that customer-controlled infrastructure. It is not an alternative range for Google-CloudVertexBot. Callers may configure a documented matching token explicitly. Published networks can be shared; IP attribution is weaker than signing-key evidence.

All five WBA directories have supplied live 2026-11-20 fixtures and parse tests. This confirms directory compatibility, **not their live request wire identities or signature coverage**. Only OpenAI has a real request capture (32 requests, including POST and OPTIONS). Google tests use generated keys. Exact DuckDuckGo/Browserbase/Manus Signature-Agent values remain unconfirmed at operator primary sources/captures; registry origin values are provisional. Remove entries if that is outside your trust policy.

Claude-Agent uses the live supplied SAIL snapshot, an IP+UA scheme rather than WBA. The schema-specific TOML parser supports only top-level schema/modified/expires_after, prefix_sets (name/exclusive/ipv4_prefixes/ipv6_prefixes), services (name/exhaustive/prefix_sets), comments and basic string arrays. Unknown syntax/keys, duplicates, missing fields, invalid ranges or dangling references reject the feed. Prefix sets are resolved by service; bots.json is not a Claude-Agent fallback. exclusive/exhaustive are validated metadata, not authorization claims. Cloudflare Browser Run and AWS AgentCore Browser are candidates only: no exact operator-confirmed directory URL has been added. AWS directories may be deployment-specific. Local own-browser agents and partial/experimental Google signing remain detection limits.

Standards: [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html), [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638), [RFC 8037 A.3](https://www.rfc-editor.org/rfc/rfc8037#appendix-A.3), [RFC 9864](https://www.rfc-editor.org/rfc/rfc9864), evolving [WBA draft](https://www.ietf.org/archive/id/draft-ietf-webbotauth-httpsig-protocol-01.txt). The supported compatibility policy is documented here; this is not a claim of full RFC/draft conformance.

Own code: MIT, LICENSE. Cloudflare fixtures: Apache-2.0, pinned commit and licence in test/fixtures/NOTICE.md. RFC code examples: test/fixtures/IETF-NOTICE.txt, linked from the interop test. Dependency licences stay with installed packages. Fixture hashes cover local copies; live public directories and approved sanitized capture fixtures are test data, not a request logging facility.
