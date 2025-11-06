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

/** Navigate safely to a URL */
async function safeGoto(page, url) {
  try {
    console.log(`🌐 Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  } catch (err) {
    console.log(`⚠️ Navigation failed: ${err.message}`);
    throw err;
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
  if (fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath));
      if (cookies.length) await page.setCookie(...cookies);
      console.log("🍪 Loaded saved cookies");
    } catch {
      await loginAndSaveCookies(page);
    }
  } else {
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
  if (!profileUrl) throw new Error("No profile URL provided");

  const browser = await puppeteerExtra.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setDefaultNavigationTimeout(180000);

    await ensureLoggedIn(page, profileUrl);
    await autoScroll(page);

    // --- Name ---
    const nameSelectors = ["h1.text-heading-xlarge", "h1", ".pv-top-card--list li.inline.t-24.t-black.t-normal.break-words"];
    let firstName = "", lastName = "";
    for (const sel of nameSelectors) {
      const fullName = await page.$eval(sel, el => el.innerText.trim()).catch(() => "");
      if (fullName) {
        [firstName, ...lastName] = fullName.split(" ");
        lastName = lastName.join(" ");
        break;
      }
    }

    // --- Profile photo ---
    const photoSelectors = [
      "img.pv-top-card-profile-picture__image--show",
      "img.pv-top-card-profile-picture__image",
      "img.profile-photo-edit__preview",
      ".pv-top-card img",
      ".pv-top-card__photo img",
    ];
    let profilePhoto = "";
    for (const sel of photoSelectors) {
      const imgHandle = await page.$(sel);
      if (imgHandle) {
        profilePhoto = await page.evaluate(el => el.src || el.getAttribute("data-delayed-url") || el.getAttribute("data-src"), imgHandle).catch(() => "");
        if (profilePhoto) break;
      }
    }

    // --- First experience ---
    let jobTitle = "", company = "";
    try {
      const result = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll("#experience li"));
        for (const exp of items) {
          const titleEl = exp.querySelector(".t-bold span[aria-hidden]");
          const companyEl = exp.querySelector(".t-normal span[aria-hidden]");
          const jobTitle = titleEl?.innerText?.trim() || "";
          let company = companyEl?.innerText?.trim() || "";
          if (company.includes("·")) company = company.split("·")[0].trim();
          if (jobTitle && company) return { jobTitle, company };
        }
        return { jobTitle: "", company: "" };
      });
      jobTitle = result.jobTitle || "";
      company = result.company || "";
    } catch {}

    return { firstName, lastName, profilePhoto, jobTitle, company };
  } catch (err) {
    console.error("❌ Scrape failed:", err);
    return { error: err.message };
  } finally {
    await browser.close().catch(() => {});
  }
}
