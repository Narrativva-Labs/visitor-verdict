import {readFile, writeFile} from 'node:fs/promises';

// GTM export format uses uppercase enum values and singular resource arrays.
// Keep output deterministic so rebuilding produces a reviewable diff.
let html = await readFile(new URL('../gtm/custom-html.html', import.meta.url), 'utf8');
if (!html.trim().startsWith('<script>') || !html.trim().endsWith('</script>')) {
  throw new Error('Expected the generated Custom HTML script');
}
// The wrapper builder is maintained separately. Normalise its configuration
// declaration here too, so either builder revision produces the v1 interface.
const normalized = html;
if (normalized !== html) {
  html = normalized;
  await writeFile(new URL('../gtm/custom-html.html', import.meta.url), html);
}
const ids = {accountId: '0', containerId: '0'};
const parameter = (key, value, type = 'TEMPLATE') => ({type, key, value});
const reference = name => `{{${name}}}`;
const dlv = name => reference(`VV - DLV ${name}`);
const fields = ['traffic_class', 'traffic_phase', 'traffic_score', 'traffic_version'];
const equals = (left, right) => ({type: 'EQUALS', parameter: [
  parameter('arg0', left), parameter('arg1', right)
]});
const matchRegex = (left, right) => ({type: 'MATCH_REGEX', parameter: [
  {type: 'TEMPLATE', key: 'arg0', value: left},
  {type: 'TEMPLATE', key: 'arg1', value: right},
]});
const table = (key, rows) => ({type: 'LIST', key,
  list: rows.map(row => ({type: 'MAP', map: row.map(([name, value]) => parameter(name, value))}))});
const currentClass = `function() {
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
}`;
const phaseTrigger = (id, phase) => ({...ids, triggerId: id, name: `VV - ${phase}`, type: 'CUSTOM_EVENT',
  customEventFilter: [equals('{{_event}}', 'traffic_class')],
  filter: [equals(dlv('traffic_phase'), phase)]});
const container = {
  exportFormatVersion: 2,
  containerVersion: {
    ...ids, containerVersionId: '0',
    container: {...ids, name: 'VV - visitor-verdict', publicId: 'GTM-XXXXXXX', usageContext: ['WEB']},
    tag: [
      {...ids, tagId: '1', name: 'VV - detector', type: 'html',
        parameter: [parameter('html', html), parameter('supportDocumentWrite', 'false', 'BOOLEAN')],
        priority: {type: 'INTEGER', value: '100'},
        firingTriggerId: ['2147479553'], tagFiringOption: 'ONCE_PER_LOAD',
        consentSettings: {consentStatus: 'NOT_NEEDED'}},
      {...ids, tagId: '2', name: 'VV - GA4 traffic_class', type: 'gaawe',
        parameter: [
          parameter('sendEcommerceData', 'false', 'BOOLEAN'),
          table('eventSettingsTable', fields.map(name => [
            ['parameter', name], ['parameterValue', dlv(name)]
          ])),
          table('userProperties', [[['name', 'traffic_class'], ['value', dlv('traffic_class')]]]),
          parameter('eventName', 'traffic_class'),
          parameter('measurementIdOverride', reference('VV - GA4 measurement ID'))
        ],
        firingTriggerId: ['3', '12'], tagFiringOption: 'ONCE_PER_EVENT',
        consentSettings: {consentStatus: 'NOT_SET'}}
    ],
    folder: [{...ids, folderId: '13', name: 'VV - OPTIONAL page_view readiness (OR, once per page)',
      notes: 'Optional trigger set: attach VV - initial and VV - timer fallback 1s as two ordinary OR firing triggers to the existing Google tag (or explicit page_view tag), replacing its early trigger. Set Once per page. Do not use a trigger group (AND). May delay page_view by up to 1 s; fallback may have no class. Roll back by restoring the original trigger and firing option. Importing does not change site tags. See docs/ga4-reporting.md.'}],
    trigger: [phaseTrigger('3', 'final'),
      {...phaseTrigger('12', 'initial'), name: 'VV - initial hard',
        filter: [equals(dlv('traffic_phase'), 'initial'), matchRegex(dlv('traffic_class'), '^(automated|declared_agent)$')]},
      {...phaseTrigger('10', 'initial'), parentFolderId: '13',
        notes: 'Optional page_view readiness set: use this OR VV - timer fallback 1s; set the existing site tag to Once per page. See folder notes.'},
      {...ids, triggerId: '11', name: 'VV - timer fallback 1s', type: 'TIMER',
        parentFolderId: '13',
        eventName: parameter('eventName', 'gtm.timer'), interval: parameter('interval', '1000'), limit: parameter('limit', '1'),
        autoEventFilter: [matchRegex('{{_event}}', '.*')], // GTM requires a variable as the first argument
        notes: 'Optional page_view readiness set: use this OR VV - initial on the existing Google tag (or explicit page_view tag), Once per page. May delay page_view by up to 1 s. See folder notes for rollback. This import creates no Google tag.'}],
    variable: [
      {...ids, variableId: '8', name: 'VV - current class', type: 'jsm',
        parameter: [parameter('javascript', currentClass)]},
      ...fields.map((name, index) => ({...ids, variableId: String(index + 4), name: `VV - DLV ${name}`, type: 'v',
        parameter: [parameter('name', name), parameter('dataLayerVersion', '2', 'INTEGER'),
          parameter('setDefaultValue', 'false', 'BOOLEAN')]})),
      {...ids, variableId: '9', name: 'VV - GA4 measurement ID', type: 'c',
        parameter: [parameter('value', 'G-XXXXXXXXXX')]}
    ]
  }
};
await writeFile(new URL('../gtm/container-import.json', import.meta.url), JSON.stringify(container, null, 2) + '\n');
console.log('Generated gtm/container-import.json from gtm/custom-html.html');
