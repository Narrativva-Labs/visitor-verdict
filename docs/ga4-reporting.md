# GTM installation and GA4 reporting

## Import and readiness wiring

1. In a GTM web container, open **Admin → Import Container**, choose [gtm/container-import.json](../gtm/container-import.json), select a workspace and **Merge**, then review conflicts and the import preview before confirming. Set **VV - GA4 measurement ID** to your existing measurement ID instead of `G-XXXXXXXXXX`. The import contains no Google tag or consent manager.
2. Keep **VV - detector** on **All Pages**, **Once per page**, priority **100**, with **No additional consent required**. Consent defaults should already be established. Do not put the detector on Initialization: it can run with consent unset on sites that push an earlier event.
3. Open the site's **existing Google tag**. Replace its early All Pages/Initialization firing trigger with **VV - initial OR VV - timer fallback 1s** as two ordinary firing triggers, not a trigger group. Set its advanced firing option to **Once per page**, so whichever trigger fires first starts it once. The timer interval is 1000ms, limit 1, enabled on all pages; it covers an unavailable or delayed detector.
4. In the existing Google tag's **Shared event settings** (using an event settings variable where appropriate), set event parameter **traffic_class = `{{VV - current class}}`**. Preserve existing consent handling. With a timely initial result, the first `page_view` can carry the current page's initial class rather than waiting for a later page. This setup requires changing the existing tag; importing alone does not wire it.
5. On every other **GA4 Event tag** (`gaawe`), add **traffic_class = `{{VV - current class}}`**, evaluated at that tag's firing time. Audit ecommerce, click and other tagged events. The dedicated final event described below is the exception: it must use the publication's DLVs.
6. Keep **VV - GA4 traffic_class** on **VV - final** with the mappings below. Preview initial/final events, version, first page_view, final DLV values, Google-tag firing count, navigation, delayed/denied consent and timer fallback before publishing. Neither a user property nor this setup backfills earlier events.

All imported named objects use `VV - `. The import creates two tags, six variables and three triggers. Underlying event/data names do not carry the prefix:

| Object | Definition |
|---|---|
| VV - detector | Custom HTML, All Pages, once per page, priority 100 |
| VV - GA4 traffic_class | GA4 Event, event name `traffic_class`, measurement ID `{{VV - GA4 measurement ID}}`, trigger VV - final |
| VV - initial / VV - final | Custom event `traffic_class`, filtered by `{{VV - DLV traffic_phase}}` equal to `initial` / `final` |
| VV - timer fallback 1s | Timer `gtm.timer`, 1000ms, limit 1, enabled on all pages |
| VV - DLV traffic_class / traffic_phase / traffic_score / traffic_version | Four Version 2 Data Layer Variables, each reading the corresponding unprefixed key, with no default |
| VV - current class | Validated live snapshot class, then startup previous class, then `undefined` |
| VV - GA4 measurement ID | Constant holding your destination ID |

### Final-event mappings

The dedicated event describes one data-layer publication. Use these exact mappings; do not substitute the live current-class variable:

| GA4 field | Variable |
|---|---|
| Event parameter `traffic_class` | `{{VV - DLV traffic_class}}` |
| Event parameter `traffic_phase` | `{{VV - DLV traffic_phase}}` |
| Event parameter `traffic_score` | `{{VV - DLV traffic_score}}` |
| Event parameter `traffic_version` | `{{VV - DLV traffic_version}}` |
| User property `traffic_class` | `{{VV - DLV traffic_class}}` |

Both detector phases contain `traffic_version: '1.0.0'`. Debug signal codes appear only in data-layer events when explicitly enabled; the production GA4 tag does not map them.

### Manual installation

Instead of importing, paste [gtm/custom-html.html](../gtm/custom-html.html) into a **VV - detector** Custom HTML tag, then create the variables, triggers and final event from the tables above. Retain the detector's once-per-page, priority and consent settings. Keep `debug: false`; review the wrapper's explicit `webgl: true` and `worker: true` opt-ins. Match any custom data-layer name in the GTM snippet and detector configuration.

The imported **VV - current class** Custom JavaScript variable uses:

```javascript
function() {
  var c;
  function valid(v) {
    return v === 'human' || v === 'suspicious' || v === 'automated' || v === 'declared_agent';
  }
  try {
    c = window.__visitorVerdict && window.__visitorVerdict['class'];
    if (valid(c)) { return c; }
  } catch (e) {}
  try {
    c = window.__visitorVerdictLast;
    if (valid(c)) { return c; }
  } catch (e) {}
  return undefined;
}
```

It never reads or writes storage. `__visitorVerdictLast` is the validated previous final class captured once at startup, not a live storage lookup. Unknown remains undefined, never default human. Re-read `window.__visitorVerdict` for the latest frozen snapshot; previously held snapshots do not update.

## CSP-safe current-class variable

For a variable without GTM Custom JavaScript evaluation, open **Templates → Variable Templates → New → Import** and choose [gtm/templates/vv-current-class.tpl](../gtm/templates/vv-current-class.tpl). Save it, then create a variable using the **VV - current class** template. Replace the imported Custom JavaScript variable, preserving or updating every reference.

