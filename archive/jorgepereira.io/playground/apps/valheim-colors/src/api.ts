import type { Sheet, SheetData, SharedSheet } from "./types";

const BASE = "/api/valheim-colors";

export async function listSheets(): Promise<Sheet[]> {
  const res = await fetch(`${BASE}/sheets`);
  if (!res.ok) throw new Error("Failed to list sheets");
  return res.json();
}

export async function getSheet(id: string): Promise<Sheet> {
  const res = await fetch(`${BASE}/sheets/${id}`);
  if (!res.ok) throw new Error("Failed to get sheet");
  return res.json();
}

export async function createSheet(data: SheetData): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/sheets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error("Failed to create sheet");
  return res.json();
}

export async function updateSheet(id: string, data: SheetData): Promise<void> {
  const res = await fetch(`${BASE}/sheets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error("Failed to update sheet");
}

export async function deleteSheet(id: string): Promise<void> {
  const res = await fetch(`${BASE}/sheets/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete sheet");
}

export async function shareSheet(id: string): Promise<{ token: string }> {
  const res = await fetch(`${BASE}/sheets/${id}/share`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to share sheet");
  return res.json();
}

export async function unshareSheet(id: string): Promise<void> {
  const res = await fetch(`${BASE}/sheets/${id}/share`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to unshare sheet");
}

export async function getSharedSheet(token: string): Promise<SharedSheet> {
  const res = await fetch(`${BASE}/shared/${token}`);
  if (!res.ok) throw new Error("Not found");
  return res.json();
}
