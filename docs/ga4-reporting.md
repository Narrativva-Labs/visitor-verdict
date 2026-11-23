# GTM installation and GA4 reporting

## Evidence claim in 1.4.0

Merge DLV `VV - DLV traffic_agent_claim` (ID 17, Version 2, key `traffic_agent_claim`, no default) and GA4 event parameter `traffic_agent_claim={{VV - DLV traffic_agent_claim}}`. Register an event-scoped custom dimension for this parameter. Keep `dom_host` separate from `dom_marker` and `ua_token` in reports, including on CD carry pages. Monitor known human controls and widget/portal sites; closed-shadow widgets using `:host { display: contents }` and persistent selective-CSS portals remain false-positive sources. Review dom_host-only changes by site/release before using the label for downstream decisions. The [experiment](../research/claude-host-experiment.md) records the monitoring plan and evidence limits.

## Import and readiness wiring

1. In a GTM web container, open **Admin → Import Container**, choose [gtm/container-import.json](../gtm/container-import.json), select a workspace and **Merge**, then review conflicts and the import preview before confirming. Set **VV - GA4 measurement ID** to your existing measurement ID instead of `G-XXXXXXXXXX`. The import contains no Google tag or consent manager.
2. Keep **VV - detector** on **All Pages**, **Once per page**, priority **100**, with **No additional consent required**. Consent defaults should already be established. Do not put the detector on Initialization: it can run with consent unset on sites that push an earlier event.
3. **Optional first `page_view` recipe:** open the site's **existing Google tag**. The import folder **VV - OPTIONAL page_view readiness (OR, once per page)** groups the two triggers for this manual step. Replace its early All Pages/Initialization firing trigger with **VV - initial OR VV - timer fallback 1s** as two ordinary firing triggers, not a trigger group. Set its advanced firing option to **Once per page**, so whichever trigger fires first starts it once. The timer interval is 1000ms, limit 1, enabled on all pages; it covers an unavailable or delayed detector.
4. In the existing Google tag's **Shared event settings** (using an event settings variable where appropriate), set event parameter **traffic_class = `{{VV - current class}}`**. Preserve existing consent handling. With a timely initial result, the first `page_view` can carry the current page's initial class rather than waiting for a later page. This setup requires changing the existing tag; importing alone does not wire it.
5. On every other **GA4 Event tag** (`gaawe`), add **traffic_class = `{{VV - current class}}`**, evaluated at that tag's firing time. Audit ecommerce, click and other tagged events. The dedicated publication event described below is the exception: it must use the publication's DLVs.
6. Keep **VV - GA4 traffic_class** on **VV - initial hard OR VV - agent OR VV - final**, **Once per event**, with the mappings below. Preview initial, agent and final events (inject a synthetic `codex-agent-overlay-root` child of the root element to see the agent phase with `traffic_agent: 'openai'`), version, first page_view, final DLV values, Google-tag firing count, navigation, delayed/denied consent and timer fallback before publishing. Neither a user property nor this setup backfills earlier events.

All imported named objects use `VV - `. The import creates two tags, eight variables, five triggers and one optional recipe folder. Underlying event/data names do not carry the prefix:

| Object | Definition |
|---|---|
| VV - detector | Custom HTML, All Pages, once per page, priority 100 |
| VV - GA4 traffic_class | GA4 Event, event name `traffic_class`, measurement ID `{{VV - GA4 measurement ID}}`, triggers VV - initial hard OR VV - agent OR VV - final, once per event |
| VV - initial / VV - agent / VV - final | Custom event `traffic_class`, filtered by `{{VV - DLV traffic_phase}}` equal to `initial` / `agent` / `final` |
| VV - initial hard | Custom event `traffic_class`, phase equals `initial` AND class matches regex `^(automated|declared_agent)$` |
| VV - OPTIONAL page_view readiness (OR, once per page) | Folder containing VV - initial and VV - timer fallback 1s; attach both manually as ordinary OR firing triggers |
| VV - timer fallback 1s | Timer `gtm.timer`, 1000ms, limit 1, enabled on all pages |
| VV - DLV traffic_class / traffic_phase / traffic_score / traffic_version / traffic_agent / traffic_webmcp / traffic_agent_claim | Seven Version 2 Data Layer Variables, each reading the corresponding unprefixed key, with no default (`traffic_agent` is absent on most events and then not sent) |
| VV - current class | Browser automated/declared class, then verified B7 agent, then browser human/suspicious, then startup previous class, then `undefined` |
| VV - GA4 measurement ID | Constant holding your destination ID |

