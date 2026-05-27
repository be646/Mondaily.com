import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const { supabaseConfig } = await import("./config/supabase.js");
const { default: authRoutes } = await import("./routes/auth.js");

const app = express();
const port = process.env.PORT || 4000;

app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:4173",
  credentials: true
}));
app.use(express.json());
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.json({
    name: "Mondaily API",
    status: "online",
    version: "0.1.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "mondaily-backend",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/db-test", async (req, res) => {
  try {
    const response = await fetch(`${supabaseConfig.url}/rest/v1/`, {
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_KEY}`
      }
    });

    const text = await response.text();
    res.status(response.ok ? 200 : 502).json({
      ok: response.ok,
      status: response.status,
      service: "supabase-postgres",
      projectUrl: supabaseConfig.url,
      message: response.ok ? "Supabase REST endpoint accepted the key." : "Supabase REST endpoint did not accept the request.",
      preview: text.slice(0, 240)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      service: "supabase-postgres",
      message: "Could not reach Supabase.",
      error: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Mondaily API listening on port ${port}`);
});
