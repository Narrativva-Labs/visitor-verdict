# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-11-22

### Added

- Experimental WebMCP capability sampled once from document/legacy navigator, plus explicitly trusted tool activation/cancellation observation on document modelContext and legacy window. New informational `traffic_webmcp` / `traffic_webmcp_count` and public `webmcp` / `webmcpCount`; count capped at 255 per document. No class, score, carry or storage effect. Observation continues after final until pagehide; no extra publication.
- GTM `VV - DLV traffic_webmcp` (ID 16) and GA4 event parameter, registry evidence, synthetic lifecycle contracts and paired fuzz classification invariants. Version 1.3.0 ES5 bundle, SRI and container regenerated.
- Versioned signal registry and JSON Schema for every detector code, default UA token and agent element ID, with sources, product/version evidence, review dates, lifecycle status and false-positive caveats; generated [signal catalogue](docs/signals.md) in the normal build.
- CI registry contracts for schema validity, exact source inventories, weights and scoring families, retired output codes, generated documentation and non-failing 120-day review warnings.

### Documentation

- Contributor requirements for new signal evidence and lifecycle updates. Google-NotebookLM is retired as an operator token (support ended August 2026); its existing AG compatibility match is retained. Claude marker coverage explicitly excludes extension 1.0.107 closed shadow roots. The registry itself is documentation-only; the WebMCP changes above update the runtime.

## 1.2.0 — 2026-11-22

- Publish final on the first visibility change to hidden by default (`finalOnHidden: true`), still once per document, with pagehide fallback and the unchanged visible-time idle deadline. A brief tab switch ends behaviour collection early; the agent marker watcher can still escalate after final.
- Require actual booleans for config overrides; consume CA/CD/CS before applying and skip carry if storage is unwritable. Suspicious provenance uses the existing `{value, direct}` shape; passive strings remain truthful previous-class labels.
- Require a real visible-to-hidden transition for hidden finalization. Document `finalOnHidden: false` for resumed behaviour and pending probes.
- Carry suspicious results to one following document through zero-weight `CS`; consume at start, never promote or renew from CS alone, and retain the bounded storage schema.
- Regenerate the 1.2.0 ES5 bundle, SRI, GTM container and signal catalogue; tag mappings remain unchanged. Extend lifecycle, carry-over and fuzz contracts.

## [1.1.0] - 2026-11-22

### Added

- Agent UI markers (`DM`): the detector checks three exact element IDs that browser agents inject while they act (`codex-agent-overlay-root` as a child of the root element; `claude-agent-glow-border` and `claude-phantom-cursor` as children of `body`, older Claude in Chrome versions) at start and again once the watcher runs, then watches with one `MutationObserver` until found or `pagehide`. The observer covers only the child lists of the root element and `body` (no subtree), plus an `id`-only watch on up to 32 newly added direct children, so mutations inside page content cost nothing. It starts only when a `pagehide` listener is attached. A match yields `declared_agent`. Markers and placement were identified by Microsoft Clarity (MIT). Evidence level: observed, self-declared by the agent UI. The OpenAI overlay ID is confirmed in the ChatGPT desktop app's Chrome plugin; current Claude in Chrome (1.0.107) keeps its UI in a closed shadow root and is not detected, only older versions are.
- New phase `traffic_phase: 'agent'`: one extra `traffic_class` event when a marker appears after the initial publication, before or after final. The frozen `window.__visitorVerdict` snapshot is replaced; final keeps `declared_agent`.
- New optional field `traffic_agent` (`openai` | `anthropic`) on data-layer events and `agent` on `window.__visitorVerdict`, only with class `declared_agent` and only when a marker named the operator; `automated` is reported without an operator. The operator is stored with the declaration (at once when the marker is present at load or confirms a carried operator) and carried to the next document with `CD`.
- GTM container 1.1.0: `VV - DLV traffic_agent`, `VV - agent` trigger, GA4 `traffic_class` tag also fires on the agent phase and sends `traffic_agent`.
- [Conversion guidance](docs/conversion-guidance.md): Visitor Verdict only labels traffic; nothing is excluded, filtered or held by default in GA4, ad platforms or leads.

### Changed

- `traffic_version` and package version `1.1.0`; minified detector ~15.5 KB (+~1.7 KB).
- Reporting docs: All sessions is the headline; views that set labelled sessions aside are optional comparisons; agent-assisted revenue is reported as a breakdown, not a deduction.
- `codex-browser-sidebar-comments-root` is deliberately not a marker: it identifies the OpenAI browser surface, not agent control.

