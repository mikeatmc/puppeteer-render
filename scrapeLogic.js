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

// 🔐 Login to LinkedIn
async function loginLinkedIn(page) {
  console.log("🔐 Logging into LinkedIn...");
  await page.goto("https://www.linkedin.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  await page.waitForSelector("#username", { timeout: 30000 });
  await page.type("#username", process.env.LINKEDIN_EMAIL, { delay: 40 });
  await page.type("#password", process.env.LINKEDIN_PASSWORD, { delay: 40 });
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 120000 }),
  ]);

  const cookies = await page.cookies();
  try {
    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
    console.log("✅ New cookies saved successfully.");
  } catch (e) {
    console.warn("⚠️ Could not save cookies to disk:", e.message);
  }
  return cookies;
}

// 🍪 Load cookies if available
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

// 🚀 Retry wrapper for launching Chromium
async function launchBrowserWithRetry(tries = 3) {
  const isProd = process.env.NODE_ENV === "production";
  const executablePath = isProd
    ? (await chromium.executablePath()) ||
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      "/usr/bin/chromium"
    : undefined;

  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      console.log(`🧩 Launch attempt ${attempt}...`);
      const browser = await puppeteerExtra.launch({
        executablePath,
        headless: true,
        ignoreHTTPSErrors: true,
        args: isProd
          ? [
              ...chromium.args,
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--single-process",
              "--disable-dev-shm-usage",
              "--no-zygote",
            ]
          : [],
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

// 🌐 Main scrape function
export async function scrapeProfile(profileUrl) {
  if (!profileUrl || typeof profileUrl !== "string") {
    throw new Error("profileUrl must be a valid URL string");
  }

  console.log("🚀 Launching Chromium...");
  const browser = await launchBrowserWithRetry();

  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(120000);
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36"
  );

  let cookiesUsed = await useCookies(page);
  if (!cookiesUsed) {
    if (!process.env.LINKEDIN_EMAIL || !process.env.LINKEDIN_PASSWORD) {
      await browser.close();
      throw new Error(
        "No cookies and missing LINKEDIN_EMAIL / LINKEDIN_PASSWORD environment variables"
      );
    }
    await loginLinkedIn(page);
  } else {
    console.log("✅ Using existing cookies.");
  }

  console.log("🌐 Opening LinkedIn profile:", profileUrl);
  await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 120000 });

  // 🧠 Detect redirect to login/join page
  const currentURL = page.url();
  if (currentURL.includes("/join") || currentURL.includes("/login")) {
    console.log("🔁 Detected LinkedIn login redirect — reauthenticating...");
    await loginLinkedIn(page);
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 120000 });
  }

  // Wait for main content
  await page.waitForSelector("h1", { timeout: 60000 }).catch(async () => {
    console.log("⚠️ Name not found, trying reload...");
    await page.reload({ waitUntil: "networkidle2" });
  });

  // Extract data
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

  // Check if it's still showing "Join LinkedIn" (means login failed)
  if (data.name.toLowerCase().includes("join linkedin")) {
    console.log("⚠️ Detected Join LinkedIn page — refreshing session...");
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
