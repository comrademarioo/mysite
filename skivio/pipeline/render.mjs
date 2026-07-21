// Headless-Chromium page renderer for roster pages that are JS shells or sit
// behind bot walls (Epic, Ikon, Mountain Collective). Returns rendered HTML.
// Routes through HTTPS_PROXY when present and tolerates its MITM certificate.
import { chromium } from 'playwright-core';

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    browserPromise = chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      headless: true,
      args: ['--ignore-certificate-errors', '--no-sandbox'],
      proxy: proxy ? { server: proxy } : undefined,
    });
  }
  return browserPromise;
}

export async function renderPage(url, { waitFor = null, timeoutMs = 45000 } = {}) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: timeoutMs }).catch(() => {});
    else await page.waitForTimeout(6000); // let SPA hydrate + fetch data
    return await page.content();
  } finally {
    await ctx.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) { (await browserPromise).close(); browserPromise = null; }
}
