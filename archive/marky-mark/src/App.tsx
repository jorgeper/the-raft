import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getPlatform, type Platform } from './platform';
import { renderMarkdown } from './lib/markdown';
import { type Anchor, type CommentData, createAnchor, reanchor, type ReanchorMatch } from './lib/anchoring';
import { getDocText, highlightRange, rangeToOffsets, rectForOffsets } from './lib/domtext';
import { parseSidecar, serializeSidecar, sidecarPathFor } from './lib/sidecar';
import { attachEmbedded, mergeComments, splitEmbedded } from './lib/embedded';
import { DEFAULT_SETTINGS, MARGIN_WIDTHS, parseSettings, serializeSettings, type Settings } from './lib/settings';
import { eventMatches } from './lib/hotkeys';
import { VimNavResolver } from './lib/vimnav';
import type { Theme } from './lib/themes';
import { applyThemeCss, loadAllThemes } from './themeRuntime';
import { FIXTURES } from './bundled';
import { Toolbar } from './components/Toolbar';
import { CommentCard } from './components/CommentCard';
import { SettingsPanel } from './components/SettingsPanel';

const Editor = lazy(() => import('./components/Editor'));

const CARD_GAP = 8;

type Positions = Record<string, ReanchorMatch | null>;
type Mode = 'preview' | 'edit';

function anchorsEqual(a: Anchor, b: Anchor): boolean {
  return a.exact === b.exact && a.prefix === b.prefix && a.suffix === b.suffix && a.start === b.start && a.end === b.end;
}

