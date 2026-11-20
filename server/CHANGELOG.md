# Changelog

## 0.3.0 — 2026-11-20

- Breaking API change: remove `toAnalyticsFields`; use pure exported `visitorLabels({ verdict?, browserClass?, browserPhase? })`.
- Return exactly `vv_type` and `vv_detail` for event-scoped GA4 custom dimensions. Detail contains six bounded pipe-separated values, at most 100 characters.
- Verified unknown purpose maps to `agent_verified`, preserving `unknown` in detail without asserting a user-directed role.
- Map Browserbase and Manus signature identities to `user_directed`, and DuckDuckGo to `crawler`, with operator documentation sources.
- Exhaustive verification/purpose/claim/browser/phase table tests and public declaration checks.

Earlier releases are recorded in README.md.