### Optional first page_view timing and rollback

Steps 3–4 above are opt-in; importing the folder does not change the site's Google tag. Attaching its two ordinary triggers implements **OR**, so the first initial publication or one-second timer starts the tag once per page. A GTM Trigger Group waits for **both** and does not implement this recipe. Save the original trigger list and firing option before editing.

This can delay `page_view` by up to **1 s** after GTM starts; browser scheduling or existing consent gates can delay delivery further. The fallback keeps collection available but may send an unlabelled pageview. Delaying the Google tag can also delay other tags that depend on it; check those in Preview.

If the site uses an explicit GA4 `page_view` event tag, leave the Google tag's startup trigger in place, attach the two readiness triggers to the explicit event tag instead, set **Once per page**, and map `traffic_class={{VV - current class}}` on that event. Ensure the Google tag's automatic pageview is disabled so only one pageview is sent. Keep SPA/history pageviews in a **separate tag** with **Once per event**: Once per page on a shared tag would suppress later virtual pageviews.

To roll back, remove the two readiness triggers from the tag you changed and restore its saved trigger list and firing option. Restore any pageview sending setting changed for the explicit-event variant. The dedicated classification event can remain on initial hard plus final.

### WebMCP reporting and migration to 1.3.0

Merge the current container import and review conflicts. Existing object IDs stay stable; **VV - DLV traffic_webmcp** is added as ID 16 (Data Layer Variable, Version 2, key `traffic_webmcp`, no default). The GA4 `traffic_class` tag adds event parameter `traffic_webmcp={{VV - DLV traffic_webmcp}}`. For a manual upgrade, update the detector HTML too. Version 1.3.0 introduced six event mappings; 1.4.0 adds a seventh for the evidence claim; no new firing trigger or user property is required.

Optionally register event-scoped **Traffic WebMCP** for `traffic_webmcp` in GA4 custom definitions. Use `none`, `capable` and `used` as a separate reporting breakdown alongside `traffic_class`. `capable` is browser API exposure, never an agent classification. `used` means a site tool was invoked through the browser's agent integration, including cancellation observations; it does not identify an operator or prove completion. Neither value changes class, score or conversion handling. An absent field from an older detector means unknown, not `none`.

The detector also exposes `traffic_webmcp_count` (trusted activation/cancellation events, capped at 255 per document); the supplied GA4 tag does not map this count. No tool names, arguments or outputs are collected. Standard publications carry the latest information at publication time. Usage after final can update `__visitorVerdict.webmcp` without another event, so this integration is not a complete invocation log. Console-dispatched events have `isTrusted: false` and must not produce `used`; synthetic trusted fixtures in the contracts only model browser delivery. Review Preview values and normal consent handling before publishing.

### Migrating an existing install to container 1.1.0

From container 1.0.1 (detector 1.0.0), either re-import [gtm/container-import.json](../gtm/container-import.json) with **Merge** (review conflicts; earlier object IDs are unchanged) or edit manually:

1. Update the **VV - detector** Custom HTML from [gtm/custom-html.html](../gtm/custom-html.html) (detector 1.1.0), or the pinned direct-script URL and SRI.
2. Add **VV - DLV traffic_agent**: Data Layer Variable, Version 2, name `traffic_agent`, no default.
3. Add **VV - agent**: Custom Event name `traffic_class`, fire on some custom events where `{{VV - DLV traffic_phase}}` **equals** `agent`.
4. On **VV - GA4 traffic_class**, add **VV - agent** as a third ordinary firing trigger (keep VV - initial hard and VV - final, **Once per event**) and add event parameter `traffic_agent={{VV - DLV traffic_agent}}`.
5. In GA4, register event-scoped **Traffic agent (event)** for parameter `traffic_agent`. Optionally filter on `traffic_phase=agent` to see escalations.
6. Preview a page where an agent UI marker appears late (for example by adding `<div id="codex-agent-overlay-root">` to `document.documentElement` from the console): expect an `agent` event with `declared_agent` and `traffic_agent: 'openai'`, then a final `declared_agent`. Publish through the usual review.

The `agent` event can arrive after final, for example when an agent takes over a tab that was already open. Reports that count `traffic_class` hits per phase should expect a third phase value; session-level any-hit reporting needs no change. `traffic_version` becomes `1.1.0`.

### Migrating an existing install to container 1.0.1

