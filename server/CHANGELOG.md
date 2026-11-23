# Changelog

## 0.6.1 — 2026-11-23

- Reserve spoofing labels for cryptographic mismatches against trusted identities; incomplete, expired and replayed proofs remain indeterminate.
- Refresh mutable WBA aliases and Poppy root kids once on mismatch with single-flight and cooldown; require secure WBA context.
- Treat nonexclusive SAIL ranges as weak evidence and support shared atomic Poppy replay storage.
- Preserve browser `dom_host` claims via `browserAgentClaim`; add ISO `generated_at` to sGTM rule exports without changing schema 1.
- Add `automation_verified` for verified intermediary platforms, retaining purpose `intermediary`. Suggested collector rank 4.75 sits above unverified claims (3), below direct agent verification (5), because the platform identity is established but its downstream agent is unknown. Update consumer type allowlists.
- Update server version, egress hosts, capture limitations, cache revocation and single-replica replay guidance. Traffic is only labelled, never blocked or excluded.

## 0.6.0 — 2026-11-23

- Add opt-in Poppy 1.0 signed-out web operator verification: ES256 sessions, ES256/PS384 delegated keys, pinned Muse metadata/JWKS, bounded cache and replay protection. No account or action authorization.
- Add claim `poppy_session` to `vv_detail`; keep existing visitor types and signature outcome precedence. Downstream detail allowlists need the new claim.
- Add offline crypto, parser fuzz, document limits, freshness and mixed WBA/IP coverage.
- Keep replay/truncated ES256 signatures unverified, pin Poppy purpose to unknown, allow delegation clock skew and compatible 1.x headers. Skip unsupported public JWKS peers, cache imported keys, expose only root kid hashes, respect request deadlines before replay insertion and derive detail claims from the winning method.

## 0.5.1 — 2026-11-23

- Refresh unknown/inactive signing keys with indeterminate rotation outcomes; add Kernel runtime validity/rotation coverage.
- Correct Client Hints gates and navigation scope; skip embedded/crawler and Android desktop-site cases; add trusted transport diagnostic opt-outs.
- Verify mixed intermediary/direct failure ordering and clarify directory trust and analytics segmentation.

## 0.5.0 — 2026-11-23

- Add optional weak `AgentVerdict.evidence: [header_mismatch]` for scoped HTTPS Chromium header inconsistencies, with version and request-shape gates. No effect on identity, verification, purpose or analytics classification.
- Add representative Chrome/Edge, Firefox, Safari, curl, Python requests and headless fixtures and protocol/policy boundaries.
- Add Kernel Agent (`kernel`), Cloudflare Browser Run (`cloudflare_browser_run`) and Shopify Cloudsurf (`shopify_cloudsurf`) as intermediary signing operators after primary-source checks and owner-supplied live HTTPS directory fixtures. All five Ed25519 authority-binding proofs verify; no signed visitor requests captured. Kernel key nbf/exp remain enforced.
- Startup directory count increases from six to nine; document new egress origins, infrastructure-only identity semantics and per-operator signature/replay/precedence tests.

## 0.4.1 — 2026-11-22

- Keep replay/invalid WBA peers visible when only signing infrastructure verifies; a valid direct signature still wins. Invalid aggregate verdicts expose no verified identity.
- Parse security dictionaries once per request, reuse lexical metadata and check Ed25519 length before base construction or directory access; retain all SSRF, count, size and timeout limits.
- Require byte-sequence Signature members and string-only Signature-Input lists. Missing covered security members fail per RFC 9421 §2.1.2; malformed shapes fail. Lossy integral Decimals anywhere in covered members and Decimal timestamps are indeterminate, never false crypto mismatches. Reject self-coverage and bare/binary-wrapped signature fields.
- Restrict PurposePolicy to product purposes in public types, matching existing runtime validation; reject an intermediary flag combined with a signature purpose mapping.
- Document collector session precedence (intermediary rank 4.75, direct verified rank 5) and inherited verified purpose. Add parser, ordering, configuration and type regressions.
- Upgrade note: 0.4.0 added provisional muse.ai and raised startup key directories from five to six; update outbound HTTPS allowlists or health can remain 5/6 with a failed refresh. Muse remains enabled by owner policy, not confirmed by Meta or a local capture.
- Clarify 0.4.0 API change: purposePolicies.browserbase and Browserbase.purposes were removed in favor of intermediary: true. Correct source locations and coverage date. Session SQL refers to the optional docs/analysis/session-classification.sql report, not a database schema.

