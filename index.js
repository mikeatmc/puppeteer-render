import express from "express";
import { scrapeProfile } from "./scrapeLogic.js";

const app = express();

app.get("/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing ?url= parameter");

  try {
    const data = await scrapeProfile(url);
    res.json(data);
  } catch (e) {
    console.error("Scrape error:", e);
    res.status(500).send(`Error: ${e.message}`);
  }
});

app.get("/", (req, res) => {
  res.send("✅ LinkedIn Puppeteer service is running!");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
