import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import Ajv from 'ajv';
import {readRegistry, renderSignals} from '../scripts/build-signals.mjs';

const root = new URL('../', import.meta.url);
const schema = JSON.parse(await readFile(new URL('signals/registry.schema.json', root), 'utf8'));
const valid = new Ajv({allErrors: true, strict: true}).compile(schema);
const source = await readFile(new URL('src/visitor-verdict.js', root), 'utf8');
const registry = await readRegistry();

function inventory(source) {
  const codes = new Map(), tokens = [], markers = [], versions = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'add') {
      const [code, weight, family] = node.arguments;
      assert.equal(code?.type, 'Literal', 'Signal codes must be statically enumerable');
      assert.equal(weight?.type, 'Literal', 'Signal weights must be statically enumerable');
      if (family) assert.equal(family.type, 'Literal');
      const item = {weight: weight.value, scoringFamily: family?.value};
      if (codes.has(code.value)) assert.deepEqual(codes.get(code.value), item, 'Inconsistent signal weights');
      codes.set(code.value, item);
    }
    if (node.type === 'Property' && node.key.name === 'agentTokens') {
      assert.equal(node.value.type, 'ArrayExpression');
      for (const entry of node.value.elements) { assert.equal(entry.type, 'Literal'); tokens.push(entry.value); }
    }
    if (node.type === 'VariableDeclarator' && node.id.name === 'markers') {
      assert.equal(node.init.type, 'ArrayExpression');
      for (const entry of node.init.elements) { assert.equal(entry.type, 'Literal'); markers.push(entry.value); }
    }
    if (node.type === 'VariableDeclarator' && node.id.name === 'version') versions.push(node.init.value);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(parse(source, {ecmaVersion: 5}));
  assert.equal(versions.length, 1);
  assert.ok(codes.size && tokens.length && markers.length, 'Source inventories must not be empty');
  return {codes, tokens, markers, version: versions[0]};
}
const sorted = list => [...list].sort();
export function checkRegistry(data, detectorSource, {now = new Date(), warn = console.warn} = {}) {
  assert.ok(valid(data), `Invalid registry schema: ${JSON.stringify(valid.errors)}`);
  assert.equal(new Set(data.signals.map(s => s.id)).size, data.signals.length, 'Duplicate registry ID');
  const detected = inventory(detectorSource);
  assert.equal(data.detectorVersion, detected.version, 'Detector version mismatch');
  const information = data.signals.filter(s => s.kind === 'information');
  assert.deepEqual(sorted(information.map(s => s.id)), ['MC', 'MU'], 'WebMCP informational inventory');
  for (const entry of information) {
    assert.equal(entry.code, entry.id); assert.equal(entry.weight, 0);
    assert.equal(entry.hardness, 'informational'); assert.equal(entry.status, 'experimental');
    assert.equal(entry.scoringFamily, undefined);
    assert.equal(entry.family, entry.id === 'MC' ? 'environment' : 'declaration');
    assert.ok(!detected.codes.has(entry.code), 'Informational fields must never enter scoring');
  }
  const codes = data.signals.filter(s => s.kind === 'code');
  assert.equal(new Set(codes.map(s => s.code)).size, codes.length, 'Duplicate code');
  assert.deepEqual(sorted(codes.filter(s => s.status !== 'retired').map(s => s.code)), sorted(detected.codes.keys()), 'Active code inventory mismatch');
  for (const s of codes) {
    assert.equal(s.id, s.code);
    if (s.status === 'retired') assert.ok(!detected.codes.has(s.code), `Retired code emitted: ${s.code}`);
    else assert.deepEqual({weight: s.weight, scoringFamily: s.scoringFamily}, detected.codes.get(s.code), `${s.code} scoring mismatch`);
  }
  for (const [kind, field, emittedCode, expected] of [['ua-token', 'token', 'AG', detected.tokens], ['element-id', 'elementId', 'DM', detected.markers]]) {
    const entries = data.signals.filter(s => s.kind === kind);
    assert.deepEqual(sorted(entries.map(s => s[field])), sorted(expected), `${kind} inventory mismatch`);
    assert.equal(new Set(entries.map(s => s[field])).size, entries.length, `Duplicate ${kind}`);
    for (const s of entries) {
      assert.equal(s.id, `${kind === 'ua-token' ? 'ua' : 'dom'}:${s[field]}`);
      assert.equal(s.code, emittedCode);
      assert.equal(s.family, 'declaration');
      assert.equal(s.weight, 100); assert.equal(s.hardness, 'declared');
      const output = codes.find(c => c.code === s.code);
      assert.ok(output && output.status !== 'retired', 'Evidence must reference an active output code');
      // Historical tokens are evidence records, never additional emitted codes.
      if (s.status === 'retired') {
        assert.equal(kind, 'ua-token', 'Retired element IDs must be removed from the detector');
        assert.ok(s.retirementReason.includes('AG'), 'Retired compatibility token must document its active output code');
        warn(`Retired token retained by unchanged detector: ${s.token} -> ${s.code}; ${s.retirementReason}`);
      }
    }
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const s of data.signals) {
    const day = Date.parse(`${s.lastChecked}T00:00:00Z`);
    assert.ok(Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === s.lastChecked, `Invalid review date: ${s.id}`);
    assert.ok(day <= today, `Future review date: ${s.id}`);
    if ((today - day) / 86400000 > 120) warn(`Stale signal ${s.id}: last checked ${s.lastChecked} (>120 days)`);
  }
}

