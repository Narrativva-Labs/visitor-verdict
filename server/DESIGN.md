# Verdict model and integration boundary

The library labels traffic and does not itself withhold anything. Conversion policy belongs to the integrator. A claimed identity is independent of evidence. A UA token is spoofable. A valid signature proves possession of a key published at a trusted operator endpoint over the covered components. A published-IP match is weaker evidence of a network range, usually gated by a relevant UA token. Neither result proves humanity, user intent, consent, purchase approval or authorization.

A reusable createVerifier validates and snapshots trusted configuration once and owns its cache. Each request supplies a host that must normalize to an allowed external authority. Unknown/internal/context failures are indeterminate. An unsigned request can never be signature_invalid. The configured authority supplies the signature base; raw Host values are not guessed or compared as alternative candidates. nginx adapters need `proxy_set_header Host $host;`; Caddy normally preserves Host, but deployed configuration must be checked. Do not trust client-controlled forwarded headers or unauthenticated sGTM envelopes.

Target syntax is validated only for covered target components, so an uncovered query ending in % or OPTIONS \* cannot change the outcome. Signed request targets preserve raw path, percent escapes and dot segments, including origin-form //path; absolute HTTPS scheme/authority and empty paths are normalized. No WHATWG path normalization is applied. Only SP/HTAB is removed from field edges; raw header values represent Latin-1 octets. The signature base must be ASCII: plain covered obs-text is rejected, while ;bs wraps each occurrence from its original Latin-1 bytes. Unicode above 255 is rejected rather than silently UTF-8 re-encoded. A linear SF guard prevents duplicate overwrite, Decimal timestamp type loss, misclassification of token colons and quadratic whitespace processing. Aggregation limits apply before parsing. Unsupported components are never skipped; content-digest cannot establish body integrity without body bytes.

Each label is evaluated separately. A valid trusted signature wins, then definitive invalid, then indeterminate. Other/absent tags are ignored_non_wba per label and cannot suppress IP matches or dominate WBA peers. IP evidence is separate and cannot hide a presented invalid WBA signature. Relevant feed failures without a match return none/ip_evidence_unavailable. All parameterized dictionary members (including either type=directory form, forbidden by protocol-01 §5.2.1) are untrusted at that label, not a reason to discard a valid peer. Unknown WBA identities never initiate network access; identity claims tied only to ignored non-WBA signatures do not prevent independent IP checks. Keys use RFC thumbprints; operator kid aliases require allowKidAlias, enabled only for Google by default; the verdict reports which matched. Mixed directories skip unsupported keys but reject structural ambiguity and private keys.

Retention for public verification material is independent of HTTP cache semantics: a nominal 300-second minimum and 24-hour maximum, additionally capped by a positive staleMaxSeconds for all fresh and stale uses, with JWK nbf/exp checked at each use. This intentionally retains public no-store directories long enough for reliable verification, without retaining request headers/IPs/signatures/nonces. After the soft TTL the last validly fetched document is served while one background refresh runs (stale-while-revalidate), up to a hard maximum age (`staleMaxSeconds`, default 24 hours, measured from the fetch). A request never waits for a refresh while usable stale data exists, so slow operator endpoints cannot push requests past their deadline at every refresh. A newer successful fetch replaces the document entirely; a failed refresh keeps the stale document only until the hard maximum. Fresh cached data takes precedence over a separate forced-refresh flight; ordinary/forced refreshes are single-flight independently; cooldown follows failure or forced unknown-key refresh only. Compiled IP BlockLists are reused. Feed fetches run in parallel; the timer starts before work, and per-operation timeboxes bound waiting. The overall deadline is best-effort over bounded synchronous work (method 32, host 2048, target 65536 and clientIp 64 characters). A request deadline does not abort a refresh shared by another request. `warm()` prefetches registry endpoints through the same single-flight loads and reports URLs instead of throwing; opt-in refresh-ahead uses unref'd timers, costs one fetch per warmed endpoint per soft TTL, and is stopped by `close()`.

The captured OpenAI signatures cover authority, method and Signature-Agent. They do not bind path, query, body or the initiating person. Default analytics mode allows replay and stores no nonce. Opt-in NonceStore is a caller-owned atomic replay/privacy choice with bounded calls; it does not authorize actions. Network trust rests on exact configured HTTPS endpoints, not an unauthenticated directory proof. Endpoint compromise/DNS/egress policy remains a deployment responsibility.

Own-browser agents can share a person's normal browser, cookies, UA and IP without signatures. No-signature/none is not human. This verifier does not detect those agents. Anthropic Claude-Agent is documented through IP+UA/SAIL rather than an assumed WBA identity; a strict parser now supports the supplied live SAIL schema and resolves Claude-Agent service ranges; expires_after supplies the bounded retention TTL. Other Claude tokens may use bots.json. Google signing is partial/experimental; generated-key tests prove syntax, not a real signed Google session. Google-CloudVertexBot uses common-crawlers ranges, not generic user-controlled fetcher networks. DuckDuckGo/Browserbase/Manus/Meta Muse have live directory fixtures but no captured request identity; their origin identities remain provisional, with verifiedByCapture=false. Amazon Bedrock AgentCore documents no public directory and is not configured. The README operator table records this distinction.