The template uses `copyFromWindow('__visitorVerdict.class')` then `copyFromWindow('__visitorVerdictLast')`, with strict enum validation. Its sole permission is read access to those two global paths; it has no write, execute, storage or network permissions. This covers the variable only: the detector's script deployment must still satisfy site CSP. Do not weaken CSP for the Custom JavaScript fallback. The template has local structural/behavioural contract coverage; an authenticated GTM Template Editor import has not yet been verified. See Google's [template API reference](https://developers.google.com/tag-platform/tag-manager/templates/api), [permission reference](https://developers.google.com/tag-platform/tag-manager/templates/permissions), and [template import instructions](https://developers.google.com/tag-platform/tag-manager/templates#export_and_import).

## Consent and timing

The supplied detector runs before consent under the project's deployment policy. It makes no analytics or advertising requests. Consent defaults/updates and Google's built-in checks remain the site's responsibility; the site owner chooses the applicable setup with their DPO. A local class does not grant consent, and readiness triggers do not override it. Pre-consent classification must never feed advertising platforms. For consent-gated loading and withdrawal, see [privacy](privacy.md#consent-and-deployment).

The readiness pattern makes an initial class available to the Google tag's first `page_view` when the detector wins the race. Timer fallback can fire without a class, or with a startup fallback if one exists. Missing/delayed detection, consent-gated loading and blocked delivery can leave events unlabelled. Validate both paths in Preview; there is no guarantee of a class on every event.

Shared event settings are evaluated when the Google tag fires, once for that document. Automatic `page_view`, `user_engagement` and enhanced-measurement events can retain that startup value; later final classifications do not refresh it. Other explicitly tagged GA4 events re-evaluate `VV - current class` when they fire. An initial human label can therefore coexist with later final automation evidence. Use any observed automated/declared evidence for whole-session reporting; a later human never cancels it.

Keep the dedicated final event even if no later interactions occur: it provides coverage and final class/phase/score/version. Never mark `traffic_class` as a key event. The user property means **last observed class**, applies from set time, may persist into later visits, and is not a stable visitor attribute. Never use it for session exclusion or backfill. The detector cannot retract collected events.

## Reporting

In **Admin → Data display → Custom definitions**, create:

| Display name | Scope | Field |
|---|---|---|
| Traffic class (event) | Event | Event parameter `traffic_class` |
| Traffic class (user — last observed) | User | User property `traffic_class` |
| Traffic phase (event), optional | Event | Event parameter `traffic_phase` |

Optionally register event-scoped `traffic_version` to distinguish release/configuration intervals. This is static release metadata.

Register `traffic_score` as a custom metric only if needed. Score is a heuristic, not a probability.

| Stored value | Reporting label and interpretation |
|---|---|
| `human` | **No automation detected**; not proof of a person |
| `suspicious` | Uncertain evidence; show separately for review |
| `automated` | Automation evidence; does not establish intent or abuse |
| `declared_agent` | Unverified identity claim; tokens can be spoofed |
| Missing | Unknown; never silently treat as human |

Use these session views, scoped to the web stream and the same date range:

- **All sessions**: baseline including unknown coverage.
- **Sessions excluding detected automation**: exclude the whole session if any event carries `automated` or `declared_agent`. Keep unknown sessions; show suspicious sessions separately within this retained traffic.
- **Stricter sensitivity view**: additionally exclude sessions containing `suspicious`.
- **Observed human-only cohort**, diagnostic only: at least one `human` observation and no automated, declared or suspicious observations. It selects measurable, labelled visits and misses unknown traffic.

Exclusion preserves unlabelled sessions and their earlier pageviews/purchases while removing sessions with observed evidence. “Only human” would bias the headline toward visits with successful classification and delivery. Always show coverage: sessions with any valid class versus sessions without, plus missing-ID pings separately. A later human label never cancels earlier automation evidence in that session.

Headline purchase conversion rate = **purchasing sessions / sessions in the same cohort**. Do not mix filtered purchasers with all-session denominators; do not count `add_to_cart` as headline conversion. Show excluded purchase revenue separately. Removing low-converting bot sessions can raise CR by arithmetic; it does not demonstrate marketing improvement.

For GA4 UI steps use [Explorations and comparisons](analysis/ga4-explorations.md): create a **Session segment** including all web-stream sessions, then exclude sessions where a `traffic_class` event has class `automated|declared_agent` **OR any event has that event parameter**. Keep name and class conditions on the same event; event name alone must not exclude all classified sessions. Standard-report comparisons on the event-scoped dimension are scoped label comparisons, not reliable whole-session exclusions; never use the user property as a shortcut. [BigQuery SQL](analysis/bigquery.sql) supplies session flags, first/last evidence, class at first purchase and consistent cohorts; [Looker Studio](analysis/looker-studio.md) uses those session aggregates.

**Do not use the class to block access, deny service or make decisions about individuals.** Assistive technology can resemble some input patterns. Leave conversion collection running while reviewing evidence. Any tag exception must match that tag's own firing event and have a class available then; a `traffic_class` exception cannot block an unrelated conversion event. Pre-consent classification must never feed advertising platforms.