const generatedDocs = await readFile(new URL('docs/signals.md', root), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const quiet = {now: new Date(), warn() {}};
const changed = fn => { const data = structuredClone(registry); fn(data); return data; };
const rejects = (data, detector = source) => assert.throws(() => checkRegistry(data, detector, quiet));
test('schema, exact source inventories, lifecycle, versions and weights', () => checkRegistry(registry, source));
test('generated documentation is current', () => assert.equal(renderSignals(registry), generatedDocs));
test('missing emitted code fails', () => rejects(changed(d => d.signals = d.signals.filter(s => s.id !== 'WD'))));
test('unimplemented active code fails', () => rejects(changed(d => d.signals.push({...d.signals[0], id: 'ZZ', code: 'ZZ'}))));
test('retired emitted code fails', () => rejects(changed(d => { d.signals[0].status = 'retired'; d.signals[0].retirementReason = 'No longer supported'; })));
test('WebMCP informational fields cannot disappear or become classification evidence', () => {
  rejects(changed(d => d.signals = d.signals.filter(s => s.id !== 'MU')));
  rejects(changed(d => d.signals.find(s => s.id === 'MC').weight = 1));
  rejects(changed(d => d.signals.find(s => s.id === 'MU').kind = 'code'));
});
test('duplicate record fails', () => rejects(changed(d => d.signals.push(d.signals[0]))));
test('missing token and added source token fail', () => {
  rejects(changed(d => d.signals = d.signals.filter(s => s.token !== 'GPTBot')));
  rejects(registry, source.replace("'ChatGPT-User',", "'New-Agent', 'ChatGPT-User',"));
});
test('missing marker and added source marker fail', () => {
  rejects(changed(d => d.signals = d.signals.filter(s => s.elementId !== 'codex-agent-overlay-root')));
  rejects(registry, source.replace("var markers = [", "var markers = ['new-agent-root', "));
});
test('changed weight or scoring cap family fails', () => {
  rejects(registry, source.replace("add('WK', 2, 'worker')", "add('WK', 3, 'worker')"));
  rejects(registry, source.replace("add('WK', 2, 'worker')", "add('WK', 2, 'geometry')"));
});
test('computed code emission cannot bypass inventory', () => rejects(registry, source.replace("add('WD', 100)", "add('W' + 'D', 100)")));
test('required evidence, statuses and retirement notes enforced by schema', () => {
  rejects(changed(d => delete d.signals[0].sources));
  rejects(changed(d => d.signals[0].status = 'unknown'));
  rejects(changed(d => delete d.signals.find(s => s.status === 'retired').retirementReason));
  rejects(changed(d => d.signals[0].sources = []));
  rejects(changed(d => d.signals[0].verification = []));
});
test('invalid, impossible and future dates fail', () => {
  const tomorrow = new Date(quiet.now.getTime() + 86400000).toISOString().slice(0, 10);
  for (const day of ['not-a-date', '2026-02-30', tomorrow]) rejects(changed(d => d.signals[0].lastChecked = day));
});
test('120-day boundary passes; 121 days warns without failing', () => {
  const sample = changed(d => d.signals.forEach(s => s.lastChecked = '2026-07-25'));
  const warnings = [];
  const options = {now: new Date('2026-11-22T12:00:00Z'), warn: text => warnings.push(text)};
  checkRegistry(sample, source, options);
  assert.ok(!warnings.some(s => s.startsWith('Stale signal')));
  sample.signals[0].lastChecked = '2026-07-24';
  checkRegistry(sample, source, options);
  assert.equal(warnings.filter(s => s.startsWith('Stale signal')).length, 1);
});
test('retired legacy token remains documented as an active AG compatibility match', () => {
  const warnings = [];
  checkRegistry(registry, source, {...quiet, warn: text => warnings.push(text)});
  assert.ok(warnings.some(s => s.includes('Google-NotebookLM -> AG')));
});
console.log(`${passed} registry checks passed (${registry.signals.length} records)`);
