# Changelog

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
