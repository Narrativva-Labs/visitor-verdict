___TERMS_OF_SERVICE___

By creating or modifying this file you agree to Google Tag Manager's Community
Template Gallery Developer Terms of Service available at
https://developers.google.com/tag-manager/gallery-tos (or such other URL as
Google may provide), as modified from time to time.

___INFO___

{
  "type": "MACRO",
  "id": "cvt_temp_public_id",
  "version": 1,
  "securityGroups": [],
  "displayName": "VV - traffic_detail",
  "description": "Visitor Verdict browser detail agent|claim|phase|replay from the data layer, without Custom JavaScript (for sites whose CSP blocks unsafe-eval). Each missing or invalid segment becomes -.",
  "containerContexts": [
    "WEB"
  ]
}


___TEMPLATE_PARAMETERS___

[]


___SANDBOXED_JS_FOR_WEB_TEMPLATE___

const copyFromDataLayer = require('copyFromDataLayer');
const getType = require('getType');
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
function segment(key) {
  const value = copyFromDataLayer(key);
  if (getType(value) !== 'string' || value.length < 1 || value.length > 32) return '-';
  if (LOWER.indexOf(value.charAt(0)) < 0) return '-';
  for (let i = 1; i < value.length; i++) {
    const c = value.charAt(i);
    if (LOWER.indexOf(c) < 0 && c !== '_') return '-';
  }
  return value;
}
return [segment('traffic_agent'), segment('traffic_agent_claim'), segment('traffic_phase'), segment('traffic_replay')].join('|');


___WEB_PERMISSIONS___

[
  {
    "instance": {
      "key": {
        "publicId": "read_data_layer",
        "versionId": "1"
      },
      "param": [
        {
          "key": "allowedKeys",
          "value": {
            "type": 1,
            "string": "specific"
          }
        },
        {
          "key": "keyPatterns",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 1,
                "string": "traffic_agent"
              },
              {
                "type": 1,
                "string": "traffic_agent_claim"
              },
              {
                "type": 1,
                "string": "traffic_phase"
              },
              {
                "type": 1,
                "string": "traffic_replay"
              }
            ]
          }
        }
      ]
    },
    "clientAnnotations": {
      "isEditedByUser": true
    },
    "isRequired": true
  }
]


___TESTS___

scenarios:
- name: Agent detail
  code: |-
    mock('copyFromDataLayer', function(key) {
      return {traffic_agent: 'anthropic', traffic_agent_claim: 'dom_host', traffic_phase: 'final'}[key];
    });
    assertThat(runCode({})).isEqualTo('anthropic|dom_host|final|-');
- name: Missing and invalid segments become dashes
  code: |-
    mock('copyFromDataLayer', function(key) {
      return {traffic_agent: 'Open AI', traffic_agent_claim: 5, traffic_phase: 'final', traffic_replay: 'consent'}[key];
    });
    assertThat(runCode({})).isEqualTo('-|-|final|consent');
- name: Empty data layer
  code: |-
    mock('copyFromDataLayer', function() { return undefined; });
    assertThat(runCode({})).isEqualTo('-|-|-|-');


___NOTES___

Import in Templates > Variable Templates > New > Import. Create a variable with this template and use it for the GA4 parameter traffic_detail in place of the Custom JavaScript VV - traffic_detail variable on sites whose Content Security Policy does not allow 'unsafe-eval' (GTM cannot run Custom JavaScript variables there; the parameter is then silently dropped). Reads only four data layer keys; no globals, storage, network or writes. Same output as the Custom JavaScript variable.
