import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultRegistry, serverAgentTokens } from '../dist/index.js';

test('public server tokens include browser and server-only claims without duplicates', () => {
  const tokens = serverAgentTokens(defaultRegistry);
  for (const token of ['ChatGPT-User', 'Google-NotebookLM', 'Yeti'])
    assert.ok(tokens.includes(token), token);
  assert.equal(new Set(tokens).size, tokens.length);
  assert.ok(
    serverAgentTokens([{ ...defaultRegistry[0], extraUaTokens: ['custom-token'] }]).includes(
      'custom-token',
    ),
  );
});

test('public declaration closure never references structured-headers', async () => {
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, 'utf8');
    assert.ok(!source.includes('structured-headers'), url.pathname);
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(\s*|import\s*|<reference\s+path=)["']([^"']+)["']/g,
    )) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const path = specifier.endsWith('.d.ts')
        ? specifier
        : specifier.replace(/\.js$/, '') + '.d.ts';
      await visit(new URL(path, url));
    }
  }
  await visit(new URL('../dist/index.d.ts', import.meta.url));
  assert.ok(visited.size > 1);
});
