import type { PurposePolicy } from './types.js';
const checked = '2026-11-20';
// Product roles from operator documentation; unlisted evidence remains unknown.
export const purposePolicies: Record<string, PurposePolicy> = {
  openai: {
    signatureAgent: 'user_directed',
    ipLists: { 'chatgpt-user': 'user_directed', searchbot: 'crawler', gptbot: 'crawler' },
    uaTokens: { 'ChatGPT-User': 'user_directed', 'OAI-SearchBot': 'crawler', GPTBot: 'crawler' },
    sources: [
      'https://developers.openai.com/api/docs/bots',
      'https://developers.openai.com/commerce/agent-access',
    ],
    checked,
  },
  google: {
    signatureAgent: 'user_directed',
    ipLists: {
      'user-triggered-agents': 'user_directed',
      'user-triggered-fetchers-google': 'user_directed',
      'user-triggered-fetchers': 'user_directed',
      'common-crawlers': 'crawler',
    },
    uaTokens: {
      'Google-Agent': 'user_directed',
      'Google-GeminiNotebook': 'user_directed',
      'Google-NotebookLM': 'user_directed',
      'Gemini-Deep-Research': 'user_directed',
      Googlebot: 'crawler',
      'Google-CloudVertexBot': 'crawler',
    },
    sources: [
      'https://developers.google.com/crawling/docs/crawlers-fetchers/overview-google-crawlers',
      'https://developers.google.com/crawling/docs/crawlers-fetchers/allow-google-agent',
    ],
    checked,
  },
  anthropic: {
    ipLists: { sail: 'user_directed' },
    uaTokens: {
      'Claude-Agent': 'user_directed',
      'Claude-User': 'user_directed',
      ClaudeBot: 'crawler',
      'Claude-SearchBot': 'crawler',
    },
    sources: [
      'https://claude.com/.well-known/sail',
      'https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler',
    ],
    checked,
  },
  perplexity: {
    ipLists: { 'perplexity-user': 'user_directed', perplexitybot: 'crawler' },
    uaTokens: { 'Perplexity-User': 'user_directed', PerplexityBot: 'crawler' },
    sources: ['https://docs.perplexity.ai/docs/resources/perplexity-crawlers'],
    checked,
  },
  mistral: {
    ipLists: { 'mistralai-user': 'user_directed', 'mistralai-index': 'crawler' },
    uaTokens: { 'MistralAI-User': 'user_directed', 'MistralAI-Index': 'crawler' },
    sources: ['https://docs.mistral.ai/robots'],
    checked,
  },
  kimi: {
    ipLists: { 'kimi-user': 'user_directed', kimibot: 'crawler', 'kimi-searchbot': 'crawler' },
    uaTokens: { 'Kimi-User': 'user_directed', KimiBot: 'crawler', 'Kimi-SearchBot': 'crawler' },
    sources: ['https://www.kimi.ai/policies/kimi-crawlers'],
    checked,
  },
  apple: {
    ipLists: { applebot: 'crawler' },
    uaTokens: { Applebot: 'crawler' },
    sources: ['https://support.apple.com/en-sg/119829'],
    checked,
  },
  microsoft: {
    ipLists: { bingbot: 'crawler' },
    uaTokens: { bingbot: 'crawler' },
    sources: ['https://www.bing.com/webmasters/help/help/which-crawlers-does-bing-use-8c184ec0'],
    checked,
  },
  commoncrawl: {
    ipLists: { ccbot: 'crawler' },
    uaTokens: { CCBot: 'crawler' },
    sources: ['https://commoncrawl.org/ccbot'],
    checked,
  },
  seznam: {
    ipLists: { seznambot: 'crawler' },
    uaTokens: { SeznamBot: 'crawler' },
    sources: ['https://o-seznam.cz/napoveda/vyhledavani/en/seznambot-crawler/'],
    checked,
  },
  naver: {
    uaTokens: { Yeti: 'crawler' },
    sources: ['https://searchadvisor.naver.com/guide/seo-basic-firewall'],
    checked,
  },
  kagi: { uaTokens: { Kagibot: 'crawler' }, sources: ['https://kagi.com/bot'], checked },
};
