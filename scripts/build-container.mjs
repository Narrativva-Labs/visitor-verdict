import {readFile, writeFile} from 'node:fs/promises';

// GTM export format uses uppercase enum values and singular resource arrays.
// Keep output deterministic so rebuilding produces a reviewable diff.
const html = await readFile(new URL('../gtm/custom-html.html', import.meta.url), 'utf8');
if (!html.trim().startsWith('<script>') || !html.trim().endsWith('</script>')) {
  throw new Error('Expected the generated Custom HTML script');
}
const ids = {accountId: '0', containerId: '0'};
const parameter = (key, value, type = 'TEMPLATE') => ({type, key, value});
const reference = name => `{{${name}}}`;
const fields = ['traffic_class', 'traffic_phase', 'traffic_score'];
const equals = (left, right) => ({type: 'EQUALS', parameter: [
  parameter('arg0', left), parameter('arg1', right)
]});
const table = (key, rows) => ({type: 'LIST', key,
  list: rows.map(row => ({type: 'MAP', map: row.map(([name, value]) => parameter(name, value))}))});
const container = {
  exportFormatVersion: 2,
  containerVersion: {
    ...ids, containerVersionId: '0',
    container: {...ids, name: 'traffic-class', publicId: 'GTM-XXXXXXX', usageContext: ['WEB']},
    tag: [
      {...ids, tagId: '1', name: 'TC - detector traffic_class', type: 'html',
        parameter: [parameter('html', html), parameter('supportDocumentWrite', 'false', 'BOOLEAN')],
        priority: {type: 'INTEGER', value: '100'},
        firingTriggerId: ['2147479553'], tagFiringOption: 'ONCE_PER_LOAD',
        consentSettings: {consentStatus: 'NOT_NEEDED'}},
      {...ids, tagId: '2', name: 'GA4 - traffic_class', type: 'gaawe',
        parameter: [
          parameter('sendEcommerceData', 'false', 'BOOLEAN'),
          table('eventSettingsTable', fields.map(name => [
            ['parameter', name], ['parameterValue', reference(name)]
          ])),
          table('userProperties', [[['name', 'traffic_class'], ['value', reference('traffic_class')]]]),
          parameter('eventName', 'traffic_class'),
          parameter('measurementIdOverride', reference('TC - GA4 measurement ID'))
        ],
        firingTriggerId: ['3'], tagFiringOption: 'ONCE_PER_EVENT',
        consentSettings: {consentStatus: 'NOT_SET'}}
    ],
    trigger: [{...ids, triggerId: '3', name: 'traffic_class final', type: 'CUSTOM_EVENT',
      customEventFilter: [equals('{{_event}}', 'traffic_class')],
      filter: [equals(reference('traffic_phase'), 'final')]}],
    variable: [
      ...fields.map((name, index) => ({...ids, variableId: String(index + 4), name, type: 'v',
        parameter: [parameter('name', name), parameter('dataLayerVersion', '2', 'INTEGER'),
          parameter('setDefaultValue', 'false', 'BOOLEAN')]})),
      {...ids, variableId: '7', name: 'TC - GA4 measurement ID', type: 'c',
        parameter: [parameter('value', 'G-XXXXXXXXXX')]}
    ]
  }
};
await writeFile(new URL('../gtm/container-import.json', import.meta.url), JSON.stringify(container, null, 2) + '\n');
console.log('Generated gtm/container-import.json from gtm/custom-html.html');
