#!/usr/bin/env node
import vm from 'node:vm';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {setup, lifecycle, snapshot, poison} from './environment.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
function flag(name, fallback) {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
}
const seedText = String(flag('--seed', '20261118'));
const runs = Number(flag('--runs', 3000));
const timeout = Number(flag('--timeout', 100));
if (!Number.isInteger(runs) || runs < 0 || runs > 1000000 || !Number.isInteger(timeout) || timeout < 1 || timeout > 10000) {
  throw Error('Use --runs 0..1000000 and --timeout 1..10000 (milliseconds).');
}
const source = await readFile(resolve(root, 'src/visitor-verdict.js'), 'utf8');
const detector = new vm.Script(source, {filename:'src/visitor-verdict.js'});
const life = new vm.Script(lifecycle, {filename:'fuzz-lifecycle.js'});
const snap = new vm.Script(snapshot);
const classes = ['human', 'suspicious', 'automated', 'declared_agent'];
const agents = ['openai', 'anthropic'];
const claims = ['dom_host', 'dom_marker', 'ua_token'];
const checks = ['webmcp-class-invariance','no-throw/budget','payload-privacy','class/score','phase-uniqueness','storage-bounds','named-property-pollution','snapshot-immutability','suspicious-carry'];
const base = () => ({storage:'{}', config:{}, race:'timer-first', double:true});
function configExpression(spec) {
  return spec.configValue ?? '({' + Object.entries(spec.config || {}).map(([key,value]) => `${JSON.stringify(key)}:${value}`).join(',') + '})';
}
function evaluate(spec, script = detector) {
  const deadline = performance.now() + timeout;
  const context = vm.createContext({__spec:JSON.stringify(spec)}, {microtaskMode:'afterEvaluate', codeGeneration:{strings:false,wasm:false}});
  let stage = 'setup';
  let result, debug = false;
  const errors = [];
  const fail = (property, detail) => { if (!errors.some(x => x.property === property)) errors.push({property,detail}); };
  const run = code => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) { const error = Error('document time budget exceeded'); error.code = 'ERR_SCRIPT_EXECUTION_TIMEOUT'; throw error; }
    return code.runInContext(context, {timeout:remaining});
  };
  try {
    run(new vm.Script(setup.replace('CONFIG_EXPRESSION', () => configExpression(spec)), {filename:'fuzz-environment.js'}));
    stage = 'initial'; run(script);
    stage = 'snapshot poisoning'; run(new vm.Script(poison));
    if (spec.double) { stage = 'double inclusion'; run(script); }
    stage = 'lifecycle'; run(life);
    if (spec.double) { stage = 'inclusion after final'; run(script); }
    stage = 'snapshot';
    debug = run(new vm.Script('!!(window.visitorVerdictConfig && window.visitorVerdictConfig.debug === true)'));
    result = JSON.parse(run(snap));
  } catch (error) {
    fail('no-throw/budget', `${stage}: ${error.code || error.name}: ${error.message}`);
    if (spec.pollution?.length) {
      const clean = evaluate({...spec,pollution:[]},script);
      if (!clean.errors.some(e=>e.property==='no-throw/budget')) fail('named-property-pollution','DOM named host object caused a host exception');
    }
    return {errors};
  }
  const {events, writes, state} = result;
  if (spec.webmcp || spec.webmcpEvents) {
    const control = evaluate({...spec, webmcp: undefined, webmcpEvents: 0}, script);
    const classification = rows => rows?.map(e => [e.traffic_class, e.traffic_score, e.traffic_phase, e.traffic_signals, e.traffic_agent]);
    if (JSON.stringify(classification(events)) !== JSON.stringify(classification(control.events))) fail('webmcp-class-invariance', 'WebMCP changed classification');
  }
  for (const value of [...events.map(e => ({webmcp: e.traffic_webmcp, webmcpCount: e.traffic_webmcp_count})), state]) {
    if (!value || !['none','capable','used'].includes(value.webmcp) || !Number.isInteger(value.webmcpCount) || value.webmcpCount < 0 || value.webmcpCount > 255 || (value.webmcp === 'used') !== (value.webmcpCount > 0)) fail('payload-privacy', 'invalid WebMCP metadata');
  }
  // Read the effective boolean in its own realm; string "true" must stay private.
  for (const event of events) {
    const allowed = ['event','traffic_class','traffic_phase','traffic_score','traffic_version','traffic_agent','traffic_agent_claim','traffic_webmcp','traffic_webmcp_count', ...(debug ? ['traffic_signals'] : [])];
    if (Object.keys(event).some(key => !allowed.includes(key)) || !['event','traffic_class','traffic_phase','traffic_score','traffic_version'].every(key => Object.hasOwn(event,key)) || event.event !== 'traffic_class') {
      fail('payload-privacy', `unexpected payload keys/value: ${JSON.stringify(event).slice(0,250)}`);
    }
    if (!classes.includes(event.traffic_class) || typeof event.traffic_score !== 'number' || !Number.isFinite(event.traffic_score)) fail('class/score', `invalid event: ${JSON.stringify(event).slice(0,250)}`);
    if (spec.expectedClass && event.traffic_class !== spec.expectedClass) fail('class/score', `expected ${spec.expectedClass}, got ${event.traffic_class}`);
    if (event.traffic_version !== '1.4.0') fail('class/score', 'missing/invalid traffic_version');
    if (!['initial','agent','final'].includes(event.traffic_phase)) fail('phase-uniqueness', `invalid phase ${event.traffic_phase}`);
    if (Object.hasOwn(event,'traffic_agent_claim') && (!claims.includes(event.traffic_agent_claim) || (event.traffic_agent_claim === 'dom_host' && event.traffic_agent !== 'anthropic') || event.traffic_class !== 'declared_agent')) fail('payload-privacy','invalid host claim');
    if (Object.hasOwn(event,'traffic_agent') && !agents.includes(event.traffic_agent)) fail('payload-privacy', `invalid traffic_agent ${event.traffic_agent}`);
    if (event.traffic_phase === 'agent' && (event.traffic_class !== 'declared_agent' || !agents.includes(event.traffic_agent))) fail('class/score', `agent phase must escalate to declared_agent with an operator: ${JSON.stringify(event).slice(0,250)}`);
    if (Object.hasOwn(event,'traffic_agent') && event.traffic_class !== 'declared_agent') fail('class/score', `traffic_agent with ${event.traffic_class}`);
    if (spec.marker === 'start' && !['declared_agent','automated'].includes(event.traffic_class)) fail('class/score', `marker at start not declared: ${event.traffic_phase} ${event.traffic_class}`);
  }
  if (state && Object.hasOwn(state,'claim') && (!claims.includes(state.claim) || (state.claim === 'dom_host' && state.agent !== 'anthropic') || state.class !== 'declared_agent')) fail('payload-privacy','invalid snapshot claim');
  if (state && Object.hasOwn(state,'signals')) fail('payload-privacy','__visitorVerdict exposes debug signals');
  if (!result.beforeFrozen || !result.finalFrozen || !result.readOnly || !result.initialIntact) fail('snapshot-immutability', 'snapshots or public descriptor are writable/changed');
  if (state && (state.version !== '1.4.0' || !['class,phase,score,version,webmcp,webmcpCount','claim,class,phase,score,version,webmcp,webmcpCount','agent,class,phase,score,version,webmcp,webmcpCount','agent,claim,class,phase,score,version,webmcp,webmcpCount'].includes(Object.keys(state).sort().join(',')) ||
      (Object.hasOwn(state,'agent') && (!agents.includes(state.agent) || state.class !== 'declared_agent')))) fail('payload-privacy', 'invalid public snapshot fields/version');
  if (result.previous !== undefined && !classes.includes(result.previous)) fail('class/score', 'invalid previous class');
  if (!state || !classes.includes(state.class) || typeof state.score !== 'number' || !Number.isFinite(state.score)) fail('class/score','missing/invalid __visitorVerdict class or score');
  const initials = events.filter(e => e.traffic_phase === 'initial').length;
  const finals = events.filter(e => e.traffic_phase === 'final').length;
  const agentEvents = events.filter(e => e.traffic_phase === 'agent').length;
  if (initials !== 1 || finals > 1 || agentEvents > 1 || events[0]?.traffic_phase !== 'initial') fail('phase-uniqueness', `${initials} initial, ${agentEvents} agent, ${finals} final events`);
  // A watched marker escalates the latest snapshot whether it lands before or after final.
  // No observer without MutationObserver or without a pagehide listener (which needs add and remove).
  if (['late','after-final'].includes(spec.marker) && !(spec.old || []).some(f => ['noMutationObserver','noWindowAdd','noWindowRemove'].includes(f)) && state && !['declared_agent','automated'].includes(state.class) &&
      !(spec.marker === 'after-final' && ['hide-first'].includes(spec.race))) fail('class/score', `watched marker ${spec.marker} left ${state.phase} ${state.class}`);
  if (spec.marker === 'decoy' && !spec.host && events.some(e => Object.hasOwn(e,'traffic_agent') && !/agent/.test(spec.storage))) fail('class/score', 'decoy marker reported an operator');
  // These schedules always force finalization, beyond the at-most-one contract.
  if (finals === 0) fail('phase-uniqueness','no final after visible timer and pagehide');
  if (spec.pollution?.length) {
    const clean = evaluate({...spec,pollution:[]},script);
    const cleanInitials = clean.events?.filter(e=>e.traffic_phase==='initial').length;
    if ((events.some(e=>e.traffic_class==='automated') && clean.events && !clean.events.some(e=>e.traffic_class==='automated')) || (initials !== 1 && cleanInitials === 1)) {
      fail('named-property-pollution','DOM named host object caused automation or disabled publication (clean control succeeds)');
    }
  }
  function validateStore(key, text, at) {
    if (key !== 'visitor_verdict') return `unapproved storage key ${key}`;
    if (text.length > 2048) return `storage exceeds 2048 characters (${text.length})`;
    let record;
    try { record = JSON.parse(text); } catch { return 'storage is not JSON'; }
    if (!record || Array.isArray(record) || typeof record !== 'object' || Object.keys(record).some(k => !['timestamps','lastClass','tpPages'].includes(k))) return 'unapproved storage record shape/keys';
    if (!Array.isArray(record.timestamps) || record.timestamps.length > 20 || record.timestamps.some(t => typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > at || t % 100 !== 0)) return 'timestamps must contain <=20 finite, nonnegative, nonfuture timestamps rounded to 100ms';
    if (!Number.isInteger(record.tpPages) || record.tpPages < 0 || record.tpPages > 255) return 'tpPages outside integer 0..255';
    const last = record.lastClass;
    if (last !== '' && !classes.includes(last) && !(last && typeof last === 'object' && !Array.isArray(last) && last.direct === true && ['automated','declared_agent','suspicious'].includes(last.value) &&
        Object.keys(last).every(k => ['value','direct'].includes(k) || k === 'agent' && last.value === 'declared_agent' && agents.includes(last.agent) || k === 'claim' && last.value === 'declared_agent' && claims.includes(last.claim)))) return 'lastClass contains unapproved value/shape';
    // A declaration on a carried-automated document must not renew direct automated.
    if (spec.noHardRenewal && last && last.value === 'automated') return 'carried automated renewed as direct provenance without hard evidence';
    return null;
  }
  for (const write of writes) {
    const error = validateStore(write.key, write.value, write.now);
    if (error) fail('storage-bounds', error);
  }
  // Blocked storage is allowed to retain its original bytes; writable storage must be repaired.
  if (!spec.blockStorage) {
    const error = validateStore('visitor_verdict', result.storage.visitor_verdict, result.now);
    if (error) fail('storage-bounds', `after run: ${error}`);
  }
  if (spec.suspiciousCarry && !spec.blockStorage) {
    const saved = JSON.parse(result.storage.visitor_verdict).lastClass;
    if (events[0]?.traffic_class !== 'suspicious' || events.some(e => ['automated','declared_agent'].includes(e.traffic_class)) || saved !== 'suspicious' || saved?.direct === true) {
      fail('suspicious-carry', 'CS must start suspicious, never promote or renew without current evidence');
    }
  }
  return {errors, events, writes:writes.length};
}

