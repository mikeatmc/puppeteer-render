import puppeteer from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import puppeteerExtra from "puppeteer-extra";
import fs from "fs";
import path from "path";
import "dotenv/config";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

puppeteerExtra.use(StealthPlugin());

const cookiePath = path.join(__dirname, "cookies.json");

async function loginAndSaveCookies(page) {
  console.log("🔐 Logging into LinkedIn...");
  await page.goto("https://www.linkedin.com/login", { waitUntil: "networkidle2", timeout: 60000 });
  await page.type("#username", process.env.LINKEDIN_EMAIL, { delay: 50 });
  await page.type("#password", process.env.LINKEDIN_PASSWORD, { delay: 50 });
  await page.click('button[type="submit"]');

  try {
    await page.waitForFunction(() => window.location.pathname.startsWith("/feed"), { timeout: 60000 });
  } catch {
    await page.waitForSelector("#global-nav", { timeout: 15000 }).catch(() => {});
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  console.log("✅ Cookies saved successfully.");
  return cookies;
}

async function ensureLoggedIn(page, profileUrl) {
  let needLogin = false;

  if (!fs.existsSync(cookiePath)) {
    needLogin = true;
  } else {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
      if (!cookies.length) needLogin = true;
      else await page.setCookie(...cookies);
    } catch {
      needLogin = true;
    }
  }

  if (needLogin) await loginAndSaveCookies(page);

  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (page.url().includes("/login")) {
    const cookies = await loginAndSaveCookies(page);
    await page.setCookie(...cookies);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
}

export async function scrapeProfile(profileUrl) {
  if (!profileUrl) throw new Error("No profile URL provided");

  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process'
    ],
  });

  const page = await browser.newPage();
  await ensureLoggedIn(page, profileUrl);

  const fullName = await page.$eval("h1", el => el.innerText.trim()).catch(() => "");
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
        el => el.src
    );
  } catch {}

  let jobTitle = "", company = "";
  try {
    await page.waitForSelector("#experience", { timeout: 15000 });
    const result = await page.evaluate(() => {
      const anchor = document.querySelector("#experience");
      let node = anchor?.parentElement;
      let jobTitle = "", company = "";
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

  await browser.close();
  return { firstName, lastName, profilePhoto, jobTitle, company };
}
