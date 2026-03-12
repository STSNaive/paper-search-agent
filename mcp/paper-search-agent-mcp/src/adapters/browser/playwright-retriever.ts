/**
 * Playwright browser retrieval adapter.
 *
 * Human-in-the-loop (HITL) browser route for subscription content:
 * 1. Opens a visible browser window navigating to the paper's landing page.
 * 2. Detects if verification is needed (CAPTCHA, login, cookie consent).
 * 3. If verification needed → returns status "needs_human" with the page open
 *    for the user to interact with. The LLM relays this to the user.
 * 4. Once verification is done (or not needed), tries to find a PDF link
 *    or capture HTML full text.
 * 5. Saves browser state (cookies/storage) after success for future sessions.
 *
 * The browser instance is kept alive across MCP calls in the same server process.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

export interface BrowserRetrievalResult {
  success: boolean;
  artifact_path: string | null;
  artifact_type: "pdf" | "html" | null;
  needs_human_interaction: boolean;
  human_message: string | null;
  state_saved: boolean;
  page_title: string | null;
  page_url: string | null;
  error: string | null;
}

// ── Singleton browser state ───────────────────────────────────────
let browserInstance: Browser | null = null;
let browserContext: BrowserContext | null = null;
let activePage: Page | null = null;

const STATE_FILE = "browser-state.json";

/**
 * Main browser retrieval function.
 *
 * @param url - URL to navigate to (DOI landing page or publisher URL)
 * @param stateDir - Directory for saving browser state
 * @param cacheDir - Directory where downloaded artifacts are stored
 * @param doi - DOI for organizing cached artifacts
 * @param action - "navigate" (default), "check" (check if verification done), or "close"
 */
export async function browserRetrieve(
  url: string,
  stateDir: string,
  cacheDir: string = "./cache",
  doi: string | null = null,
  action: "navigate" | "check" | "close" = "navigate",
): Promise<BrowserRetrievalResult> {
  mkdirSync(resolve(stateDir), { recursive: true });

  if (action === "close") {
    return closeBrowser(stateDir);
  }

  if (action === "check") {
    return checkCurrentPage(stateDir, cacheDir, doi);
  }

  // action === "navigate"
  return navigateAndRetrieve(url, stateDir, cacheDir, doi);
}

// ── Navigate & Retrieve ───────────────────────────────────────────

async function navigateAndRetrieve(
  url: string,
  stateDir: string,
  cacheDir: string,
  doi: string | null,
): Promise<BrowserRetrievalResult> {
  try {
    await ensureBrowser(stateDir);
    if (!browserContext) throw new Error("Browser context not available");

    activePage = await browserContext.newPage();
    await activePage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for page to stabilize
    await activePage.waitForTimeout(2000);

    // Check for verification challenges
    const challenge = await detectChallenge(activePage);
    if (challenge) {
      return {
        success: false,
        artifact_path: null,
        artifact_type: null,
        needs_human_interaction: true,
        human_message: `Browser opened at: ${activePage.url()}\n` +
          `Detected: ${challenge}\n` +
          `Please complete the verification in the browser window, ` +
          `then call browser_retrieve with action="check" to continue.`,
        state_saved: false,
        page_title: await activePage.title(),
        page_url: activePage.url(),
        error: null,
      };
    }

    // No challenge — try to retrieve content
    return tryRetrieveContent(activePage, stateDir, cacheDir, doi);
  } catch (e) {
    return {
      success: false,
      artifact_path: null,
      artifact_type: null,
      needs_human_interaction: false,
      human_message: null,
      state_saved: false,
      page_title: null,
      page_url: null,
      error: (e as Error).message,
    };
  }
}

// ── Check current page (after human interaction) ──────────────────

async function checkCurrentPage(
  stateDir: string,
  cacheDir: string,
  doi: string | null,
): Promise<BrowserRetrievalResult> {
  if (!activePage || activePage.isClosed()) {
    return {
      success: false,
      artifact_path: null,
      artifact_type: null,
      needs_human_interaction: false,
      human_message: null,
      state_saved: false,
      page_title: null,
      page_url: null,
      error: "No active browser page. Call browser_retrieve with action='navigate' first.",
    };
  }

  try {
    // Give page time to settle after human interaction
    await activePage.waitForTimeout(1000);

    // Check if challenge is still present
    const challenge = await detectChallenge(activePage);
    if (challenge) {
      return {
        success: false,
        artifact_path: null,
        artifact_type: null,
        needs_human_interaction: true,
        human_message: `Verification still needed: ${challenge}\n` +
          `Please complete it in the browser window, then call browser_retrieve with action="check" again.`,
        state_saved: false,
        page_title: await activePage.title(),
        page_url: activePage.url(),
        error: null,
      };
    }

    return tryRetrieveContent(activePage, stateDir, cacheDir, doi);
  } catch (e) {
    return {
      success: false,
      artifact_path: null,
      artifact_type: null,
      needs_human_interaction: false,
      human_message: null,
      state_saved: false,
      page_title: null,
      page_url: null,
      error: (e as Error).message,
    };
  }
}