let seed = 2166136261;
for (const ch of seedText) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
function rand() { seed += 0x6D2B79F5; let n = seed; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; }
const pick = xs => xs[Math.floor(rand()*xs.length)];
const integer = n => Math.floor(rand()*n);
const values = ['undefined','null','true','false','"true"','"false"','""','0','-1','1','2','20','255','NaN','Infinity','-Infinity','1.5','{}','[]','function () {}','({__proto__:null,constructor:"polluted"})'];
const configKeys = ['finalOnHidden','idleMs','fastNavMs','fastNavCount','suspiciousThreshold','debug','webgl','worker','dataLayerName','agentTokens'];
function jsonValue(depth=0) {
  const atoms = [null,true,false,0,-1,1,255,256,1.5,1e300,'true','false','__proto__','constructor','automated','declared_agent','suspicious'];
  if (depth > 2 || rand() < .5) return pick(atoms);
  if (rand() < .5) return Array.from({length:integer(12)}, () => jsonValue(depth+1));
  return Object.fromEntries(Array.from({length:integer(6)}, () => [pick(['timestamps','lastClass','tpPages','__proto__','constructor','prototype','value','direct']),jsonValue(depth+1)]));
}
function storageValue() {
  switch (integer(7)) {
    case 0: return pick(['','undefined','NaN','Infinity','{','null','[NaN]']);
    case 1: return JSON.stringify(jsonValue());
    case 2: return JSON.stringify({timestamps:Array.from({length:integer(100)}, () => pick([-1,0,1800000000001,1800000000000-integer(10000),null,'1',{},[]])),lastClass:jsonValue(),tpPages:jsonValue()});
    case 3: return '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"timestamps":[],"tpPages":2}';
    case 4: return JSON.stringify({timestamps:Array(integer(50000)).fill(1799999999000),lastClass:jsonValue(),tpPages:jsonValue()});
    case 5: return JSON.stringify({timestamps:[],lastClass:{value:pick(classes),direct:true,...(rand()<.5 ? {agent:pick([...agents,'evil',1,null,['openai']])} : {})},tpPages:integer(260)});
    default: return JSON.stringify({timestamps:[],lastClass:pick(classes),tpPages:integer(256)});
  }
}
const oldFeatures = ['noWorker','noWebGL','noPermissions','noJSON','noOwnNames','noWindowAdd','noDocumentAdd','noWindowRemove','noDocumentRemove','noMutationObserver'];
const pollutionNames = ['/', '__playwright__binding__','__playwright__binding__controller__','__pwInitScripts','__visitorVerdict','callPhantom','_phantom','__nightmare','domAutomation','domAutomationController','__selenium_unwrapped','__webdriver_evaluate','$cdc_x','$wdc_x'];
function randomSpec() {
  const s = {...base(),storage:storageValue(),race:pick(['timer-first','hide-first','visibility']),interaction:rand()<.5,synthetic:rand()<.3,teleport:rand()<.15,oldTrusted:rand()<.2,poisonSnapshot:rand()<.5};
  if (rand() < .1) s.configValue = pick(values);
  else for (const key of configKeys) if (rand() < .6) {
    s.config[key] = key === 'agentTokens' && rand() < .7 ? pick(['["(a+)+$"]','Array(10000).fill("x")','["[",".*","a|b","(a+)+$","\\\\"]','["x".repeat(100000)]','[{},null,NaN,function(){}]']) : key === 'dataLayerName' && rand()<.7 ? JSON.stringify(pick(['dataLayer','customLayer','__proto__','constructor','prototype','','x'.repeat(129)])) : pick(values);
  }
  if (rand()<.5) s.webmcp = pick(['document','legacy','both','throw']);
  s.webmcpEvents = integer(300); s.webmcpTrusted = pick([true,false,null]);
  s.blockStorage = rand()<.05;
  s.noWebGL = rand()<.2; s.softwareGL = rand()<.2; s.workerMismatch = rand()<.1; s.workerHeadless = rand()<.05;
  s.permissionMismatch = rand()<.3; s.soft = rand()<.15;
  if (rand()<.1) s.old = oldFeatures.filter(() => rand()<.3);
  if (rand()<.1) {
    s.pollution = [{target:pick(['window','document']),name:pick(pollutionNames),kind:pick(['element','collection','plain','array'])}];
    s.workerHeadless = false;
  }
  if (rand()<.08) s.ua = 'a'.repeat(pick([24,32,128,10000])) + '!';
  if (rand()<.2) s.form = pick(['burst','normal','paste','untrusted']);
  if (rand()<.15) s.host = pick(['start','late']);
  if (rand()<.15) s.marker = pick(['start','late','after-final','decoy']);
  return s;
}

