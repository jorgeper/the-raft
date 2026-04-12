import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { createAuthRouter, getSession } from "./auth.js";

const ROOT = process.cwd();

interface AppMeta {
  slug: string;
  title: string;
  description?: string;
  public?: boolean;
}

interface AppEntry extends AppMeta {
  dir: string;
}

function loadApps(): AppEntry[] {
  const appsDir = path.join(ROOT, "apps");
  if (!fs.existsSync(appsDir)) return [];

  const entries: AppEntry[] = [];
  for (const dirent of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const metaPath = path.join(appsDir, dirent.name, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta: AppMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      entries.push({ ...meta, dir: dirent.name });
    } catch (e) {
      console.warn(`Skipping ${dirent.name}: failed to parse meta.json`, e);
    }
  }
  return entries;
}

const apps = loadApps();
const publicSlugs = new Set(apps.filter((a) => a.public).map((a) => a.slug));

const sessionSecret = process.env.SESSION_SECRET || "change-me-in-production";
const app = express();

app.set("trust proxy", true);
app.use(cookieParser(sessionSecret));

// ── Auth routes (unauthenticated) ──────────────────────────────────
app.use(createAuthRouter());
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── Auth middleware (everything below requires auth) ───────────────
app.use((req, res, next) => {
  const slug = req.path.split("/")[1];
  if (publicSlugs.has(slug)) return next();

  const session = getSession(req);
  if (!session) {
    res.cookie("returnTo", req.originalUrl, {
      signed: true,
      httpOnly: true,
      maxAge: 5 * 60 * 1000,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    return res.redirect("/login");
  }
  next();
});

// ── API ────────────────────────────────────────────────────────────
app.get("/api/apps", (_req, res) => {
  res.json(apps.map(({ dir: _dir, ...meta }) => meta));
});

// ── Sub-apps (static files at /<slug>/) ────────────────────────────
for (const entry of apps) {
  const appDir = path.join(ROOT, "apps", entry.dir);
  app.use(`/${entry.slug}`, express.static(appDir));
  // SPA fallback: if no static file matched, serve index.html
  app.get(`/${entry.slug}/*`, (_req, res, next) => {
    const indexPath = path.join(appDir, "index.html");
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    next();
  });
}

// ── Home page ──────────────────────────────────────────────────────
const homeDir = path.join(ROOT, "dist", "home");
app.use(express.static(homeDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(homeDir, "index.html"));
});

// ── Start ──────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "8002", 10);
app.listen(port, "0.0.0.0", () => {
  console.log(`Playground running on http://localhost:${port}`);
  console.log(
    `Loaded ${apps.length} app(s): ${apps.map((a) => a.slug).join(", ") || "(none)"}`
  );
});