This package supplies analytics evidence separately from browser traffic_class. It does not verify a human, consent, abuse policy, robots compliance, delegated rights, payload integrity, authorization to buy, or payment authority. Applications still enforce their normal authorization and conversion policy. Services receiving original-request context must authenticate that envelope; their own HTTP request cannot reconstruct the original browser signature.

Registry entries may declare explicit server-only UA tokens (including bingbot and the newly documented/operator-claimed bot tokens), while browser defaults remain an unchanged subset. Applebot and MistralAI-User also have documented JSON IP feeds. A collector normally uses its fixed configured host; Fastify trustProxy can make req.host depend on X-Forwarded-Host. Aggregate reason counters make context/feed faults visible without retaining request data. npm installation of this subfolder package uses an npm pack tarball, not a repository-root git dependency.

Optional FCrDNS is off by default. When explicitly enabled, only bot claims with documented suffix rules and no prior network/signature match can initiate PTR queries. Valid PTR suffixes require a label boundary and a forward A/AAAA address matching the original IP; a copied name is insufficient. Proofs are scoped to eligible operator rules. Default Resolver transport is injectable; four outstanding transactions, bounded answer sizes, hard timeouts, a 1024-entry positive/negative IP LRU and 300-second TTL bound work and retention. DNS is part of the overall best-effort deadline. An injected resolver that ignores cancellation keeps its concurrency permit until it settles, preventing unbounded background requests. Results reuse ip_match with reason reverse_dns_match and method rdns; signatures retain precedence.

This is an explicit privacy exception: PTR discloses the client IP to the chosen resolver and the opt-in cache retains IP keys transiently in memory. No IP or PTR is returned or logged. Default operation still retains no request IP. DNS confirms a network attribution, not authority to act or the exact bot process; Google customer-hosted infrastructure is not equivalent to a Google-operated product. Root conversion policy is unchanged: the library labels, withholds nothing itself, and leaves policy to the integrator.

Feed caching now uses a 32-entry LRU separate from 128 key directories, with 8192 compiled ranges per feed and 8192 total static ranges. This bounds retained feed prefixes at 262144; aggregate admitted bodies at 32 MiB plus 8 MiB of directory bodies (buffer/string/JSON copies add bounded transient overhead). Native representation overhead is not an exact byte budget. Large registries can evict feeds or receive feed_cache_busy, never grow retention without limit. Static Kagi ranges are reviewed configuration, not scraped dynamically.

Kimi, Common Crawl, Seznam, Naver and Mistral index feeds are registered from primary documentation and owner-confirmed JSON responses. Amazon's published address examples are HTML-wrapped, so no guessed raw-JSON endpoint or generic HTML extractor is enabled. You.com directory existence is confirmed, but the docs/wire identity and reported IP/DNS details remain unavailable, so YouBot stays claim-only. Most Chinese-operator entries are claim-only or optional rDNS; Kimi is a documented feed exception. See the README for per-token capabilities and source dates.

The configurable maximum signature lifetime is a local policy: exceeding it yields none/invalid_validity_window. RFC binary encodings are decoded without canonical padding/pad-bit requirements. Ambiguous Signature-Agent dictionary keys yield none/ambiguous_signature_agent; Signature and Signature-Input duplicates remain strict. @query is raw and includes a leading ? (also when absent); @scheme is https from the configured HTTPS context. Draft-01 §5.2.1/§5.2.2 impose matching-label coverage on signers; verifiers never attribute to an uncovered member. Intermediary relabeling is allowed (§6.6.1; RFC 9421 §7.2.5). Prefer the covered member keyed to the current label; otherwise accept exactly one covered keyed member and report attribution=relabeled in successful signature evidence and its per-label result. Several covered keyed members without a current-label match are none/ambiguous_signature_agent. Parameterized identity members from the older Cloudflare README remain ignored under draft-01.

FCrDNS forward confirmation queries only the original normalized IP's family (A for IPv4, AAAA for IPv6). A suffix mismatch requires no forward lookup. Forward NODATA/NXDOMAIN, an empty answer or a different IP are definitive nonmatches: no_signature/reverse_dns_not_confirmed absent stronger evidence. Operational resolver errors and timeouts remain none/reverse_dns_unavailable. Both are cached with the configured TTL; signatures and IP-feed failure precedence remain unchanged. Some real Baidu crawler PTRs have no forward A record, so the published method cannot always confirm them. PTR-only verification is never accepted.

