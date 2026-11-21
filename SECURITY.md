# Security policy

## Supported releases

Browser detector security fixes target the latest stable release in the 1.x line. Use the latest patch release when available. The unreleased `server/` 0.3.x preview receives best-effort fixes on `phase2-verifier`; there are no maintained server release branches.

## Report security and data-leak bugs privately

Use [GitHub private vulnerability reporting](https://github.com/Narrativva-Labs/visitor-verdict/security/advisories/new) for unexpected raw-data exports, identifiers, prohibited storage, network requests or other privacy/security boundary failures. Do not post these reports as public issues.

Include the affected version, a minimal synthetic reproduction, expected/observed behaviour and impact. Do not send real visitor data, URLs, IP addresses, cookies or identifiers. František Bujnovský maintains the project; response and fix times depend on availability.

Scope includes the browser detector and GTM integration, plus the `server/` verifier: signature forgery or verification bypass, trusted host/proxy boundary failures, SSRF or redirect/egress bypass, parser denial of service, prohibited data retention or logging, and exploitable dependency vulnerabilities. The server intentionally fetches configured operator directories and feeds; arbitrary request-controlled network access is a security failure.

If the private reporting form is unavailable, open an issue requesting a private contact channel, without vulnerability details or visitor data.

## Detection evasions

Publicly known detection bypasses belong in the [public bypass issue form](https://github.com/Narrativva-Labs/visitor-verdict/issues/new?template=bypass-report.yml). Client-side detection is spoofable; evading a classification alone is a known limit, not a data-leak vulnerability. Report unknown privacy/security failures privately even if encountered while testing an evasion.
