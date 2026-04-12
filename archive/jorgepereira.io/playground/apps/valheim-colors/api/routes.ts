import { Router, type Request, type Response } from "express";
import {
  initStore,
  listSheets,
  getSheet,
  createSheet,
  updateSheet,
  deleteSheet,
  shareSheet,
  unshareSheet,
  getSharedSheet,
} from "./store.js";

interface Deps {
  getSession: (req: Request) => { id: string; email: string } | null;
}

export function createRouter({ getSession }: Deps): Router {
  initStore();

  const router = Router();

  // ── Authenticated endpoints ────────────────────────────────────

  router.get("/sheets", (req: Request, res: Response) => {
    const user = getSession(req)!;
    const rows = listSheets(user.id);
    res.json(
      rows.map((r) => ({
        id: r.id,
        data: JSON.parse(r.data),
        shareToken: r.share_token,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    );
  });

  router.get("/sheets/:id", (req: Request, res: Response) => {
    const user = getSession(req)!;
    const row = getSheet(user.id, req.params.id);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      id: row.id,
      data: JSON.parse(row.data),
      shareToken: row.share_token,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  router.post("/sheets", (req: Request, res: Response) => {
    const user = getSession(req)!;
    const { data } = req.body;
    if (!data) { res.status(400).json({ error: "Missing data" }); return; }
    const result = createSheet(user.id, JSON.stringify(data));
    res.status(201).json(result);
  });

  router.put("/sheets/:id", (req: Request, res: Response) => {
    const user = getSession(req)!;
    const { data } = req.body;
    if (!data) { res.status(400).json({ error: "Missing data" }); return; }
    const ok = updateSheet(user.id, req.params.id, JSON.stringify(data));
    if (!ok) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  });

  router.delete("/sheets/:id", (req: Request, res: Response) => {
    const user = getSession(req)!;
    const ok = deleteSheet(user.id, req.params.id);
    if (!ok) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  });

  router.post("/sheets/:id/share", (req: Request, res: Response) => {
    const user = getSession(req)!;
    const token = shareSheet(user.id, req.params.id);
    if (!token) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ token });
  });

  router.delete("/sheets/:id/share", (req: Request, res: Response) => {
    const user = getSession(req)!;
    const ok = unshareSheet(user.id, req.params.id);
    if (!ok) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  });

  // ── Public endpoint (no auth) ──────────────────────────────────

  router.get("/shared/:token", (req: Request, res: Response) => {
    const row = getSharedSheet(req.params.token);
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      data: JSON.parse(row.data),
      userId: row.user_id,
    });
  });

  return router;
}