Cache-only request verification (`verify(input, { cacheOnly: true })`) never joins network
flights or waits on a missing directory/feed. It returns none/cache_miss while starting one
background refresh, subject to cooldown and capacity bounds. Fresh and stale returns use the
same hard age boundary, including forced-refresh cooldown fallbacks. A positive hard limit
shortens the effective fresh TTL and refresh-ahead schedule (600-second cap beats a 3600-second
HTTP TTL); zero retains its distinct meaning of disabling stale serving. Static and cached IP
evidence and cryptographic checks remain available. DNS is skipped and a signature needing a
configured external replay store is indeterminate/insufficient_context, never silently exempted
from replay protection. A collector may send without labels on cache_miss; later evidence only
affects later hits. Bounded synchronous parsing/crypto still takes time, but endpoint outages
add no wait to this path.

Purpose is registry product metadata applied only to verified evidence. Signed identities
and purpose-specific feeds take precedence over unsigned UA tokens. Shared-feed token
conflicts and all unverified results are unknown. It does not prove user intent or authorize
conversion routing. Cache health exposes only endpoint counts and the most recent completed
refresh outcome/time; a document can be loaded without an active key. Refresh callbacks carry
kind/outcome/time/hostname/reason only (hostname is public endpoint metadata, never a URL) and cannot affect verification. Logging and rate limiting of
operational warnings belong to the integrator.

Registry provenance uses documented/observed/inferred evidence with source and date.
Purpose attribution retains the winning DNS rule in the bounded DNS cache and
uses only that rule's eligible tokens. Shared-feed tokens with unknown roles
remain part of ambiguity resolution. Google customer cloud DNS is excluded.

## GA4 label API (0.3.0)

`visitorLabels` replaces `toAnalyticsFields` and returns only `vv_type` and `vv_detail`.
It is pure and stores nothing. Invalid signatures take precedence, followed by verified
identities (crawler purpose gives `crawler_verified`; `user_directed` or `unknown` gives
`agent_verified`), browser automation, unverified claims, suspicious behavior, human and
pending. Unknown purpose never downgrades successful verification to pending: detail
preserves `unknown`, and `agent_verified` alone does not assert a user-directed role.
Manus and Meta Muse signature identities map to user_directed under the owner policy
based on their documented agent products; DuckDuckGo's maps to crawler in line
with DuckAssistBot. Browserbase is an intermediary (0.4.0): it signs its customers'
browser sessions, so its verified identity has purpose `intermediary` and never names the
agent. `intermediary` is registry configuration (`intermediary: true`, requires a
signatureAgent), not a purpose mapping, so a UA claim cannot override it. A valid direct
signature wins `verified` over a valid intermediary one regardless of label order. Source URLs are recorded in registry-purposes.ts and the README.
The six pipe-separated detail segments are operator, verification, purpose, claim,
browser class and phase. Missing is `-`, unknown operator is `none`. Configured operator
names start with a lowercase ASCII letter and contain at most 24 lowercase ASCII
letters, digits or underscores; rejecting invalid names preserves separators
and guarantees the 100-character bound, including a sticky operator in collectors.

Since 0.3.5 `browserAgent` carries an operator observed by the browser detector from a
page marker (`openai` or `anthropic` only). It is used only with browser class
`declared_agent` and only when the server has neither a verified identity nor an
invalid signature; the claim segment is then `dom_marker` and the type stays
`agent_unverified`. Verified identity always wins, and a marker never upgrades a type to
verified or downgrades a spoofed one. The browser phase `agent` marks the detector's
update after such a marker appears.

Session aggregation belongs to the collector: pending=0, human=1, bot_suspicious=2,
agent_unverified=3, bot_automation=4, bot_spoofed=4.5, crawler_verified/agent_verified=5;
fresh equal-rank evidence replaces the prior type and operator. Current-hit detail remains distinct from sticky type.
Full hits use client_id+session_id, denied pings page_id; bounded memory-only storage
must expire and clear on close. No library persistence or request waiting is introduced.

## Evidence versus identity (0.4.0)

The operator segment of `vv_detail` is filled only from verified evidence on the hit
(`signature_valid`/`ip_match` in the verification segment) or from a browser page marker
(claim `dom_marker`, type `agent_unverified`). UA tokens and unverified Signature-Agent values
are claims and never name an operator. A collector's sticky operator travels with the sticky
type that established it, so `vv_type` in {agent_verified, crawler_verified} is the reliable
"verified operator" test for every hit, and verification `signature_valid|ip_match` is the
per-hit test. The format stays six segments; the only addition is the purpose value
`intermediary`, and unlisted purpose values become `unknown`.

## Keyed signature members (0.4.0)

Draft-01 §5.2.2 lets a signer cover another label's `signature` and `signature-input`
members. The verifier now supports these keyed components (RFC 9421 §2.1.2) and serializes
the member per RFC 8941. Covering a member whose timestamps the lexical guard found to be
Decimals is indeterminate, because re-serialization would not reproduce the signed octets.
Attribution is unchanged: each label attributes to the Signature-Agent member keyed by its own
label; several covered keyed members without that match remain ambiguous.
