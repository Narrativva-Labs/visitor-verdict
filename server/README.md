# Visitor Verdict server verifier

An internal TypeScript package in the public MIT Visitor Verdict repository. Node 22+, ESM. Its purpose is analytics and conversion hygiene. It verifies operator evidence, never humanity, consent, purchase approval or application authorization.

## Build and validate

```sh
cd server
npm ci
npm test
npm run typecheck
npm run format:check
npm run tokens # regenerate only when browser defaults change
```

The package is marked `private: true` to prevent accidental npm publication. `files` includes the built `dist`, documentation and licence; `prepare` builds it for installation as a git dependency. `server/dist` and node_modules are ignored. CI runs server tests, typechecking and formatting on Node 22 and 24, independently of browser checks.

Dependencies are pinned: runtime **structured-headers 2.1.1 (MIT)** for SF parsing/serialization; dev TypeScript 5.6.3, Node declarations 22.20.1 and Prettier 3.3.3. Crypto uses only `node:crypto`; CIDR matching uses `node:net.BlockList`. A linear lexical guard checks duplicates, canonical base64 and integer timestamp types before the SF parser can lose that information. UA token regexes are compiled once from the generated browser defaults, with a drift test. No DOM lib is required. The test suite also compiles a public API consumer against Node 22 declarations without DOM or skipLibCheck.

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
  host: req.headers.host,
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
| `deadlineMs`        | Overall per-verification deadline, default 1500 ms. Expiry returns none/deadline_exceeded.                                                                              |
| `fetchTimeoutMs`    | Per-fetch and nonce-store timeout, default 1000 ms. Positive integer, at most 60 seconds, as for deadlineMs.                                                            |
| `nonceStore`        | Optional atomic `insertIfAbsent(key, ttlSeconds): Promise<boolean>`. Default absent: no nonce retention.                                                                |
| `now`               | Function returning Unix **seconds**, default Date.now()/1000. Values above 1e11/nonfinite return none/invalid_clock; clock exceptions return none/internal_error.       |

`verify` accepts Node IncomingHttpHeaders, WHATWG Headers, Map, or a Node rawHeaders array of alternating names/values. Unsupported containers reject with TypeError (programmer error). Malformed contents return a verdict. Arrays of pairs are not rawHeaders. Prefer rawHeaders where original field occurrences matter; WHATWG Headers may already have combined occurrences before the library sees them.

The explicit request `host` is trimmed only by SP/HTAB, lowercased, and stripped of default :443. It must match a configured authority; otherwise the result is **none/unknown_authority**, including unsigned visits. The signature base uses that configured authority. Raw Host/:authority field values are not compared or tried as alternative authorities. `target` is optional unless signed components require it. When supplied, it must be raw origin-form or absolute HTTPS form with the same authority; unparsable context returns none/insufficient_context. Paths/target URIs preserve raw percent encoding and dot segments instead of applying WHATWG URL normalization.

Transport adapters must supply the external host and genuine client IP from a trusted boundary. The library never derives either from X-Forwarded-Host/X-Forwarded-For. For nginx use `proxy_set_header Host $host;` (and account for nondefault ports in your adapter). Caddy normally keeps Host; verify your deployed upstream configuration rather than assuming it. Sanitize forwarding headers and authenticate any original-request envelope passed to an sGTM/verifier service. The service's own HTTP request is not the signed browser request.

`coveredHeaderNames(signatureInput)` returns the ordinary covered field names, excluding derived components; malformed/duplicate/oversize inputs throw. It helps adapters collect required fields without silently discarding coverage. It does not itself verify a signature or declare supported component parameters.

## Verdicts and analytics

The verdict contains claimed known UA tokens and parsed Signature-Agent strings; both remain untrusted claims. A successful `verified` field identifies an operator and method; signature evidence includes keyid, identity and `keyidForm` (`thumbprint` or `kid`). `signatures` retains per-label results, including peers that fail. Whole-header syntax/duplicate/resource errors fail before label evaluation. Optional `ip` contains operator/list evidence only, never the client IP.

