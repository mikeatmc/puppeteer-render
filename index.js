import express from "express";
import dotenv from "dotenv";
import { scrapeProfile } from "./scrapeLogic.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
  res.send("✅ Puppeteer LinkedIn scraper running!");
});

app.get("/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("❌ Please provide ?url=<linkedin-profile>");

  try {
    const data = await scrapeProfile(url);
    res.json(data);
  } catch (err) {
    console.error("Scrape error:", err);
    res.status(500).send(`❌ Scrape failed: ${err.message}`);
  }
});

// ✅ Only log locally (not on Render)
app.listen(PORT, () => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`🚀 Server running locally at http://localhost:${PORT}`);
  } else {
    console.log("🚀 Server running on Render!");
  }
});
