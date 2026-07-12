import { useState } from "react";
import Conversation from "./Conversation";
import Home from "./Home";
import { backend } from "./ipc";
import type { Conversation as Conv } from "./types";

type Route =
  | { view: "home" }
  | { view: "conversation"; initial: Conv | null; assetUrls: Record<string, string> };

function App() {
  const [route, setRoute] = useState<Route>({ view: "home" });

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

  if (route.view === "home") {
    return (
      <Home
        onNew={() => setRoute({ view: "conversation", initial: null, assetUrls: {} })}
        onOpen={openSaved}
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