| verification        | Meaning / reasons                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signature_valid`   | A trusted signature passes policy and crypto: verified.                                                                                                                                                                 |
| `signature_invalid` | A signature was presented and demonstrably failed: wrong_tag, crypto_mismatch, expired, invalid_timestamp_type, missing_keyid, signature_agent_not_covered, etc. Never returned merely for an unsigned visitor.         |
| `none`              | Indeterminate/untrusted/context failure: untrusted_signature_agent, unknown_keyid, unsupported_component, insufficient_context, unknown_authority, invalid_clock, internal_error, directory_timeout, deadline_exceeded. |
| `no_signature`      | No signature headers and no official IP match: signature_headers_absent. UA alone never verifies.                                                                                                                       |
| `ip_match`          | No signature presented and a relevant operator-published range matches: official_ip_range_match.                                                                                                                        |

Selection is pure and tested: valid signature wins; otherwise definitive invalid wins over indeterminate. An invalid presented signature never becomes ip_match, though independent IP evidence is attached after evaluable signature failures. Early malformed/resource/context failures avoid further fetches. Unknown Signature-Agent identities trigger no network I/O. Unsupported dictionary members are untrusted for their label without poisoning valid peers.

`toAnalyticsFields` exports only flat strings: agent_claim = signature_agent / ua_token / none, agent_verification = the enum, agent_operator = verified operator / none. Do not forward the entire diagnostic verdict or raw requests to GA4/sGTM. Do not use these signals for pre-consent advertising.

## Signature profile and key rules

Request-only Ed25519, optional signature alg="ed25519". Required tag="web-bot-auth", keyid, SF **Integer** created/expires, bare @authority or @target-uri, and coverage of present Signature-Agent. Created may be 30 seconds in the future; expires may be 30 seconds behind now; lifetime is 0–24 hours. Integer-valued Decimals such as created=1800000000.0 are rejected lexically.

Both legacy quoted-string (OpenAI) and dictionary forms are supported. Dictionary coverage must use `"signature-agent";key="g"` for label g. Members may have no parameters or exactly `type="directory"`; other parameters/types make that member untrusted. Canonicalized dictionary member values include their accepted parameters. Each field line is trimmed by SP/HTAB before comma-space joining. Other control characters are rejected; NBSP/obs-text is preserved in ordinary signed fields.

Components supported: @authority, @method, @target-uri, @path; bare/member Signature-Agent; ordinary lowercase header names without component parameters. Unsupported covered components are never omitted. Covered content-digest returns none/insufficient_context: body integrity is outside this API.

Directories may contain up to 32 keys. Structural problems, ambiguous aliases, or **any private d** reject the directory. Unsupported/invalid public keys are skipped independently. Supported keys: OKP/Ed25519, canonical 32-byte x, alg absent/EdDSA/Ed25519, use absent/sig, key_ops absent or containing verify. Each key is indexed by its RFC 7638/RFC 8037 thumbprint and its optional custom kid. Google uses short custom kids; the live Google fixture is tested. JWK nbf/exp are checked on every use, even on cache hits. An expired/inactive key never establishes validity.

Default analytics verification stores no nonce. Optional NonceStore receives a JSON tuple of identity, thumbprint and nonce only after crypto success, TTL through expires + 30 seconds. It is caller-owned storage and an explicit change to default privacy/replay behavior. Use atomic shared storage across instances and do not log keys. Calls are time-boxed; the interface cannot forcibly cancel external store work already started. Missing nonce/replay fail; store exceptions are indeterminate. No signature proves integrity of components it does not cover.

## Network, retention and resource limits

Only exact HTTPS registry endpoints are fetched, without credentials, fragments, alternate ports or redirects. Require status 200 and unchanged response URL. Streaming and declared-size limits apply; every rejection aborts/cancels the response, including responses arriving after timeout. All fetchers are injectable; tests never hit the network. Directory proofs are outside request verification; trust rests on the exact configured URL over HTTPS.

Verification retention is deliberately separate from HTTP caching: successfully parsed operator directories/IP lists are kept for **at least 300 seconds and at most 24 hours**, even for no-store/no-cache/max-age=0. Cache-Control max-age minus Age supplies the intermediate TTL. This is public operator data, not retained request data. Single-flight refresh is per URL/document kind. A 60-second cooldown applies only after failures or forced unknown-key refreshes; successful ordinary refreshes do not cause outages. Unknown keyids permit one controlled refresh per cooldown. Hard expiry never uses stale data after failed refresh. IP feeds compile BlockList once per successful fetch; relevant feeds are fetched in parallel with allSettled. Registry order selects evidence deterministically. Overall deadlines still apply.

Limits: total headers 64 KiB / 256 field occurrences, user-agent 1 KiB, signature-related headers 16 KiB, four paired labels, 32 components/signature; directories 64 KiB / 32 keys; IP feeds **1 MiB / 8192 prefixes**. Limits are counted on the first aggregation pass, using push rather than repeated copies. The linear lexer handles commas/semicolons in strings and colons in SF Tokens. No raw request header/IP/signature/nonce is logged or retained in cache. IP matching supports v4, v6 and mapped v4.

Shared cache refreshes have their own bounded lifetime: one caller's deadline does not cancel a fetch needed by other callers. A timed-out request cannot proceed to nonce insertion after its shared fetch finishes. HTTPS allowlisting does not prevent compromised domains/DNS; deploy outbound network controls and application rate limits. Node fetch does not pin DNS resolution.

## Operators and sources

| operator    | identity                                       | verifiedByCapture | IP evidence / source                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| openai      | https://chatgpt.com                            | true              | chatgpt-user/searchbot/gptbot/adsbot; [agent access](https://developers.openai.com/commerce/agent-access), [bots](https://developers.openai.com/api/docs/bots)                                                                                                                                                 |
| google      | https://agent.bot.goog                         | false             | user-triggered-agents, user-triggered-fetchers-google; **common-crawlers for Google-CloudVertexBot**; [agent guide](https://developers.google.com/crawling/docs/crawlers-fetchers/allow-google-agent), [common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) |
| duckduckgo  | https://assistbot.duckduckgo.com (provisional) | false             | duckassistbot.json; [operator reference](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot), [directory listing](https://radar.cloudflare.com/bots/directory/duckassistbot)                                                                                                                   |
| browserbase | https://www.browserbase.com (provisional)      | false             | [program](https://www.browserbase.com/contact-web-bot-auth), [directory listing](https://radar.cloudflare.com/bots/directory/browserbase)                                                                                                                                                                      |
| manus       | https://api.manus.im (provisional)             | false             | [directory listing](https://radar.cloudflare.com/bots/directory/manus-bot)                                                                                                                                                                                                                                     |
| anthropic   | no WBA identity configured                     | false             | [bots.json](https://claude.com/crawling/bots.json) for ClaudeBot/Claude-SearchBot/Claude-User                                                                                                                                                                                                                  |
| perplexity  | no WBA identity configured                     | false             | [operator reference](https://docs.perplexity.ai/docs/resources/perplexity-crawlers); perplexitybot/perplexity-user.json                                                                                                                                                                                        |

The generic Google user-triggered-fetchers feed remains registered with an empty token mapping: no currently generated token is assigned to that customer-controlled infrastructure. It is not an alternative range for Google-CloudVertexBot. Callers may configure a documented matching token explicitly. Published networks can be shared; IP attribution is weaker than signing-key evidence.

All five WBA directories have supplied live 2026-11-20 fixtures and parse tests. This confirms directory compatibility, **not their live request wire identities or signature coverage**. Only OpenAI has a real request capture (32 requests, including POST and OPTIONS). Google tests use generated keys. Exact DuckDuckGo/Browserbase/Manus Signature-Agent values remain unconfirmed at operator primary sources/captures; registry origin values are provisional. Remove entries if that is outside your trust policy.

SAIL remains TODO/disabled because its live TOML schema was not confirmed. Claude-Agent is an IP+UA scheme, not an assumed WBA identity; bots.json is not used as its fallback. Cloudflare Browser Run and AWS AgentCore Browser are candidates only: no exact operator-confirmed directory URL has been added. AWS directories may be deployment-specific. Local own-browser agents and partial/experimental Google signing remain detection limits.

Standards: [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html), [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638), [RFC 8037 A.3](https://www.rfc-editor.org/rfc/rfc8037#appendix-A.3), [RFC 9864](https://www.rfc-editor.org/rfc/rfc9864), evolving [WBA draft](https://www.ietf.org/archive/id/draft-ietf-webbotauth-httpsig-protocol-01.txt). The supported compatibility policy is documented here; this is not a claim of full RFC/draft conformance.

Own code: MIT, LICENSE. Cloudflare fixtures: Apache-2.0, pinned commit and licence in test/fixtures/NOTICE.md. RFC code examples: test/fixtures/IETF-NOTICE.txt, linked from the interop test. Dependency licences stay with installed packages. Fixture hashes cover local copies; live public directories and approved sanitized capture fixtures are test data, not a request logging facility.
