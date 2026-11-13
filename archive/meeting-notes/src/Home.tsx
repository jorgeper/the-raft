import { useEffect, useState } from "react";
import { backend } from "./ipc";
import type { Conversation } from "./types";

interface Props {
  onNew: () => void;
  onOpen: () => void;
  onSettings: () => void;
  onRecovered: (conv: Conversation) => void;
}

function Home({ onNew, onOpen, onSettings, onRecovered }: Props) {
  const [recoverable, setRecoverable] = useState<Conversation | null>(null);

  useEffect(() => {
    backend.checkRecovery().then(setRecoverable);
  }, []);

  return (
    <div className="home">
      <button className="btn-gear" onClick={onSettings} aria-label="Settings" title="Settings">
        ⚙
      </button>
      {recoverable && (
        <div className="recovery-banner" role="alert">
          <span>
            A recording didn't finish saving
            {recoverable.title !== "Untitled conversation"
              ? ` — “${recoverable.title}”`
              : ""}
            . Recover it?
          </span>
          <button
            className="btn-mini"
            onClick={async () => onRecovered(await backend.recover())}
          >
            Recover
          </button>
          <button
            className="btn-mini quiet"
            onClick={async () => {
              await backend.discardRecovery();
              setRecoverable(null);
            }}
          >
            Discard
          </button>
        </div>
      )}
      <div className="home-center">
        <h1 className="wordmark">Minutes</h1>
        <p className="tagline">Meeting notes that never leave this device.</p>
        <button className="btn-primary" onClick={onNew}>
          New conversation
        </button>
        <button className="btn-quiet" onClick={onOpen}>
          Open a saved conversation…
        </button>
      </div>
      <footer className="local-badge">
        <span className="dot-local" aria-hidden="true" />
        100% local — no audio ever leaves this device.
      </footer>
    </div>
  );
}

export default Home;
