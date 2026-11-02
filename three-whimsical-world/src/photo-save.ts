/**
 * Where photos go. The dev server writes them straight into a folder (`saveSettings.folder`, default ~/Downloads;
 * a photo session makes its own subfolder there); without it (a static build) they fall back to browser downloads,
 * with the session's name as a prefix instead of a folder.
 */

export const saveSettings = {
  folder: '~/Downloads',
};

/** Local date and time as 2026-11-01-1903 (for folder names) or 20261101-190312 (for file names). */
export function stamp(kind: 'folder' | 'file', d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return kind === 'folder' ? `${date}-${p(d.getHours())}${p(d.getMinutes())}` : `${date.replace(/-/g, '')}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * The canvas as a PNG. Call right after rendering, in the same frame: the drawing buffer is cleared once the frame
 * is shown, and `toBlob` takes its snapshot when called.
 */
export function grab(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Saves a PNG as `name` in the photo folder (in `sub` inside it, if given). Resolves to where it went. */
export async function savePng(png: Blob, name: string, sub = ''): Promise<string> {
  const q = new URLSearchParams({ dir: saveSettings.folder, sub, name });
  try {
    const res = await fetch(`/__photos/save?${q}`, { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' } });
    const body = await res.json();
    if (res.ok && body.path) return body.path as string;
    if (res.status !== 404) throw new Error(body.error ?? res.statusText);
  } catch (e) {
    // No dev server (a static build): download instead. Anything else is worth knowing about.
    if (!(e instanceof SyntaxError) && !(e instanceof TypeError)) console.warn('Photo not saved to folder:', e);
  }
  const a = document.createElement('a');
  a.download = sub ? `${sub}-${name}` : name;
  a.href = URL.createObjectURL(png);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return `Downloads/${a.download}`;
}

/** A native "choose folder" dialog (dev server on macOS); null if cancelled or unavailable. */
export async function pickFolder(): Promise<string | null> {
  try {
    const res = await fetch('/__photos/pick', { method: 'POST' });
    const body = await res.json();
    return body.dir ?? null;
  } catch {
    return null;
  }
}
