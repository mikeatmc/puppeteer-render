import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cookiePath = path.join(__dirname, "cookies.json");

// 🧠 Add stealth plugin (avoid LinkedIn bot detection)
puppeteerExtra.use(StealthPlugin());

/** Safe navigation with retries */
async function safeGoto(page, url) {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🌐 Navigating to ${url} (Attempt ${attempt})...`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      return;
    } catch (err) {
      console.log(`⚠️ Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxAttempts) {
        console.log("⏳ Retrying in 5 seconds...");
        await new Promise(r => setTimeout(r, 5000));
        const pages = await page.browser().pages();
        if (pages.includes(page)) await page.close();
        page = await page.browser().newPage();
      } else {
        throw err;
      }
    }
  }
}

/** Login and save cookies */
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

/** Ensure logged in and navigate to profile */
async function ensureLoggedIn(page, profileUrl) {
  let needLogin = true;
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

  await safeGoto(page, profileUrl);
  const currentURL = page.url();
  const pageTitle = await page.title();
  if (
      currentURL.includes("/login") ||
      currentURL.includes("checkpoint") ||
      pageTitle.toLowerCase().includes("sign in") ||
      pageTitle.toLowerCase().includes("join linkedin")
  ) {
    console.log("⚠️ Cookies invalid, performing fresh login...");
    const cookies = await loginAndSaveCookies(page);
    await page.setCookie(...cookies);
    await safeGoto(page, profileUrl);
  }
}

/** Scroll to bottom to load lazy content */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

/** Main scraper */
export async function scrapeProfile(profileUrl) {
  const defaultResponse = {
    status: "error",
    data: {
      firstName: "",
      lastName: "",
      profilePhoto: "",
      jobTitle: "",
      company: "",
    },
  };

  if (!profileUrl) return defaultResponse;

  // ✅ PuppeteerExtra uses Puppeteer’s Chromium
  const browser = await puppeteerExtra.use(StealthPlugin()).launch({
    headless: true,
    executablePath: puppeteer.executablePath(), // Puppeteer's built-in Chromium
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-extensions",
      "--window-size=1920,1080"
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(180000);
    await page.setViewport({ width: 1366, height: 768 });

    await ensureLoggedIn(page, profileUrl);
    await autoScroll(page);
    await new Promise(r => setTimeout(r, 4000));

    // 🧠 Extract name
    const fullName = await page.evaluate(() => {
      const selectors = [
        "h1",
        ".pv-text-details__left-panel h1",
        '[data-view-name="identity-profile-name"] span[dir="auto"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText) return el.innerText.trim();
      }
      return "";
    });

    const [firstName, ...lastNameParts] = fullName.split(" ");
    const lastName = lastNameParts.join(" ");

    // 🧠 Extract profile photo
    const profilePhoto = await page.evaluate(() => {
      const img = document.querySelector(`
        img.pv-top-card-profile-picture__image--show,
        img.pv-top-card-profile-picture__image,
        img.profile-photo-edit__preview,
        .pv-top-card__photo img,
        img[alt*='profile picture'],
        .pv-top-card img
      `);
      return (
          img?.src ||
          img?.getAttribute("data-delayed-url") ||
          img?.getAttribute("data-src") ||
          ""
      );
    });

    // 🧠 Extract experience (Clean, Fast, Reliable)
    let jobTitle = "";
    let company = "";
    
    try {
      const exp = await page.evaluate(() => {
        try {
          // Find the EXPERIENCE section wrapper
          const expRoot = document.querySelector("#experience")?.parentElement;
          if (!expRoot) return { jobTitle: "", company: "" };
    
          // Pick the FIRST (latest) experience item
          const firstItem = expRoot.querySelector("[data-view-name='profile-component-entity']");
          if (!firstItem) return { jobTitle: "", company: "" };
    
          // Extract job title
          const job =
            firstItem.querySelector(".t-bold span[aria-hidden='true']")?.innerText?.trim() ||
            firstItem.querySelector(".t-bold")?.innerText?.trim() ||
            firstItem.querySelector("span[aria-hidden='true']")?.innerText?.trim() ||
            "";
    
          // Extract company name
          let comp =
            firstItem.querySelector(".t-14.t-normal span[aria-hidden='true']")?.innerText?.trim() ||
            firstItem.querySelector(".t-14.t-normal")?.innerText?.trim() ||
            "";
    
          // Remove "· Full-time", "· Internship", etc.
          if (comp.includes("·")) comp = comp.split("·")[0].trim();
    
          return { jobTitle: job, company: comp };
        } catch {
          return { jobTitle: "", company: "" };
        }
      });
    
      jobTitle = exp.jobTitle;
      company = exp.company;
    
      console.log(`✅ Experience: ${jobTitle} at ${company}`);
    } catch (err) {
      console.log("⚠️ Experience extraction failed:", err.message);
    
      // 🔁 Backup minimal selector
      const fallback = await page.evaluate(() => {
        const first = document.querySelector("[data-view-name='profile-component-entity']");
        if (!first) return { jobTitle: "", company: "" };
    
        const job =
          first.querySelector("span[aria-hidden='true']")?.innerText?.trim() || "";
    
        let comp =
          first.querySelector(".t-14.t-normal span[aria-hidden='true']")?.innerText?.trim() || "";
    
        if (comp.includes("·")) comp = comp.split("·")[0].trim();
    
        return { jobTitle: job, company: comp };
      });
    
      jobTitle = fallback.jobTitle;
      company = fallback.company;
    }


    return {
      status: "success",
      data: { firstName, lastName, profilePhoto, jobTitle, company },
    };
  } catch (err) {
    console.error("❌ Scrape failed:", err);
    return defaultResponse;
  } finally {
    await browser.close().catch(() => {});
  }
}
