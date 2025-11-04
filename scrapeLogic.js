import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

puppeteerExtra.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cookiePath = path.join(__dirname, "cookies.json");

async function loginAndSaveCookies(page) {
  console.log("🔐 Logging into LinkedIn...");
  await page.goto("https://www.linkedin.com/login", {
    waitUntil: "networkidle2",
    timeout: 90000,
  });
  await page.type("#username", process.env.LINKEDIN_EMAIL, { delay: 50 });
  await page.type("#password", process.env.LINKEDIN_PASSWORD, { delay: 50 });
  await page.click('button[type="submit"]');

  await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 }).catch(() => {});
  const cookies = await page.cookies();
  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
  console.log("✅ Cookies saved successfully.");
  return cookies;
}

async function ensureLoggedIn(page, profileUrl) {
  if (fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
      if (cookies.length) await page.setCookie(...cookies);
    } catch {}
  } else {
    await loginAndSaveCookies(page);
  }

  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  if (page.url().includes("/login")) {
    await loginAndSaveCookies(page);
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  }
}

export async function scrapeProfile(profileUrl) {
  if (!profileUrl) throw new Error("No profile URL provided");

  console.log("🚀 Launching Chromium...");
  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/chromium-browser",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-software-rasterizer",
      "--no-zygote",
      "--single-process",
      "--ignore-certificate-errors",
      "--window-size=1920,1080",
    ],
    timeout: 0,
    env: { TMPDIR: process.env.TMPDIR || "/usr/src/app/tmp" },
  });

  const page = await browser.newPage();
  await ensureLoggedIn(page, profileUrl);

  const name = await page.$eval("h1", (el) => el.innerText.trim()).catch(() => "");
  const headline = await page.$eval(".text-body-medium.break-words", (el) => el.innerText.trim()).catch(() => "");
  const location = await page.$eval(".pv-text-details__left-panel div.text-body-small", (el) => el.innerText.trim()).catch(() => "");
  const photo = await page.$eval("img.pv-top-card-profile-picture__image, .profile-photo-edit__preview", (el) => el.src).catch(() => "");

  await browser.close();
  return { name, headline, location, photo, scrapedAt: new Date().toISOString() };
}