function corpus() {
  const list = [{...base(),label:'baseline'}, {...base(),poisonSnapshot:true,label:'public snapshot poisoning'}];
  for (const host of ['start','late']) for (const webdriver of [true,false]) list.push({...base(),host,webdriver,expectedClass:webdriver ? 'automated' : undefined,label:'host precedence'});
  for (const form of ['burst','normal','paste','untrusted']) list.push({...base(),form,expectedClass:'human',label:'form signals cannot classify alone'});
  for (const webmcp of ['document','legacy','both','throw']) {
    for (const webmcpTrusted of [true,false,null]) list.push({...base(), webmcp, webmcpTrusted,
      webmcpEvents: 300, label: `WebMCP ${webmcp} trusted=${webmcpTrusted}`});
  }
  for (const [ua, webdriver] of [[undefined, false], ['ChatGPT-User', false], ['Claude-Agent/1.0', true]]) {
    list.push({...base(),storage:JSON.stringify({lastClass:{value:'declared_agent',direct:true}}),ua,webdriver,
      expectedClass:webdriver ? 'automated' : 'declared_agent',label:'declared carry preserves class unless current webdriver is true'});
  }
  list.push({...base(),storage:'{"lastClass":{"arbitrary":"raw"}}',label:'untrusted stored class'});
  list.push({...base(),storage:JSON.stringify({timestamps:Array(47864).fill(1799999999000)}),label:'47864-entry storage budget regression'});
  for (const debug of ['true','false','"true"','"false"']) list.push({...base(),config:{debug},label:`debug ${debug}`});
  for (const feature of oldFeatures) list.push({...base(),config:{worker:'true',webgl:'true'},permissionMismatch:true,old:[feature],oldTrusted:true,interaction:true,label:`old browser ${feature}`});
  list.push({...base(),config:{worker:'true',webgl:'true'},permissionMismatch:true,old:oldFeatures,oldTrusted:true,interaction:true,label:'all old browser omissions'});
  list.push({...base(),interaction:true,oldTrusted:true,label:'isTrusted undefined'});
  list.push({...base(),synthetic:true,label:'synthetic events only'});
  for (const name of pollutionNames) for (const target of ['window','document']) for (const kind of ['element','collection','plain','array']) list.push({...base(),pollution:[{name,target,kind}],label:`DOM ${target}.${name} ${kind}`});
  for (const raw of ['{"lastClass":{"arbitrary":"raw"}}','{"lastClass":"secret"}','{"timestamps":[-1,1e999,1800000000001,null,"1"],"tpPages":-1}','{"__proto__":{"polluted":true},"constructor":{},"tpPages":1.5}',JSON.stringify({timestamps:Array(100000).fill(-1),tpPages:256})]) list.push({...base(),storage:raw,label:'storage boundary'});
  for (const token of ['(a+)+$','(a|aa)+$','.*','[','x'.repeat(100000)]) list.push({...base(),ua:'a'.repeat(32)+'!',config:{agentTokens:JSON.stringify([token])},label:'regex/token boundary'});
  list.push({...base(),config:{agentTokens:'Array(100000).fill("safe")'},label:'huge token array'});
  for (const finalOnHidden of ['true','false']) for (const race of ['timer-first','hide-first','visibility']) list.push({...base(),config:{finalOnHidden},race,storage:JSON.stringify({lastClass:{value:'suspicious',direct:true}}),suspiciousCarry:true,label:'CS decays without promotion'});
  for (const race of ['timer-first','hide-first','visibility']) list.push({...base(),race,label:`duplicate/race ${race}`});
  for (const marker of ['start','late','after-final','decoy']) for (const race of ['timer-first','hide-first']) {
    list.push({...base(),marker,race,label:`agent UI marker ${marker} ${race}`});
    list.push({...base(),marker,race,webdriver:true,expectedClass:'automated',label:`agent UI marker ${marker} with webdriver`});
  }
  list.push({...base(),marker:'late',old:['noMutationObserver'],expectedClass:'human',label:'agent UI marker without MutationObserver'});
  for (const marker of ['start','late','after-final']) for (const race of ['timer-first','hide-first','visibility']) {
    list.push({...base(),marker,race,storage:JSON.stringify({timestamps:[],lastClass:{value:'automated',direct:true},tpPages:0}),
      expectedClass:'automated',noHardRenewal:true,label:`carried automated + marker ${marker} ${race}`});
  }
  return list;
}