1. Add **VV - initial hard**: Custom Event name `traffic_class`; fire on some custom events where `{{VV - DLV traffic_phase}}` **equals** `initial` AND `{{VV - DLV traffic_class}}` **matches RegEx** `^(automated|declared_agent)$`.
2. Add it as a second ordinary firing trigger to the existing **VV - GA4 traffic_class** tag, keeping **VV - final**. Keep **Once per event**, allowing initial and final to send independently.
3. Ensure event parameter `traffic_phase={{VV - DLV traffic_phase}}` exists alongside the existing class/score/version mappings. Keep the publication DLVs; remove any legacy class User Property mapping.
4. Optionally apply the first-page-view recipe above. Preview a hard initial result before closing the browser, all final classes, both readiness paths and one pageview per page, then publish through the site's usual review process. No detector JavaScript update is needed; `traffic_version` remains `1.0.0`.

Initial and final hits for the same hard class are expected. Use **session-level any-hit evidence**; do not interpret `traffic_class` event counts as bot visits. Initial delivery improves short-visit coverage but remains subject to browser, network and consent timing. Measured on 21 November 2026 with Chrome (headless and headed) on the demo shop, recording each GA4 request in page storage at send time: GA4 batches events, but leaving the page flushes the batch. With 0.7 s and 1.5 s per page, every page sent `page_view` and the initial `traffic_class` (usually also final, which the detector publishes on page hide). Automation listeners such as Playwright `request` events miss these unload requests, so do not conclude from them that hits were lost. An unflushed batch remains possible when the browser process is killed without leaving the page. The first-page-view recipe additionally puts the class on `page_view` itself.

### Publication-event mappings

The dedicated event describes one data-layer publication. Use these exact mappings; do not substitute the live current-class variable:

| GA4 field | Variable |
|---|---|
| Event parameter `traffic_class` | `{{VV - DLV traffic_class}}` |
| Event parameter `traffic_phase` | `{{VV - DLV traffic_phase}}` |
| Event parameter `traffic_score` | `{{VV - DLV traffic_score}}` |
| Event parameter `traffic_version` | `{{VV - DLV traffic_version}}` |
| Event parameter `traffic_agent` | `{{VV - DLV traffic_agent}}` |
| Event parameter `traffic_webmcp` | `{{VV - DLV traffic_webmcp}}` |
| Event parameter `traffic_agent_claim` | `{{VV - DLV traffic_agent_claim}}` |

All current detector phases contain `traffic_version: '1.4.1'`. `traffic_agent` is `openai` or `anthropic` when known from DOM evidence or its one-document CD carry, with class `declared_agent`. `traffic_agent_claim` distinguishes `dom_marker`, observed `dom_host`, and `ua_token`; older stored records may lack a claim. Claude in Chrome 1.0.107 is detected by the guarded host pattern, based on limited observed evidence. Debug codes are not mapped to GA4.

### Manual installation

Instead of importing, paste [gtm/custom-html.html](../gtm/custom-html.html) into a **VV - detector** Custom HTML tag, then create the variables, triggers and publication event from the tables above. Retain the detector's once-per-page, priority and consent settings. Keep `debug: false`; review the wrapper's explicit `webgl: true` and `worker: true` opt-ins. Match any custom data-layer name in the GTM snippet and detector configuration.

The imported **VV - current class** Custom JavaScript variable uses:

```javascript
function() {
  var c, server;
  function valid(v) {
    return v === 'human' || v === 'suspicious' || v === 'automated' || v === 'declared_agent';
  }
  try {
    c = window.__visitorVerdict && window.__visitorVerdict['class'];
  } catch (e) {}
  if (c === 'automated' || c === 'declared_agent') { return c; }
  try {
    server = window.__visitorVerdictServer;
    // B7 exposes the verified wire verdict; accept its normalized echo too.
    if (server && server.type !== 'crawler_verified' && server.purpose !== 'crawler' &&
        server.purpose !== 'intermediary' && server.claim !== 'server_intermediary' &&
        typeof server.operator === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(server.operator) &&
        (server['class'] === 'declared_agent' && /^(server_signature|server_ip)$/.test(server.claim) ||
         server.v === 1 && server.type === 'agent_verified' && /^(signature_valid|ip_match)$/.test(server.verification))) {
      return 'declared_agent';
    }
  } catch (e) {}
  if (valid(c)) { return c; }
  try {
    c = window.__visitorVerdictLast;
    if (valid(c)) { return c; }
  } catch (e) {}
  return undefined;
}
```

