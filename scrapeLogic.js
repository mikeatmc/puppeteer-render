import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

puppeteerExtra.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cookiePath = path.join(__dirname, "cookies.json");

/* ============================================================
   🔐 LOGIN HANDLER
============================================================ */
async function loginLinkedIn(page) {
  console.log("🔐 Logging into LinkedIn...");

  await page.goto("https://www.linkedin.com/login", {
    waitUntil: "networkidle2",
    timeout: 120000,
  });

  await page.waitForSelector("#username", { timeout: 30000 });
  await page.type("#username", process.env.LINKEDIN_EMAIL, { delay: 60 });
  await page.type("#password", process.env.LINKEDIN_PASSWORD, { delay: 60 });

  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 120000 }),
  ]);

  const currentUrl = page.url();
  if (currentUrl.includes("/feed")) console.log("✅ Logged in successfully!");
  else if (currentUrl.includes("/checkpoint")) {
    console.warn("⚠️ LinkedIn checkpoint/captcha detected — may need manual action.");
  } else {
    console.warn("⚠️ Login redirect did not reach /feed — LinkedIn may have blocked login.");
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  console.log("✅ New cookies saved successfully.");
  return cookies;
}

/* ============================================================
   🍪 COOKIE MANAGEMENT
============================================================ */
async function useCookies(page) {
  if (!fs.existsSync(cookiePath)) {
    console.log("⚠️ No cookie file found.");
    return false;
  }
  try {
    const cookies = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
    if (!Array.isArray(cookies) || cookies.length === 0) return false;
    await page.setCookie(...cookies);
    console.log(`🍪 Loaded ${cookies.length} cookies from file.`);
    return true;
  } catch (e) {
    console.log("❌ Failed to load cookies:", e.message);
    return false;
  }
}

/* ============================================================
   🧩 LAUNCH CHROMIUM WITH RETRY
============================================================ */
async function launchBrowserWithRetry(tries = 3) {
  const isProd = process.env.NODE_ENV === "production";
  const executablePath =
    (await chromium.executablePath()) ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    "/usr/bin/chromium";

  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      console.log(`🧩 Launch attempt ${attempt}...`);
      const browser = await puppeteerExtra.launch({
        executablePath: isProd ? executablePath : undefined,
        headless: true,
        ignoreHTTPSErrors: true,
        args: [
          ...chromium.args,
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--single-process",
          "--disable-dev-shm-usage",
          "--no-zygote",
        ],
      });
      console.log("✅ Chromium launched successfully!");
      return browser;
    } catch (err) {
      console.error(`❌ Launch failed (attempt ${attempt}):`, err.message);
      if (attempt === tries) throw err;
      console.log("⏳ Retrying in 2 seconds...");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/* ============================================================
   🌐 MAIN SCRAPER
============================================================ */
export async function scrapeProfile(profileUrl) {
  if (!profileUrl || typeof profileUrl !== "string") {
    throw new Error("profileUrl must be a valid URL string");
  }

  console.log("🚀 Launching Chromium...");
  const browser = await launchBrowserWithRetry();
  const page = await browser.newPage();

  // 💡 Set stealth headers and fingerprint overrides
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  await page.setDefaultNavigationTimeout(120000);
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36"
  );

  // Load or login
  let cookiesUsed = await useCookies(page);
  if (!cookiesUsed) {
    if (!process.env.LINKEDIN_EMAIL || !process.env.LINKEDIN_PASSWORD) {
      await browser.close();
      throw new Error("Missing LINKEDIN_EMAIL / LINKEDIN_PASSWORD in env");
    }
    await loginLinkedIn(page);
  } else {
    console.log("✅ Using existing cookies.");
  }

  // Go to profile
  console.log("🌐 Opening LinkedIn profile:", profileUrl);
  await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 120000 });

  // 🔁 Detect redirects or "Join LinkedIn"
  let currentURL = page.url();
  if (currentURL.includes("/join") || currentURL.includes("/login")) {
    console.log("🔁 Redirected to login/join — logging in again...");
    await loginLinkedIn(page);
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 120000 });
  }

  // Wait for the profile name or reload if needed
  await page.waitForSelector("h1", { timeout: 60000 }).catch(async () => {
    console.log("⚠️ Name not found, retrying page reload...");
    await page.reload({ waitUntil: "networkidle2" });
  });

  // Extract profile data
  const data = await page.evaluate(() => {
    const name = document.querySelector("h1")?.innerText?.trim() || "";
    const headline =
      document.querySelector(".text-body-medium.break-words")?.innerText?.trim() || "";
    const location =
      document.querySelector(".pv-text-details__left-panel div.text-body-small")?.innerText?.trim() || "";
    const photo =
      document.querySelector(".pv-top-card-profile-picture__image")?.src ||
      document.querySelector(".profile-photo-edit__preview")?.src ||
      "";
    return { name, headline, location, photo, scrapedAt: new Date().toISOString() };
  });

  console.log("📦 Data extracted:", data);

  // 🧠 If still "Join LinkedIn", refresh cookies & retry
  if (data.name.toLowerCase().includes("join linkedin")) {
    console.log("⚠️ Detected Join LinkedIn page — refreshing cookies & retry...");
    await loginLinkedIn(page);
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 120000 });

    const refreshedData = await page.evaluate(() => {
      const name = document.querySelector("h1")?.innerText?.trim() || "";
      const headline =
        document.querySelector(".text-body-medium.break-words")?.innerText?.trim() || "";
      const location =
        document.querySelector(".pv-text-details__left-panel div.text-body-small")?.innerText?.trim() || "";
      const photo =
        document.querySelector(".pv-top-card-profile-picture__image")?.src ||
        document.querySelector(".profile-photo-edit__preview")?.src ||
        "";
      return { name, headline, location, photo, scrapedAt: new Date().toISOString() };
    });

    console.log("📦 Data re-extracted after login:", refreshedData);
    await browser.close();
    return refreshedData;
  }

  await browser.close();
  return data;
}
