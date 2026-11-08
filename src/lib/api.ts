import type { ReadrApi } from "../../shared/types";

// Inside Electron the preload script provides window.readr. When the renderer
// is opened in a plain browser (vite dev without Electron) every call fails
// with a clear message instead of crashing the UI.
const notInElectron = () => Promise.reject(new Error("Open Readr through Electron (npm run dev)."));

export const api: ReadrApi =
  typeof window !== "undefined" && window.readr
    ? window.readr
    : (new Proxy({}, { get: () => notInElectron }) as ReadrApi);
