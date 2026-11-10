// The app-level stores that outlive every page: the settings, the library, and the read-aloud session.
// (The radio and TV session, audio focus and live text are module stores in src/lib.)

import React from "react";
import { LibraryProvider } from "./library-provider";
import { ReaderProvider } from "./reader-provider";
import { SettingsProvider } from "./settings-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <LibraryProvider>
        <ReaderProvider>{children}</ReaderProvider>
      </LibraryProvider>
    </SettingsProvider>
  );
}