export default function App() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [docPath, setDocPath] = useState<string | null>(null);
  const [buffer, setBuffer] = useState('');
  const [savedText, setSavedText] = useState('');
  const [mode, setMode] = useState<Mode>('preview');
  const [html, setHtml] = useState('');
  const [comments, setComments] = useState<CommentData[]>([]);
  const [positions, setPositions] = useState<Positions>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(true);
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [selInfo, setSelInfo] = useState<{ start: number; end: number; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closePrompt, setClosePrompt] = useState(false);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  const docRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const vimRef = useRef(new VimNavResolver());
  const docTextRef = useRef('');
  const skipSaveRef = useRef(true);
  const unwatchRef = useRef<(() => void) | null>(null);
  const scrollRatioRef = useRef(0);

  const dirty = buffer !== savedText;

  // Refs mirroring state, for stable event handlers.
  const stateRef = useRef({ settings, mode, dirty, docPath, buffer, savedText, comments, platform });
  stateRef.current = { settings, mode, dirty, docPath, buffer, savedText, comments, platform };

  /** Read a doc file and its comments from both stores (trailer wins by id). */
  const loadDocParts = useCallback(async (p: Platform, path: string) => {
    const raw = await p.readTextFile(path);
    const split = splitEmbedded(raw);
    let sidecarComments: CommentData[] = [];
    try {
      const sidecar = sidecarPathFor(path);
      if (await p.exists(sidecar)) sidecarComments = parseSidecar(await p.readTextFile(sidecar));
    } catch {
      sidecarComments = []; // corrupt sidecar: ignore rather than crash
    }
    return { content: split.content, comments: mergeComments(split.comments, sidecarComments) };
  }, []);

  // --- document loading ------------------------------------------------------
  const openDoc = useCallback(async (p: Platform, path: string) => {
    let content: string;
    let stored: CommentData[];
    try {
      ({ content, comments: stored } = await loadDocParts(p, path));
    } catch {
      return; // unreadable path (e.g. deleted file in a stale open event)
    }
    skipSaveRef.current = true;
    setDocPath(path);
    setBuffer(content);
    setSavedText(content);
    setComments(stored);
    setPositions({});
    setActiveId(null);
    setPending(null);
    setMode('preview');

    unwatchRef.current?.();
    unwatchRef.current = null;
    try {
      unwatchRef.current = await p.watchFile(path, async () => {
        const s = stateRef.current;
        if (s.dirty || s.mode === 'edit') return; // never clobber local edits
        try {
          const fresh = await loadDocParts(p, path);
          skipSaveRef.current = true;
          setBuffer(fresh.content);
          setSavedText(fresh.content);
          setComments(fresh.comments);
        } catch {
          /* file briefly unavailable mid-write; next event will catch up */
        }
      });
    } catch {
      /* watching is best-effort */
    }
  }, [loadDocParts]);

  /**
   * Persist comments per the active storage mode (SPEC2 FR-C.5). Embedded
   * writes rewrite the file as LAST-SAVED text + trailer — never flushing
   * unsaved text edits — and clean up a stale sidecar (migration). Sidecar
   * mode behaves exactly like v1.
   */
  const persistComments = useCallback(async (current: CommentData[]) => {
    const s = stateRef.current;
    if (!s.platform || !s.docPath) return;
    const p = s.platform;
    const sidecar = sidecarPathFor(s.docPath);
    try {
      if (s.settings.commentStorage === 'embedded') {
        await p.writeTextFile(s.docPath, attachEmbedded(s.savedText, current));
        if (await p.exists(sidecar)) await p.remove(sidecar);
      } else if (current.length > 0) {
        await p.writeTextFile(sidecar, serializeSidecar(current));
      } else if (await p.exists(sidecar)) {
        await p.remove(sidecar); // no comments → no sidecar litter
      }
    } catch {
      /* disk hiccup; the next change retries */
    }
  }, []);

  // --- bootstrap ---------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    (async () => {
      const p = await getPlatform();
      if (disposed) return;

      const cfg = await p.configDir();
      const settingsPath = p.join(cfg, 'settings.json');
      let loaded = DEFAULT_SETTINGS;
      try {
        if (await p.exists(settingsPath)) loaded = parseSettings(await p.readTextFile(settingsPath));
      } catch {
        /* fall back to defaults */
      }
      if (p.kind === 'web') loaded = { ...loaded, commentStorage: 'embedded' }; // no sidecars on web
      const themeList = await loadAllThemes(p);

      setPlatform(p);
      setSettings(loaded);
      setThemes(themeList);

      let openedViaEvent = false;
      await p.onOpenFile((path) => {
        openedViaEvent = true;
        void openDoc(p, path);
      });

      await p.onFileDrop((path) => void openDoc(p, path));

      if (!openedViaEvent) {
        const welcome = await p.welcomeDocPath();
        if (!(await p.exists(welcome)) && FIXTURES['welcome.md']) {
          await p.writeTextFile(welcome, FIXTURES['welcome.md']);
        }
        if (await p.exists(welcome)) void openDoc(p, welcome);
      }

      await p.registerCloseGuard(
        () => stateRef.current.dirty,
        () => setClosePrompt(true)
      );
    })();
    return () => {
      disposed = true;
    };
  }, [openDoc]);

  // --- OS light/dark tracking (live, SPEC3 §2) -----------------------------------
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // --- theme application: light/dark pair ------------------------------------------
  useEffect(() => {
    if (themes.length === 0) return;
    const wanted = prefersDark && settings.useDarkTheme ? settings.themeDark : settings.themeLight;
    const theme = themes.find((t) => t.id === wanted) ?? themes.find((t) => t.id === 'crisp') ?? themes[0];
    applyThemeCss(theme.css);
  }, [themes, settings.themeLight, settings.themeDark, settings.useDarkTheme, prefersDark]);

  // --- appearance overrides: font size, margins, zoom (SPEC3 §2) ---------------------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (settings.fontSize === 'auto') el.style.removeProperty('--mm-font-size');
    else el.style.setProperty('--mm-font-size', `${settings.fontSize}px`);
    if (settings.margins === 'default') el.style.removeProperty('--mm-content-width');
    else el.style.setProperty('--mm-content-width', MARGIN_WIDTHS[settings.margins]);
    (el.style as CSSStyleDeclaration & { zoom: string }).zoom =
      settings.zoom === 100 ? '' : String(settings.zoom / 100);
  }, [settings.fontSize, settings.margins, settings.zoom]);

  // --- settings persistence ---------------------------------------------------
  const updateSettings = useCallback(
    (next: Settings) => {
      setSettings(next);
      const p = stateRef.current.platform;
      if (!p) return;
      void (async () => {
        const path = p.join(await p.configDir(), 'settings.json');
        await p.writeTextFile(path, serializeSettings(next));
      })();
    },
    []
  );

  // --- actions -----------------------------------------------------------------
  const saveDoc = useCallback(async () => {
    const s = stateRef.current;
    if (!s.platform || !s.docPath) return;
    const text =
      s.settings.commentStorage === 'embedded' ? attachEmbedded(s.buffer, s.comments) : s.buffer;
    await s.platform.writeTextFile(s.docPath, text);
    await s.platform.commitFile?.(s.docPath); // web download fallback for handle-less files
    setSavedText(s.buffer);
    if (s.settings.commentStorage === 'sidecar') {
      // Completes an embedded→sidecar migration: the plain write above
      // stripped the trailer; make sure the sidecar holds the comments.
      await persistComments(s.comments);
    }
  }, [persistComments]);

  const toggleMode = useCallback(() => {
    const s = stateRef.current;
    const ws = workspaceRef.current;
    if (ws && ws.scrollHeight > 0) scrollRatioRef.current = ws.scrollTop / ws.scrollHeight;
    if (s.mode === 'preview') {
      setMode('edit');
    } else {
      if (s.settings.autosaveOnToggle && s.dirty) void saveDoc();
      setMode('preview');
    }
    setSelInfo(null);
    setPending(null);
  }, [saveDoc]);

  const openViaDialog = useCallback(async () => {
    const p = stateRef.current.platform;
    if (!p) return;
    const path = await p.openFileDialog();
    if (path) void openDoc(p, path);
  }, [openDoc]);

  /** Save As… (SPEC3 §3): comments travel with the document to the new path. */
  const saveDocAs = useCallback(async () => {
    const s = stateRef.current;
    const p = s.platform;
    if (!p || !s.docPath || !p.saveFileDialog) return;
    const target = await p.saveFileDialog(p.basename(s.docPath));
    if (!target) return;
    const text = s.settings.commentStorage === 'embedded' ? attachEmbedded(s.buffer, s.comments) : s.buffer;
    await p.writeTextFile(target, text);
    if (s.settings.commentStorage === 'sidecar' && s.comments.length > 0) {
      await p.writeTextFile(sidecarPathFor(target), serializeSidecar(s.comments));
    }
    await p.commitFile?.(target);
    await openDoc(p, target); // switch to the new document (title, watcher, sidecar)
  }, [openDoc]);

  const reloadThemes = useCallback(async () => {
    const p = stateRef.current.platform;
    if (!p) return;
    setThemes(await loadAllThemes(p));
  }, []);

  // --- global hotkeys (capture phase so Cmd+S never reaches the webview) --------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-hotkey-recorder]')) return;
      const hk = stateRef.current.settings.hotkeys;
      if (eventMatches(e, hk.toggleEdit)) {
        e.preventDefault();
        toggleMode();
      } else if (eventMatches(e, hk.save)) {
        e.preventDefault();
        void saveDoc();
      } else if (eventMatches(e, hk.openFile)) {
        e.preventDefault();
        void openViaDialog();
      } else if (eventMatches(e, hk.toggleComments)) {
        e.preventDefault();
        setShowComments((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggleMode, saveDoc, openViaDialog]);

  // --- vim-style navigation (SPEC3 §5): preview only, never while typing ------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s.settings.vimNav || s.mode !== 'preview') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable], .modal') || document.querySelector('.overlay')) {
        vimRef.current.reset();
        return;
      }
      const action = vimRef.current.resolve(e, performance.now());
      if (!action) return;
      const ws = workspaceRef.current;
      if (!ws) return;
      e.preventDefault();
      const half = ws.clientHeight / 2;
      switch (action) {
        case 'down':
          ws.scrollBy({ top: 60 });
          break;
        case 'up':
          ws.scrollBy({ top: -60 });
          break;
        case 'halfDown':
          ws.scrollBy({ top: half });
          break;
        case 'halfUp':
          ws.scrollBy({ top: -half });
          break;
        case 'top':
          ws.scrollTop = 0;
          break;
        case 'bottom':
          ws.scrollTop = ws.scrollHeight;
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- window title -------------------------------------------------------------
  useEffect(() => {
    const p = platform;
    if (!p) return;
    const name = docPath ? p.basename(docPath) : 'Markimark';
    void p.setTitle(`${name}${dirty ? ' •' : ''} — Markimark`);
    document.title = `${name}${dirty ? ' •' : ''} — Markimark`;
  }, [platform, docPath, dirty]);

  // --- markdown rendering (preview mode only) -------------------------------------
  useEffect(() => {
    if (mode !== 'preview') return;
    let cancelled = false;
    void renderMarkdown(buffer).then((rendered) => {
      if (!cancelled) setHtml(rendered);
    });
    return () => {
      cancelled = true;
    };
  }, [buffer, mode]);

  // --- restore scroll position when swapping modes --------------------------------
  useLayoutEffect(() => {
    const ws = workspaceRef.current;
    if (ws) ws.scrollTop = scrollRatioRef.current * ws.scrollHeight;
  }, [mode]);

  // --- inject rendered doc, re-anchor, highlight ----------------------------------
  useLayoutEffect(() => {
    if (mode !== 'preview') return;
    const doc = docRef.current;
    if (!doc) return;
    doc.innerHTML = html;
    if (!html) {
      docTextRef.current = '';
      return;
    }

    // Resolve local image paths through the platform (Tauri asset protocol).
    const p = stateRef.current.platform;
    const path = stateRef.current.docPath;
    if (p && path) {
      const dir = p.dirname(path);
      doc.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src');
        if (src) img.src = p.resolveAssetSrc(src, dir);
      });
    }

    const text = getDocText(doc);
    docTextRef.current = text;

    const pos: Positions = {};
    let changed = false;
    const updated = comments.map((c) => {
      const m = reanchor(c.anchor, text);
      pos[c.id] = m;
      if (m) {
        const fresh = createAnchor(text, m.start, m.end);
        if (!anchorsEqual(fresh, c.anchor)) {
          changed = true;
          return { ...c, anchor: fresh };
        }
      }
      return c;
    });
    setPositions(pos);
    if (changed) {
      // Persist refreshed anchors; the effect reruns and highlights then.
      setComments(updated);
      return;
    }
    if (!showComments) return;
    for (const c of comments) {
      if (c.resolved) continue;
      const m = pos[c.id];
      if (m) highlightRange(doc, m.start, m.end, c.id);
    }
  }, [html, comments, showComments, mode]);

  // --- active highlight styling -----------------------------------------------------
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    doc.querySelectorAll<HTMLElement>('mark.hl').forEach((m) => {
      m.classList.toggle('active', m.dataset.cid === activeId);
    });
  }, [activeId, positions, showComments]);

  // --- margin card alignment (runs every render; cheap) ------------------------------
  useLayoutEffect(() => {
    const doc = docRef.current;
    const panel = panelRef.current;
    if (!doc || !panel) return;
    const docTop = doc.getBoundingClientRect().top;
    const cards = Array.from(panel.querySelectorAll<HTMLElement>('[data-flowcard]'));
    let cursor = 0;
    for (const el of cards) {
      const key = el.dataset.flowcard!;
      let desired: number | null = null;
      if (key === '__composer' && pending) {
        const rect = rectForOffsets(doc, pending.start, pending.end);
        if (rect) desired = rect.top - docTop;
      } else {
        const mark = doc.querySelector<HTMLElement>(`mark.hl[data-cid="${CSS.escape(key)}"]`);
        if (mark) desired = mark.getBoundingClientRect().top - docTop;
      }
      // Rects are in zoomed viewport px; margins apply pre-zoom — convert.
      const zf = stateRef.current.settings.zoom / 100;
      const marginTop = desired === null ? 0 : Math.max(0, desired / zf - cursor);
      el.style.marginTop = `${marginTop}px`;
      cursor += marginTop + el.offsetHeight + CARD_GAP;
    }
  });

  // --- debounced comment autosave (sidecar or embedded per settings) -------------------
  useEffect(() => {
    if (!platform || !docPath) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    const t = setTimeout(() => void persistComments(comments), 800);
    return () => clearTimeout(t);
  }, [comments, platform, docPath, persistComments]);

  // --- selection → floating "Add comment" button ---------------------------------------
  useEffect(() => {
    if (mode !== 'preview') return;
    const onSelection = () => {
      const sel = document.getSelection();
      const doc = docRef.current;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !doc) {
        setSelInfo((prev) => (prev === null ? prev : null));
        return;
      }
      const range = sel.getRangeAt(0);
      if (!doc.contains(range.commonAncestorContainer)) {
        setSelInfo((prev) => (prev === null ? prev : null));
        return;
      }
      const { start, end } = rangeToOffsets(doc, range);
      if (end <= start || docTextRef.current.slice(start, end).trim() === '') {
        setSelInfo((prev) => (prev === null ? prev : null));
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelInfo({ start, end, x: rect.left + rect.width / 2, y: rect.top });
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [mode]);

  // --- comment operations -----------------------------------------------------------
  const startComposer = () => {
    if (!selInfo) return;
    setPending({ start: selInfo.start, end: selInfo.end });
    setDraft('');
    setActiveId(null);
    window.getSelection()?.removeAllRanges();
    setSelInfo(null);
  };

  const submitComment = () => {
    const body = draft.trim();
    if (!body || !pending) return;
    const comment: CommentData = {
      id: crypto.randomUUID(),
      author: settings.author,
      createdAt: new Date().toISOString(),
      body,
      resolved: false,
      thread: [],
      anchor: createAnchor(docTextRef.current, pending.start, pending.end),
    };
    setComments((prev) => [...prev, comment]);
    setPending(null);
    setDraft('');
    setActiveId(comment.id);
  };

  const updateComment = (next: CommentData) => {
    setComments((prev) => prev.map((c) => (c.id === next.id ? next : c)));
  };

  const deleteComment = (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
    setActiveId((a) => (a === id ? null : a));
  };

  const handleMarkClick = (id: string) => {
    setActiveId(id);
    panelRef.current?.querySelector(`[data-flowcard="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const handleCardActivate = (id: string) => {
    setActiveId(id);
    const doc = docRef.current;
    if (!doc) return;
    const marks = Array.from(doc.querySelectorAll<HTMLElement>(`mark.hl[data-cid="${CSS.escape(id)}"]`));
    if (marks.length === 0) return;
    marks[0].scrollIntoView({ block: 'center' });
    for (const m of marks) {
      m.classList.add('flash');
      setTimeout(() => m.classList.remove('flash'), 900);
    }
  };

  // --- panel ordering ------------------------------------------------------------------
  const open = comments
    .filter((c) => !c.resolved)
    .sort((a, b) => (positions[a.id]?.start ?? a.anchor.start) - (positions[b.id]?.start ?? b.anchor.start));
  const resolved = comments.filter((c) => c.resolved);

  type Item = { kind: 'comment'; c: CommentData } | { kind: 'composer' };
  const items: Item[] = open.map((c) => ({ kind: 'comment', c }) as Item);
  if (pending) {
    let at = items.findIndex(
      (it) => it.kind === 'comment' && (positions[it.c.id]?.start ?? it.c.anchor.start) > pending.start
    );
    if (at === -1) at = items.length;
    items.splice(at, 0, { kind: 'composer' });
  }

  const panelVisible = mode === 'preview' && showComments && (comments.length > 0 || pending !== null);

  const zoomFactor = settings.zoom / 100;

  if (!platform) return <div className="theme-root" />;

  return (
    <div className="theme-root" ref={rootRef}>
      <Toolbar
        docName={docPath ? platform.basename(docPath) : null}
        docPath={docPath}
        dirty={dirty}
        mode={mode}
        showComments={showComments}
        commentCount={comments.length}
        hotkeys={settings.hotkeys}
        isMac={platform.isMac}
        onToggleMode={toggleMode}
        onToggleComments={() => setShowComments((v) => !v)}
        onOpenFile={() => void openViaDialog()}
        onSave={() => void saveDoc()}
        onSaveAs={() => void saveDocAs()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {mode === 'preview' ? (
        <div className="workspace" ref={workspaceRef}>
          <div className="docwrap">
            {!docPath && <p className="placeholder">Open a markdown file to get started.</p>}
            <div
              className="doc"
              data-testid="doc"
              ref={docRef}
              onClick={(e) => {
                const mark = (e.target as HTMLElement).closest?.('mark.hl') as HTMLElement | null;
                if (mark?.dataset.cid && showComments) handleMarkClick(mark.dataset.cid);
              }}
            />
          </div>
          {panelVisible && (
            <aside className="panel" data-testid="panel" ref={panelRef}>
              {items.map((it) =>
                it.kind === 'composer' ? (
                  <div className="card composer" data-flowcard="__composer" data-testid="composer" key="__composer">
                    <textarea
                      data-testid="composer-input"
                      placeholder="Add a comment…"
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          submitComment();
                        } else if (e.key === 'Escape') {
                          setPending(null);
                          setDraft('');
                        }
                      }}
                    />
                    <div className="row">
                      <button data-testid="composer-submit" onClick={submitComment}>
                        Comment
                      </button>
                      <button
                        onClick={() => {
                          setPending(null);
                          setDraft('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <CommentCard
                    key={it.c.id}
                    comment={it.c}
                    author={settings.author}
                    orphaned={positions[it.c.id] === null}
                    active={activeId === it.c.id}
                    onActivate={handleCardActivate}
                    onUpdate={updateComment}
                    onDelete={deleteComment}
                  />
                )
              )}
              {resolved.length > 0 && (
                <details className="resolved-section" data-testid="resolved-section">
                  <summary>Resolved ({resolved.length})</summary>
                  {resolved.map((c) => (
                    <CommentCard
                      key={c.id}
                      comment={c}
                      author={settings.author}
                      orphaned={positions[c.id] === null}
                      active={activeId === c.id}
                      onActivate={(id) => setActiveId(id)}
                      onUpdate={updateComment}
                      onDelete={deleteComment}
                    />
                  ))}
                </details>
              )}
            </aside>
          )}
        </div>
      ) : (
        <div className="workspace" ref={workspaceRef} style={{ overflow: 'hidden' }}>
          <Suspense fallback={<div className="editor-wrap" data-testid="editor-loading" />}>
            <Editor value={buffer} lineNumbers={settings.lineNumbers} onChange={setBuffer} />
          </Suspense>
        </div>
      )}

      {selInfo && showComments && !pending && mode === 'preview' && (
        <button
          className="add-comment-btn"
          data-testid="add-comment-btn"
          style={{ left: selInfo.x / zoomFactor, top: Math.max(8, selInfo.y / zoomFactor - 42) }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={startComposer}
        >
          💬 Add comment
        </button>
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          themes={themes}
          isMac={platform.isMac}
          storageLocked={platform.kind === 'web'}
          onChange={updateSettings}
          onReloadThemes={() => void reloadThemes()}
          onImportTheme={
            platform.importTheme
              ? async () => {
                  if (await platform.importTheme!()) void reloadThemes();
                }
              : undefined
          }
          onRevealThemesDir={platform.revealThemesDir ? () => void platform.revealThemesDir!() : undefined}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {closePrompt && (
        <div className="overlay">
          <div className="modal" data-testid="close-prompt">
            <h2>Unsaved changes</h2>
            <p style={{ fontSize: 13.5 }}>
              “{docPath ? platform.basename(docPath) : 'This file'}” has unsaved changes. Save before closing?
            </p>
            <div className="actions">
              <button data-testid="close-cancel" onClick={() => setClosePrompt(false)}>
                Cancel
              </button>
              <button
                data-testid="close-discard"
                onClick={() => {
                  setClosePrompt(false);
                  void platform.closeNow();
                }}
              >
                Don’t save
              </button>
              <button
                className="primary"
                data-testid="close-save"
                onClick={async () => {
                  await saveDoc();
                  setClosePrompt(false);
                  void platform.closeNow();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
