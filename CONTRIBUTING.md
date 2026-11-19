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

`npm test` runs detector contracts and runner contracts. For the longer default fuzz campaign run `npm run test:fuzz`; see [fuzz methodology](test/fuzz/README.md) for seed/replay options. CI runs both supported Node versions and fails on check errors.

The build validates ES5 source/output and regenerates `dist/visitor-verdict.min.js`, its SHA-384 `.sri` file, GTM Custom HTML and container JSON. Include generated artifacts with relevant source/config changes; `dist/` is versioned. Never hand-edit generated files. `npm run build:container` rebuilds only the container from current HTML.

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
- No new data leaving the detector. Production output is limited to event name, class, phase and numeric score; debug-only short signal codes remain opt-in and default off. Do not add network requests or raw-signal exports.
- No cookies or localStorage. Preserve the bounded `sessionStorage` schema and failure handling; do not add URLs, IDs or click traces.
- Prioritise avoiding human false positives over catching every bot. Preserve accessibility/input safeguards, conservative corroboration and human controls. Do not tune weights solely to make a bot fixture pass.
- Preserve ES5 compatibility and no runtime dependencies. Document optional probes and consent/integration timing honestly; pre-consent results must never feed advertising platforms.
- Report misses, uncertainty, SKIP and ERROR honestly. A missing event is unknown; an execution/launch failure is not a detection success. Synthetic controls and emulation are not physical-device or assistive-technology validation.

Keep pull requests focused, explain the resulting behaviour and list the checks actually run. The project is MIT licensed; contributions are made under that license.
