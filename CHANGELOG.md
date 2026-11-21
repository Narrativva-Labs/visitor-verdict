# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-11-20

### Changed

- GTM container 1.0.1: the GA4 `traffic_class` tag now sends initial `automated` and `declared_agent` publications in addition to final results for every class, improving coverage when short visits end without final delivery.
- Clearly labelled optional first-page-view readiness trigger set, with manual setup, one-second fallback, once-per-page firing, timing risks and rollback instructions.
- Migration instructions, session-level any-hit reporting guidance and container contract coverage. Initial/final duplicates are expected; classification-event counts are not visit counts.
- BigQuery session rollup ranks `automated` above `declared_agent`, matching detector precedence.
- Measured GA4 batching note (corrected 21 November 2026): leaving the page flushes the GA4 batch, so short visits still send `page_view` and the initial classification; automation request listeners miss these unload requests. SPA pageviews stay in a separate tag.
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

[1.0.1]: https://github.com/Narrativva-Labs/visitor-verdict/releases/tag/v1.0.1
[1.0.0]: https://github.com/Narrativva-Labs/visitor-verdict/releases/tag/v1.0.0
