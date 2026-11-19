# AI website visitors and browser automation tells

Research date: **2026-11-18**. Scope: evidence for the small, ES5, local-only detector described in the detector design. This is desk research, not a browser benchmark. No framework/browser combinations were executed for this document. Recommendations below are proposed calibration, not measured accuracy.

Dates beside sources mean publication/update dates when explicitly available. Otherwise **accessed 2026-11-18** applies to every link, including live documentation and repository `main`/`master`. Moving source branches are not release guarantees; pin versions and record actual browser versions in the eventual test report. An absent documented identifier means “not established by this research”, not “proved absent in every request”.

## Findings that determine the design

1. An AI product, its crawler, its cloud browser, and its local browser integration can have different identities. Do not equate `ChatGPT-User` with every ChatGPT agent visit or `Claude-User` with Claude in Chrome.
2. A declared UA token is a **claim**, not authenticated vendor identity. The name `declared_agent` fits this distinction. Verification through published IP ranges or HTTP signatures belongs at the server/CDN.
3. Browser automation has useful positive evidence, but no universal negative test. A real Chrome session driven through an extension or OS input may look exactly like its human owner. `human` must mean “no sufficient evidence observed”.
4. Fetchers that never execute the page's JavaScript never run this detector or its GA4 tag. A long agent token array does not fix that blind spot.
5. Do not implement the full fingerprinting suites described below. Their detailed outputs, hashes, entropy gathering and cross-context profiling conflict with the repository's intended scope. Reduce allowed checks to temporary booleans; export only class/score and optional debug codes.

## 1. Agents, fetchers and identity

### Documented identities and exact examples

Match stable tokens case-insensitively, not complete UA strings or Chrome versions. These are examples published by operators, not a promise that the entire product always uses them.

