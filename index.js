import express from "express";
import dotenv from "dotenv";
import { scrapeProfile } from "./scrapeLogic.js";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;

// Health check
app.get("/", (req, res) => {
  res.send("✅ Puppeteer LinkedIn Scraper API is running!");
});

// GET /scrape?url=<linkedin-profile>
app.get("/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Please provide ?url=<linkedin-profile>" });

  try {
    const data = await scrapeProfile(url);
    res.json(data);
  } catch (err) {
    console.error("Scrape error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Optional: POST /scrape with JSON body
app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Please provide { url: <linkedin-profile> }" });

  try {
    const data = await scrapeProfile(url);
    res.json(data);
  } catch (err) {
    console.error("Scrape error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
