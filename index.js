import express from "express";
import { scrapeProfile } from "./scrapeLogic.js";
const app = express();

app.get("/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("❌ Please provide ?url=<linkedin-profile>");
  try {
    const data = await scrapeProfile(url);
    res.json(data);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(4000, () => console.log("Server on http://localhost:4000"));
