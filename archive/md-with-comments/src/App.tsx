import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CommentData, createAnchor, reanchor, ReanchorMatch, Anchor } from './lib/anchoring';
import { getDocText, highlightRange, rangeToOffsets, rectForOffsets } from './lib/domtext';
import { renderMarkdown } from './lib/markdown';
import { CommentCard } from './components/CommentCard';

const AUTHOR = localStorage.getItem('mdcomments.author') ?? 'Reviewer';
const CARD_GAP = 8;

type Positions = Record<string, ReanchorMatch | null>;

function docFromHash(): string | null {
  const m = /#doc=([^&]+)/.exec(window.location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

function anchorsEqual(a: Anchor, b: Anchor): boolean {
  return (
    a.exact === b.exact &&
    a.prefix === b.prefix &&
    a.suffix === b.suffix &&
    a.start === b.start &&
    a.end === b.end
  );
}

export default function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(docFromHash);
  const [loadedFile, setLoadedFile] = useState<string | null>(null);
  const [html, setHtml] = useState('');
  const [comments, setComments] = useState<CommentData[]>([]);
  const [positions, setPositions] = useState<Positions>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(true);
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [selInfo, setSelInfo] = useState<{ start: number; end: number; x: number; y: number } | null>(null);

  const docRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const docTextRef = useRef('');
  const skipSaveRef = useRef(true);

  // --- routing -------------------------------------------------------------
  useEffect(() => {
    const onHash = () => setCurrent(docFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // --- file list -----------------------------------------------------------
  useEffect(() => {
    fetch('/api/files')
      .then((r) => r.json())
      .then((d) => setFiles(d.files ?? []))
      .catch(() => {});
  }, []);

  // --- document + comments loading ------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setHtml('');
    setComments([]);
    setPositions({});
    setActiveId(null);
    setPending(null);
    setLoadedFile(null);
    if (!current) return;
    (async () => {
      try {
        const [fileRes, commentsRes] = await Promise.all([
          fetch(`/api/files/${encodeURIComponent(current)}`),
          fetch(`/api/files/${encodeURIComponent(current)}/comments`),
        ]);
        if (!fileRes.ok) return;
        const { content } = await fileRes.json();
        const stored = commentsRes.ok ? await commentsRes.json() : { comments: [] };
        const rendered = await renderMarkdown(content);
        if (cancelled) return;
        skipSaveRef.current = true;
        setComments(Array.isArray(stored.comments) ? stored.comments : []);
        setHtml(rendered);
        setLoadedFile(current);
      } catch {
        /* network failure: leave the document area empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current]);

  // --- render document, re-anchor, apply highlights --------------------------
  useLayoutEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    doc.innerHTML = html;
    if (!html) {
      docTextRef.current = '';
      return;
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
      // Persist the refreshed anchors; this effect reruns and highlights then.
      setComments(updated);
      return;
    }
    if (!showComments) return;
    for (const c of comments) {
      if (c.resolved) continue;
      const m = pos[c.id];
      if (m) highlightRange(doc, m.start, m.end, c.id);
    }
  }, [html, comments, showComments]);

  // --- active highlight styling ----------------------------------------------
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    doc.querySelectorAll<HTMLElement>('mark.hl').forEach((m) => {
      m.classList.toggle('active', m.dataset.cid === activeId);
    });
  }, [activeId, positions, showComments]);

  // --- margin card alignment (runs every render; cheap) -----------------------
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
      const marginTop = desired === null ? 0 : Math.max(0, desired - cursor);
      el.style.marginTop = `${marginTop}px`;
      cursor += marginTop + el.offsetHeight + CARD_GAP;
    }
  });

  // --- debounced autosave ------------------------------------------------------
  useEffect(() => {
    if (!loadedFile) return;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/files/${encodeURIComponent(loadedFile)}/comments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [comments, loadedFile]);

  // --- selection → floating "Add comment" button -------------------------------
  useEffect(() => {
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
  }, []);

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
      author: AUTHOR,
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
    panelRef.current
      ?.querySelector(`[data-flowcard="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
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

  // --- panel ordering ------------------------------------------------------------
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

  return (
    <div className="app">
      <nav className="sidebar">
        <h1>MDComments</h1>
        <ul className="file-list">
          {files.map((f) => (
            <li key={f}>
              <button
                data-testid="file-item"
                className={f === current ? 'selected' : ''}
                onClick={() => {
                  window.location.hash = `doc=${encodeURIComponent(f)}`;
                }}
              >
                {f}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="content">
        <header className="toolbar">
          <span className="docname">{current ?? 'Select a document'}</span>
          <button data-testid="toggle-comments" onClick={() => setShowComments((s) => !s)}>
            {showComments ? 'Hide comments' : 'Show comments'}
          </button>
        </header>

        <div className="workspace">
          <div className="docwrap">
            {!current && <p className="placeholder">Choose a markdown document from the list.</p>}
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

          <aside className="panel" data-testid="panel" ref={panelRef} hidden={!showComments}>
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
                  author={AUTHOR}
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
                    author={AUTHOR}
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
        </div>
      </div>

      {selInfo && showComments && !pending && (
        <button
          className="add-comment-btn"
          data-testid="add-comment-btn"
          style={{ left: selInfo.x, top: Math.max(8, selInfo.y - 42) }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={startComposer}
        >
          💬 Add comment
        </button>
      )}
    </div>
  );
}
