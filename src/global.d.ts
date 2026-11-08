/// <reference types="vite/client" />
import type { ReadrApi } from "../shared/types";

declare global {
  interface Window {
    readr: ReadrApi;
  }
}

export {};
