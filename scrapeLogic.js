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

async function safeGoto(page, url) {
  console.log(`🌐 Navigating to ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
}

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

  const pageTitle = await page.title();
  if (
    page.url().includes("/login") ||
    page.url().includes("checkpoint") ||
    pageTitle.toLowerCase().includes("sign in") ||
    pageTitle.toLowerCase().includes("join linkedin")
  ) {
    console.log("⚠️ Cookies invalid, performing fresh login...");
    const cookies = await loginAndSaveCookies(page);
    await page.setCookie(...cookies);
    await safeGoto(page, profileUrl);
  }
}

async function autoScroll(page) {
  console.log("🖱️ Scrolling page to load lazy content...");
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

export async function scrapeProfile(profileUrl) {
  const resultData = { firstName: "", lastName: "", profilePhoto: "", jobTitle: "", company: "" };
  const returnObj = { status: "error", data: resultData };

  if (!profileUrl) return returnObj;

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
    await new Promise(r => setTimeout(r, 4000)); // wait for lazy content

    // --- Name ---
    const fullName = await page.$eval("h1", el => el.innerText.trim()).catch(() => "");
    if (fullName) {
      const [first, ...lastParts] = fullName.split(" ");
      resultData.firstName = first;
      resultData.lastName = lastParts.join(" ");
    }

    // --- Profile photo ---
    const profilePhoto = await page.$eval(
      `img.pv-top-card-profile-picture__image--show,
       img.pv-top-card-profile-picture__image,
       img.profile-photo-edit__preview,
       .pv-top-card img,
       .pv-top-card__photo img`,
      el => el.src || el.getAttribute("data-delayed-url") || el.getAttribute("data-src")
    ).catch(() => "");
    resultData.profilePhoto = profilePhoto;

    // --- Experience section (new + old layout support) ---
    console.log("🧭 Searching for experience section...");
    let jobTitle = "", company = "";
    try {
      await page.waitForSelector('section[data-section="experience"], #experience', { timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000)); // give DOM time to render

      const expResult = await page.evaluate(() => {
        const section =
          document.querySelector('section[data-section="experience"]') ||
          document.querySelector("#experience");
        if (!section) return { jobTitle: "", company: "" };

        const firstItem = section.querySelector("li, div.pvs-entity");
        if (!firstItem) return { jobTitle: "", company: "" };

        const titleEl = firstItem.querySelector(".t-bold span[aria-hidden]");
        const companyEl = firstItem.querySelector(".t-normal span[aria-hidden]");
        const jobTitle = titleEl?.innerText?.trim() || "";
        let company = companyEl?.innerText?.trim() || "";
        if (company.includes("·")) company = company.split("·")[0].trim();
        return { jobTitle, company };
      });

      jobTitle = expResult.jobTitle;
      company = expResult.company;

      console.log(`💼 Experience found: ${jobTitle} at ${company}`);
    } catch (err) {
      console.log("⚠️ Experience not found:", err.message);
    }

    resultData.jobTitle = jobTitle;
    resultData.company = company;

    returnObj.status = "success";
    returnObj.data = resultData;
    return returnObj;
  } catch (err) {
    console.error("❌ Scrape failed:", err);
    return returnObj;
  } finally {
    await browser.close().catch(() => {});
  }
}
