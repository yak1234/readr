import React from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { i18n } from "./i18n";
import App from "./App";
import { FloatingApp } from "./floating";
import "./styles.css";

// The floating player is the same bundle loaded with ?floating.
const floating = new URLSearchParams(location.search).has("floating");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>{floating ? <FloatingApp /> : <App />}</I18nextProvider>
  </React.StrictMode>,
);
