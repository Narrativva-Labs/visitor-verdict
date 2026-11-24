# Visitor Verdict server verifier (0.6.1)

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

The package is marked `private: true` to prevent accidental npm publication. `files` includes the built `dist`, documentation and licence; `prepare` builds it when packaging. npm cannot install a git dependency directly from this repository’s server/ subfolder. From a checkout, run `npm pack` inside server/, then install the resulting tarball in the consuming application (`npm install /path/to/visitor-verdict-server-0.6.1.tgz`). Do not point npm at the repository root and expect it to select this package. pnpm/yarn subdirectory syntax is a separate package-manager capability; check its version-specific documentation. `server/dist` and node_modules are ignored. CI runs server tests, typechecking and formatting on Node 22 and 24, independently of browser checks.

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

| Construction option  | Contract                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry`           | Trusted operator entries with exact identity and directory/feed URLs, source and date. Up to 128 operators and 128 distinct endpoints. Never accept this from requests. |
| `authorities`        | Nonempty list of up to 128 allowed external authorities. Case and default HTTPS port are normalized at construction.                                                    |
| `fetcher`            | Optional `(url, RequestInit) => Promise<Response>`. Defaults to fetch. Preserve HTTPS/TLS validation and manual redirects.                                              |
| `deadlineMs`         | Best-effort overall deadline over bounded synchronous work, default 1500 ms. Expiry returns none/deadline_exceeded.                                                     |
| `maxLifetimeSeconds` | Positive safe integer, default 86400 s; maximum expires-created lifetime.                                                                                               |
| `reverseDns`         | Optional FCrDNS configuration, disabled by default; see the DNS section below.                                                                                          |
| `onRefresh`          | Optional public-document refresh callback; exceptions are ignored.                                                                                                      |
| `fetchTimeoutMs`     | Per-fetch and nonce-store timeout, default 1000 ms. Positive integer, at most 60 seconds, as for deadlineMs.                                                            |
| `staleMaxSeconds`    | Positive values cap total document age, fresh or stale, default 86400 s (0–86400). 0 disables stale serving and retains the ordinary HTTP-derived fresh TTL.            |
| `nonceStore`         | Optional atomic `insertIfAbsent(key, ttlSeconds): Promise<boolean>`. Default absent: no nonce retention.                                                                |
| `now`                | Function returning Unix **seconds**, default Date.now()/1000. Values above 1e11/nonfinite return none/invalid_clock; clock exceptions return none/invalid_clock.        |

`verify` accepts Node IncomingHttpHeaders, WHATWG Headers, Map, or a Node rawHeaders array of alternating names/values. Unsupported containers reject with TypeError (programmer error). Malformed contents return a verdict. Arrays of pairs are not rawHeaders. Prefer rawHeaders where original field occurrences matter; WHATWG Headers may already have combined occurrences before the library sees them.

The explicit request `host` is trimmed only by SP/HTAB, lowercased, and stripped of default :443. It must match a configured authority; otherwise the result is **none/unknown_authority**, including unsigned visits. The signature base uses that configured authority. Raw Host/:authority field values are not compared or tried as alternative authorities. `target` is optional unless signed components require it. Only its type and size are checked eagerly. Syntax is validated lazily when a signature covers @path or @target-uri; an uncovered query ending in a lone % and OPTIONS \* do not change verification. Covered target context must be raw origin-form (including //path) or absolute HTTPS form with the same authority; unusable covered context returns none/insufficient_context. Absolute HTTPS scheme/authority and empty path are normalized consistently, while raw path/query octets are preserved. Paths/target URIs preserve raw percent encoding and dot segments instead of applying WHATWG URL normalization.

A single-host collector should use its fixed configured external host, as above, after routing to that collector. Multi-host adapters must map a trusted route to the correct configured host rather than trying candidates until a signature verifies. Fastify req.host reads X-Forwarded-Host when trustProxy is enabled; do not pass it unchecked. Keep a local aggregate reason counter or health check (without request data) so a spike of unknown_authority, invalid_clock or feed errors exposes integration problems.

Transport adapters must supply the external host and genuine client IP from a trusted boundary. The library never derives either from X-Forwarded-Host/X-Forwarded-For. For nginx use `proxy_set_header Host $host;` (and account for nondefault ports in your adapter). Caddy normally keeps Host; verify your deployed upstream configuration rather than assuming it. Sanitize forwarding headers and authenticate any original-request envelope passed to an sGTM/verifier service. The service's own HTTP request is not the signed browser request.

`coveredHeaderNames(signatureInput)` returns the ordinary covered field names, excluding derived components; malformed/duplicate/oversize inputs throw only public TypeError, never an internal Failure class. `requiredHeaderNames(signatureInput?)` never throws and returns user-agent, signature, signature-input, signature-agent plus covered ordinary field names; malformed or absent input yields the four base names. It helps adapters collect required fields without silently discarding coverage. It does not itself verify a signature or declare supported component parameters.

## Purpose and health

`verdict.agent_purpose` and the purpose segment in `visitorLabels({ verdict }).vv_detail` are
`user_directed`, `crawler`, `intermediary` (since 0.4.0) or `unknown`. Only signature_valid/ip_match can carry a
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
Verified [Manus](https://manus.im/docs/features/cloud-browser) and Meta Muse
([muse.ai](https://muse.ai/blog/poppy-personal-agent-protocol), since 0.4.0) signature
identities map to `user_directed`: each is an agent acting for its user (owner policy based
on their documented products).

**Intermediaries (since 0.4.0).** Some operators sign as infrastructure for other parties'
agents; Cloudflare calls them "intermediary", as opposed to "direct". A registry entry with
`intermediary: true` (Browserbase, Kernel, Cloudflare Browser Run and Shopify Cloudsurf in the default registry) verifies like any other
signature, but its purpose is always `intermediary`: the verified operator is the signing
infrastructure, never the agent's identity, and a contradictory UA claim cannot change that.
[Browserbase](https://docs.browserbase.com/platform/identity/web-bot-auth) signs its
customers' browser sessions (beta, enabled per account), so `browserbase|signature_valid|intermediary|…`
means "a Browserbase-hosted browser, agent not identified". When a request carries a valid
direct signature and a valid intermediary signature (for example the draft-01 Appendix D.2
shape), the direct identity is reported in `verified`, regardless of header order; both
remain in `signatures`. The flag requires a configured `signatureAgent`. DuckDuckGo's signature identity maps to `crawler`, consistent with its
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

The server-side GTM variable template is in development. It uses IP rules and browser signals without cryptographic verification, and loads [pinned jsDelivr rules (`sgtm-rules-v1.1.1`)](https://cdn.jsdelivr.net/gh/Narrativva-Labs/visitor-verdict@sgtm-rules-v1.1.1/dist/sgtm-rules.json). The Node verifier and optional Poppy verifier are separate. See [labelling guidance](../docs/conversion-guidance.md#server-side-gtm-labelling-only) and [passive ad-platform recipes](../docs/ad-platform-recipes.md).

## Verdicts and analytics

The verdict contains claimed known UA tokens and parsed Signature-Agent strings; both remain untrusted claims. A successful `verified` field identifies an operator and method; signature evidence includes keyid, identity and `keyidForm` (`thumbprint` or `kid`). Successful dictionary signatures also report `attribution: 'label' | 'relabeled'` in `verified` and the per-label result; legacy bare-string identities omit it. `signatures` retains per-label results, including peers that fail. Whole-header syntax/resource errors fail before label evaluation. Signature and Signature-Input duplicates stay strict; duplicate dictionary keys in Signature-Agent return none/ambiguous_signature_agent instead of asserting a bad signature. Optional `ip` contains operator/list evidence only, never the client IP.

| verification        | Meaning / reasons                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signature_valid`   | A trusted signature passes policy and crypto: verified.                                                                                                                                                                                                                                                                                                          |
| `signature_invalid` | Cryptographic mismatch of a relevant WBA member against a trusted identity/key (`crypto_mismatch`), or a trusted Poppy proof (`poppy_signature_invalid`). Incomplete, orphan, expired, replayed and unrelated proofs do not establish spoofing.                                                                                                                  |
| `none`              | Indeterminate/untrusted/context failure: untrusted_signature_agent, unknown_keyid, unsupported_component, insufficient_context, unknown_authority, invalid_clock, internal_error, replay_capacity_exhausted, nonce_store_timeout, directory_timeout, deadline_exceeded, ip_evidence_unavailable, cache_miss, reverse_dns_unavailable, ambiguous_signature_agent. |
| `no_signature`      | No WBA signature and no official IP match: signature_headers_absent, ignored_non_wba or reverse_dns_not_confirmed. A relevant failed feed with no match instead returns none/ip_evidence_unavailable. UA alone never verifies.                                                                                                                                   |
| `ip_match`          | No WBA signature presented and a relevant operator-published range matches: official_ip_range_match, or optional FCrDNS: reverse_dns_match.                                                                                                                                                                                                                      |
| `ip_mismatch` | Opt-in unsigned UA claim outside the complete operator IP union: official_ip_range_mismatch. IP trust and successful source refresh within 2 h determine certainty; never verified identity. |

