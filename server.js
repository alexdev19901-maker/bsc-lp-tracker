import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const DEBANK_BASE = "https://pro-openapi.debank.com/v1";

app.use(cors());
app.use(express.json());

// Store API key in memory (set via /api/set-key or .env)
let apiKey = process.env.DEBANK_API_KEY || "";

// Set API key at runtime from the UI
app.post("/api/set-key", (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "No key provided" });
  apiKey = key;
  res.json({ ok: true });
});

// Proxy: fetch all complex protocol positions for a wallet on BSC
app.get("/api/positions/:wallet", async (req, res) => {
  if (!apiKey) return res.status(401).json({ error: "API key not set. Enter your DeBank key in the UI or set DEBANK_API_KEY env var." });

  const wallet = req.params.wallet.toLowerCase();

  try {
    const resp = await fetch(
      `${DEBANK_BASE}/user/all_complex_protocol_list?id=${wallet}&chain_id=bsc`,
      {
        headers: {
          accept: "application/json",
          AccessKey: apiKey,
        },
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`DeBank API error ${resp.status}:`, errText);
      return res.status(resp.status).json({
        error: `DeBank API error: ${resp.status}`,
        detail: errText,
      });
    }

    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Proxy fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasKey: !!apiKey });
});

// Serve built frontend (after `npm run build`)
app.use(express.static(join(__dirname, "dist")));

// SPA fallback — any non-API route serves index.html
app.get("/{*splat}", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  BSC LP Tracker running on port ${PORT}\n`);
});