// ── Content retrieval from a loaded page ──────────────────────────

async function tryRetrieveContent(
  page: Page,
  stateDir: string,
  cacheDir: string,
  doi: string | null,
): Promise<BrowserRetrievalResult> {
  const pageTitle = await page.title();
  const pageUrl = page.url();

  // Strategy 1: Look for a PDF download link and download it
  const pdfResult = await tryDownloadPdf(page, cacheDir, doi);
  if (pdfResult) {
    await saveState(stateDir);
    return {
      success: true,
      artifact_path: pdfResult.path,
      artifact_type: "pdf",
      needs_human_interaction: false,
      human_message: null,
      state_saved: true,
      page_title: pageTitle,
      page_url: pageUrl,
      error: null,
    };
  }

  // Strategy 2: Capture full-text HTML from the page
  const htmlResult = await captureHtmlFulltext(page, cacheDir, doi);
  if (htmlResult) {
    await saveState(stateDir);
    return {
      success: true,
      artifact_path: htmlResult.path,
      artifact_type: "html",
      needs_human_interaction: false,
      human_message: null,
      state_saved: true,
      page_title: pageTitle,
      page_url: pageUrl,
      error: null,
    };
  }

  // Could not find downloadable content
  await saveState(stateDir);
  return {
    success: false,
    artifact_path: null,
    artifact_type: null,
    needs_human_interaction: false,
    human_message: `Page loaded (${pageUrl}) but could not locate full text. ` +
      `You may need to manually download the file and use import_local_file.`,
    state_saved: true,
    page_title: pageTitle,
    page_url: pageUrl,
    error: "Could not find PDF download link or full-text HTML on the page.",
  };
}

// ── Challenge detection ───────────────────────────────────────────

async function detectChallenge(page: Page): Promise<string | null> {
  const checks = [
    // CAPTCHA indicators
    { selector: 'iframe[src*="captcha"], iframe[src*="recaptcha"], .g-recaptcha, #captcha', label: "CAPTCHA detected" },
    // Cloudflare challenge
    { selector: '#challenge-running, #challenge-form, .cf-browser-verification', label: "Cloudflare verification" },
    // Institutional login / Shibboleth
    { selector: 'form[action*="login"], form[action*="shibboleth"], form[action*="auth"], #loginForm', label: "Login form detected" },
    // Cookie consent blocking overlay
    { selector: '.cookie-consent-modal, #cookie-banner[style*="block"], .gdpr-overlay', label: "Cookie consent overlay" },
    // Access denied patterns
    { selector: '.access-denied, .paywall, .restricted-access', label: "Access denied / paywall" },
  ];

  for (const check of checks) {
    try {
      const el = await page.$(check.selector);
      if (el && await el.isVisible()) {
        return check.label;
      }
    } catch {
      // Selector failed — skip
    }
  }

  // Check page text for common denial patterns
  try {
    const bodyText = await page.textContent("body") ?? "";
    const lower = bodyText.toLowerCase().slice(0, 5000);
    if (lower.includes("verify you are human") || lower.includes("please verify")) {
      return "Human verification prompt";
    }
    if (lower.includes("access denied") && !lower.includes("abstract")) {
      return "Access denied page";
    }
  } catch {
    // Page not fully loaded
  }

  return null;
}

// ── PDF download logic ────────────────────────────────────────────