### Fixed

- Direct provenance is split into hard and declared evidence. In 1.0.x a UA token on a document that was automated only through a carried `CA` stored direct `automated` again, so `CA` could chain across documents. Now only direct hard evidence stores `automated`; a declaration (UA token or marker) stores `declared_agent`, so the following document is `declared_agent`, never `automated`.

### Known limits

- Markers in shadow roots (open or closed) and frames are not inspected; marker names can change with agent releases; page code can plant them. A BFCache-restored page is not watched again.
- The carried label lasts one document: after a person stops the agent and clicks on, the next page can still be `declared_agent` with `traffic_agent`.

### Documentation

- Roadmap and README: Phase 2 (server-side verification on the `phase2-verifier` branch) in development alongside Phase 1 field validation; links to Vanilla Server-Side, its first integration.
- GA4 batching note in 1.0.1 corrected after the release: leaving the page flushes the batch.
- Field-validation status: in progress since 2026-11-19, no study results yet.

## [1.0.1] - 2026-11-20

### Changed

- GTM container 1.0.1: the GA4 `traffic_class` tag now sends initial `automated` and `declared_agent` publications in addition to final results for every class, improving coverage when short visits end without final delivery.
- Clearly labelled optional first-page-view readiness trigger set, with manual setup, one-second fallback, once-per-page firing, timing risks and rollback instructions.
- Migration instructions, session-level any-hit reporting guidance and container contract coverage. Initial/final duplicates are expected; classification-event counts are not visit counts.
- BigQuery session rollup ranks `automated` above `declared_agent`, matching detector precedence.
- Measured GA4 batching note (corrected after the release, 21 November 2026): leaving the page flushes the GA4 batch, so short visits still send `page_view` and the initial classification; automation request listeners miss these unload requests. SPA pageviews stay in a separate tag.
- Detector JavaScript, distribution, probe settings and `traffic_version: '1.0.0'` are unchanged.

## [1.0.0] - 2026-11-19

### Added

- Four local traffic classes: `declared_agent`, `automated`, `suspicious` and `human`, with conservative scoring that prioritises avoiding human false positives.
- Synchronous initial classification and a final phase after visible observation time or pagehide, with duplicate-inclusion and BFCache safeguards.
- Signal catalogue covering declared user-agent tokens, webdriver/headless and automation globals, browser geometry/language/plugins/permissions, optional WebGL and worker probes, inactivity, synthetic input, rapid navigation and teleport clicks/history.
- Privacy minimisation: no identifiers, fingerprints, cookies, localStorage or detector network requests; bounded tab-session storage; local reduction of raw values to flags; debug signal codes disabled by default.
- GTM Custom HTML and importable container, configurable data-layer output, and GA4 event/user-property and session-cohort reporting documentation.
- Standalone ES5 minified distribution and SHA-384 Subresource Integrity file, alongside existing GTM outputs.
- Contract and runner-contract checks, seeded invariant fuzzing, browser controls, adversarial benchmark tooling and a manual human lab.
- Node.js 20/22 CI, contribution and security guidance, and privacy-conscious issue forms.

### Known limits

- Patched browsers, stealth and natural input can evade detection. `human` means no sufficient automation evidence, not proof of a person; declared identities are unverified claims.
- Fetchers that do not execute JavaScript produce no classification. Missing events and failed benchmark launches are unknown, never detection successes.
- Accessibility input, privacy tools, emulation, VMs and unusual settings can resemble weak signals. Synthetic controls do not establish a population false-positive rate or validate real assistive technology.
- Optional probes depend on browser support and CSP; CSP-blocked Blob workers may cause browser-generated violation reports. Storage denial removes cross-document history, and unload can lose final analytics delivery.
- GA4 events sent before classification cannot be backfilled. Automatic-event/shared-settings and last-observed user-property semantics require care; pre-consent classifications must not feed advertising platforms.
- The detector exceeds the original 5 KB minified target. ES5 syntax does not imply legacy-browser support.

[1.1.0]: https://github.com/Narrativva-Labs/visitor-verdict/releases/tag/v1.1.0
[1.0.1]: https://github.com/Narrativva-Labs/visitor-verdict/releases/tag/v1.0.1
[1.0.0]: https://github.com/Narrativva-Labs/visitor-verdict/releases/tag/v1.0.0
