import express from "express";
import dotenv from "dotenv";
import { scrapeProfile } from "./scrapeLogic.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
  res.send("✅ LinkedIn Puppeteer scraper is running!");
});

/**
 * Example:
 *   GET /scrape?url=https://www.linkedin.com/in/some-profile/
 */
app.get("/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing ?url parameter");
  try {
    const data = await scrapeProfile(url);
    res.json(data);
  } catch (e) {
    console.error("Scrape error:", e);
    res.status(500).send(`Error: ${e.message || e}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