async function tryDownloadPdf(
  page: Page,
  cacheDir: string,
  doi: string | null,
): Promise<{ path: string } | null> {
  // Common PDF link selectors across major publishers
  const pdfSelectors = [
    // Generic PDF links
    'a[href$=".pdf"]',
    'a[href*="/pdf/"]',
    'a[href*="pdf?"]',
    'a[href*="type=printable"]',
    // Publisher-specific
    'a.pdf-download',
    'a[data-article-pdf]',
    'a[title*="PDF" i]',
    'a[aria-label*="PDF" i]',
    'button[data-action="pdf-download"]',
    '.article-tools a[href*="pdf"]',
    // Elsevier / ScienceDirect
    'a.download-link[href*="pdf"]',
    '#pdfLink',
    // Springer / Nature
    'a[data-track-action="download pdf"]',
    'a.c-pdf-download__link',
    // Wiley
    'a.epub-section__item[href*="pdf"]',
    // IEEE
    'a[href*="arnumber"][href*="pdf"]',
  ];

  for (const selector of pdfSelectors) {
    try {
      const link = await page.$(selector);
      if (!link) continue;

      const href = await link.getAttribute("href");
      if (!href) continue;

      // Set up download listener and click
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
        link.click().catch(() => null),
      ]);

      if (download) {
        const dir = artifactDir(doi, cacheDir);
        const savePath = join(dir, "fulltext.pdf");
        await download.saveAs(savePath);
        return { path: savePath };
      }

      // If no download event, the link might have navigated —
      // check if current page is now a PDF
      await page.waitForTimeout(2000);
      const url = page.url();
      if (url.endsWith(".pdf") || url.includes("/pdf/")) {
        // Navigate-to-PDF: capture the content via fetch
        const response = await page.goto(url, { timeout: 30000 });
        if (response) {
          const body = await response.body();
          if (body.slice(0, 5).toString() === "%PDF-") {
            const dir = artifactDir(doi, cacheDir);
            const savePath = join(dir, "fulltext.pdf");
            writeFileSync(savePath, body);
            return { path: savePath };
          }
        }
      }
    } catch {
      // Try next selector
    }
  }

  return null;
}

// ── HTML capture logic ────────────────────────────────────────────

async function captureHtmlFulltext(
  page: Page,
  cacheDir: string,
  doi: string | null,
): Promise<{ path: string } | null> {
  // Common article body selectors
  const articleSelectors = [
    "article.fulltext",
    ".article-body",
    ".article__body",
    "#article-body",
    ".fulltext-view",
    ".c-article-body",     // Springer / Nature
    ".hlFld-Fulltext",     // Wiley
    ".NLM_sec",            // Various JATS-based
    "#bodymatter",
    "main article",
    ".article-content",
    "#main-content article",
  ];

  for (const selector of articleSelectors) {
    try {
      const el = await page.$(selector);
      if (!el) continue;

      const html = await el.innerHTML();
      // Only accept if there's a meaningful amount of text
      const textLen = html.replace(/<[^>]+>/g, "").trim().length;
      if (textLen < 500) continue;

      const dir = artifactDir(doi, cacheDir);
      const savePath = join(dir, "fulltext.html");
      // Wrap in a minimal HTML document
      const fullHtml = `<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"><title>${await page.title()}</title></head>\n<body>\n${html}\n</body>\n</html>`;
      writeFileSync(savePath, fullHtml, "utf-8");
      return { path: savePath };
    } catch {
      // Try next selector
    }
  }

  return null;
}

// ── Browser lifecycle helpers ─────────────────────────────────────

async function ensureBrowser(stateDir: string): Promise<void> {
  if (browserInstance && browserInstance.isConnected()) return;

  browserInstance = await chromium.launch({
    headless: false,  // Must be visible for human interaction
  });

  const statePath = join(resolve(stateDir), STATE_FILE);
  if (existsSync(statePath)) {
    try {
      const stateJson = readFileSync(statePath, "utf-8");
      const state = JSON.parse(stateJson);
      browserContext = await browserInstance.newContext({ storageState: state });
    } catch {
      browserContext = await browserInstance.newContext();
    }
  } else {
    browserContext = await browserInstance.newContext();
  }
}

async function saveState(stateDir: string): Promise<void> {
  if (!browserContext) return;
  try {
    const statePath = join(resolve(stateDir), STATE_FILE);
    const state = await browserContext.storageState();
    writeFileSync(statePath, JSON.stringify(state), "utf-8");
  } catch {
    // Non-critical — state saving failed
  }
}

async function closeBrowser(stateDir: string): Promise<BrowserRetrievalResult> {
  try {
    if (browserContext) {
      await saveState(stateDir);
      await browserContext.close();
      browserContext = null;
    }
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
    }
    activePage = null;
    return {
      success: true,
      artifact_path: null,
      artifact_type: null,
      needs_human_interaction: false,
      human_message: "Browser closed and state saved.",
      state_saved: true,
      page_title: null,
      page_url: null,
      error: null,
    };
  } catch (e) {
    return {
      success: false,
      artifact_path: null,
      artifact_type: null,
      needs_human_interaction: false,
      human_message: null,
      state_saved: false,
      page_title: null,
      page_url: null,
      error: (e as Error).message,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function artifactDir(doi: string | null, cacheDir: string): string {
  const safeName = doi ? doi.replace(/[/\\:*?"<>|]/g, "_") : `browser_${Date.now()}`;
  const dir = resolve(cacheDir, safeName);
  mkdirSync(dir, { recursive: true });
  return dir;
}
