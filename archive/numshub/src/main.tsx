import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import SettingsApp from "./settings/SettingsApp";
import OverlayApp from "./overlay/OverlayApp";

// Window routing: the Rust side opens the overlay window with
// index.html?window=overlay; tests may also use #/overlay.
const params = new URLSearchParams(window.location.search);
const isOverlay =
  params.get("window") === "overlay" || window.location.hash === "#/overlay";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isOverlay ? <OverlayApp /> : <SettingsApp />}</React.StrictMode>,
);
