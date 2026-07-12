import { useState } from "react";
import Conversation from "./Conversation";
import Home from "./Home";
import { backend } from "./ipc";
import type { Conversation as Conv } from "./types";

type Route = { view: "home" } | { view: "conversation"; initial: Conv | null };

function App() {
  const [route, setRoute] = useState<Route>({ view: "home" });

  async function openSaved() {
    const conv = await backend.openFile();
    if (conv) setRoute({ view: "conversation", initial: conv });
  }

  if (route.view === "home") {
    return <Home onNew={() => setRoute({ view: "conversation", initial: null })} onOpen={openSaved} />;
  }
  return (
    <Conversation
      key={route.initial?.id ?? "new"}
      initial={route.initial}
      onHome={() => setRoute({ view: "home" })}
    />
  );
}

export default App;
