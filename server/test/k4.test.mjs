import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentCache} from '../dist/cache.js';
import {decodeList,decodeSail,ipMismatch} from '../dist/ip.js';
const start=1800000000,url='https://example.test/ip';
test('K4 repeated identical shrink recovers after two hours; changed content and empty never bypass guard',async()=>{
 let now=start,count=4,offset=0;const cache=new AgentCache(async()=>Response.json({prefixes:Array.from({length:count},(_,i)=>({ipv4Prefix:`192.0.${i+offset}.0/24`}))}),50,{now:()=>now,staleMaxSeconds:86400});
 cache.requireComplete(url);await cache.load(url,'ip',now,decodeList,'warm');count=1;now+=601;
 await assert.rejects(cache.load(url,'ip',now,decodeList,'forced'),{reason:'shrink'});
 now+=7199;await assert.rejects(cache.load(url,'ip',now,decodeList,'forced'),{reason:'shrink'});
 now+=61;assert.equal((await cache.load(url,'ip',now,decodeList,'forced')).prefixCount,1);
 count=0;now+=61;await assert.rejects(cache.load(url,'ip',now,decodeList,'forced'),{reason:'shrink'});now+=7201;await assert.rejects(cache.load(url,'ip',now,decodeList,'forced'),{reason:'shrink'});cache.close();
});
test('K4 one SAIL service shrink does not disable healthy sibling or extend unhealthy LKG forever',async()=>{
 let now=start,bad=false;const sail=()=>`schema = "draft-kelley-webbotauth-sail-00"\nmodified = 2026-11-24T00:00:00Z\nexpires_after = 300\n[[prefix_sets]]\nname = "good"\nexclusive = true\nipv4_prefixes = ["192.0.2.0/24"]\nipv6_prefixes = []\n[[prefix_sets]]\nname = "bad"\nexclusive = true\nipv4_prefixes = ${bad?'[]':'["198.51.100.0/24"]'}\nipv6_prefixes = []\n[[services]]\nname = "good"\nexhaustive = true\nprefix_sets = ["good"]\n[[services]]\nname = "bad"\nexhaustive = true\nprefix_sets = ["bad"]\n`;
 const cache=new AgentCache(async()=>new Response(sail(),{headers:{'content-type':'application/sail+toml'}}),50,{now:()=>now,staleMaxSeconds:86400});
 for(const name of ['good','bad']) cache.requireComplete(url,name);
 await cache.load(url,'sail',now,decodeSail,'warm');bad=true;now+=601;await cache.load(url,'sail',now,decodeSail,'forced');
 const reg=name=>[{operator:name,ipLists:[{name:'sail',url,format:'sail',service:name,complete:true,uaTokens:[name+'Bot']}]}];
 assert.deepEqual(await ipMismatch('203.0.113.1',['goodBot'],reg('good'),cache,now,new Map()),{fresh:true});
 assert.deepEqual(await ipMismatch('203.0.113.1',['badBot'],reg('bad'),cache,now,new Map()),{fresh:false});
 now+=86400;const data=await cache.load(url,'sail',now,decodeSail,'forced');assert.equal(data.has('bad'),false);assert.equal(data.has('good'),true);cache.close();
});