Other/absent signature tags are reported per-label as none/ignored_non_wba and do not suppress IP matching or override an indeterminate WBA peer. A malformed SF header can still fail before tag selection.

Selection is pure and tested: a valid direct signature wins; otherwise a definitive cryptographic mismatch wins over a valid intermediary, followed by indeterminate. An invalid presented signature never becomes ip_match, though independent IP evidence is attached after evaluable signature failures. Early malformed/resource/context failures avoid further fetches. Unknown WBA Signature-Agent identities trigger no network I/O. Identity claims attached only to ignored non-WBA signatures do not restrict independent IP checks. Unsupported dictionary members are untrusted for their label without poisoning valid peers.

Version 0.3.0 replaces the public `toAnalyticsFields` API with pure `visitorLabels({ verdict?, browserClass?, browserPhase?, browserAgent?, browserAgentClaim? })` (`browserAgent` since 0.3.5). It returns exactly two GA4 event parameters; register both as **event-scoped custom dimensions** (`customEvent:vv_type` and `customEvent:vv_detail` in the Data API).

| `vv_type`             | First matching evidence                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot_spoofed`         | Server `signature_invalid`                                                                                                                                                       |
| `agent_verified`      | Server `signature_valid`/`ip_match`, purpose `user_directed` or `unknown`. `verifiedByCapture: false` integrations lack local wire confirmation; identity does not prove intent. |
| `automation_verified` | Trusted intermediary signature: platform identity (Browserbase, Kernel, Cloudflare Browser Run, Shopify Cloudsurf); downstream agent and purpose unknown.                        |
| `crawler_verified`    | Server `signature_valid`/`ip_match`, purpose `crawler`                                                                                                                           |
| `bot_automation`      | Browser `automated`                                                                                                                                                              |
| `agent_unverified`    | Uncertain `ip_mismatch` without browser `automated`, or browser `declared_agent` (with or without a page marker) or unverified UA/Signature-Agent/`poppy_session` claim                                                                  |
| `bot_suspicious`      | Browser `suspicious`                                                                                                                                                             |
| `human`               | Browser `human`                                                                                                                                                                  |
| `pending`             | No browser class or qualifying server evidence                                                                                                                                   |

**Capture limitation:** 8 of the 9 default WBA signers have `verifiedByCapture: false`: directory checks and synthetic tests do not confirm their actual visitor wire format. Platform signatures can represent QA or scraper workloads; `automation_verified` does not establish an AI shopping agent.

Every verified result (`signature_valid` or `ip_match`) with unknown purpose yields `agent_verified`, never `pending`, even if browser evidence exists. The purpose segment remains `unknown`: `agent_verified` confirms identity and does not by itself establish a user-directed product role. An `intermediary` purpose yields `automation_verified`: the automation platform is verified, while its downstream agent remains unidentified. Older 0.6.0 consumers may still group intermediaries under `agent_verified`; update their allowlists before upgrading. Only an explicit crawler purpose yields `crawler_verified`. Since 0.4.0 an unlisted purpose value in a hand-built verdict becomes `unknown` and is never copied into the label.

`vv_detail` is `operator|verification|purpose|claim|browser_class|browser_phase`, e.g. `openai|signature_valid|user_directed|signature_agent|human|final`. Missing segments are `-`, unknown operator is `none`. With a verdict, claim is `signature_agent` for WBA, `poppy_session` for Poppy, `ua_token` or `none`; `dom_marker` or `dom_host` when a browser page observation supplies the operator (below); unverified purpose is `unknown`; verified purposes are `user_directed`, `crawler`, `intermediary` or `unknown`. Browser classes are `human`, `suspicious`, `automated`, `declared_agent`; phases `initial`, `final`, `agent`. Invalid browser values become `-`. Operators must begin with a lowercase ASCII letter, followed by at most 23 lowercase ASCII letters, digits or underscores; invalid/long configured names become `none`, never truncated. Detail is at most 100 characters, with no version segment or raw claims.

`browserAgent` (since 0.3.5) is the operator a browser detector observed from a page marker, for example an in-browser agent's own DOM element. Only `openai` and `anthropic` are accepted; any other value is ignored. `browserAgentClaim: 'dom_host'` preserves the experimental browser host heuristic separately from an exact `dom_marker`; omitted or unknown claims retain the legacy `dom_marker` value. Both require `declared_agent` and an accepted browser operator, remain unverified and never override server evidence. The host heuristic can have false positives and should be analyzed separately. Operator precedence:

1. A verified identity (`signature_valid` or `ip_match`) always supplies the operator and the claim from server evidence. A conflicting marker is ignored: an OpenAI signature with an Anthropic marker stays `openai|signature_valid|…|signature_agent|…`, `agent_verified`.
2. `signature_invalid` stays `bot_spoofed` with operator `none`; a marker does not name an operator for a failed signature.
3. Otherwise, with browser class `declared_agent` and an accepted marker, the marker supplies the operator and claim becomes `dom_host` when explicitly supplied, otherwise `dom_marker`, replacing an unverified UA or Signature-Agent claim, so the claim segment names the source of the operator. The type stays `agent_unverified`. Example without server evidence: `openai|-|-|dom_marker|declared_agent|agent`.
4. A marker with any other browser class is ignored.

The helper is stateless. Collectors can retain the strongest type per session without delaying hits: ranks are pending=0, human=1, bot_suspicious=2, agent_unverified=3, bot_automation=4, bot_spoofed=4.5, automation_verified=4.75, direct crawler_verified=agent_verified=5. Fresh equal-rank evidence replaces the earlier type, operator and verified purpose. An intermediary never replaces active direct evidence. Same-type/same-operator/same-purpose renewal never shortens active expiry; lower-ranked inherited hits do not extend it. Verified sticky expiry is capped to the accepted proof deadline and the configured TTL. A collector may give detected replay its own per-hit retention policy; replay is now `none`, and malformed or incomplete proofs do not assert spoofing. Existing collectors must review their sticky evidence rules. Verification, claim and browser detail describe the current hit; an inherited verified operator also carries its purpose (including intermediary). Detail can use a previously known operator (verified, or since 0.3.5 a page marker's operator inherited with a stronger `agent_unverified` type). Scope full events to client_id + session_id and denied pings to page_id + client_id, with a bounded memory-only LRU/TTL and no stored IPs.

### Evidence versus identity (0.4.0)

The operator segment has exactly two sources in `visitorLabels`, and the same detail always says which:

| Operator source                            | Verification segment                                               | Claim segment                                           | `vv_type`                                                     |
| ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------- |
| Verified WBA signature                     | `signature_valid`                                                  | `signature_agent`                                       | `agent_verified` / `crawler_verified` / `automation_verified` |
| Verified IP range or FCrDNS                | `ip_match`                                                         | `ua_token` (the claim that selected the feed) or `none` | `agent_verified` / `crawler_verified`                         |
| Verified Poppy session                     | `signature_valid`                                                  | `poppy_session`                                         | `agent_verified`                                              |
| Browser page marker (observed, unverified) | anything except `signature_valid`, `ip_match`, `signature_invalid` | `dom_marker` or `dom_host`                              | `agent_unverified`; mismatch: `bot_spoofed` if certain, otherwise `bot_automation` for automated browser |
| Nothing else                               | any                                                                | any                                                     | operator is `none`                                            |

A UA token or an unverified Signature-Agent value is a claim: it sets the claim segment and can make the type `agent_unverified`, but it **never** names an operator. An exhaustive test enforces this table. A collector that keeps a sticky operator per session (Vanilla does) inherits it together with the stronger type that established it, so on such a hit the type, not the current hit's verification segment, tells the source: `agent_verified`/`crawler_verified`/`automation_verified` means a verified operator; `agent_unverified` with an operator means a browser observation (`dom_marker` or `dom_host`).

**Count verified operators with `vv_type` in `agent_verified`, `crawler_verified`, `automation_verified`**, or per hit with the verification segment `signature_valid` or `ip_match`. Exclude purpose `intermediary` when counting the agents themselves. `vv_detail` beginning with `openai|` alone also matches marker-named sessions. In Looker Studio derive operator with `REGEXP_EXTRACT(vv_detail, '^([^|]+)')` and its source with
`CASE WHEN vv_type IN ('agent_verified','crawler_verified','automation_verified') THEN 'verified' WHEN REGEXP_EXTRACT(vv_detail, '^([^|]+)') != 'none' THEN 'browser_claim' ELSE 'none' END`.
Browser/GTM-only sites keep `traffic_class` for now; their `traffic_agent` is always a page marker, never verification.

Do not forward the entire diagnostic verdict or raw requests to GA4/sGTM. Do not use these signals for pre-consent advertising.

## Signature profile and key rules

Request-only Ed25519, optional signature alg="ed25519". Required tag="web-bot-auth", keyid, SF **Integer** created/expires, bare @authority or @target-uri, and coverage of present Signature-Agent. Created may be 30 seconds in the future; expires may be 30 seconds behind now; the default maximum lifetime is 86400 seconds. `maxLifetimeSeconds` configures a positive integer lifetime limit; exceeding it returns none/invalid_validity_window (local policy, not proof of an invalid signature). Inverted windows return `none/invalid_validity_window`: failed timestamp policy alone does not establish spoofing. Decimals such as created=1800000000.0 are indeterminate (none/invalid_timestamp_type) per WBA label using lexical type metadata, as discussed in [cloudflare/web-bot-auth#203](https://github.com/cloudflare/web-bot-auth/issues/203). These timestamp rules apply only to Signature-Input metadata; an extension named created/expires in Signature-Agent cannot poison peers.

Both legacy quoted-string (OpenAI) and dictionary forms are supported. Dictionary coverage uses `"signature-agent";key="g"`. Draft-01 §5.2.1/§5.2.2 require signers to cover the member keyed to their signature label; verifiers attribute only to covered members. Intermediaries may relabel Signature and Signature-Input without changing the covered member key (§6.6.1; RFC 9421 §7.2.5). The verifier prefers a covered member matching the current label; otherwise a sole covered keyed member is accepted with `attribution: 'relabeled'`. Several covered keyed members without a current-label match return none/ambiguous_signature_agent, even if they name the same identity. An uncovered member never supplies attribution. A signature may cover several keyed members. Cloudflare web-bot-auth 0.2.0 README examples with ;type=directory members are ignored here (none), as required by draft-01. Protocol-01 §5.2.1 forbids member parameters. All parameterized members are therefore ignored for identity, including both `type=directory` (SF Token) and `type="directory"` (SF String); neither is normative in that revision. Legacy quoted-string compatibility remains explicit. Each field line is trimmed by SP/HTAB before comma-space joining. Other control characters are rejected; raw field strings are interpreted as Latin-1 octets (0–255); Unicode above 255 is rejected. Unwrapped non-ASCII covered fields return none/non_ascii_component, per RFC 9421 §2.5. Binary wrapping via `;bs` base64-encodes each trimmed field occurrence using Latin-1 bytes, never UTF-8, before combining. The final ASCII base is encoded explicitly as ASCII.

A covered ordinary header absent from the request headers returns
`none/unsupported_component`, rather than `required_component_missing`.

Components supported: @authority, @method, @target-uri, @path, @query (raw query prefixed by ?, or ? when absent), @scheme (https for the configured HTTPS authorities); bare/member Signature-Agent; since 0.4.0 keyed members of Signature-Input and Signature (`"signature-input";key="x"`, `"signature";key="x"`, RFC 9421 §2.1.2), so an outer signature that covers another label's signature per draft-01 §5.2.2 and Appendix D.2 verifies; ordinary lowercase RFC 9110 tchar header names (including dots, underscores and leading digits), bare or with `;bs`. In 0.6.1 a missing keyed Signature-Input/Signature member returns none/required_component_missing; a wrong RFC 9421 member shape returns none/malformed_signature. These failures prevent verification under RFC 9421 §2.1.2, but do not prove a cryptographic mismatch against a trusted identity. Signature values must be byte sequences (ArrayBuffer in structured-headers 2.1.1); Signature-Input values must be inner lists of string component identifiers. Integral Decimals anywhere in either covered member (including extension and component parameters) return none/unsupported_component because the parser loses their type on serialization. Decimal timestamps on the evaluated label return none/invalid_timestamp_type; fractional non-timestamp Decimals that serialize faithfully remain supported. Self-coverage and unkeyed/binary-wrapped Signature-Input/Signature are unsupported rather than ordinary-header fallbacks. Each label prefers its own covered Signature-Agent member (sole-member relabeling remains supported): an outer signature covering two keyed members is attributed to the one keyed by its own label, as argued in [cloudflare/web-bot-auth#202](https://github.com/cloudflare/web-bot-auth/issues/202). Unsupported covered components are never omitted. Covered content-digest returns none/insufficient_context: body integrity is outside this API.

Directories may contain up to 32 keys. Structural problems, ambiguous aliases, or **any private d** reject the directory. Unsupported/invalid public keys are skipped independently. Supported keys: OKP/Ed25519, canonical 32-byte x, alg absent/EdDSA/Ed25519, use absent/sig, key_ops absent or containing verify. Each key is indexed by its RFC 7638/RFC 8037 thumbprint. A registry `allowKidAlias: true` explicitly enables custom kid compatibility; only Google has that flag in the default registry. Cache entries retain keys by thumbprint, and alias selection is operator-scoped. Google uses short custom kids; the live Google fixture is tested. JWK nbf/exp are checked on every use, even on cache hits. An expired/inactive key never establishes validity.

Default analytics verification stores no nonce. Optional NonceStore receives a 64-character hex SHA-256 digest of the JSON tuple of identity, thumbprint and nonce only after crypto success, TTL through expires + 30 seconds. It is caller-owned storage and an explicit change to default privacy/replay behavior. Use atomic shared storage across instances and do not log keys. Calls are time-boxed; the interface cannot forcibly cancel external store work already started. Missing nonce/replay fail; store exceptions are indeterminate. No signature proves integrity of components it does not cover.

A valid direct signature wins over intermediary signatures regardless of header order. Since 0.6.1, if only an intermediary verifies, only a trusted cryptographic mismatch in a WBA peer takes precedence, yielding signature_invalid and bot_spoofed with operator none. Replay and incomplete evidence do not override a valid intermediary. Per-label successes remain available in signatures; signing infrastructure cannot hide a failed direct identity. A valid direct signature still wins over invalid peers.

## Network, retention and resource limits

Signature-Agent, Signature-Input and Signature dictionaries are parsed once per request and reused for covered keyed members. Ed25519 signature length is checked before base construction or directory access. Existing four-label/32-component and aggregate-header limits remain in force. Only exact HTTPS registry endpoints are fetched, without credentials, fragments, alternate ports or redirects. Require status 200 and unchanged response URL. Streaming and declared-size limits apply; every rejection aborts/cancels the response, including responses arriving after timeout. All fetchers are injectable; tests never hit the network. Directory proofs are outside request verification; trust rests on the exact configured URL over HTTPS.

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

## Upgrade to 0.6.x

Version 0.6.1 has nine WBA directories, plus two Poppy documents when enabled (11 warm targets). Permit outbound HTTPS on port 443 to these exact hosts as needed by the default registry:

`agent.bot.goog`, `api.manus.im`, `assistbot.duckduckgo.com`, `chatgpt.com`, `claude.com`, `cloudsurf.shopify.io`, `developers.google.com`, `duckduckgo.com`, `index.commoncrawl.org`, `mistral.ai`, `muse.ai`, `openai.com`, `search.developer.apple.com`, `search.seznam.cz`, `searchadvisor.naver.com`, `web-bot-auth.cloudflare-browser-rendering-085.workers.dev`, `www.bing.com`, `www.browserbase.com`, `www.kernel.sh`, `www.kimi.ai`, `www.perplexity.ai`.

Poppy uses only the pinned `muse.ai` metadata and JWKS URLs. DNS egress to the configured resolver is needed only when reverse DNS is enabled. Blocked sources produce incomplete evidence; traffic remains labelled and forwarded. Muse attribution remains provisional and may be omitted from a custom registry.

Browserbase uses intermediary: true rather than a purpose mapping: purposePolicies.browserbase and its default-registry purposes field were removed in 0.4.0. PurposePolicy now excludes intermediary at compile time as it already did at runtime. The flag applies to signature evidence only; separate IP/rDNS evidence, if configured, follows its own documented product mappings. A simultaneous signature purpose mapping and intermediary flag is rejected. Meta crawler UA claims share the meta operator entry with Muse but have no IP/rDNS verification configured; future feeds must use separate per-feed/per-token purpose mappings, not Muse's signature purpose.

## Operator coverage and sources (checked 2026-11-23)

**Signing operators (re-checked 2026-11-23; additions checked 2026-11-23).** Each directory below was fetched live over
HTTPS (status 200, no redirect, `application/http-message-signatures-directory+json`), parsed
as a JWKS-style directory of public Ed25519 keys only, and its own directory signatures
(draft-meunier-webbotauth-httpsig-directory, tag `http-message-signatures-directory`) were
checked as interop evidence; the verifier itself trusts only the configured URL.

| Identity                                                                    | Keys                       | Directory proofs              | Notes                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | -------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://muse.ai` (Meta Muse, new)                                          | 2, thumbprint kids         | 2/2 valid, `"@authority";req` | Fixture `muse-directory-2026-11-22`. Meta has not documented this identity; DataDome observed Muse moving its signing from www.meta.com to muse.ai (7–9 Nov 2026) and signing only part of its requests                                                                                                                 |
| `https://www.kernel.sh` (0.5.0)                                             | 1, thumbprint kid, nbf/exp | 1/1 valid, `"@authority";req` | Owner-supplied live directory 2026-11-23; intermediary                                                                                                                                                                                                                                                                  |
| `https://web-bot-auth.cloudflare-browser-rendering-085.workers.dev` (0.5.0) | 3, no kid                  | 3/3 valid, `"@authority";req` | Owner-supplied live directory 2026-11-23; intermediary                                                                                                                                                                                                                                                                  |
| `https://cloudsurf.shopify.io` (0.5.0)                                      | 1, thumbprint kid          | 1/1 valid, `"@authority";req` | Owner-supplied live directory 2026-11-23; intermediary                                                                                                                                                                                                                                                                  |
| `https://www.browserbase.com`                                               | 2                          | 2/2 valid, `"@authority"`     | Unchanged since 2026-11-20; directory also carries `"purpose":"rag"`, which is not used                                                                                                                                                                                                                                 |
| `https://api.manus.im`                                                      | 2, no kid                  | 2/2 valid, `"@authority"`     | Unchanged since 2026-11-20                                                                                                                                                                                                                                                                                              |
| `https://agent.bot.goog`                                                    | 5, short custom kids       | 1 valid (kid `DYiMjA`)        | Unchanged since 2026-11-20. Google documents [Web Bot Auth](https://developers.google.com/crawling/docs/crawlers-fetchers/web-bot-auth) as experimental: `Signature-Agent: g="https://agent.bot.goog"`, Signature/Signature-Input label `g`, only a subset of Google-Agent requests signed, IP verification as fallback |

**Not supported yet.** Amazon Bedrock AgentCore Browser signs only when the customer creates a
browser with `browserSigning` enabled, and its [documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-web-bot-auth.html)
names no public key directory or Signature-Agent value (checked 2026-11-23; arcjet/well-known-bots
lists no verification method for it either). No AWS origin is guessed. The www.meta.com directory
is still live, but no Meta document ties it to a product, so it is not trusted for Muse or any
other Meta token. Kernel, Cloudflare Browser Run and Shopify Cloudsurf are admitted as intermediaries in 0.5.0 after primary-source and live directory checks (below).

**Kimi registry evidence (checked 2026-11-21):** Kimi publishes identical IP prefixes
for `kimi-user`, `kimibot` and `kimi-searchbot`. An `ip_match` therefore proves
only the operator; purpose comes from the claimed UA token selecting the feed
and its purpose mapping. It does not independently verify that product role.

`rDNS` below always means optional FCrDNS, off by default. `claim` means a token is recognized but does not verify anything. All entries have verifiedByCapture=false except OpenAI. Unverified tokens are deliberately included as claims, not assertions that an operator officially uses them. Operator sources and dates are also stored in the registry.

| Operator                        | Tokens / capability in this package                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Primary source                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI                          | ChatGPT-User, OAI-SearchBot, GPTBot, OAI-AdsBot: IP lists; https://chatgpt.com: signature, verifiedByCapture=true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [agent access](https://developers.openai.com/commerce/agent-access), [bots](https://developers.openai.com/api/docs/bots)                                                                        |
| Google                          | Common-crawlers IP + googlebot.com rDNS: Googlebot, Googlebot-Image, Googlebot-Video, Storebot-Google, Google-InspectionTool, GoogleOther, GoogleOther-Image, GoogleOther-Video, Google-CloudVertexBot. Managed-fetchers-google IP: Google-GeminiNotebook, Google-NotebookLM, Gemini-Deep-Research, Google-Pinpoint, Google-Read-Aloud, GoogleProducer, Google-Site-Verification, Google-CWS, FeedFetcher-Google. Google-Agent and Gemini-Deep-Research also map to user-triggered-agents IP. google.com rDNS covers Google-Agent plus all nine managed-fetcher tokens (customer googleusercontent.com excluded). Gemini-Deep-Research remains observed with inferred mapping. https://agent.bot.goog signature with opt-in kid aliases. | [verification](https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests), [agent](https://developers.google.com/crawling/docs/crawlers-fetchers/allow-google-agent) |
| Anthropic                       | Claude-Agent: SAIL IP; ClaudeBot/Claude-SearchBot/Claude-User: bots.json IP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [SAIL](https://claude.com/.well-known/sail), [bots](https://claude.com/crawling/bots.json)                                                                                                      |
| Perplexity                      | PerplexityBot/Perplexity-User: IP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)                                                                                                                       |
| DuckDuckGo                      | DuckAssistBot: IP; provisional https://assistbot.duckduckgo.com signature identity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [operator](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot), [directory](https://radar.cloudflare.com/bots/directory/duckassistbot)                                          |
| Kernel Agent                    | Signature https://www.kernel.sh, purpose `intermediary`; no captured requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [Bots and agents](https://www.kernel.sh/docs/bots)                                                                                                                                              |
| Cloudflare Browser Run          | Signature https://web-bot-auth.cloudflare-browser-rendering-085.workers.dev, purpose `intermediary`; no captured requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [Request headers](https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/)                                                                                           |
| Shopify Cloudsurf               | Signature https://cloudsurf.shopify.io, purpose `intermediary`; no captured requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [Cloudsurf](https://help.shopify.com/en/manual/intro-to-shopify/bots/cloudsurf)                                                                                                                 |
| Browserbase                     | Intermediary (signing infrastructure): https://www.browserbase.com signature, purpose `intermediary`; no captured requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [Web Bot Auth](https://docs.browserbase.com/platform/identity/web-bot-auth), [directory](https://radar.cloudflare.com/bots/directory/browserbase)                                               |
| Manus                           | Provisional signature origin https://api.manus.im; no captured requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [Manus](https://radar.cloudflare.com/bots/directory/manus-bot)                                                                                                                                  |
| Meta Muse                       | Provisional signature origin https://muse.ai (operator `meta`); Muse signs only part of its requests; no captured requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [DataDome observation](https://ppc.land/metas-muse-agent-gains-a-signed-id-in-a-quiet-test-datadome-finds/), [Muse](https://muse.ai/blog/poppy-personal-agent-protocol)                         |
| Apple                           | Applebot: JSON IP + applebot.apple.com rDNS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [Applebot](https://support.apple.com/en-sg/119829)                                                                                                                                              |
| Microsoft                       | bingbot: JSON IP + search.msn.com rDNS; AdIdxBot/BingPreview/MicrosoftPreview/BingVideoPreview: claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [Bingbot](https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26)                                                                                                                  |
| Mistral                         | MistralAI-User/MistralAI-Index: separate JSON IP feeds; MistralAI-Training: claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [robots](https://docs.mistral.ai/robots)                                                                                                                                                        |
| Moonshot Kimi                   | KimiBot/Kimi-SearchBot/Kimi-User: three separate JSON IP feeds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [policy](https://www.kimi.ai/policies/kimi-crawlers)                                                                                                                                            |
| Common Crawl                    | CCBot: JSON IP (top-level synctoken/notes ignored) + crawl.commoncrawl.org rDNS for v4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [CCBot](https://commoncrawl.org/ccbot)                                                                                                                                                          |
| Seznam                          | SeznamBot: JSON IP + seznam.cz rDNS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [crawler](https://o-seznam.cz/napoveda/vyhledavani/en/seznambot-crawler/)                                                                                                                       |
| Naver                           | Yeti/Ads-Naver/Blueno: JSON IP + naver.com rDNS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [firewall guide](https://searchadvisor.naver.com/guide/seo-basic-firewall)                                                                                                                      |
| Kagi                            | Kagibot: four static IPv4 addresses + kagibot.org rDNS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [bot](https://kagi.com/bot)                                                                                                                                                                     |
| Baidu                           | Baiduspider: baidu.com/baidu.jp rDNS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [verification](https://help.baidu.com/question?class=476&id=2996&prod_id=99)                                                                                                                    |
| Petal                           | PetalBot: petalsearch.com/aspiegel.com rDNS; the primary guide's step names aspiegel.com while its worked example uses petalsearch.com                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [guide](https://webmaster.petalsearch.com/site/petalbot)                                                                                                                                        |
| Yandex                          | YandexBot/YandexAdditional: yandex.ru/yandex.net/yandex.com rDNS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | [verification](https://yandex.com/support/webmaster/en/robot-workings/check-yandex-robots)                                                                                                      |
| Amazon crawler family           | Amazonbot/Amzn-SearchBot/Amzn-User: claim; HTML-wrapped address documents are not registered as JSON feeds; crawl.amazonbot.amazon not confirmed at the current primary source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [Amazonbot](https://developer.amazon.com/amazonbot)                                                                                                                                             |
| Amazon Ads                      | AmazonAdBot: amazonadbot.com rDNS; HTML-wrapped address document not registered as a JSON feed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [AdBot](https://adbot.amazon.com/)                                                                                                                                                              |
| Meta crawlers                   | meta-externalagent/meta-externalfetcher/meta-webindexer: claim only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [crawlers](https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers)                                                                                                       |
| You.com                         | YouBot: claim only pending exact Signature-Agent confirmation; live directory existence supplied by owner is not proof of its wire identity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | [directory listing](https://radar.cloudflare.com/bots/directory/youbot)                                                                                                                         |
| Sogou                           | Sogou (matches Sogou web spider): claim; crawl.sogou.com not confirmed in the retrieved primary guide                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [guide](https://www.sogou.com/docs/help/webmasters.htm)                                                                                                                                         |
| ByteDance                       | Bytespider/TikTokSpider: claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [webmaster](https://zhanzhang.toutiao.com/)                                                                                                                                                     |
| DeepSeek / Zhipu / Shenma / 360 | DeepSeekBot/ChatGLM-Spider/YisouSpider/360Spider: claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [DeepSeek](https://www.deepseek.com/), [Zhipu](https://chatglm.cn/), [Shenma](https://zhanzhang.sm.cn/), [360](https://www.so.com/help/spider_ip.html)                                          |
| Diffbot / Timpi                 | Diffbot/Timpibot: claim; no verification capability confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [Diffbot](https://docs.diffbot.com/reference/crawl-faq), [Timpi](https://timpi.io/)                                                                                                             |

Kagi's checked static addresses are 216.18.205.234, 35.212.27.76, 104.254.65.50 and 209.151.156.194. They require manual review when the operator changes its page. `staticPrefixes` is configuration, never scraped from a request; total static ranges are capped at 8192 and gated by the operator's explicit extraUaTokens. Registry extra tokens extend claim detection without editing the browser list; tests keep browser tokens a subset.

Chinese-operator coverage is uneven. Kimi publishes separate machine-readable feed endpoints with identical prefixes as checked on 2026-11-21; their names do not independently prove product purpose. In this registry Baidu and Petal can use optional FCrDNS; Sogou, ByteDance, DeepSeek, Zhipu, Shenma and 360 remain claims. No crawler identity or verification method is inferred for a separate AI product simply from its brand. A claim-only result is not a verified operator and does not establish that a visitor is human.

Amazon's primary pages show JSON examples embedded in HTML: Amazonbot/Amzn-User/AdBot use ipv4Prefix examples, SearchBot uses ip_prefix. A raw JSON response endpoint could not be confirmed, so no second JSON shape or HTML scraper was added. You.com's docs were unavailable here: exact Signature-Agent, the reported 68.67.112.0/24 range and search.you.com suffix remain unconfirmed and disabled. The operator-confirmed directory contains public key material but does not independently prove the wire identity. No You.com signing origin is guessed. Sogou's suffix and crawl.amazonbot.amazon remain disabled for lack of current primary documentation; Petal's two suffixes are both present in its indexed primary guide. Claims without public verification docs are explicitly not promoted to network evidence.

The generic Google user-triggered-fetchers feed has an empty token mapping; it does not verify Google-CloudVertexBot. SAIL uses the supplied strict TOML schema, resolves services to prefix sets, and honours bounded expires_after retention. Unknown syntax, keys, duplicate fields, invalid ranges and dangling references reject the feed. AWS signing remains unsupported until an exact deployment directory and wire identity are confirmed. Browser Run is configured as signing infrastructure in 0.5.0. Own-browser agents and partial Google signing remain limits.

Standards: [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html), [RFC 7638](https://www.rfc-editor.org/rfc/rfc7638), [RFC 8037 A.3](https://www.rfc-editor.org/rfc/rfc8037#appendix-A.3), [RFC 9864](https://www.rfc-editor.org/rfc/rfc9864), evolving [WBA draft](https://www.ietf.org/archive/id/draft-ietf-webbotauth-httpsig-protocol-01.txt). The supported compatibility policy is documented here; this is not a claim of full RFC/draft conformance.

Own code: MIT, LICENSE. Cloudflare fixtures: Apache-2.0, pinned commit and licence in test/fixtures/NOTICE.md. RFC code examples: test/fixtures/IETF-NOTICE.txt, linked from the interop test. Dependency licences stay with installed packages. Fixture hashes cover local copies; live public directories and approved sanitized capture fixtures are test data, not a request logging facility.

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

### Local replay enforcement (0.3.3)

`new MemoryNonceStore(capacity = 10000, now = () => Date.now() / 1000,
perOperatorCapacity = Math.max(1, Math.floor(capacity / 4)))` supports
`cacheOnly: true`, including duplicated package instances. Use the same clock as
the verifier. Replay keys are SHA-256 digests of the canonical identity, key
thumbprint and nonce. Existing persisted external-store keys change at upgrade;
retain old history or drain the signed validity window before switching formats.

Lookup is constant time; an expiry heap removes only expired entries. The total
budget and each operator budget fail closed with `none/replay_capacity_exhausted`,
without evicting live history. `status()` returns occupancy, capacity, operator
budget, saturation and exhaustion count, without replay keys or identities.
Status reads reclaim expired entries using the store clock; use the same clock as
the verifier for status and direct inserts.
Each operator has a ceiling, not a reserved partition; multiple operators can
fill the global budget and prevent another operator from inserting. Direct two-argument inserts share a
single unnamed operator budget. Optional third-argument `{ scope, expiresAt, now }`
supplies an operator scope, absolute Unix-second retention floor and clock snapshot.

Verifier inserts retain history through signed expiry plus 30 seconds inclusive,
using the absolute deadline and verifier clock snapshot across verifier calls.
Direct two-argument inserts and status reads use the store clock: an ahead-of-verifier
clock can expire that history prematurely, so all callers must share a compatible clock. External stores
receive the usual relative TTL and must use a compatible clock. They remain
unavailable in cache-only verification. Local inserts need no timeout timer.

Valid direct signatures take precedence; otherwise cryptographic mismatches precede
intermediary evidence, followed by indeterminate candidates (replay first). Successful signature evidence includes `verified.expiresAt` (Unix
seconds without skew), so callers can cap derived evidence.

## Header consistency (0.5.0)

`AgentVerdict.evidence` optionally contains `header_mismatch`, a weak local
diagnostic independent of verification, reason, identity and purpose. It never
changes `visitorLabels`, never creates `agent_verified` or `bot_suspicious`, and
is not exported in `vv_detail`. No raw headers are returned, cached or retained.

Set `AgentRequest.secure: false` for plain HTTP, and `headerDiagnostics: false`
behind proxies/CDNs that strip Sec-\* headers or for privacy/enterprise policy
deployments. The default assumes the API external HTTPS contract. Brave uses a
Chrome UA and cannot reliably be excluded by UA; disabling diagnostics is the
explicit escape hatch. Known embedded, iOS, wrapper and derivative tokens and
crawlers are skipped. Linux UA with Android platform is allowed for desktop-site mode.

Within the API's external HTTPS contract, checks apply only to Chrome/HeadlessChrome
and Chromium Edge claims with recognizable navigation/resource context: Fetch Mode
navigate, a known Fetch Dest, or GET accepting text/html without non-navigation Fetch Metadata (a navigation-shaped
claim, not proof of navigation). Arbitrary collector POSTs and ambiguous _/_
requests are skipped. Site/Mode start at Chrome 76 / Edge 79; Dest at 80; default
Sec-CH-UA and Sec-CH-UA-Mobile at 89, Sec-CH-UA-Platform at 93. No high-entropy hints or Sec-Fetch-User
are required. Hints are expected only for top-level navigation-shaped requests
or same-origin subresources, avoiding iframe and cross-origin Permissions Policy
suppression. Recognized platforms are compared with Windows, Android, Chrome OS,
macOS or Linux in the UA. iOS, explicit WebViews and known privacy derivatives
are skipped; Firefox/Safari are outside scope.

Unmarked privacy browsers, enterprise policies, extensions, UA overrides, CDNs
and proxies can alter these defaults. False positives are expected; therefore
this evidence does not affect classification. Consistent headers are easy to copy
and do not prove humanity. Adapters must supply original headers and trusted HTTPS
context; never infer identity from unchecked forwarding headers. Vanilla already
passes rawHeaders and keeps its existing TRUST_PROXY handling.

Sources: [Chromium low-entropy defaults](https://developer.chrome.com/docs/privacy-security/user-agent-client-hints),
[Fetch Metadata version support](https://web.dev/articles/fetch-metadata).
Fixtures are representative protocol examples, not browser captures; headless
Chrome with complete headers intentionally has no mismatch.

## Intermediary signers (0.5.0, checked 2026-11-23)

The owner supplied live curl HTTPS directory bodies and response headers for all
three operators (HTTP 200, application/http-message-signatures-directory+json).
All five authority-binding Ed25519 directory proofs verify using published JWK
thumbprints. These proofs cover only `"@authority";req`, not a Content-Digest or
the body; runtime trust remains the exact configured HTTPS URL. JSON fixture bodies
are unchanged; response cookies and unrelated metadata were omitted from header
fixtures. No signed visitor request has been captured: `verifiedByCapture: false`.

| Operator ID              | Signature-Agent / directory origin                                | Keys / valid proofs | Primary documentation                                                              |
| ------------------------ | ----------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `kernel`                 | https://www.kernel.sh                                             | 1 / 1               | https://www.kernel.sh/docs/bots                                                    |
| `cloudflare_browser_run` | https://web-bot-auth.cloudflare-browser-rendering-085.workers.dev | 3 / 3               | https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/ |
| `shopify_cloudsurf`      | https://cloudsurf.shopify.io                                      | 1 / 1               | https://help.shopify.com/en/manual/intro-to-shopify/bots/cloudsurf                 |

Each exact directory URL appends `/.well-known/http-message-signatures-directory`
to the listed origin. All three set `intermediary: true`: valid signatures report
`automation_verified` with purpose `intermediary`, identifying infrastructure rather
than the customer's agent. Unsigned UA/Signature-Agent or page-marker claims never
replace this purpose; valid direct signatures retain precedence. Kernel Search
has a separate direct crawler identity and is outside this addition. No custom kid
aliases are enabled. Kernel's published key has short nbf/exp validity; the verifier
rechecks it per use and an expired cached key never verifies a request.
Unknown or inactive keys request a bounded, cooldown-protected refresh, also in
cacheOnly mode (asynchronously). During rotation, verification is `none` with
`cache_miss`/`unknown_keyid`, not `signature_invalid`; analytics retains
`agent_unverified` rather than `bot_spoofed`. There is no `unavailable` vv_type.
This is missing verification evidence, never proof of spoofing.

The default registry now has **nine directories** (six previously). Add outbound
HTTPS access to all three origins above; a blocked directory can leave health at
8/9 with a failed refresh. No hit is held or excluded. The 0.4.1 5/6 examples above
are historical. Tests cover exact registry endpoints, generated valid, wrong-key,
unknown-key, expired and replayed requests for each signer, direct-signature
precedence, unsigned claims and all live directory proofs at capture time.

Cloudflare's current workers.dev origin may be blocked by corporate egress policies.
It is an exact preview hostname, not trust in all workers.dev tenants. Trust depends
on HTTPS/domain control: directory proofs do not bind the body. A moved or released
hostname needs an explicitly reviewed registry update; no redirects or automatic
origin migration are trusted. No real signed visitor captures exist for these three
operators; synthetic tests and directory proofs do not establish their wire format.

GA4 reports distinguish `automation_verified` from direct `agent_verified` in 0.6.1.
Historical data needs the third `vv_detail` segment to separate `intermediary`. Infrastructure signatures identify the
browser service and may represent QA tools, scrapers or any customer workload.

Platform-default release source: [Chrome 92 Enterprise release notes, upcoming Chrome 93](https://storage.googleapis.com/support-kms-prod/LrD0vGFF3FFxwwScrfThxc6dRMNG3bTBFJEF).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

### Static rules for server-side GTM

From the repository root, run `npm --prefix server run build` followed by
`node scripts/build-sgtm-rules.mjs`. This writes `dist/sgtm-rules.json` using the
registry's exact order, UA gates, purpose policies, static ranges, JSON IP feeds
and SAIL services. IPv4 ranges are sorted/merged integer intervals per evidence
group; IPv6 prefixes use normalized hexadecimal network addresses and bit lengths.
No request or visitor data is involved. The serialized output must fit 200,000 bytes.

Every upstream feed must succeed before the output is replaced. Archived public
source documents can be supplied with `--source-dir DIR` using file names
`<operator>--<list>.txt`. `--output FILE` supports isolated validation.
`--allow-partial` is for offline development only: its artifact explicitly records
`complete: false` and missing sources and must not be published as a release feed.
Run `node scripts/test-sgtm-rules.mjs` for offline export/SAIL/size-guard tests.

Publish a reviewed, complete feed under an immutable public repository tag such as
`sgtm-rules-v1.1.1`; the companion sGTM template reads
`https://cdn.jsdelivr.net/gh/Narrativva-Labs/visitor-verdict@sgtm-rules-v1.1.1/dist/sgtm-rules.json`.
Pinned rules do not update automatically; operators must publish a new tag and
marketers must select it to refresh their data. This is a local feed builder, not
a deployment or publishing command.

## Optional Poppy 1.0 verification (0.6.0)

Enable with `poppy: { enabled: true }` in `createVerifier` and provide an injected
`fetcher`. Default is off. This web adapter verifies signed-out requests only,
using the request's HTTPS origin as the Company identifier (no OAuth issuer).
Supply the original `method`, `host`, `target` and `Poppy-Session` / `Poppy-Version`
headers through the trusted transport adapter. The default registry pins Muse's
`https://muse.ai/poppy/agent.json` and `https://muse.ai/poppy/jwks.json` under the
provisional operator `meta`. Custom registry entries require both `poppyClientId`
and `poppyJwksUri`, on the same exact hostname. Metadata must repeat both URLs.
The injected transport must validate TLS, honor manual redirects and refuse
loopback/private/link-local resolved addresses, including DNS rebinding. Request
claims cannot add fetch destinations. Do not use a permissive fetcher for custom
registries. No discovery document or OAuth server is installed or fetched.

[Poppy 1.0 §4.1 and §5.2–5.3](https://personalagentprotocol.org/docs/1.0/spec#session-header)
requires an ES256 Session JWT and an ES256 or PS384 delegation signed by the
agent's published key. Direct root-key session signatures are unsupported.
Delegations last at most 24 hours; Session JWTs have no `exp`. This adapter checks
`iat` within ±60 seconds, exact origin audience, method, URL without query or
fragment, public P-256 delegated key and RFC 7638 thumbprint. Delegation `iat`
allows up to 60 seconds of future clock skew; `exp` must still be after verification
time and at most 24 hours after `iat`. Compatible `Poppy-Version: 1.x` headers
(major.minor, at most 32 characters) are verified using only the 1.0 rules (§3.4). Unknown algorithms, clients, keys, malformed claims and unavailable
documents remain unverified. A cryptographic mismatch against a declared agent's
known key is `signature_invalid`, mapped to `bot_spoofed` like WBA. Replay and
truncated ES256 signatures remain `none` (`poppy_replay` / `poppy_malformed`),
without spoofing attribution.

Documents use the WBA cache: 64 KiB bodies, at most 32 JWKS keys, configured fetch
timeout and verification deadline, stale bounds, coalescing and 60-second failure
backoff. Unsupported public JWKS entries are skipped; private key members reject
the whole document. Supported root `KeyObject`s are imported once per refresh;
delegated public `KeyObject`s use a bounded cache of 128 entries. Unknown key IDs
trigger one throttled refresh. A mismatch of a known root kid also attempts one refresh before reporting a cryptographic failure. Failed, cooldown-suppressed or cache-only mismatch refreshes remain indeterminate. `warm()` includes the two
pinned documents only when Poppy is enabled; cache-only mode can verify warmed
keys. JWTs are limited to 16 KiB with bounded JSON depth and duplicate JSON members
rejected. Process-local replay storage holds hashes through the acceptance window,
with 10,000 total and 2,500 entries per operator; capacity failures are unverified.
By default each verifier owns this store, protecting only one long-lived verifier instance in one replica. Configure `poppy: { enabled: true, replayStore }` with the same atomic `NonceStore` interface as WBA for multiple workers/replicas. Keys use a `poppy:` namespace and hashed issuer, audience and jti; retain them for the supplied TTL. Store failures/timeouts return `none`; cache-only mode never calls an external store.
Poppy runs after other asynchronous evidence. Its request signal and absolute
monotonic deadline are checked between document/crypto stages and before replay
insertion, so timed-out work cannot consume a nonce. A shared cache refresh may
finish for future requests, but aborted Poppy work starts no follow-up fetch.

A valid direct WBA proof wins attribution ties with Poppy; valid Poppy wins over a
valid intermediary WBA signer. A valid direct proof wins over an invalid peer;
invalid proof wins when only intermediary infrastructure verifies. Poppy proofs
use the existing signature outcome policy, ahead of IP/DNS: IP cannot rescue an
invalid or indeterminate presented Poppy proof. This preserves WBA's conservative
fallback policy. Structurally malformed WBA headers still fail the existing outer
request parser before Poppy evaluation.

Only operator identity is verified. There is no user/account authorization,
action approval, session continuity/end-state lookup or browser-cookie validation.
Authorization headers and `ath` claims remain unverified because OAuth client
binding is unavailable. Signed-out sessions are fully eligible for operator
verification. `agent_purpose` is conservatively `unknown` for Poppy.
Poppy itself adds no visitor types; 0.6.1 separately adds `automation_verified` for intermediaries; `vv_detail` adds claim `poppy_session` (within 100
characters), while verification remains `signature_valid` / `signature_invalid`
/ `none`. This claim means header presence when unverified, never delegation of
user authority. With a valid WBA winner, the claim is `signature_agent`, even if
a Poppy header is also present. Browser page-marker precedence remains unchanged.
Ambiguous raw targets (backslashes, dot segments or whitespace) remain unverified
with `poppy_request`; URL parsing errors use the same reason.
Diagnostics contain only bounded reason codes, ES256, version and a hash of the
operator's root `kid`; delegated per-user key fingerprints are never returned;
never forward JWTs, subjects or Authorization values to logs or analytics.
Vanilla and downstream sGTM detail allowlists must accept `poppy_session` before
consuming this new claim; their packages are not changed here.

## Verification policy in 0.6.1

`automation_verified` has suggested collector rank **4.75**, above `agent_unverified` (3) and below directly verified agents/crawlers (5). A trusted platform signature is stronger than a copied claim, but does not identify the downstream agent. `visitorLabels` is stateless and does not implement session ranking. This label change affects analytics dictionaries only: the library never excludes or blocks traffic.

WBA requires HTTPS context: explicit `secure: false` returns `none/insufficient_context`. Known mutable kid aliases get one single-flight directory refresh on crypto mismatch, subject to a 60-second cooldown. Without a completed refresh the result is indeterminate; immutable thumbprint keys do not need this rotation fallback. Expiration, retries/replay, malformed headers and missing members return `none`. A valid intermediary is not displaced by incomplete or unrelated members. SAIL `exclusive=false` ranges provide only weak `shared_ip_range` evidence, never `ip_match` or a verified label; `exhaustive=false` does not invalidate a positive exclusive match.

Cache policy deliberately tolerates delayed revocation: HTTP soft TTL is clamped to 300–86400 seconds, including a 300-second minimum for no-cache/no-store. Default hard age is 86400 seconds; stale documents may verify while a background refresh runs. Removed keys/ranges stop verifying after replacement or hard expiry, not immediately when a publisher revokes them. Set `staleMaxSeconds: 0` to disable stale serving, or a small positive hard age to cap retention and soft TTL. This trades availability for a shorter revocation window; no option guarantees instantaneous revocation.

Without WBA `nonceStore`, `agent_verified` confirms a reusable signed statement during its acceptance window, not a fresh client/hit or an unsigned target/IP. `MemoryNonceStore` protects only its owning instance/replica. For replay protection across replicas use a shared atomic store for WBA and Poppy, and keep each verifier long-lived. Legitimate HTTP retries can be replay results and are never by themselves proof of spoofing.

The sGTM JSON exporter retains schema 1 and adds `generated_at` as an ISO serialization timestamp. This timestamp is not proof of feed freshness or revocation checks. Existing consumers can ignore the additive field. sGTM IP rules alone do not verify intermediary signatures; `automation_verified` is a server verification label.

A successful directory fetch awaited during the current request (cold load, joined fetch, forced rotation refresh or mismatch refresh) is reused across WBA members. A mismatch against that fresh document is definitive without a second fetch; its own cooldown never downgrades it. A cached document alone does not count as a fresh fetch. Poppy applies the same rule to its JWKS, requires a single candidate selected by kid before and after refresh, and permits a bounded refresh when the root algorithm changes. Explicit `secure:false` is checked only after selecting a WBA tag; unrelated signatures remain ignored and do not suppress independent IP or reverse-DNS evidence.

## Unsigned UA IP mismatch (server 0.7.0)

`createVerifier({ flagSpoofedClaims: true, ... })` opts into negative IP evidence;
its default is false. Pass `ipTrusted: false` on requests whose client address the
transport adapter cannot establish reliably; direct connections default to true.
Only a recognized UA token with an explicitly `complete: true` IP list is eligible.
`Signature-Agent` alone never triggers the rule. WBA, mixed, incomplete or malformed Signature/Signature-Input headers suppress it.
Exclusively non-WBA signatures (`ignored_non_wba`, another tag) behave as absent
signatures for both positive IP verification and mismatch. Accepted Poppy proof wins.

Initially only OpenAI's ChatGPT-User, OAI-SearchBot, GPTBot and OAI-AdsBot mappings
are marked complete, with source and check date on each feed. The
[OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)
identifies these UAs and publishes their IP lists for site operators to verify
requests. Treating those published lists as complete for those exact tokens is
our explicit registry policy, not cryptographic proof or a claim about every
OpenAI product. Other operators remain disabled. Check the union of **all** feeds
of the claimed operator (and static ranges), including feeds for other UA tokens.
Missing, empty, invalid or hard-expired feeds cannot establish a mismatch.

`ip_mismatch` is the new second segment in
`operator|verification|purpose|claim|browser|phase`. Example:
`none|ip_mismatch|unknown|ua_token|-|-`. It names no verified operator and implies
no verified purpose. `bot_spoofed` requires both `ipTrusted: true` and
`ipListsFresh: true` on the verdict. Every operator feed must have a known last
**successful source refresh** at most 7200 seconds ago (inclusive). The verifier
records this time after HTTPS fetch, parsing and validation finish. Cache reads,
serialization/download of an aggregate cache and failed refresh attempts never
renew it. Missing, invalid or future timestamps are uncertain. `creationTime` in
a publisher document is not a refresh timestamp. Otherwise the result remains
`ip_mismatch` with `agent_unverified`, or `bot_automation` if the browser reports
`automated`. This is negative IP-range evidence, weaker than identity verification.
IP certainty means the collector established the client IP through a trusted proxy
under its `TRUST_PROXY` configuration (or a direct socket with no proxy); arbitrary
X-Forwarded-For values are never trusted. Set `ipTrusted: false` for uncertain paths. Page markers retain their existing bounded operator/claim behavior.

Direct valid signature / IP match outrank a certain mismatch (`bot_spoofed`,
rank 4.5), which outranks browser automation and claims. An uncertain mismatch
never overrides browser `automated`: it yields `bot_automation`; without that
browser evidence it yields `agent_unverified`. This supersedes the earlier sGTM
precedence that let every mismatch override browser automation. Unlike sGTM's current heuristic
that any token-gated nonempty group is complete, this registry deliberately
requires explicit completeness and enables it only for OpenAI. Sticky collectors
rank spoofing at 4.5, below direct verified identity (5).

Negative checks use memory only. Missing feeds start background fetches and do not
assert mismatch; warm with `{ ipLists: true }` to preload the full union. After
600 seconds since successful source refresh (or if its time is unknown), retained
lists trigger one throttled background refresh without
waiting, even if their HTTP max-age is longer. Decisions use the retained list
until the configured hard `staleMaxSeconds` limit (default 24 hours); no failed
refresh extends it. This avoids adding network latency to a negative decision.
