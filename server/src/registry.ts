import { additionalOperators } from './registry-extra.js';
import type { Registry } from './types.js';
// Exact operator identities and endpoints; no discovery from request-controlled URLs.
export const defaultRegistry: Registry = [
  ...additionalOperators,
  {
    operator: 'apple',
    reverseDns: [
      {
        uaTokens: ['Applebot'],
        suffixes: ['applebot.apple.com'],
        source: 'https://support.apple.com/en-sg/119829',
        checked: '2026-11-20',
      },
    ],
    verifiedByCapture: false,
    checked: '2026-11-20',
    source: 'https://support.apple.com/en-sg/119829',
    ipLists: [
      {
        name: 'applebot',
        url: 'https://search.developer.apple.com/applebot.json',
        uaTokens: ['Applebot'],
      },
    ],
  },
  {
    operator: 'microsoft',
    reverseDns: [
      {
        uaTokens: ['bingbot'],
        suffixes: ['search.msn.com'],
        source: 'https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26',
        checked: '2026-11-20',
      },
    ],
    verifiedByCapture: false,
    checked: '2026-11-20',
    source: 'https://www.bing.com/webmasters/help/how-to-verify-bingbot-3905dc26',
    extraUaTokens: ['bingbot'],
    ipLists: [
      { name: 'bingbot', url: 'https://www.bing.com/toolbox/bingbot.json', uaTokens: ['bingbot'] },
    ],
  },
  {
    operator: 'mistral',
    verifiedByCapture: false,
    checked: '2026-11-20',
    source: 'https://docs.mistral.ai/robots',
    ipLists: [
      {
        name: 'mistralai-user',
        url: 'https://mistral.ai/mistralai-user-ips.json',
        uaTokens: ['MistralAI-User'],
      },
      {
        name: 'mistralai-index',
        url: 'https://mistral.ai/mistralai-index-ips.json',
        uaTokens: ['MistralAI-Index'],
      },
    ],
  },
  {
    operator: 'duckduckgo',
    signatureAgent: 'https://assistbot.duckduckgo.com',
    directoryUrl: 'https://assistbot.duckduckgo.com/.well-known/http-message-signatures-directory',
    verifiedByCapture: false,
    source: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'duckassistbot',
        url: 'https://duckduckgo.com/duckassistbot.json',
        uaTokens: ['DuckAssistBot'],
      },
    ],
  },
  {
    operator: 'openai',
    signatureAgent: 'https://chatgpt.com',
    directoryUrl: 'https://chatgpt.com/.well-known/http-message-signatures-directory',
    verifiedByCapture: true,
    source: 'https://developers.openai.com/commerce/agent-access',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'chatgpt-user',
        url: 'https://openai.com/chatgpt-user.json',
        uaTokens: ['ChatGPT-User'],
      },
      { name: 'searchbot', url: 'https://openai.com/searchbot.json', uaTokens: ['OAI-SearchBot'] },
      { name: 'gptbot', url: 'https://openai.com/gptbot.json', uaTokens: ['GPTBot'] },
      { name: 'adsbot', url: 'https://openai.com/adsbot.json', uaTokens: ['OAI-AdsBot'] },
    ],
  },
  {
    operator: 'google',
    extraUaTokens: ['Googlebot'],
    allowKidAlias: true,
    reverseDns: [
      {
        uaTokens: [
          'Google-Agent',
          'Google-GeminiNotebook',
          'Google-NotebookLM',
          'Gemini-Deep-Research',
        ],
        suffixes: ['google.com', 'googleusercontent.com'],
        source:
          'https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests',
        checked: '2026-11-20',
      },
      {
        uaTokens: ['Google-CloudVertexBot', 'Googlebot'],
        suffixes: ['googlebot.com'],
        source:
          'https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests',
        checked: '2026-11-20',
      },
    ],
    signatureAgent: 'https://agent.bot.goog',
    directoryUrl: 'https://agent.bot.goog/.well-known/http-message-signatures-directory',
    verifiedByCapture: false,
    source: 'https://developers.google.com/crawling/docs/crawlers-fetchers/allow-google-agent',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'user-triggered-agents',
        url: 'https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json',
        uaTokens: ['Google-Agent'],
      },
      {
        name: 'user-triggered-fetchers-google',
        url: 'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json',
        uaTokens: ['Google-GeminiNotebook', 'Google-NotebookLM', 'Gemini-Deep-Research'],
      },
      {
        name: 'common-crawlers',
        url: 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
        uaTokens: ['Google-CloudVertexBot', 'Googlebot'],
      },
      {
        name: 'user-triggered-fetchers',
        url: 'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json',
        uaTokens: [],
      },
    ],
  },
  {
    operator: 'browserbase',
    signatureAgent: 'https://www.browserbase.com',
    directoryUrl: 'https://www.browserbase.com/.well-known/http-message-signatures-directory',
    verifiedByCapture: false,
    source: 'https://www.browserbase.com/contact-web-bot-auth',
    checked: '2026-11-20',
    ipLists: [],
  },
  {
    operator: 'manus',
    signatureAgent: 'https://api.manus.im',
    directoryUrl: 'https://api.manus.im/.well-known/http-message-signatures-directory',
    verifiedByCapture: false,
    source: 'https://radar.cloudflare.com/bots/directory/manus-bot',
    checked: '2026-11-20',
    ipLists: [],
  },
  {
    operator: 'anthropic',
    verifiedByCapture: false,
    source: 'https://claude.com/crawling/bots.json',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'bots',
        url: 'https://claude.com/crawling/bots.json',
        uaTokens: ['ClaudeBot', 'Claude-SearchBot', 'Claude-User'],
      },
      {
        name: 'sail',
        url: 'https://claude.com/.well-known/sail',
        uaTokens: ['Claude-Agent'],
        format: 'sail',
        service: 'Claude-Agent',
      },
    ],
  },
  {
    operator: 'perplexity',
    verifiedByCapture: false,
    source: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers',
    checked: '2026-11-20',
    ipLists: [
      {
        name: 'perplexitybot',
        url: 'https://www.perplexity.ai/perplexitybot.json',
        uaTokens: ['PerplexityBot'],
      },
      {
        name: 'perplexity-user',
        url: 'https://www.perplexity.ai/perplexity-user.json',
        uaTokens: ['Perplexity-User'],
      },
    ],
  },
];
