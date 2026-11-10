// Readr's pages as routes in a memory router (an Electron window has no address bar), under one layout that
// holds the language, the study counts and what is being read. Unknown addresses go Home.

import React from "react";
import { createMemoryRouter, Navigate } from "react-router";
import { ArticlePage } from "../views/article";
import { CardsPage } from "../views/cards";
import { FindPage } from "../views/find";
import { HomePage } from "../views/home";
import { ListPage } from "../views/list";
import { LivePage } from "../views/live";
import { OpenPage } from "../views/open";
import { PastPage } from "../views/past";
import { ReviewPage } from "../views/review";
import { SourcePage } from "../views/source";
import { AppShell } from "./app-shell";
import { trackHistory } from "./history";
import { LanguageProvider } from "./language-provider";
import { usePage } from "./navigation";
import { ReadingProvider } from "./reading-provider";
import { PATTERNS, paths } from "./routes";
import { StudyProvider } from "./study-provider";

function Layout() {
  return (
    <LanguageProvider>
      <StudyProvider>
        <ReadingProvider>
          <AppShell />
        </ReadingProvider>
      </StudyProvider>
    </LanguageProvider>
  );
}

/** A page only for addresses it can read (a list or a live kind Readr has); anything else goes Home. */
function Known({ children }: { children: React.ReactNode }) {
  return usePage() ? <>{children}</> : <Navigate to={paths.home()} replace />;
}

export function createReadrRouter() {
  const page = (path: string, element: React.ReactNode) => ({ path, element: <Known>{element}</Known> });
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          page(PATTERNS.home, <HomePage />),
          page(PATTERNS.review, <ReviewPage />),
          page(PATTERNS.cards, <CardsPage />),
          page(PATTERNS.list, <ListPage />),
          page(PATTERNS.source, <SourcePage />),
          page(PATTERNS.article, <ArticlePage />),
          page(PATTERNS.live, <LivePage />),
          page(PATTERNS.past, <PastPage />),
          page(PATTERNS.find, <FindPage />),
          page(PATTERNS.open, <OpenPage />),
          { path: "*", element: <Navigate to={paths.home()} replace /> },
        ],
      },
    ],
    { initialEntries: [paths.home()] },
  );
  return { router, position: trackHistory(router) };
}
