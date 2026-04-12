import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // also load .env as fallback
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

/** Resolve the directory to serve for a sub-app.
 *  If apps/<name>/dist/index.html exists, serve from dist/ (built React app).
 *  Otherwise serve apps/<name>/ directly (simple static app). */
function resolveAppDir(appDirName: string): string {
  const base = path.join(ROOT, "apps", appDirName);
  const dist = path.join(base, "dist");
  if (fs.existsSync(dist) && fs.existsSync(path.join(dist, "index.html"))) {
    return dist;
  }
  return base;
}

/** Find the API router module for a sub-app, if it exists.
 *  Checks for compiled .js (in api/dist/) first, then .ts (dev with tsx). */
function findApiRoutes(appDirName: string): string | null {
  const apiDir = path.join(ROOT, "apps", appDirName, "api");
  const compiledPath = path.join(apiDir, "dist", "routes.js");
  const sourcePath = path.join(apiDir, "routes.ts");
  if (fs.existsSync(compiledPath)) return compiledPath;
  if (fs.existsSync(sourcePath)) return sourcePath;
  return null;
}

const apps = loadApps();
const publicSlugs = new Set(apps.filter((a) => a.public).map((a) => a.slug));

const sessionSecret = process.env.SESSION_SECRET || "change-me-in-production";
const isProduction = process.env.NODE_ENV === "production";
const app = express();

app.set("trust proxy", true);
app.use(cookieParser(sessionSecret));
app.use(express.json());

// ── Auth routes (unauthenticated) ──────────────────────────────────
app.use(createAuthRouter());
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── Auth middleware (everything below requires auth) ───────────────
app.use((req, res, next) => {
  const parts = req.path.split("/").filter(Boolean);
  const slug = parts[0];

  // Public sub-apps
  if (publicSlugs.has(slug)) return next();

  // Public shared endpoints: /api/<app>/shared/* and /<slug>/shared/*
  if (slug === "api" && parts.length >= 3 && parts[2] === "shared") return next();
  if (parts.length >= 2 && parts[1] === "shared") return next();

  const session = getSession(req);
  if (!session) {
    // API calls get 401; pages get redirected to login
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    res.cookie("returnTo", req.originalUrl, {
      signed: true,
      httpOnly: true,
      maxAge: 5 * 60 * 1000,
      secure: isProduction,
      sameSite: "lax",
    });
    return res.redirect("/login");
  }
  next();
});

// ── API: app directory ─────────────────────────────────────────────
app.get("/api/apps", (_req, res) => {
  res.json(apps.map(({ dir: _dir, ...meta }) => meta));
});

// ── API: auto-discover sub-app routers ─────────────────────────────
for (const entry of apps) {
  const routesPath = findApiRoutes(entry.dir);
  if (routesPath) {
    const mod = await import(routesPath);
    const router = mod.createRouter({ getSession });
    app.use(`/api/${entry.slug}`, router);
    console.log(`  Mounted API for ${entry.slug}`);
  }
}

// ── Sub-apps (static files at /<slug>/) ────────────────────────────
for (const entry of apps) {
  const appDir = resolveAppDir(entry.dir);
  app.use(`/${entry.slug}`, express.static(appDir));
  // SPA fallback: serve index.html for unmatched routes
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
