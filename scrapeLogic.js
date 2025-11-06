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

/** Safe navigation for LinkedIn with retries */
async function safeGoto(page, url) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🌐 Navigating to ${url} (Attempt ${attempt})...`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      return;
    } catch (err) {
      console.log(`⚠️ Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        console.log("⏳ Retrying with fresh page in 5 seconds...");
        await new Promise(r => setTimeout(r, 5000));
        try {
          // Close old page to avoid detached frame
          const pages = await page.browser().pages();
          if (pages.includes(page)) await page.close();
          page = await page.browser().newPage();
        } catch {}
      } else {
        throw err;
      }
    }
  }
}

/** Login to LinkedIn and save cookies */
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

/** Ensure logged in and profile accessible */
async function ensureLoggedIn(page, profileUrl) {
  let needLogin = true;

  // Load cookies if available
  if (fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath));
      if (cookies.length) {
        await page.setCookie(...cookies);
        needLogin = false;
        console.log("🍪 Loaded saved cookies");
      }
    } catch {
      needLogin = true;
    }
  }

  if (needLogin) {
    await loginAndSaveCookies(page);
  }

  // Navigate to profile
  await safeGoto(page, profileUrl);

  const currentURL = page.url();
  const pageTitle = await page.title();
  console.log("📌 Current page URL:", currentURL);
  console.log("📌 Page title:", pageTitle);
  
  if (
    currentURL.includes("/login") ||
    currentURL.includes("checkpoint") ||
    pageTitle.toLowerCase().includes("sign in") ||
    pageTitle.toLowerCase().includes("join linkedin")
  ) {
    console.log("⚠️ Not logged in or cookies invalid, performing fresh login...");
    const cookies = await loginAndSaveCookies(page);
    await page.setCookie(...cookies);
    await safeGoto(page, profileUrl);
  }
}

/** Main scraper */
export async function scrapeProfile(profileUrl) {
  if (!profileUrl) throw new Error("No profile URL provided");

  console.log(`🚀 Scraping LinkedIn profile: ${profileUrl}`);

  const browser = await puppeteerExtra.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-extensions",
      "--single-process",
      "--window-size=1920,1080",
    ],
  });

  try {
    let page = await browser.newPage();
    await page.setDefaultNavigationTimeout(180000);
    await page.setViewport({ width: 1366, height: 768 });

    await ensureLoggedIn(page, profileUrl);

    /** --- Scrape full name --- */
    let firstName = "", lastName = "", fullName = "";
    const nameSelectors = ["h1", ".text-heading-xlarge", ".profile-topcard__name"];
    for (const sel of nameSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        fullName = await page.$eval(sel, el => el.innerText.trim());
        [firstName, ...lastNameParts] = fullName.split(" ");
        lastName = lastNameParts.join(" ");
        console.log(`👤 Name found: ${fullName} (selector: ${sel})`);
        break;
      } catch {}
    }
    if (!fullName) console.log("⚠️ Name not found");

    /** --- Scrape profile photo --- */
    let profilePhoto = "";
    const photoSelectors = [
      "img.pv-top-card-profile-picture__image",
      ".pv-top-card img",
      ".profile-photo-edit__preview"
    ];
    for (const sel of photoSelectors) {
      try {
        profilePhoto = await page.$eval(sel, el => el.src);
        if (profilePhoto) {
          console.log(`🖼 Profile photo found (selector: ${sel}): ${profilePhoto}`);
          break;
        }
      } catch {}
    }
    if (!profilePhoto) console.log("⚠️ Profile photo not found");

    /** --- Scrape first experience --- */
    let jobTitle = "", company = "";
    try {
      await page.waitForSelector("#experience", { timeout: 15000 });
      const result = await page.evaluate(() => {
        const anchor = document.querySelector("#experience");
        if (!anchor) return { jobTitle: "", company: "" };
        let node = anchor.nextElementSibling;
        while (node) {
          const entity = node.querySelector('[data-view-name="profile-component-entity"]');
          if (entity) {
            const titleEl = entity.querySelector(".t-bold span[aria-hidden]");
            const companyEl = entity.querySelector(".t-normal span[aria-hidden]");
            let jobTitle = titleEl?.innerText?.trim() || "";
            let company = companyEl?.innerText?.trim() || "";
            if (company.includes("·")) company = company.split("·")[0].trim();
            return { jobTitle, company };
          }
          node = node.nextElementSibling;
        }
        return { jobTitle: "", company: "" };
      });
      jobTitle = result.jobTitle || "";
      company = result.company || "";
      console.log(`💼 Experience found: ${jobTitle} at ${company}`);
    } catch {
      console.log("⚠️ Experience not found");
    }

    console.log("✅ Scrape completed successfully.");
    return { firstName, lastName, fullName, profilePhoto, jobTitle, company };

  } catch (err) {
    console.error("❌ Scrape failed:", err);
    return { error: err.message };
  } finally {
    await browser.close().catch(() => {});
  }
}
