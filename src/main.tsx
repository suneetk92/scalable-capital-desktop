import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applySettings, loadSettings } from "./settings";
import { extension } from "./extensions";

applySettings(loadSettings());

const ready = extension.prepare?.() ?? Promise.resolve();

void ready.then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