// Greedy structural reduction: preserve the failing property while removing independent
// knobs, then prune JSON keys/array ranges. Full cases are also saved for exact replay.
function minimize(original, property, originalDetail, evaluateCase = evaluate) {
  let best = structuredClone(original), attempts = 0;
  function accept(candidate) {
    if (++attempts > 100) return false;
    if (evaluateCase(candidate).errors.some(e => e.property === property)) { best = candidate; return true; }
    return false;
  }
  for (const key of Object.keys(best)) {
    if (['storage','config'].includes(key)) continue;
    const c = structuredClone(best); delete c[key]; accept(c);
  }
  for (const key of Object.keys(best.config || {})) { const c = structuredClone(best); delete c.config[key]; accept(c); }
  for (const key of ['old','pollution']) {
    for (let i=(best[key]?.length || 0)-1;i>=0;i--) {
      const c = structuredClone(best); c[key].splice(i,1); accept(c);
    }
  }
  accept({...best,storage:'{}'});
  try {
    let raw = JSON.parse(best.storage);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const key of Object.keys(raw)) {
        const c = {...raw}; delete c[key];
        if (accept({...best,storage:JSON.stringify(c)})) raw = c;
      }
      for (const key of Object.keys(raw)) if (Array.isArray(raw[key])) {
        while (raw[key].length > 0) {
          const c = {...raw,[key]:raw[key].slice(0,Math.floor(raw[key].length/2))};
          if (!accept({...best,storage:JSON.stringify(c)})) break;
          raw = c;
        }
      }
    }
  } catch { /* invalid JSON is itself a useful minimal storage input */ }
  const replay = evaluateCase(best).errors.find(e=>e.property===property);
  return {spec:best,detail:replay?.detail || originalDetail || 'Failure did not reproduce; original diagnostic unavailable',
    reproduced:!!replay,attempts};
}

