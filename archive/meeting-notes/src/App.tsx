import { useEffect, useState } from "react";
import Conversation from "./Conversation";
import Home from "./Home";
import Oobe from "./Oobe";
import Settings from "./Settings";
import { backend } from "./ipc";
import type { Conversation as Conv, Settings as TSettings } from "./types";

type Route =
  | { view: "loading" }
  | { view: "oobe" }
  | { view: "home" }
  | { view: "settings" }
  | { view: "conversation"; initial: Conv | null; assetUrls: Record<string, string> };

function App() {
  const [route, setRoute] = useState<Route>({ view: "loading" });
  const [settings, setSettings] = useState<TSettings | null>(null);

  useEffect(() => {
    backend.getSettings().then((s) => {
      setSettings(s);
      setRoute({ view: s.oobe_done ? "home" : "oobe" });
    });
  }, []);

  async function openSaved() {
    const opened = await backend.openFile();
    if (opened) {
      setRoute({
        view: "conversation",
        initial: opened.conversation,
        assetUrls: opened.assetUrls,
      });
    }
  }

  if (route.view === "loading" || !settings) return null;

  if (route.view === "oobe") {
    return (
      <Oobe
        settings={settings}
        onDone={(s) => {
          setSettings(s);
          setRoute({ view: "home" });
        }}
      />
    );
  }

  if (route.view === "settings") {
    return (
      <Settings
        settings={settings}
        onSettingsChange={setSettings}
        onRerunOobe={() => setRoute({ view: "oobe" })}
        onBack={() => setRoute({ view: "home" })}
      />
    );
  }

  if (route.view === "home") {
    return (
      <Home
        onNew={() => setRoute({ view: "conversation", initial: null, assetUrls: {} })}
        onOpen={openSaved}
        onSettings={() => setRoute({ view: "settings" })}
        onRecovered={(conv) =>
          setRoute({ view: "conversation", initial: conv, assetUrls: {} })
        }
      />
    );
  }

  return (
    <Conversation
      key={route.initial?.id ?? "new"}
      initial={route.initial}
      initialAssetUrls={route.assetUrls}
      onHome={() => setRoute({ view: "home" })}
    />
  );
}

export default App;
