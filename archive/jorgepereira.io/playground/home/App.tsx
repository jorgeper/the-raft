import { useEffect, useState } from "react";

interface AppInfo {
  slug: string;
  title: string;
  description?: string;
  public?: boolean;
}

export function App() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/apps")
      .then((r) => r.json())
      .then((data) => {
        setApps(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="container">
      <header>
        <h1>Playground</h1>
        <p className="subtitle">Mini-apps, tools, and experiments.</p>
        <a href="/logout" className="logout">
          Sign out
        </a>
      </header>

      {loading ? (
        <p className="empty">Loading...</p>
      ) : apps.length === 0 ? (
        <p className="empty">No apps yet.</p>
      ) : (
        <div className="grid">
          {apps.map((app) => (
            <a key={app.slug} href={`/${app.slug}/`} className="card">
              <h2>{app.title}</h2>
              {app.description && <p>{app.description}</p>}
              {app.public && <span className="badge">Public</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