if (args.includes('--self-test')) {
  const fixtures = [
    ['no-throw/budget','throw Error("fixture");'],
    ['no-throw/budget','while(true){}'],
    ['payload-privacy','window.dataLayer.push({event:"traffic_class",traffic_class:"human",traffic_phase:"initial",traffic_score:0,raw:"oops"});'],
    ['class/score','window.dataLayer.push({event:"traffic_class",traffic_class:"alien",traffic_phase:"initial",traffic_score:Infinity});'],
    ['phase-uniqueness','window.dataLayer.push({event:"traffic_class",traffic_class:"human",traffic_phase:"initial",traffic_score:0});'],
    ['snapshot-immutability','window.__visitorVerdict = {class:"human",score:0,phase:"initial",version:"1.4.0"};'],
    ['storage-bounds','window.sessionStorage.setItem("forbidden","{}");'],
    ['named-property-pollution','window.dataLayer.push({event:"traffic_class",traffic_class:window.__playwright__binding__ ? "automated" : "human",traffic_phase:"initial",traffic_score:100});']
  ];
  for (const [property,code] of fixtures) {
    const spec = {...base(),pollution:[{name:'__playwright__binding__',target:'window'}]};
    if (!evaluate(spec,new vm.Script(code)).errors.some(e=>e.property===property)) throw Error(`Harness self-test missed ${property}`);
  }
  // Timing failures may disappear while minimising or on the final replay.
  // Preserve the first actual error instead of rendering an undefined detail.
  const originalDetail = 'initial: ERR_SCRIPT_EXECUTION_TIMEOUT: document time budget exceeded';
  const flaky = minimize(base(), 'no-throw/budget', originalDetail, () => ({errors:[]}));
  if (flaky.detail !== originalDetail || flaky.reproduced !== false) throw Error('Lost flaky budget diagnostic');
  const replayed = minimize(base(), 'no-throw/budget', originalDetail,
    () => ({errors:[{property:'no-throw/budget',detail:'lifecycle: ERR_SCRIPT_EXECUTION_TIMEOUT: replay budget exceeded'}]}));
  if (!replayed.reproduced || !replayed.detail.includes('replay budget exceeded')) throw Error('Lost reproduced budget diagnostic');
  console.log(`Harness self-test PASS (${fixtures.length} injected faults, including infinite loop).`);
  console.log('Budget diagnostic contracts PASS (flaky and reproduced failures).');
  process.exit(0);
}

