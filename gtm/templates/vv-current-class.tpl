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
  "displayName": "VV - current class",
  "description": "Current validated Visitor Verdict class; falls back to the previous final class captured at detector start.",
  "containerContexts": [
    "WEB"
  ]
}

___TEMPLATE_PARAMETERS___

[]

___SANDBOXED_JS_FOR_WEB_TEMPLATE___

const copyFromWindow = require('copyFromWindow');
function valid(value) {
  return value === 'human' || value === 'suspicious' || value === 'automated' || value === 'declared_agent';
}
const current = copyFromWindow('__visitorVerdict.class');
if (valid(current)) return current;
const previous = copyFromWindow('__visitorVerdictLast');
if (valid(previous)) return previous;
return undefined;

___WEB_PERMISSIONS___

[
  {
    "instance": {
      "key": {
        "publicId": "access_globals",
        "versionId": "1"
      },
      "param": [
        {
          "key": "keys",
          "value": {
            "type": 2,
            "listItem": [
              {
                "type": 3,
                "mapKey": [
                  {
                    "type": 1,
                    "string": "key"
                  },
                  {
                    "type": 1,
                    "string": "read"
                  },
                  {
                    "type": 1,
                    "string": "write"
                  },
                  {
                    "type": 1,
                    "string": "execute"
                  }
                ],
                "mapValue": [
                  {
                    "type": 1,
                    "string": "__visitorVerdict.class"
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": false
                  },
                  {
                    "type": 8,
                    "boolean": false
                  }
                ]
              },
              {
                "type": 3,
                "mapKey": [
                  {
                    "type": 1,
                    "string": "key"
                  },
                  {
                    "type": 1,
                    "string": "read"
                  },
                  {
                    "type": 1,
                    "string": "write"
                  },
                  {
                    "type": 1,
                    "string": "execute"
                  }
                ],
                "mapValue": [
                  {
                    "type": 1,
                    "string": "__visitorVerdictLast"
                  },
                  {
                    "type": 8,
                    "boolean": true
                  },
                  {
                    "type": 8,
                    "boolean": false
                  },
                  {
                    "type": 8,
                    "boolean": false
                  }
                ]
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
- name: Current class wins
  code: |-
    mock('copyFromWindow', function(path) {
      return path === '__visitorVerdict.class' ? 'human' : 'automated';
    });
    assertThat(runCode({})).isEqualTo('human');
    assertApi('copyFromWindow').wasNotCalledWith('__visitorVerdictLast');
- name: Previous class is the fallback
  code: |-
    mock('copyFromWindow', function(path) {
      return path === '__visitorVerdictLast' ? 'suspicious' : undefined;
    });
    assertThat(runCode({})).isEqualTo('suspicious');
- name: Unknown stays undefined
  code: |-
    mock('copyFromWindow', function() { return 'human\n'; });
    assertThat(runCode({})).isUndefined();

___NOTES___

Import in Templates > Variable Templates > New > Import. Create a variable with this template and use it in place of the Custom JavaScript VV - current class variable. Only the two named globals are readable. No storage, network, write, or execute permissions. The detector itself still needs the site CSP to allow its deployment.
