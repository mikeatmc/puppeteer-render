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
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(180000);
    await page.setViewport({ width: 1366, height: 768 });

    await ensureLoggedIn(page, profileUrl);
    await autoScroll(page);

    // Name
    const fullName = await page.$eval("h1", el => el.innerText.trim()).catch(() => "");
    const [firstName, ...lastNameParts] = fullName.split(" ");
    const lastName = lastNameParts.join(" ");

    // Profile photo
    const profilePhoto = await page.$eval(
      `img.pv-top-card-profile-picture__image--show,
       img.pv-top-card-profile-picture__image,
       img.profile-photo-edit__preview,
       .pv-top-card img,
       .pv-top-card__photo img`,
      el => el.src || el.getAttribute("data-delayed-url") || el.getAttribute("data-src")
    ).catch(() => "");

    // First experience (jobTitle + company)
    let jobTitle = "",
      company = "";
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