const replayPath = flag('--case', null);
const cases = replayPath ? [JSON.parse(await readFile(resolve(replayPath),'utf8'))] : corpus();
const total = cases.length + (replayPath ? 0 : runs);
const stats = Object.fromEntries(checks.map(p=>[p,0]));
const first = new Map(); let failed = 0; const began = performance.now();
for (let index=0; index<total; index++) {
  const spec = index < cases.length ? cases[index] : randomSpec();
  const result = evaluate(spec);
  if (result.errors.length) failed++;
  for (const error of result.errors) {
    stats[error.property]++;
    if (!first.has(error.property)) {
      first.set(error.property,{index,label:spec.label || `random ${index-cases.length}`,spec,detail:error.detail});
      console.error(`fuzz case ${index}: ${error.property}: ${error.detail}`);
    }
  }
  if ((index+1)%500 === 0) console.log(`fuzz ${index+1}/${total}: ${failed} failing cases`);
}
const out = resolve(root,'test/results'); await mkdir(out,{recursive:true});
const examples = [];
for (const [property,example] of first) {
  const reduced = minimize(example.spec,property,example.detail);
  const path = resolve(out,`fuzz-${property.replaceAll('/','-')}.json`);
  await writeFile(path,JSON.stringify(reduced.spec,null,2)+'\n');
  examples.push({property,...example,minimized:reduced,path});
}
const duration = ((performance.now()-began)/1000).toFixed(2);
const lines = [
  '# Detector fuzz report','',
  `Seed: \`${seedText}\`. Cases: ${total} (${cases.length} targeted + ${replayPath ? 0 : runs} random). Failing cases: ${failed}. Duration: ${duration}s. VM budget: ${timeout}ms per document.`,
  '',`Run: \`node test/fuzz/run.mjs --seed ${seedText} --runs ${runs} --timeout ${timeout}\``,
  '', '| Invariant | Failing cases |','|---|---:|',...checks.map(p=>`| ${p} | ${stats[p]} |`),'',
  'Each isolated document loads the current source text; duplicate inclusion, visible/hidden timers, stale queued callbacks, repeated pagehide, and BFCache-style events are exercised. VM callbacks and promise jobs share the document timeout budget. Named-property pollution has a paired clean control to exclude pre-existing automated carry-over. No browser or network is used.',
  '', 'Missing-listener policy: the detector still publishes initial and a timed final. Input falls back to document capture when window lacks a usable add/remove pair; if neither target can observe input, NI stays unknown. No phase/class invariant was relaxed. The fake event dispatcher now models document input passing through window capture; the previous dispatcher silently bypassed these listeners.',
  '', 'Storage validation covers every write and final writable state: only visitor_verdict, <=20 rounded timestamps, bounded tpPages, and class/provenance. Blocked storage may retain its original bytes. Existing unrelated site keys are outside detector ownership. Limits are 2048 serialized characters per detector record.',
  '', 'The fake Worker returns configurable booleans; WebGL and permissions are stubs. This checks detector contracts, not browser fidelity, real graphics, or classification accuracy. Missing add/removeEventListener methods are deliberately tested as requested. Counts are observations; properties after a thrown exception cannot be checked.',
  '', 'Counterexamples are greedily reduced (up to 100 attempts each); reductions preserve the named failure, without claiming a globally minimal input. Exact JSON cases are saved beside this report. --case accepts a saved case, whose config expressions are trusted local test code.'
];
for (const e of examples) {
  const formatted = JSON.stringify(e.minimized.spec,null,2);
  lines.push('',`## ${e.property}`,'',`First seen at case ${e.index} (${e.label}). ${e.detail}`,
    '',`Final reduction replay: ${e.minimized.reproduced ? e.minimized.detail : 'not reproduced; original error retained above (timing may be flaky).'}`,
    '',`Replay: \`node test/fuzz/run.mjs --case ${e.path} --timeout ${timeout}\``, '', '```json',formatted.length>1800?formatted.slice(0,1800)+'\n… (full input in replay file)':formatted,'```');
}
await writeFile(resolve(out,'fuzz-report.md'),lines.join('\n')+'\n');
console.log(`${failed ? 'FAIL' : 'PASS'}: ${total} cases, ${failed} failing; ${duration}s. Report: test/results/fuzz-report.md`);
process.exitCode = failed ? 1 : 0;
