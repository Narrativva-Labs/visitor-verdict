# Security policy

## Supported releases

Security fixes target the latest stable release in the 1.x line. Use the latest patch release when available.

## Report data-leak bugs privately

Use [GitHub private vulnerability reporting](https://github.com/Narrativva-Labs/visitor-verdict/security/advisories/new) for unexpected raw-data exports, identifiers, prohibited storage, network requests or other privacy/security boundary failures. Do not post these reports as public issues.

Include the affected version, a minimal synthetic reproduction, expected/observed behaviour and impact. Do not send real visitor data, URLs, IP addresses, cookies or identifiers. František Bujnovský maintains the project; response and fix times depend on availability.

Repository maintainers must enable private vulnerability reporting in the repository security settings for this channel to accept submissions.

## Detection evasions

Publicly known detection bypasses belong in the [public bypass issue form](https://github.com/Narrativva-Labs/visitor-verdict/issues/new?template=bypass-report.yml). Client-side detection is spoofable; evading a classification alone is a known limit, not a data-leak vulnerability. Report unknown privacy/security failures privately even if encountered while testing an evasion.
