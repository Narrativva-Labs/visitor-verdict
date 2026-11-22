# Contributing

Contributions should preserve conservative classification and data minimisation. Discuss the concrete problem with a synthetic reproduction, browser/tool versions and short debug codes. Do not attach URLs, IPs, visitor data, identifiers or raw browser-property dumps. Use the false-positive or publicly known bypass issue form; report data-leak bugs through [private security advisories](SECURITY.md).

## Build and deterministic checks

Use Node.js 20 or 22 and the committed lockfile:

```sh
npm ci
npm run build
npm test
npm run test:fuzz -- --runs 1000
```

`npm test` runs detector, runner and signal-registry contracts. `npm run test:registry` runs the registry checks alone. For the longer default fuzz campaign run `npm run test:fuzz`; see [fuzz methodology](test/fuzz/README.md) for seed/replay options. CI runs both supported Node versions and fails on check errors.

The build also regenerates [the signal catalogue](docs/signals.md) from `signals/registry.json`. The registry and its schema never enter detector bundles.

The build validates ES5 source/output and regenerates `dist/visitor-verdict.min.js`, its SHA-384 `.sri` file, GTM Custom HTML and container JSON. Include generated artifacts with relevant source/config changes; `dist/` is versioned. Never hand-edit generated files. `npm run build:container` rebuilds only the container from current HTML.

## Signal registry

Every new output code, default `agentTokens` entry or agent element ID needs a record in `signals/registry.json`, conforming to `signals/registry.schema.json`. Include the exact condition, evidence family, weight/hardness and runtime scoring family where applicable, a public source URL or pinned code reference, the verified product version/range (explicitly unknown when not established), last review date, status and known false positives. Do not infer real-product coverage from a synthetic fixture. `validated` is scoped to the listed verification; field accuracy is a separate question.

Increment `registryVersion` when evidence or entries change; it is independent of `detectorVersion`. Run `npm run build` and commit the generated `docs/signals.md`. Dates are reviewed manually; build must not refresh them. Reviews older than 120 days produce warnings without failing CI. Retired output codes must not remain emit-able. A historical UA token may be marked retired while its existing literal still emits active `AG`, with an explicit `retirementReason`; this records ended operator support without silently changing runtime compatibility. Element IDs retain their historical version scope until their matchers are deliberately removed.

## Browser suites and manual checks

```sh
npx playwright install --with-deps chromium firefox webkit
npm run test:browsers
npm run test:extended
```

Install Google Chrome separately for Chrome-channel/CDP cases. Headed cases need a desktop or Xvfb on Linux. `TRAFFIC_CHROME_EXECUTABLE` overrides Chrome for the CDP harness. Browser runs create local reports under `test/results/`; review classifications and completeness rather than treating a launch failure as a pass.

For the adversarial benchmark:

```sh
bash test/adversarial/setup.sh
bash test/adversarial/run-all.sh
```

See [adversarial usage](test/adversarial/USAGE.md) for dependencies, display requirements and tool configuration. Stop other servers on port 8787 first.

The optional human lab opens a fresh Chrome profile for manual input. Use a synthetic local site with the detector installed:

```sh
npm run serve
# In another terminal:
node test/human-lab.mjs http://127.0.0.1:8787
```

The lab defaults to the macOS Chrome installation; `TC_CHROME` overrides it. Its local logs include page URLs and test observations: keep them private and use synthetic pages only. Manual checks do not establish a population false-positive rate or validate real assistive technology unless those users/devices were actually tested.

## Design rules

- No fingerprinting, identifiers or hashes of visitor/browser data. The build's SRI digest covers the static release asset only.
- No new data leaving the detector. Production output is limited to event name, class, phase, numeric score, static version and the optional operator enum from agent UI markers; debug-only short signal codes remain opt-in and default off. Do not add network requests or raw-signal exports.
- No cookies or localStorage. Preserve the bounded `sessionStorage` schema and failure handling; do not add URLs, IDs or click traces.
- Prioritise avoiding human false positives over catching every bot. Preserve accessibility/input safeguards, conservative corroboration and human controls. Do not tune weights solely to make a bot fixture pass.
- Preserve ES5 compatibility and no runtime dependencies. Document optional probes and consent/integration timing honestly; pre-consent results must never feed advertising platforms.
- Report misses, uncertainty, SKIP and ERROR honestly. A missing event is unknown; an execution/launch failure is not a detection success. Synthetic controls and emulation are not physical-device or assistive-technology validation.

Keep pull requests focused, explain the resulting behaviour and list the checks actually run. The project is MIT licensed; contributions are made under that license.
