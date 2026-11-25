import test from 'node:test';import assert from 'node:assert/strict';
import {createVerifier} from '../dist/index.js';import {AgentCache} from '../dist/cache.js';
const url='https://example.test/sail',now=1800000000;
const body=`schema = "draft-kelley-webbotauth-sail-00"\nmodified = 2026-11-24T00:00:00Z\nexpires_after = 86400\n[[prefix_sets]]\nname = "optional"\nexclusive = true\nipv4_prefixes = ["192.0.2.0/24"]\nipv6_prefixes = []\n[[services]]\nname = "optional"\nexhaustive = true\nprefix_sets = ["optional"]\n[[prefix_sets]]\nname = "required"\nexclusive = true\nipv4_prefixes = []\nipv6_prefixes = []\n[[services]]\nname = "required"\nexhaustive = true\nprefix_sets = ["required"]\n`;
const registry=service=>[{operator:'openai',verifiedByCapture:false,source:'https://example.test/docs',checked:'2026-11-25',ipLists:[{name:service,url,format:'sail',service,uaTokens:['GPTBot'],complete:true,source:'https://example.test/docs',checked:'2026-11-25'}]}];
test('K6 SAIL readiness is per verifier; an unused service cannot make warm successful',async()=>{
 const cache=new AgentCache(async()=>new Response(body,{headers:{'content-type':'application/sail+toml'}}),50,{now:()=>now});
 const bad=createVerifier({authorities:['example.com'],registry:registry('required'),now:()=>now},cache);
 const good=createVerifier({authorities:['other.example'],registry:registry('optional'),now:()=>now},cache);
 try{assert.deepEqual((await bad.warm({ipLists:true})).failed,[url]);assert.equal(bad.status().ipLists.loaded,0);assert.deepEqual((await good.warm({ipLists:true})).ok,[url]);assert.equal(good.status().ipLists.loaded,1);assert.equal(bad.status().ipLists.loaded,0);}finally{bad.close();good.close();cache.close();}
});
