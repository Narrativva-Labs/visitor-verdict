// Optional real-DOM contract: run after installing Playwright Chromium.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const source = await readFile(new URL('../src/visitor-verdict.js', import.meta.url), 'utf8');
const browser = await chromium.launch({headless: true});
try {
  for (const variant of ['host', 'attribute', 'child', 'block', 'stripped']) {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.evaluate(() => {
      // Exercise only declaration evidence in the automated test browser.
      Object.defineProperty(navigator, 'webdriver', {get: () => false});
      Object.defineProperty(navigator, 'userAgent', {get: () => 'Mozilla/5.0 Chrome/158.0.0.0 Safari/537.36'});
      Object.defineProperty(navigator, 'userAgentData', {get: () => undefined});
      window.visitorVerdictConfig = {debug: true};
      const style = document.createElement('style'); style.textContent = 'body > div { display: contents }'; document.head.appendChild(style);
    });
    await page.addScriptTag({content: source});
    await page.evaluate(variant => {
      const node = document.createElement('div');
      const shadow = node.attachShadow({mode: 'closed'});
      shadow.innerHTML = '<div id="claude-agent-glow-border">synthetic</div>';
      if (variant === 'attribute' || variant === 'stripped') node.setAttribute('data-test', 'temporary');
      if (variant === 'child') node.appendChild(document.createTextNode(' '));
      if (variant === 'block') node.style.display = 'block';
      document.body.appendChild(node);
      if (variant === 'stripped') setTimeout(() => node.removeAttribute('data-test'), 0);
    }, variant);
    await page.waitForTimeout(50);
    const state = await page.evaluate(() => window.__visitorVerdict);
    assert.equal(state.class, ['host', 'stripped'].includes(variant) ? 'declared_agent' : 'human', variant);
    if (state.class === 'declared_agent') { assert.equal(state.agent, 'anthropic'); assert.equal(state.claim, 'dom_host'); }
    await page.close();
  }
  console.log('PASS: 5 real-DOM closed-shadow host contracts');
} finally { await browser.close(); }