## 0.4.0 — 2026-11-22

- Add Meta Muse as a signing operator: operator `meta`, identity `https://muse.ai`, directory `https://muse.ai/.well-known/http-message-signatures-directory`, purpose `user_directed`. Provisional (observed by DataDome, not documented by Meta; Muse signs only part of its requests). The old www.meta.com directory is not trusted.
- Intermediaries: registry flag `intermediary: true` (Browserbase in the default registry) and purpose value `intermediary`. A verified intermediary signature identifies the signing infrastructure, never the agent; `vv_type` stays `agent_verified`, `vv_detail` reads `browserbase|signature_valid|intermediary|…`. A valid direct signature now wins `verified` over a valid intermediary regardless of label order. Breaking for registry consumers: Browserbase's purpose changes from `user_directed` to `intermediary`, and `AgentPurpose` gains a value.
- Support keyed `signature-input` and `signature` components (draft-01 §5.2.2, Appendix D.2): an outer signature that covers another label's signature now verifies instead of returning none/unsupported_component. Absent, wrongly shaped or Decimal-timestamp members are indeterminate. Attribution is unchanged.
- `visitorLabels` maps unlisted purpose values to `unknown`.
- Evidence versus identity: documented and tested that only verification or a page marker (`dom_marker`) names an operator; UA tokens and unverified Signature-Agent values never do.
- Live directory re-check for Muse, Browserbase, Manus and Google (2026-11-22); Google's experimental Web Bot Auth documentation added as registry evidence. Amazon Bedrock AgentCore Browser is documented as not supported (no public directory).
- Optional reporting query `docs/analysis/session-classification.sql` (repository root) accepts purpose `intermediary` in both purpose allowlists; neither this library nor Vanilla has a SQL storage layer.

## 0.3.5 — 2026-11-22

- `visitorLabels` accepts optional `browserAgent` (`openai` or `anthropic`, from a browser page marker). With browser class `declared_agent` and no verified identity or invalid signature, it supplies the `vv_detail` operator and the claim segment `dom_marker`; the type stays `agent_unverified`. Verified identity always wins over a conflicting marker; other values are ignored.
- Accept browser phase `agent` in `vv_detail`.
- Export the `BrowserAgent` type. Correct the session ranks in DESIGN.md.

## 0.3.4 — 2026-11-21

- Preserve typed failures across independent package copies.
- Reclaim expired replay occupancy on status reads using the store clock; retain the inclusive expiry boundary.
- Correct API, replay and release documentation.

## 0.3.3 — 2026-11-21

- Prioritize replay failures over other invalid candidates; valid proofs still win.
- Bound replay key size, use an expiry heap and per-operator budgets, expose capacity status, and report typed exhaustion.
- Retain local nonces through an absolute skew deadline and recognize duplicate package stores without per-insert timers.

## 0.3.2 — 2026-11-21

- Add bounded atomic MemoryNonceStore support in cache-only verification.
- Return signed proof expiry as verified.expiresAt for evidence lifetime limits.

## 0.3.1 — 2026-11-20

- Refresh events report the public endpoint hostname (never a URL or visitor data), so collectors can log which key directory or IP list failed.
- Export `serverAgentTokens(registry)` so collectors count UA claims with the same token list as verification.

## 0.3.0 — 2026-11-20

- Breaking API change: remove `toAnalyticsFields`; use pure exported `visitorLabels({ verdict?, browserClass?, browserPhase? })`.
- Return exactly `vv_type` and `vv_detail` for event-scoped GA4 custom dimensions. Detail contains six bounded pipe-separated values, at most 100 characters.
- Verified unknown purpose maps to `agent_verified`, preserving `unknown` in detail without asserting a user-directed role.
- Map Browserbase and Manus signature identities to `user_directed`, and DuckDuckGo to `crawler`, with operator documentation sources.
- Exhaustive verification/purpose/claim/browser/phase table tests and public declaration checks.

## 0.2.1 — 2026-11-20

- exclude customer Google Cloud DNS, bind purpose to the matching DNS rule/list, add crawler roles, server-only Google tokens and registry evidence provenance; strengthen signature/cache and delivery boundary coverage.

## 0.2.0 — 2026-11-20

- add verified-only agent_purpose, cache status and public refresh metadata; retain cache-only verification and bounded stale-while-revalidate.