| Product / route | Exact token or documented UA | Interpretation and source |
|---|---|---|
| ChatGPT user-triggered retrieval | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot` | Certain ChatGPT / custom GPT user actions; independent of search and training crawlers. [OpenAI crawler reference](https://developers.openai.com/api/docs/bots), live reference. |
| ChatGPT search | `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot` | Search discovery. Version can change; robots.txt requests can add a marker. [OpenAI](https://developers.openai.com/api/docs/bots). |
| OpenAI training | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot` | Training crawler. [OpenAI](https://developers.openai.com/api/docs/bots). |
| OpenAI ad landing-page checks | `OAI-AdsBot/1.0` | Separate declared automated visitor, not necessarily an agent executing JS. [OpenAI](https://developers.openai.com/api/docs/bots). |
| Anthropic fetch/search/training | `Claude-User`, `Claude-SearchBot`, `ClaudeBot` | User retrieval, search, and training respectively. The official reference establishes these tokens; this report does not invent complete UA templates for them. [Anthropic crawler policy](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler), displayed as updated over two weeks before access. |
| Anthropic-hosted browser, including Claude Duet | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-Agent/1.0) Chrome/154.0.0.0 Safari/537.36` | **Newer distinction:** real browser on Anthropic infrastructure with `Claude-Agent` token; operator publishes `Claude-Agent` IPs in `https://claude.com/.well-known/sail`. SAIL is a draft publication format, not proof that every request has WBA signatures. [Anthropic hosted-browser identification](https://support.claude.com/en/articles/18234133-how-do-anthropic-hosted-browsers-identify-themselves-when-they-browse-the-web-on-a-user-s-behalf), updated over two weeks before access. |
| Perplexity search | `Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)` | Search crawler, not a training crawler according to the operator. [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers). |
| Perplexity retrieval | `Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)` | User-triggered fetcher; use its own IP list rather than PerplexityBot's list. This is not a documented guarantee for every Comet interaction. [Perplexity](https://docs.perplexity.ai/docs/resources/perplexity-crawlers). |
| Google-hosted agent | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent) Chrome/W.X.Y.Z Safari/537.36` | Official template; `W.X.Y.Z` is a placeholder, not a literal observed version. Mobile template also contains `Google-Agent`. User-directed agents hosted by Google. [Google user-triggered fetchers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers), updated **2026-08-19**. |
| Google Vertex AI crawler | `Google-CloudVertexBot` | Separate explicit crawler identity; not the identity of local Chrome agent actions. [Cloudflare bot reference](https://developers.cloudflare.com/ai-crawl-control/reference/bots/), **2026-04-23**. |
| Google Gemini Notebook | `Google-GeminiNotebook`; formerly `Google-NotebookLM` | Current reference says old name was supported until August 2026. A fetcher route, not the identity of all Gemini in Chrome actions. [Google](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers), **2026-08-19**. |
| Gemini Deep Research (third-party evidence) | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Gemini-Deep-Research; +https://gemini.google/overview/deep-research/) Chrome/135.0.0.0 Safari/537.36` | **Not in Google's user-triggered fetcher reference** (checked 2026-11-19). Listed by independent bot directories ([Dark Visitors](https://darkvisitors.com/agents/gemini-deep-research), [Known Agents](https://knownagents.com/agents/gemini-deep-research)) and in a Cloudflare reporting script's AI-assistant list. Added as a declared token only; like every token it is an unverified claim. |
| Mistral user retrieval | `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)` | Current official docs describe user actions in Vibe. Also document `MistralAI-Index/1.0` and `MistralAI-Training/1.0` using the same wrapper. [Mistral crawlers](https://docs.mistral.ai/robots). |
| DuckDuckGo AI answers | `DuckAssistBot` | Operator explicitly identifies real-time crawling for AI-assisted answers. Distinguish ordinary DuckDuckGo browser users. [DuckDuckGo help](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot). |
| Amazon search/training-related crawling | `Amazonbot`; current reference also lists `Amzn-SearchBot` | Amazonbot example: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1) Chrome/W.X.Y.Z Safari/537.36`. These names do not identify all Nova Act sessions. [Amazon Web Search crawlers](https://developer.amazon.com/docs/amazonbot/amazonbot.html), search index dated approximately October 2026. |
| Common Crawl | `CCBot/2.0 (https://commoncrawl.org/faq/)` | General public corpus crawler used downstream for many purposes, including AI. Calling this an interactive AI agent would be inaccurate. [Common Crawl operator reference](https://commoncrawl.org/ccbot). |
| Apple | `Applebot` | Powers search/Siri/etc.; not proof of AI task execution. **`Applebot-Extended` is a robots usage-control token, not a separate crawler.** [Applebot reference](https://support.apple.com/en-us/119829). |
| Meta | `meta-externalagent`, `meta-externalfetcher`, `Meta-WebIndexer` | AI-related crawler/fetcher names; not the same as human traffic in Facebook/Instagram in-app browsers or the `facebookexternalhit` link preview fetcher. Current sharing docs explicitly list `Meta-WebIndexer`; corroborate the external names in [Cloudflare's bot reference](https://developers.cloudflare.com/ai-crawl-control/reference/bots/). [Meta crawler reference](https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers). |
| ByteDance | `Bytespider` | Explicit AI crawler identity in the CDN operator's directory; no claim here that ByteDance publishes a stable full browser UA. [Cloudflare bot reference](https://developers.cloudflare.com/ai-crawl-control/reference/bots/), 2026 live reference. |

**Do not add `Google-Extended`:** Google explicitly says there is no separate HTTP UA; it controls downstream use of material fetched under other identities. [Google common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers). Similarly, don't infer an AI visit from ordinary `Googlebot`, `bingbot`, `Chrome`, `Edg`, `Brave`, `OPR` or `Safari`.

### Browser agents that can look human

“Real browser” does not imply unautomated, and “Chromium-based product” does not imply a detectable automation flag. The expected visibility below is an inference from the documented architecture unless an explicit token is documented above.

| Product / mode | Documented execution model; what a page can infer |
|---|---|
| **ChatGPT agent mode / Operator successor / current Cloud browser** | Operator was integrated into ChatGPT agent on **2025-07-17**. Current docs call the remote route Cloud browser and describe signed requests. `ChatGPT Agent` is also a WAF bot category/name, **not established here as a literal UA token**. The official allowlisting guide does not promise a unique JS-visible UA or `webdriver` value for all sessions. [Operator update](https://openai.com/index/introducing-operator/), [Cloud browser access](https://developers.openai.com/commerce/agent-access). |
| **Claude in Chrome / Claude Code Chrome integration** | Operates inside the user's Chrome, sharing login state. No official per-action UA suffix was established in these docs. Expect ordinary Chrome signals; absence of `Claude-User` is normal for this route. Do not conflate this with Anthropic-hosted `Claude-Agent`. [Claude Code Chrome docs](https://code.claude.com/docs/en/chrome), [Claude in Chrome](https://claude.com/claude-in-chrome). |
| **Perplexity Comet** | Agent integrated into a Chromium browser. Its crawler documentation does not specify a separate Comet UA contract. MIT's index distinguishes product documentation from third-party observations of normal Chrome UAs; those observations are not a universal guarantee. Do not add bare `Comet` or assume every action includes `Perplexity-User`. [Comet operator page](https://www.perplexity.ai/comet), [2025 AI Agent Index: Comet](https://aiagentindex.mit.edu/2025/comet/), released 2026. |
| **Gemini in Chrome auto browse** | Uses tabs in the user's Chrome with visible task controls and site sign-in permission. No mandatory page-visible agent token established by the help page. **Google-hosted `Google-Agent` is a separate identified route.** [Chrome auto browse help](https://support.google.com/chrome/answer/16821166?hl=en). |
| **Project Mariner** | Historical browser-agent project, not itself a verified stable UA token. Use the currently documented `Google-Agent` when present; do not assume every later Chrome integration is the cloud implementation. [Google announcement, **2025-05-20**](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-universal-ai-assistant/), [Google hosted-agent identification](https://developers.google.com/crawling/docs/crawlers-fetchers/allow-google-agent), live 2026 docs. |
| **Microsoft Copilot** | Distinguish Bing retrieval, hosted task products, and Browse with Copilot in Edge. Microsoft explicitly documents user-requested website navigation/actions in Edge; it does not specify a universal `Copilot-User` token in the cited docs. Edge's own UA cannot establish whether a human or Copilot acted. [Edge announcement, **2025-07-28**](https://blogs.windows.com/msedgedev/2025/07/28/introducing-copilot-mode-in-edge-a-new-way-to-browse-the-web/), [Browse with Copilot support](https://support.microsoft.com/en-us/microsoft-365-copilot/using-microsoft-copilot-in-edge-at-work). |
| **Opera Neon** | Neon Do acts inside the user's browser; other tasks can run in cloud environments. No verified universal agent UA token found. Browser-brand detection would classify human Neon users too. [Operator release, **2025-09**](https://blogs.opera.com/news/2025/09/opera-neon-agentic-ai-browser-release/), [Intelligent mode, **2026-02**](https://blogs.opera.com/news/2026/02/opera-neon-ai-browser-intelligent-mode/). |
| **Browserbase / Stagehand** | Cloud browser infrastructure, not one fixed AI identity. Operator offers WBA identity; no universal UA token is specified in the cited material. Signed platform identity does not identify the underlying model or prove benign intent. [Browserbase automation](https://www.browserbase.com/use-case/web-automation), [identity](https://www.browserbase.com/identity), [WBA explanation, **2026-10**](https://dev.browserbase.com/blog/what-is-web-bot-auth). |
| **Brave Leo AI browsing** | Works within Brave; testing announcement published December 2025. Brave deliberately uses Chrome-like UAs on desktop and Safari-like UAs on iOS. Even detecting Brave would not detect agent activity. [AI browsing announcement](https://brave.com/blog/ai-browsing/), [operator UA wiki](https://github.com/brave/brave-browser/wiki/User-Agents). |
| **Amazon Nova Act** | SDK can drive local Chrome, including a default Chrome profile, or use AgentCore remote browser. No universal `NovaAct` UA contract found. Host choice determines tells. [AWS SDK source/docs](https://github.com/aws/nova-act), live 2026. AgentCore WBA is optional, separately configured. |
| **Manus** | Has a cloud browser and a local Browser Operator route. Operator trust docs describe local browser execution with user's authentication retained locally. Do not assume a cloud identity covers local operation. [Manus takeover help, **2026**](https://help.manus.im/en/articles/11711218-how-can-i-take-over-manus-browser-or-vs-code), [operator trust FAQ](https://trust.manus.im/faq). Cloudflare lists Manus Bot, but the linked operator UA page returned 404 during this research. The exact `Manus-User/1.0` suffix and `https://api.manus.im` signing identity need primary-source confirmation before default deployment; see evidence gap below. |

**Evidence gap, Manus:** the current [isbot pattern source](https://github.com/omrilotan/isbot/blob/main/src/patterns.json) includes `manus-user/`, and [Cloudflare Radar's Manus entry](https://radar.cloudflare.com/bots/directory/manus-bot) is indexed with an operator documentation link. This establishes a practical candidate, not an authenticated full UA/signing contract. The operator link `https://manus.im/help/Manus-user` failed (404); Radar detail fetches timed out. Keep this candidate separate from the verified default array. Do not fill missing primary evidence with a fabricated “exact” string.

### Web Bot Auth and `Signature-Agent`

Web Bot Auth builds agent identity on **HTTP Message Signatures (RFC 9421)**. The architecture/directory conventions remain evolving drafts; header syntax differs between implementations. Check the operator's current syntax, covered fields, key lookup, timestamps/replay handling and signature verification. A bare header can be spoofed. None of these inbound request headers is exposed by `navigator`; a pure page script cannot read or cryptographically verify its navigation request headers.

| Operator / route | Documented usage as of access date |
|---|---|
| OpenAI Cloud browser | Certain requests carry `Signature`, `Signature-Input`, and **`Signature-Agent: "https://chatgpt.com"`**, including literal quotes. Keys: `https://chatgpt.com/.well-known/http-message-signatures-directory`. [OpenAI guide](https://developers.openai.com/commerce/agent-access). |
| Google hosted agents | Experimental signing of a subset; documented syntax **`Signature-Agent: g="https://agent.bot.goog"`** with `g` labels. Keys: `https://agent.bot.goog/.well-known/http-message-signatures-directory`. [Google guide](https://developers.google.com/crawling/docs/crawlers-fetchers/allow-google-agent), 2026; [user-triggered fetcher reference](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers). |
| Browserbase | Participates in signed-agent identity; request access/enablement through its program rather than assuming every session is signed. [Operator WBA program](https://www.browserbase.com/contact-web-bot-auth), [Cloudflare Radar directory](https://radar.cloudflare.com/bots/directory/browserbase). |
| Amazon Bedrock AgentCore Browser | Preview and **opt-in at Browser Tool creation**; when enabled, browser requests are signed. This is not evidence that all Nova Act local sessions sign. [AWS configuration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-web-bot-auth.html). |
| Anthropic hosted browsers | Official reference documents UA plus published IPs in SAIL. Do not relabel SAIL as RFC 9421 signing without separate evidence. [Anthropic](https://support.claude.com/en/articles/18234133-how-do-anthropic-hosted-browsers-identify-themselves-when-they-browse-the-web-on-a-user-s-behalf). |

Cloudflare documents a structured-string `Signature-Agent` format and verification requirements. Signed identity means an operator made the request, not that the visitor is human or authorized for a purchase. [Cloudflare Web Bot Auth](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/), 2026 live docs. Do not implement WBA network/key fetching inside this repository's detector. A later server integration would need an explicit design and is outside this phase.

## 2. Browser-side tells: useful positives, conditional leaks, patched heuristics

### Framework and browser matrix

| Tool / mode | Useful positive evidence | Limits / current patching |
|---|---|---|
| Stock Selenium / ChromeDriver | `navigator.webdriver === true`; recognizable driver artifacts when injected | UA can be ordinary Chrome. Headed mode does not remove WebDriver. Driver-generation-dependent artifacts include window `cdc_…_Array`, `_Promise`, `_Symbol`; scanning **only document `$cdc_`** misses these. BotD checks the broader three-letter-prefix form; do not assume current builds always inject it. [BotD source](https://github.com/fingerprintjs/BotD/blob/main/src/sources/distinctive_properties.ts). |
| Stock Playwright Chromium | WebDriver flag; headless UA/client-hint brand when unmodified; binding/init-script artifacts if present | Do not promise globals on every navigation or framework version. Different execution worlds and feature paths matter. Current binding controller is discussed below. |
| Playwright Firefox / WebKit | WebDriver/automation artifacts if actually exposed | No `HeadlessChrome` token expected. Chromium-specific `window.chrome`, PDF, renderer or CDP checks cannot be applied to these engines. Patch flags for Blink do not alter Firefox/WebKit. Playwright uses patched browser builds. [Playwright browser docs](https://playwright.dev/docs/browsers). |
| Puppeteer | Default headless UA / webdriver when unmodified; occasional evaluation-source traces | No universal public `window.puppeteer` object. Current source uses `pptr:` evaluation-source URLs. These are labels in stack/source paths, not automatically readable window properties. [Puppeteer util source](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/common/util.ts). |
| New headless Chrome | Explicit `HeadlessChrome` claim when present, webdriver in relevant launch modes | **Chrome 112 unified headless with regular Chrome.** New headless has ordinary browser capabilities; empty plugins, absent Chrome APIs and zero outer dimensions are not invariants. Old headless is separate `chrome-headless-shell`; Puppeteer defaults to new headless since v22. [Chrome architecture](https://developer.chrome.com/docs/chromium/headless), [shell explanation](https://developer.chrome.com/docs/automation-and-testing/headless-chrome-shell), [Chrome testing tools](https://developer.chrome.com/blog/tools-from-chrome-for-frictionless-testing). |
| puppeteer-extra-plugin-stealth / playwright-extra | May leave unpatched framework or cross-context inconsistencies | Patches UA, webdriver, languages, plugins, permissions, hardware concurrency, WebGL vendor, outer dimensions, Chrome APIs, iframe window, codecs and source URLs. The exact enabled set matters; “stealth detected by no plugins” is not a defensible universal claim. [Concrete evasion list](https://github.com/berstend/puppeteer-extra/blob/master/packages/puppeteer-extra-plugin-stealth/index.js), [operator README](https://github.com/berstend/puppeteer-extra/blob/master/packages/puppeteer-extra-plugin-stealth/readme.md). |
| undetected-chromedriver | Only remaining positive artifacts on the actual build | Project describes preventing driver-variable injection since 3.4.0, rather than simply renaming/deleting variables. It also patches headless behavior. No reliable universal `cdc_`/webdriver detection should be claimed. README's “undetected” claims are not independent measurements. [Project changelog](https://github.com/ultrafunkamsterdam/undetected-chromedriver). |
| nodriver | Default unmodified headless UA or launch-induced flags can still disclose automation | Direct browser protocol control, no Selenium/WebDriver dependency. Name alone does not guarantee `navigator.webdriver` is false in every launch configuration. No mandatory Selenium globals to detect. [Project source/README](https://github.com/ultrafunkamsterdam/nodriver). |
| Camoufox | Build-specific implementation errors, not a stable generic tell established here | Firefox-based, current project describes native/C++ spoofing and an isolated automation layer, including workers. JS descriptor/proxy probes alone cannot assume it behaves like injected stealth. Its claims still require independent validation. Chrome-only tests are inapplicable. [Project architecture](https://github.com/daijro/camoufox), source accessed 2026. |
| Rebrowser / similar patched protocol clients | Whatever remains observable in that pinned build | Rebrowser explicitly addresses `Runtime.enable` leakage, source URLs and utility-world naming. CDP detection is not equivalent to agent identification and patches evolve. [Patch descriptions](https://github.com/rebrowser/rebrowser-patches). |

MDN documents `navigator.webdriver` as a cooperative automation flag: Chrome enables it under `--enable-automation`, headless or `--remote-debugging-port=0`; Firefox under Marionette. A true value is good evidence of automation instrumentation, **not of AI or maliciousness**. False/undefined proves nothing. Chromium's `--disable-blink-features=AutomationControlled` and stealth can suppress it. [MDN webdriver](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver), [stealth webdriver evasion](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions/navigator.webdriver).

### Exact globals worth testing, with qualifications

- Legacy PhantomJS: `window.callPhantom`, `window._phantom`; Nightmare: `window.__nightmare`. Strong positives for those runtimes when type/shape is appropriate, weak coverage of current tools.
- `window.domAutomation`, `window.domAutomationController`: Chromium automation/test plumbing when exposed, not an invariant of new headless or Playwright.
- Selenium document properties: `__selenium_evaluate`, `__selenium_unwrapped`, `__webdriver_evaluate`, `__driver_evaluate`, `__webdriver_unwrapped`, `__driver_unwrapped`, `__fxdriver_evaluate`, `__fxdriver_unwrapped`, `__webdriver_script_fn`, `__webdriver_script_func`, `__webdriver_script_function`, `__$webdriverAsyncExecutor`.
- Driver cache prefixes: document `^\$cdc_` / `^\$wdc_`; **also window** `^cdc_[A-Za-z0-9]+_(Array|Promise|Symbol|Object|Proxy|JSON|Window)$` with function/object shape checks. Keep this narrow; a generic property called `driver`, `webdriver`, `emit`, `spawn`, `nightmare` or `process` is not enough in an application.
- Prefer `Object.getOwnPropertyNames` for a bounded local scan (includes non-enumerable own properties); `Object.keys` alone can miss non-enumerable artifacts. Never export the names collected. Avoid evaluating arbitrary getters during a scan.

These names are grounded in [BotD's distinctive property source](https://github.com/fingerprintjs/BotD/blob/main/src/sources/distinctive_properties.ts) (accessed 2026-11-18). The precise `cdc_` prefix and extra suffixes remain version-dependent candidates; this research did not establish their presence in the latest installed ChromeDriver. Presence checks can still collide with page code or be deliberately spoofed; validate shape and test a clean baseline.

**Playwright has changed:** a 2025 first-party detection investigation described `window.__playwright__binding__` and `window.__pwInitScripts`. [Castle research, **2025**](https://blog.castle.io/how-to-detect-headless-chrome-bots-instrumented-with-playwright/). Current `main` explicitly defines `__playwright__binding__controller__` and `__pw_fn_` in [utilityScriptSerializers.ts](https://github.com/microsoft/playwright/blob/main/packages/isomorphic/utilityScriptSerializers.ts). [PageBinding.createInitScript](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/page.ts) installs the controller for the binding path. This is concrete evidence of a feature-dependent artifact, not evidence that every plain `page.goto()` exposes it. Check the three exact known names when present; do not classify any arbitrary `__playwright*` property as hard evidence. `__pw_fn_` may be an application-chosen exposed function path, so defer until measured.

**Puppeteer's `__puppeteer_evaluation_script__` is often misdescribed:** historical evaluation scripts used it as a sourceURL label. It is not established as a guaranteed `window` global. Current source defines `pptr:internal` and `pptr:…` URLs. Do not give a nonexistent assumed global a hard rule. [Current Puppeteer source](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/common/util.ts), [stealth sourceURL evasion](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth/evasions/sourceurl).

**CDP serialization probes:** an `Error.stack` getter plus console serialization has been used to reveal runtime instrumentation. It can be patched, can behave differently by Chrome/framework version, and developer tools can introduce similar observer behavior. Rebrowser's explicit `Runtime.enable` countermeasure demonstrates that this is not a durable proof. Keep out of the default detector: no console tricks, debugger timing or expensive cross-world probes. [Rebrowser implementation rationale](https://github.com/rebrowser/rebrowser-patches).

**Input trust:** `dispatchEvent` / programmatic DOM events can be untrusted; automation through browser input protocols can produce trusted events. Thus `isTrusted === true` does **not** prove a person, while `false` proves only script dispatch, which ordinary UI libraries can also do. Do not use synthetic scroll events as proof. [MDN Event.isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted), [WebDriver input actions](https://w3c.github.io/webdriver/#actions).

## 3. What open-source detectors actually check

### FingerprintJS BotD (open-source, not the commercial Fingerprint product)

The inspected [detector registry](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/index.ts) contains **18** registered detectors, not a universal modern-agent classifier. Its README separates open-source capabilities from commercial AI-assistant/WBA detection. Source naming something “HeadlessChrome” does not make its heuristic a safe hard rule for this project. Source accessed 2026-11-18:

| Registered detector | Concrete condition / source |
|---|---|
| `detectAppVersion` | `/headless/i`, `/electron/i`, `/slimerjs/i` in appVersion. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/app_version.ts). |
| `detectDocumentAttributes` | Root-element attribute names include `selenium`, `webdriver`, `driver`. Page-authored attributes can collide. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/document_element_keys.ts). |
| `detectErrorTrace` | `PhantomJS` in captured stack trace. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/error_trace.ts). |
| `detectEvalLengthInconsistency` | Native eval string lengths 37, 39, 33 inconsistent with detected WebKit/Gecko, IE, Chromium engines respectively. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/eval_length.ts). |
| `detectFunctionBind` | Bind source reports non-function; classified PhantomJS. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/function_bind.ts). |
| `detectLanguagesLengthInconsistency` | Collected language list has length zero. Collection includes `language` and legacy fallbacks; **not simply `navigator.languages.length === 0`**. [Detector](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/languages_inconsistency.ts), [collector](https://github.com/fingerprintjs/BotD/blob/main/src/sources/languages.ts). |
| `detectNotificationPermissions` | Chrome-only denied/prompt mismatch reported by collector. [Detector](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/notification_permissions.ts). |
| `detectPluginsArray` | Plugin list fails the collector's PluginArray check. [Detector](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/plugins_array.ts). |
| `detectPluginsLengthInconsistency` | Zero plugins only for detected Chrome + Chromium engine + non-Android. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/plugins_inconsistency.ts). |
| `detectProcess` | `process.type === 'renderer'` or non-null `process.versions.electron`; detects Electron, which also hosts legitimate human apps. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/process.ts). |
| `detectUserAgent` | PhantomJS, Headless, Electron, SlimerJS tokens. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/user_agent.ts). |
| `detectWebDriver` | Truthy collected WebDriver flag; does not prove headlessness despite result label. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/webdriver.ts). |
| `detectWebGL` | Exact `vendor == 'Brian Paul' && renderer == 'Mesa OffScreen'`. **Not** a generic rule for absent WebGL or every Mesa renderer. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/webgl.ts). |
| `detectWindowExternal` | `Sequentum` in external object's string. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/window_external.ts). |
| `detectWindowSize` | Both outer dimensions zero **and document focused**; source explains unfocused new tabs can have zero sizes. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/window_size.ts). |
| `detectMimeTypesConsistent` | MimeTypeArray prototype and each entry's MimeType prototype disagree with expected native prototypes. [Collector](https://github.com/fingerprintjs/BotD/blob/main/src/sources/mime_types_consistence.ts), [detector](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/mime_types_consistence.ts). |
| `detectProductSub` | Chrome/Safari/Opera/WeChat productSub differs from `20030107`. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/product_sub.ts). |
| `detectDistinctiveProperties` | Named globals: Awesomium, CEF `RunPerfTest`, CefSharp, `emit`, FMiner, Geb, Nightmare, Phantomas, PhantomJS, Rhino `spawn`, Selenium/driver artifacts, WebDriverIO `wdioElectron`, domAutomation. Broad three-letter driver-prefix regex on window plus named document properties. These runtime checks are broader than safe proof of automation on a normal website. [Source](https://github.com/fingerprintjs/BotD/blob/main/src/sources/distinctive_properties.ts). |

### CreepJS

The [headless module](https://github.com/abrahamjuliot/creepjs/blob/master/src/headless/index.ts), accessed 2026-11-18, computes heuristic percentages from:

- `likeHeadless`: Blink without `window.chrome`; notification mismatch; empty plugins/MIME types; denied notifications; ActiveText resolving to `rgb(255, 0, 0)`; light color preference; blank UA-data platform; PDF disabled; screen equals available screen; viewport/screen geometry; worker SwiftShader; missing Web Share; platform-estimated absence of Content Index, Contacts Manager and downlinkMax.
- `headless`: webdriver true, unexpected undefined webdriver in its CSS-supported context, or a recorded webdriver lie; HeadlessChrome in UA/appVersion or worker UA.
- `stealth`: detached/srcdoc iframe behavior; late insertion of `chrome` among window properties; invalid Chrome runtime function prototypes/constructibility/errors; Function.toString lies; main/worker WebGL renderer disagreement.

These are descriptions of **its checks**, not our recommendations. Light mode, disabled PDFs and absent share APIs are normal human configurations.

Its separate [lies module](https://github.com/abrahamjuliot/creepjs/blob/master/src/lies/index.ts) probes API tampering through native function/getter `toString`, function metadata, descriptors/prototypes, call/apply/new behavior, error behavior and comparison with iframe references. Wider CreepJS gathers canvas, audio, fonts, WebGL, workers and many other entropy sources. A lie can mean a privacy extension, not automation. Do not copy its fingerprint/hashing or lie-percentage model into the <5 KB ES5 detector.

### isbot

[isbot implementation](https://github.com/omrilotan/isbot/blob/main/src/index.ts) is **UA regex classification only**. It checks no webdriver, events, renderer, browser globals or HTTP signature. Its fallback regex is `bot|crawl|http|lighthouse|scan|search|spider` (case-insensitive). [Pattern list](https://github.com/omrilotan/isbot/blob/main/src/patterns.json), accessed 2026-11-18, includes named tools (`chrome-lighthouse`, `phantomjs`, `playwright`, `selenium`, `manus-user/`, `cypress/`), crawler words, CLI clients, monitoring/security tools and broad shape patterns. It uses lookbehind in some patterns; its full list is not an ES5-safe drop-in. It detects many legitimate nonhuman clients but cannot separate a genuine Chrome agent session from an owner using that browser. Do not import its generic `agent`, `http`, `search` matches into `declared_agent`.

## 4. False-positive traps

| Human environment | Trap and conservative treatment |
|---|---|
| Android/iOS, tablets, touch-only users | No desktop plugins, mouse movement, `window.chrome` or UA Client Hints may be normal. iPad desktop-style UA complicates mobile detection. Use touch/pointer/keyboard as equivalent interaction families; never impose Chrome checks on iOS Chrome's WebKit UA. |
| Safari / WKWebView / in-app browsers | Missing Permissions API, notification capability, navigator fields and Chromium globals are ordinary engine/embedding differences. A missing or rejected API is “unknown”, not a positive signal. Desktop-request mode does not convert the underlying engine. |
| Browser PDF settings | Modern `navigator.plugins` is standardized around inline PDF support: five compatibility entries **when supported**, otherwise an empty list. “Real Chrome always has five” is too strong; desktop settings and enterprise policy can disable it. [MDN plugins](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/plugins). |
| Brave / privacy extensions | Modified values, blocked APIs and function wrappers can be deliberate protection. Brave UA often looks like Chrome. Never label privacy protection as hard automation. [Brave UA wiki](https://github.com/brave/brave-browser/wiki/User-Agents). |
| Firefox Resist Fingerprinting / Tor-style protections | Fixed dimensions and CPU/language values are expected. Firefox's RFP can disable the WebGL debug-renderer extension. Missing extension is **not** WebGL failure. [Mozilla RFP](https://support.mozilla.org/en-US/kb/resist-fingerprinting), [MDN WebGL extension](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_debug_renderer_info). |
| Old devices, VMs, remote desktop, disabled acceleration | Software graphics or unavailable WebGL do not prove bots. SwiftShader/llvmpipe/softpipe can reflect GPU limitations or policy. Never match all `Mesa`/all `ANGLE`; those include ordinary hardware rendering. Treat these as one correlated graphics family. |
| Fullscreen / kiosk / small monitors / responsive windows | Screen equal to viewport, 800×600, or 1280×720 is not unique to automation. Playwright's configured viewport is not a secret invariant; Puppeteer itself defaults to 800×600. [Puppeteer default viewport source](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/common/util.ts). |
| Background tabs, prerendering, minimization | Zero dimensions, lost focus, and no events can be normal. Gate geometry on visibility and focus. Count only actual visible exposure, not wall-clock time; early pagehide is not eight seconds of inactivity. [BotD window-size caveat](https://github.com/fingerprintjs/BotD/blob/main/src/detectors/window_size.ts). |
| Readers, assistive input, keyboard navigation, embedded media | Eight visible seconds without input is common. Reading and watching are not bot behavior. Never require a mouse; do not treat absence of movement as proof. |
| Application-generated events | Frameworks dispatch synthetic input/scroll events for legitimate UI functions. `isTrusted === false` is a script-event fact, not a bot fact. Don't let one synthetic event poison a session. [MDN isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted). |
| Fast navigation / back-forward cache | Humans can follow three short links quickly or revisit cached pages. Repeated URL reloads, duplicate detector injection, BFCache restores and prerender activation must not inflate the timestamp list. Count qualifying intervals, not raw page count. |
| HTTP/insecure contexts and permissions policy | Notification state can be denied by origin security, policy or user settings; APIs may reject query names. Compare only when supported and in a secure, top-level Chromium context. Never prompt for permission to run detection. |
| Shared session / manual takeover | A bot may hand control to a person. Mandatory automated carry-over can keep that later person labeled automated. Store only the mandated last class, document the persistence, and do not describe it as new page-level hard evidence. |
| Developer tools / test instrumentation | CDP observers, injected helpers or webdriver can be used by a human developer. `automated` describes an instrumented browser visit, not the visitor's intent or whether AI was used. |

Three human controls cannot establish zero population false positives. In addition to the requested controls, eventually validate actual mobile hardware, stock Safari/Firefox/Brave, private mode, PDF disabled, WebGL blocked/software-only, keyboard-only reading, background tabs and rapid manual navigation. A Playwright “human control” remains an instrumented simulation; stealth can make the control resemble the bots being tested.

## 5. Recommended `agentTokens` and weighted detector policy

### Default tokens

ES5 regex **sources**, compiled with `i` (without `g`). Match a complete token before `/version` or a separator, and require an appropriate left boundary. Examples below intentionally do not pin versions.

```js
var agentTokens = [
  'ChatGPT-User',
  'OAI-SearchBot',
  'OAI-AdsBot',
  'GPTBot',
  'Claude-Agent',
  'Claude-User',
  'Claude-SearchBot',
  'ClaudeBot',
  'Perplexity-User',
  'PerplexityBot',
  'Google-Agent',
  'Google-CloudVertexBot',
  'Google-GeminiNotebook',
  'Google-NotebookLM',
  'MistralAI-User',
  'MistralAI-Index',
  'MistralAI-Training',
  'DuckAssistBot',
  'Applebot',
  'Bytespider',
  'meta-externalagent',
  'meta-externalfetcher',
  'meta-webindexer',
  'CCBot',
  'Amazonbot',
  'Amzn-SearchBot'
];
// For these literal-safe sources; custom sources must be validated separately.
// new RegExp('(?:^|[^A-Za-z0-9_-])(?:' + agentTokens.join('|') +
//            ')(?=$|[^A-Za-z0-9_-])', 'i')
```

The array intentionally includes general crawlers with AI-related downstream use because the detector design includes that coverage. Therefore `declared_agent` should be documented as declared AI-associated agent/fetcher/crawler, **not** “an autonomous purchase agent”. Plain HTTP fetchers remain invisible to in-page execution regardless of inclusion.

Optional compatibility candidate after confirmation: `Manus-User` (primary evidence incomplete above). Do **not** put `ChatGPT Agent` in the default array solely because a WAF uses that display name. Do not invent `Operator`, `Claude in Chrome`, `Comet`, `Gemini`, `Copilot-User`, `Opera Neon`, `Browserbase`, `NovaAct`, `Manus` or `Brave` UA matches. Add a product-specific token only after verifying the actual operator contract or a reproducible captured UA. Keep `Google-Extended` and `Applebot-Extended` out.

### Classification order and score

Proposed priority: declared token → `declared_agent`; otherwise a confirmed hard signal or mandatory previous automated class → `automated`; otherwise soft/behavior sum at least **6** → `suspicious`; otherwise `human`. Declared detection wins over an automated environment so an honest agent does not lose its identity. Retain initial declared/automated final class as specified. Assign hard/declared score **100** for a numeric result; this is a sentinel, not a probability. Soft scores are additive within the caps below, not confidence percentages.

Weights are deliberately conservative. Their values are design proposals based on the evidence, not values supplied by BotD or measured by this research.

| Code | Type / weight | Concrete condition and safeguards |
|---|---|---|
| `AG` | declared / 100 | Boundary-matched known token in current UA. Self-declaration only; don't export UA. |
| `WD` | hard / 100 | Strict `navigator.webdriver === true`; do not treat absent/false as suspicious. |
| `HL` | hard / 100 | `HeadlessChrome` token in UA or synchronous UA-data brands. Guard missing brands; no high-entropy API request. |
| `AU` | hard / 100 | Explicit known automation/audit tokens: `PhantomJS`, `Chrome-Lighthouse`, `Lighthouse`, `PTST` with version delimiter, `GTmetrix`, `Google-PageRenderer`. Use bounded token patterns, not broad `bot`/`test` matches. These indicate automation/audit tooling rather than AI; exact current coverage must be verified in the test harness. |
| `GL` | hard / 100 | Exact known automation globals with expected shape: PhantomJS/Nightmare, Selenium document helper functions, domAutomation objects, narrow ChromeDriver window/cache signatures. Avoid generic application identifiers and broad prefixes. |
| `PW` | hard / 100, feature-dependent | Recognizable exact Playwright binding/controller/init-script objects **when verified for the installed test version**. Start with known names above; repeat probes at final to catch late injection. A missing object has no score. Disable any candidate whose clean baseline collides. |
| `CA` | inherited / 100 | Previous page's stored final class `automated`, as explicitly required by the detector design. Separate code from direct evidence. No cross-session identifier. |
| `G0` | soft / 1 | Both screen dimensions zero, both viewport dimensions zero, or both outer dimensions zero; only visible, focused top-level context. One geometry-family point maximum; recheck final. |
| `GS` | soft / 1 | 800×600 screen, or 1280×720 **screen equal to viewport**. Not viewport alone. Geometry family including `G0` capped at 1; normal resolutions are weak evidence. |
| `LA` | soft / 1 | `navigator.languages` empty/missing **and** no usable `navigator.language`/legacy fallback. A one-item languages array is normal. |
| `PL` | soft / 1 | Desktop Chromium/Chrome only, zero plugins. Exclude Android/iOS/touch mobile emulations and known WebViews; if `pdfViewerEnabled === false`, score 0. Never expect exactly five across all browsers. |
| `WG` | soft / 1 | WebGL genuinely unavailable **or** renderer matches `SwiftShader`, `llvmpipe`, `Mesa OffScreen`, `softpipe`. One point total. Missing debug extension alone scores 0. Reduce to boolean immediately, release context where possible; never draw/read/hash canvas pixels. |
| `CH` | soft / 1 | Desktop Chromium identified from compatible context but `window.chrome` missing. Exclude iOS, non-Chromium engines, known embedded browsers. UA string alone insufficient. |
| `NP` | soft / 1 | Chromium secure top-level context: `Notification.permission === 'denied'` and successful notifications query returns `prompt`. Async final-only, rejected/unsupported query scores 0. Never block final waiting for it. |
| `HC` | soft / 0 default; debug only | Missing/zero hardwareConcurrency. Too many old/embedded/privacy cases; no score for an ordinary small positive core count. Optional experimental weight 1 only after controls. |
| `NI` | behavior / 2 | No qualifying interaction during **the full 8000 ms visible observation**, not an early pagehide. Track presence only, no paths/timing profiles. Count mousemove, pointerdown, touchstart, keydown, wheel, scroll; handle synthetic-only separately. |
| `FN` | behavior / 3 | At least `fastNavCount` pageviews in a qualifying consecutive rapid run: with count 3, **two** consecutive positive intervals below 2000 ms. Bound timestamps to 20; dedupe invocation and handle bad/future timestamps and storage failure. Do not confuse three intervals with three pageviews. |
| `SY` | behavior / 2 | Pointer interactions occurred, all were `isTrusted === false`, and no trusted interaction of any accepted modality occurred. No points merely because no pointer input occurred. Treat `NI`/`SY` as one behavior family capped at 2; a single library-generated event must not add to inactivity. |

**Decision safeguards:** cap correlated geometry at 1, graphics at 1 and inactivity/synthetic-only at 2. Consider requiring at least three distinct soft/behavior families to reach `suspicious` (with the listed weights, fast navigation + inactivity + one environment family does so). These caps/guards are recommendations beyond the simplest sum in the detector design; preserve them or document the false-positive tradeoff if simplifying. A genuine trusted interaction removes `SY` and prevents `NI`; it does not cancel real hard evidence or make automation human.

Example score implications: reading quietly = 2 → human; PDF-disabled/software-GPU privacy user with a common resolution and no input = at most 4 → human; fast navigation + no input = 5 → human; fast navigation + no input + one weak environment family = 6 → suspicious. The requested AutomationControlled-disabled fast-click bot may therefore slip through if it uses plausible browser input and a normal environment. Record that honestly. **Do not increase weights just to force that fixture to pass:** the same short navigation pattern is achievable by a real person.

### Implementation boundaries and acceptance implications

- Catch failures per signal and treat unavailable APIs as unknown. Browser security/privacy restrictions must not throw away the initial/final event.
- Synchronous initial phase uses only currently available environment booleans. Async permission results and later automation globals can affect final if they arrive in time. Final must fire once, never wait indefinitely for a query, and preserve initial hard/declared classification.
- Only visible elapsed time advances inactivity. `pagehide` finalizes immediately with whatever observation exists; it must not manufacture eight seconds of behavior. BFCache restores need an explicit lifecycle policy to avoid duplicate final events or phantom pageviews.
- Session storage contains only the permitted bounded timestamps and last class, not UA, renderer, signal vector, hashes or IDs. Do not export framework artifact values or retain raw input events. Debug codes default off.
- Do not add font/canvas/audio fingerprinting, worker/iframe identity comparisons, CDP console traps, native-function lie scoring, IP lookup, signature key retrieval, notification prompts or additional network requests to chase stealth.
- The expected honest result for extension/OS-driven agents in a normal logged-in browser can be `human`. Fetch/curl yields **no detector event**, not a “human” event. Browser install/launch failure is **SKIP/ERROR**, never a detection PASS. Source support and benchmark coverage are separate facts.
