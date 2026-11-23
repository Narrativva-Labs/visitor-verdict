# Fixture provenance and expected policy

Cloudflare web-bot-auth, copyright Cloudflare and contributors, Apache-2.0.
Pinned commit: **bc27a88e974061af1809f3020c150f6b03547fc7**.
Full licence: APACHE-2.0.txt. Source commit: https://github.com/cloudflare/web-bot-auth/commit/bc27a88e974061af1809f3020c150f6b03547fc7

Upstream files:

- https://raw.githubusercontent.com/cloudflare/web-bot-auth/bc27a88e974061af1809f3020c150f6b03547fc7/packages/web-bot-auth/test/test_data/web_bot_auth_architecture_v1.json
- https://raw.githubusercontent.com/cloudflare/web-bot-auth/bc27a88e974061af1809f3020c150f6b03547fc7/packages/web-bot-auth/test/test_data/web_bot_auth_architecture_v2.json
- https://raw.githubusercontent.com/cloudflare/web-bot-auth/bc27a88e974061af1809f3020c150f6b03547fc7/packages/web-bot-auth/test/test_data/web_bot_auth_directory_response_v1.json

Retrieved through the web reader because terminal egress was blocked. Presentation line numbers were removed and LF line endings reconstructed; no intentional semantic edits. SHA-256 of the **local copies**, including their reconstructed formatting, is recorded in sha256.json and checked by tests. These are not claims of independently compared upstream byte-for-byte hashes.

| Fixture               | Vector                         | Public API policy outcome at fixture-created time                                     |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| architecture v1       | 1, RSA, no Signature-Agent     | none / unsupported_algorithm                                                          |
| architecture v1       | 2, RSA, quoted identity        | none / unsupported_algorithm                                                          |
| architecture v1       | 3, Ed25519, no Signature-Agent | none / untrusted_signature_agent                                                      |
| architecture v1       | 4, Ed25519, quoted identity    | signature_valid / verified with explicit test-only registry                           |
| architecture v2       | 1–4                            | none / invalid_validity_window (century-long expiry)                                  |
| directory response v1 | Ed25519 response               | no_signature / ignored_non_wba in request API; isolated crypto and digest checks pass |

Both Ed25519 v1/v2 request vectors, including legacy cases without identity, also pass isolated canonicalisation/crypto tests. Those tests do not weaken production policy. RSA is intentionally unsupported. The v2 agent2 member / sig2 signature-label combination is attributable as a relabeled signature when it is the sole covered keyed identity member; the century-long validity window still exceeds the default policy. A separate API regression uses an explicit test-only lifetime override and confirms signature_valid with attribution=relabeled for Ed25519 v2 vector 4. Directory proofs use response/request-linked components and are outside this library's request API.

chatgpt-agent-2026-11-20.json and openai-directory-2026-11-20.json were supplied by the repository owner from traffic to the owner's analytics subdomain on 2026-11-20; copied without changes. IPs/cookies were already removed. All 32 requests verify at each request's arrival time; they expire one hour after created (subject to the verifier's 30-second tolerance), and all are expired two hours after arrival. They are explicit static test fixtures, never a logging mechanism for new traffic.

RFC 9421 B.2.6/B.1.4 example data appears in interop.test.mjs; see IETF-NOTICE.txt and https://www.rfc-editor.org/rfc/rfc9421.html. Dependency licences remain in installed packages; no dependency licence is classified as a traffic fixture.

Live directory JSON and HTTP header fixtures for openai/google/duckduckgo/browserbase/manus were supplied from operator fetches by the repository owner on 2026-11-20. Their exact endpoint URLs are in src/registry.ts. The accompanying headers are public endpoint responses, not visitor request headers. They are included in sha256.json. Google uses custom short kid values; OpenAI sends no-store. Tests exercise these production differences.

The owner supplied anthropic-sail-2026-11-20.toml, fetched live from https://claude.com/.well-known/sail (application/sail+toml, schema draft-kelley-webbotauth-sail-00, expires_after=3600). It contains public operator ranges, no visitor data. Its checksum is in sha256.json; tests exercise strict parsing, service resolution and TTL bounds.

muse-directory-2026-11-22.json and muse-directory-2026-11-22.headers.txt were fetched over HTTPS from https://muse.ai/.well-known/http-message-signatures-directory on 2026-11-22. The body is unchanged; the header file keeps only the status line, content-type, cache-control, signature-input, signature and date of the public endpoint response (no visitor data). The same day the Browserbase, Manus and Google directories returned the same key sets as their 2026-11-20 fixtures, so those fixtures were not replaced.

header-consistency.json contains authored representative HTTP header examples for
Chrome/Edge, Firefox, Safari, headless Chrome and HTTP clients. These are synthetic
protocol fixtures, not captures of visitors or claims of a real browser session.
They contain no URLs, identifiers, cookies, request signatures or visitor data.

Kernel, Cloudflare Browser Run and Shopify Cloudsurf directory fixtures dated
2026-11-23 were supplied by the repository owner from live curl HTTPS fetches
(HTTP 200). Exact URLs are in src/registry.ts. JSON bodies are copied byte for byte.
Header fixtures retain only status, date, age, cache-control, content-type,
content-length, signature, signature-input and content-digest if present; response
cookies, request IDs and other unrelated response metadata were omitted.
All five Ed25519 authority-binding proofs verify at capture time; these proofs
cover only @authority;req, not a Content-Digest or the directory body. Runtime
trust remains the exact configured HTTPS URL. Kernel's key has nbf/exp and is
short-lived; it must not be treated as permanently active. No signed visitor
request was captured for these operators. Local fixture hashes are in sha256.json.

poppy-agent.json is the owner-supplied Muse public CIMD document captured on
2026-11-23 from https://muse.ai/poppy/agent.json. Tests generate their own keys;
this metadata fixture is not evidence of a captured verified Session request.
