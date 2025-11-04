import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cookiePath = path.join(__dirname, "cookies.json");

puppeteerExtra.use(StealthPlugin());

/** ✅ Helper to detect available Chrome binary */
function getChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/local/bin/chromium",
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`🧭 Found Chromium binary: ${p}`);
      return p;
    }
  }

  console.warn("⚠️ No system Chromium found — Puppeteer will download one (slower start).");
  return undefined;
}

/** Safe navigation with retries */
async function safeGoto(page, url, options = {}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🌐 Navigating to ${url} (Attempt ${attempt})...`);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
        ...options,
      });
      return;
    } catch (err) {
      console.log(`⚠️ Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        console.log("⏳ Retrying in 5 seconds...");
        await new Promise((r) => setTimeout(r, 5000));
      } else {
        throw err;
      }
    }
  }
}

/** Logs into LinkedIn and saves cookies */
async function loginAndSaveCookies(page) {
  console.log("🔐 Logging into LinkedIn...");
  await safeGoto(page, "https://www.linkedin.com/login");

  await page.type("#username", process.env.LINKEDIN_EMAIL, { delay: 50 });
  await page.type("#password", process.env.LINKEDIN_PASSWORD, { delay: 50 });
  await page.click('button[type="submit"]');

  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  const cookies = await page.cookies();
  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  console.log("✅ Cookies saved successfully.");
  return cookies;
}

/** Ensures user is logged in */
async function ensureLoggedIn(page, profileUrl) {
  let needLogin = false;

  if (fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath));
      if (cookies.length) {
        await page.setCookie(...cookies);
        console.log("🍪 Loaded saved cookies.");
      } else needLogin = true;
    } catch {
      needLogin = true;
    }
  } else needLogin = true;

  if (needLogin) await loginAndSaveCookies(page);

  await safeGoto(page, profileUrl);
  if (page.url().includes("/login")) {
    console.log("⚠️ Cookies expired, re-logging...");
    const cookies = await loginAndSaveCookies(page);
    await page.setCookie(...cookies);
    await safeGoto(page, profileUrl);
  }
}

/** Main scraper */
export async function scrapeProfile(profileUrl) {
  if (!profileUrl) throw new Error("No profile URL provided");

  console.log("🚀 Launching Chromium...");
  const executablePath = getChromePath();

  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-extensions",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(180000);
    await page.setViewport({ width: 1366, height: 768 });

    await ensureLoggedIn(page, profileUrl);

    const fullName = await page.$eval("h1", (el) => el.innerText.trim()).catch(() => "");
    const [firstName, ...lastNameParts] = fullName.split(" ");
    const lastName = lastNameParts.join(" ");

    let profilePhoto = "";
    try {
      profilePhoto = await page.$eval(
        `
        img.pv-top-card-profile-picture__image--show,
        img.pv-top-card-profile-picture__image,
        img.profile-photo-edit__preview,
        .pv-top-card img,
        .pv-top-card__photo img
      `,
        (el) => el.src
      );
    } catch {}

    let jobTitle = "",
      company = "";
    try {
      await page.waitForSelector("#experience", { timeout: 15000 });
      const result = await page.evaluate(() => {
        const anchor = document.querySelector("#experience");
        let node = anchor?.parentElement;
        let jobTitle = "",
          company = "";
        while (node && !jobTitle && !company) {
          const entity = node.querySelector('[data-view-name="profile-component-entity"]');
          if (entity) {
            const titleEl = entity.querySelector(".t-bold span[aria-hidden]");
            const companyEl = entity.querySelector(".t-normal span[aria-hidden]");
            jobTitle = titleEl?.innerText?.trim() || "";
            company = companyEl?.innerText?.trim() || "";
            if (company.includes("·")) company = company.split("·")[0].trim();
            break;
          }
          node = node.nextElementSibling;
        }
        return { jobTitle, company };
      });
      jobTitle = result.jobTitle || "";
      company = result.company || "";
    } catch {}

    console.log("✅ Scrape completed successfully.");
    return { firstName, lastName, profilePhoto, jobTitle, company };
  } catch (err) {
    console.error("❌ Scrape failed:", err);
    return { error: err.message };
  } finally {
    await browser.close().catch(() => {});
  }
}
