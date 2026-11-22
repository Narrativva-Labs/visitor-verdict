import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {defaultRegistry} from '../server/dist/registry.js';
const dir=await mkdtemp(join(tmpdir(),'vv-sgtm-rules-'));
const output=join(dir,'output.json');
const run=(extra=[])=>spawnSync(process.execPath,['scripts/build-sgtm-rules.mjs','--source-dir',dir,'--output',output,...extra],{encoding:'utf8'});
try{
 for(const o of defaultRegistry) for(const list of o.ipLists){
  const body=list.format==='sail' ? `schema = "draft-kelley-webbotauth-sail-00"\nmodified = 2026-11-23T00:00:00Z\nexpires_after = 86400\n[[prefix_sets]]\nname = "test"\nexclusive = true\nipv4_prefixes = ["192.0.2.0/25", "192.0.2.128/25"]\nipv6_prefixes = ["2001:db8::/33"]\n[[services]]\nname = "${list.service}"\nexhaustive = true\nprefix_sets = ["test"]\n` : JSON.stringify({prefixes:[{ipv4Prefix:'192.0.2.128/25'},{ipv4Prefix:'192.0.2.0/25'},{ipv4Prefix:'198.51.100.42/32'},{ipv6Prefix:'2001:db8::/33'}]});
  await writeFile(join(dir,`${o.operator}--${list.name}.txt`),body);
 }
 let r=run();assert.equal(r.status,0,r.stderr);
 const original=await readFile(output,'utf8'), feed=JSON.parse(original);
 assert.equal(feed.complete,true);assert.ok(Buffer.byteLength(original)<=200000);assert.deepEqual(feed.missing,[]);
 const group=feed.groups.find(g=>g.list==='chatgpt-user');assert.deepEqual(group.v4,[[3221225984,3221226239],[3325256746,3325256746]]);assert.deepEqual(group.v6,[['20010db8000000000000000000000000',33]]);
 assert.equal(feed.tokens[group.tokens[0]],'ChatGPT-User');assert.equal(feed.operators[group.operator].id,'openai');
 const sail=feed.groups.find(g=>g.list==='sail');assert.equal(sail.v4.length,1);assert.ok(sail.tokens.length);
 // Missing input must never replace an existing good output silently.
 await rm(join(dir,'openai--chatgpt-user.txt'));r=run();assert.notEqual(r.status,0);assert.equal(await readFile(output,'utf8'),original);
 r=run(['--allow-partial']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(await readFile(output,'utf8')).complete,false);
 // Guard must measure the full serialized byte length, before writing output.
 const large=JSON.stringify({prefixes:Array.from({length:8192},(_,i)=>({ipv6Prefix:`2001:db8:${i.toString(16)}::/128`}))});
 for(const o of defaultRegistry)for(const list of o.ipLists)if(list.format!=='sail')await writeFile(join(dir,`${o.operator}--${list.name}.txt`),large);
 const before=await readFile(output,'utf8');r=run();assert.notEqual(r.status,0);assert.match(r.stderr,/200 KB/);assert.equal(await readFile(output,'utf8'),before);
 console.log('PASS: sGTM rules export, merged IPv4 boundaries, IPv6 prefixes, SAIL, UA gates, strict failure, partial manifest and 200 KB guard');
}finally{await rm(dir,{recursive:true,force:true});}
