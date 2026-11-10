// Readr's window: the app-level stores, then the router with its history (for Back and Forward).

import { useState } from "react";
import { RouterProvider } from "react-router";
import { HistoryProvider } from "./shell/navigation";
import { AppProviders } from "./shell/providers";
import { createReadrRouter } from "./shell/router";

export default function App() {
  const [{ router, position }] = useState(createReadrRouter);
  return (
    <AppProviders>
      <HistoryProvider position={position}>
        <RouterProvider router={router} />
      </HistoryProvider>
    </AppProviders>
  );
}