The B7 snapshot may use its native `v/type/operator/verification/purpose` shape or normalized `class/operator/claim` shape. Verified agents override browser human/suspicious; crawler and intermediary verdicts do not. The variable returns only the class; it does not restore identity DLVs or alter the browser snapshot. Every browser publication explicitly clears `traffic_agent` and `traffic_agent_claim` to `undefined` unless applicable to its declared-agent result, preventing stale GTM model identity. The GA4 tag no longer sets a traffic_class User Property; remove that mapping from existing tags during upgrade. Classification remains an event parameter.

It never reads or writes storage. `__visitorVerdictLast` is the validated previous final class captured once at startup, not a live storage lookup. Unknown remains undefined, never default human. Re-read `window.__visitorVerdict` for the latest frozen snapshot; previously held snapshots do not update.

## CSP-safe current-class variable

For a variable without GTM Custom JavaScript evaluation, open **Templates → Variable Templates → New → Import** and choose [gtm/templates/vv-current-class.tpl](../gtm/templates/vv-current-class.tpl). Save it, then create a variable using the **VV - current class** template. Replace the imported Custom JavaScript variable, preserving or updating every reference.

This alternative template currently covers browser evidence only; use the imported Custom JavaScript variable for B7 server precedence. The template uses `copyFromWindow('__visitorVerdict.class')` then `copyFromWindow('__visitorVerdictLast')`, with strict enum validation. Its sole permission is read access to those two global paths; it has no write, execute, storage or network permissions. This covers the variable only: the detector's script deployment must still satisfy site CSP. Do not weaken CSP for the Custom JavaScript fallback. The template has local structural/behavioural contract coverage; an authenticated GTM Template Editor import has not yet been verified. See Google's [template API reference](https://developers.google.com/tag-platform/tag-manager/templates/api), [permission reference](https://developers.google.com/tag-platform/tag-manager/templates/permissions), and [template import instructions](https://developers.google.com/tag-platform/tag-manager/templates#export_and_import).

## Consent and timing

The supplied detector runs before consent under the project's deployment policy. It makes no analytics or advertising requests. Consent defaults/updates and Google's built-in checks remain the site's responsibility; the site owner chooses the applicable setup with their DPO. A local class does not grant consent, and readiness triggers do not override it. Pre-consent classification must never feed advertising platforms. For consent-gated loading and withdrawal, see [privacy](privacy.md#consent-and-deployment).

The readiness pattern makes an initial class available to the Google tag's first `page_view` when the detector wins the race. Timer fallback can fire without a class, or with a startup fallback if one exists. Missing/delayed detection, consent-gated loading and blocked delivery can leave events unlabelled. Validate both paths in Preview; there is no guarantee of a class on every event.

Shared event settings are evaluated when the Google tag fires, once for that document. Automatic `page_view`, `user_engagement` and enhanced-measurement events can retain that startup value; later final classifications do not refresh it. Other explicitly tagged GA4 events re-evaluate `VV - current class` when they fire. An initial human label can therefore coexist with later final automation evidence. Use any observed automated/declared evidence for whole-session reporting; a later human never cancels it.

Keep the dedicated event on initial hard, agent and final even if no later interactions occur: initial hard can reach GA4 before a short-lived browser closes without publishing final, while final provides coverage and final class/phase/score/version. One page can send up to three `traffic_class` hits (initial, agent, final), for example a declared UA token at start, a late agent UI marker and final; count sessions with any matching hit rather than summing classification events. Never mark `traffic_class` as a key event. The import sets no traffic_class User Property. Legacy values may persist; remove the old mapping and use event evidence. The detector cannot retract collected events.

## Reporting

In **Admin → Data display → Custom definitions**, create:

| Display name | Scope | Field |
|---|---|---|
| Traffic class (event) | Event | Event parameter `traffic_class` |
| Traffic agent (event) | Event | Event parameter `traffic_agent` |
| Traffic agent claim (event) | Event | Event parameter `traffic_agent_claim` |
| Traffic phase (event), optional | Event | Event parameter `traffic_phase` |

Optionally register event-scoped `traffic_version` to distinguish release/configuration intervals. This is static release metadata.

Register `traffic_score` as a custom metric only if needed. Score is a heuristic, not a probability.

| Stored value | Reporting label and interpretation |
|---|---|
| `human` | **No automation detected**; not proof of a person |
| `suspicious` | Uncertain evidence; show separately for review |
| `automated` | Automation evidence; does not establish intent or abuse |
| `declared_agent` | Unverified agent claim (UA token or agent UI marker); can be spoofed. With `traffic_agent`, an agent UI of that operator was in the page: usually a real person's agent-assisted visit |
| Missing | Unknown; never silently treat as human |

**Labels only.** Nothing is excluded, filtered or deleted at collection, and no view below is a default filter. **All sessions** is the headline; the other views are optional comparisons that leave the data intact. Agent-assisted sessions are real visits: a browser agent such as OpenAI's in-browser agent runs in the person's own browser and pays with their card, so its purchases are revenue. Coverage remains limited: the Claude 1.0.107 host pattern is observed evidence and may also match unrelated closed-shadow widgets or portals. Report them as their own segment, not as removed traffic.

Use these session views, scoped to the web stream and the same date range:

- **All sessions** (headline): every session including unknown coverage.
- **Agent-assisted sessions**: any event carries `traffic_agent` (or `declared_agent` with the operator known). Show sessions, purchases and revenue; this is customer activity through an agent. The carried label lasts one page: if the person stops the agent and clicks on, the next page can still carry `declared_agent` and `traffic_agent`, so a session's last pageview may be human activity. BigQuery flag: `has_agent_operator`.
- **Sessions without detected automation** (optional comparison): leave out sessions where any event carries `automated` or `declared_agent`. Keep unknown sessions; show suspicious sessions separately within this view. Use it to see how much the labelled traffic moves rates, not as the reported total.
- **Stricter sensitivity view** (optional): additionally leave out sessions containing `suspicious`.
- **Observed human-only cohort**, diagnostic only: at least one `human` observation and no automated, declared or suspicious observations. It selects measurable, labelled visits and misses unknown traffic.

The comparison views keep unlabelled sessions and their earlier pageviews/purchases and set aside sessions with observed evidence; they never remove anything from GA4. “Only human” would bias the headline toward visits with successful classification and delivery. Always show coverage: sessions with any valid class versus sessions without, plus missing-ID pings separately. A later human label never cancels earlier automation evidence in that session.

Headline purchase conversion rate = **purchasing sessions / sessions in the same cohort**. Do not mix filtered purchasers with all-session denominators; do not count `add_to_cart` as headline conversion. Always report revenue from all sessions; show revenue in labelled sessions (agent-assisted, automated) as a breakdown, not a deduction. Leaving low-converting bot sessions out of a comparison view can raise CR by arithmetic; it does not demonstrate marketing improvement.

For GA4 UI steps use [Explorations and comparisons](analysis/ga4-explorations.md): create a **Session segment** including all web-stream sessions; for the optional comparison view, exclude sessions where a `traffic_class` event has class `automated|declared_agent` **OR any event has that event parameter**. Keep name and class conditions on the same event; event name alone must not exclude all classified sessions. Standard-report comparisons on the event-scoped dimension are scoped label comparisons, not reliable whole-session exclusions; never use the user property as a shortcut. [BigQuery SQL](analysis/bigquery.sql) supplies session flags, first/last evidence, class at first purchase and consistent cohorts; [Looker Studio](analysis/looker-studio.md) uses those session aggregates.

**Do not use the class to block access, deny service or make decisions about individuals.** Assistive technology can resemble some input patterns. Keep conversion collection running and send conversions as usual; the project recommends no conversion exceptions or holds by default (see [conversion guidance](conversion-guidance.md)). Pre-consent classification must never feed advertising platforms.


## Detector 1.2.0 timing and carry-over

The generated container keeps the existing tag mappings and triggers. Upgrade the detector tag from the regenerated import. Final now fires on the first visibility change to hidden (also a short tab switch), with pagehide fallback and the existing visible-time idle deadline. This lets integrations queue the hit earlier but does not guarantee browser or GA4 delivery. Later behaviour is no longer counted; set `finalOnHidden: false` to retain pause-on-hidden. The agent marker watch may still publish agent after final.

`CS` makes the next document start suspicious after a suspicious final. It adds no score/family, consumes the stored result at start and expires after that document unless fresh suspicious evidence exists. It never promotes to automated or declared_agent. These are labels only: retain all traffic and conversions.

WebMCP is **observed, page-forgeable** information, never authentication or a
classification signal. EventTarget prototype registration rejects ordinary
polyfill callback spoofing; handlers require an Event with strict isTrusted and
catch hostile getters. Earlier same-realm scripts can replace platform globals,
so this cannot establish cryptographic or tamper-proof provenance. Capture listeners
observe window, document and both modelContext locations; repeated delivery of the
same event is deduplicated. At 255 observations listeners disconnect.

**GA4 undercounts WebMCP usage after the final event (normally 8 seconds).** Later
tool events update only the local snapshot, with no extra analytics publication.
Agents that read longer before calling tools therefore systematically appear as
`capable`/`none` in GA4 even when the local snapshot later says `used`.
