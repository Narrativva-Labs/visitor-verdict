Run from the repository root (Node 18+; built-ins only):

```sh
node test/fuzz/run.mjs
node test/fuzz/run.mjs --seed regression-42 --runs 10000 --timeout 100
node test/fuzz/run.mjs --self-test
```

The default is 3,000 seeded random documents plus a fixed boundary corpus. Every
invocation reads `src/visitor-verdict.js` anew. Exit status is 1 if any invariant
fails; results and reduced replay cases go into the already gitignored
`test/results/`. The report is `test/results/fuzz-report.md`.

`--timeout` is a wall-clock budget in milliseconds shared by all VM executions
for one document, including promise jobs and event/timer callbacks. A timeout is
a reported failure, and the runner continues. Increase it on heavily loaded
machines. No real browser, sleep, Worker, graphics context, or network is used.

`environment.mjs` builds browser objects in the VM realm, with fake visible time,
event listeners, bounded timer draining, sessionStorage, Worker replies, WebGL,
and asynchronous permissions. Cases mix malformed storage, huge arrays, invalid
config types, literal regex attack strings, missing old browser methods, trusted
and untrusted event paths, duplicate inclusion, timer/pagehide races, and DOM
named elements/collections. DOM pollution uses a paired clean control, so
existing hard evidence does not create a false failure. Missing methods must
neither escape as exceptions nor prevent the required initial/final events.
The detector uses document capture if window lacks a usable add/remove pair,
or timer-only publication if neither target can observe input. NI remains
unknown when input cannot be observed. Both phases are still required: no
invariant was relaxed for missing methods. Document input in this fake DOM
passes through window capture before reaching document listeners.

Stored class/provenance is sanitised before every write, including stale-document
merges. If JSON is unavailable, unreadable history is discarded and the detector
writes a fresh minimal record using its bounded-number/fixed-enum serialiser.

Privacy assertions inspect every published payload and the public state, with
debug enabled only by boolean `true`. Storage assertions inspect every write
and the final writable record: only the detector key, <=20 finite rounded
timestamps, a known class or bounded provenance record, and integer tpPages in
0..255; total record size <=2,048 characters. Unrelated site storage keys are
outside detector ownership; blocked storage may retain its input. Fake cookie,
localStorage, and network APIs throw if accessed.

The report saves one greedily reduced counterexample per failing invariant,
with a replay command:

```sh
node test/fuzz/run.mjs --case test/results/fuzz-storage-bounds.json
```

Replay files contain JavaScript expressions for config values and should be
treated as trusted local test code. Reduction removes independent options and
JSON fields/array ranges while preserving the named failure (up to 100 trials);
it does not promise a globally smallest case. The harness self-test injects
seven independent faults, including an infinite loop, to verify its assertions.
These VM checks complement browser tests; they do not measure real automation
detection accuracy or browser API compatibility beyond the modeled surface.
