import test from 'node:test';
import {runCorpus} from './vectors/runner.mjs';
test('K4 shared corpus agrees with canonical library and sandbox',async()=>{await runCorpus({packageUrl:new URL('../dist/index.js',import.meta.url).href});});
