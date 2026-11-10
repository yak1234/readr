// What Readr has: sources and their followed sections (feeds, with what each feed holds), the saved articles, the
// saved stations and TV channels (and one of each being tried), and the library's startup state. Loaded once for
// the window; pages read it and never own it.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import pLimit from "p-limit";
import type { ArticleSummary, Channel, Feed, SavedChannel, SavedStation, Site, StartupState, Station } from "../../shared/types";
import { feedsToLoad, type FeedState } from "../lib/stories";
import { api } from "../lib/api";
import { loadAll } from "../lib/load";
import { useReadrSettings } from "./settings-provider";

export interface LibraryValue {
  sites: Site[];
  feeds: Feed[];
  library: ArticleSummary[];
  stations: SavedStation[];
  channels: SavedChannel[];
  /** A station or channel being tried from a finder (playable, not saved). */
  tryingStation: Station | null;
  tryingChannel: Channel | null;
  /** Everything has loaded once (some of it may have failed: see `useLibraryStartup`). */
  ready: boolean;
  /** After signing in: what the feeds hold is fetched again, and a page that couldn't open tries again. */
  signedIn: () => void;
  /** Counts sign-ins, for what depends on the session. */
  signIns: number;
  refreshLibrary: () => Promise<void>;
  refreshSources: () => Promise<void>;
  saveStation: (st: Station, lang: string) => Promise<void>;
  removeStation: (id: string) => Promise<void>;
  /** A station to play that may not be saved: made playable for this session. */
  tryStation: (st: Station) => Promise<void>;
  saveChannel: (ch: Channel, lang: string) => Promise<void>;
  removeChannel: (id: string) => Promise<void>;
  tryChannel: (ch: Channel) => Promise<void>;
}

const LibraryContext = createContext<LibraryValue | null>(null);

/** The feeds' stories, apart from the rest: they arrive one feed at a time, and only the pages that list
 * stories redraw for them. */
interface FeedStories {
  feedState: Record<string, FeedState>;
  loadFeed: (feedId: string) => void;
}
const FeedStoriesContext = createContext<FeedStories | null>(null);

/** How the library started, apart from the rest: the window around the pages shows it, and doesn't redraw
 * when the lists change. */
interface LibraryStartup {
  /** The library's one-time upgrade into the database, and trying it again. */
  libraryState: StartupState | null;
  retryUpgrade: () => Promise<void>;
  /** Some of the lists couldn't be loaded. */
  loadFailed: boolean;
}
const LibraryStartupContext = createContext<LibraryStartup | null>(null);

/** What the library can be asked to do, apart from what it holds: these never change, so what only acts
 * (opening an address, say) doesn't redraw when the lists do. */
type LibraryActions = Pick<LibraryValue, "tryStation" | "saveStation" | "tryChannel" | "saveChannel">;
const LibraryActionsContext = createContext<LibraryActions | null>(null);

/** How many feeds are fetched at once. */
const FEEDS_AT_ONCE = 3;

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useReadrSettings();
  const [sites, setSites] = useState<Site[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedState, setFeedState] = useState<Record<string, FeedState>>({});
  const [library, setLibrary] = useState<ArticleSummary[]>([]);
  const [stations, setStations] = useState<SavedStation[]>([]);
  const [channels, setChannels] = useState<SavedChannel[]>([]);
  const [tryingStation, setTryingStation] = useState<Station | null>(null);
  const [tryingChannel, setTryingChannel] = useState<Channel | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // A load that fails leaves its list empty and shows a quiet note; it never blocks the rest. Later refreshes
  // fail silently and keep the list they had.
  const loadLibrary = useCallback(() => api.library().then(setLibrary), []);
  const loadStations = useCallback(() => api.stations().then(setStations), []);
  const loadChannels = useCallback(() => api.channels().then(setChannels), []);
  const loadSources = useCallback(() => Promise.all([api.sites().then(setSites), api.feeds().then(setFeeds)]), []);
  const refreshLibrary = useCallback(() => loadLibrary().catch(() => undefined), [loadLibrary]);
  const refreshSources = useCallback(() => loadSources().then(() => undefined, () => undefined), [loadSources]);

  // A few feeds fetched at a time, whichever page asks: a source with a dozen sections never fires a dozen
  // requests at once. A feed keeps its stories while it is fetched again, and keeps them if that fails.
  const [feedQueue] = useState(() => pLimit(FEEDS_AT_ONCE));
  const loadFeed = useCallback((feedId: string) => {
    setFeedState((s) => ({ ...s, [feedId]: { ...s[feedId], loading: true, items: s[feedId]?.items ?? [] } }));
    feedQueue(() => api.fetchFeed(feedId)).then(
      (r) => setFeedState((s) => ({ ...s, [feedId]: { loading: false, items: r.ok ? r.items : (s[feedId]?.items ?? []), error: r.ok ? undefined : r.error, fetchedAt: Date.now() } })),
      (e) => setFeedState((s) => ({ ...s, [feedId]: { loading: false, items: s[feedId]?.items ?? [], error: String(e?.message ?? e), fetchedAt: Date.now() } })),
    );
  }, [feedQueue]);

  // The library's upgrade runs when the app asks for its state (with the app's language); the loads below wait
  // for it in the main process.
  const [libraryState, setLibraryState] = useState<StartupState | null>(null);
  const initialLang = useRef(settings.currentLang);
  useEffect(() => {
    api.libraryState(initialLang.current).then(setLibraryState).catch(() => undefined);
  }, []);
  const retryUpgrade = useCallback(async () => {
    const s = await api.retryUpgrade().catch((e) => ({ library: "upgrade-failed" as const, message: String(e?.message ?? e) }));
    setLibraryState(s);
    if (s.library === "ready") void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    void loadAll([loadSources, loadLibrary, loadStations, loadChannels]).then((ok) => {
      if (!ok) setLoadFailed(true);
      setReady(true);
    });
  }, [loadSources, loadLibrary, loadStations, loadChannels]);

  const saveStation = useCallback(async (st: Station, lang: string) => setStations(await api.saveStation(st, lang)), []);
  const removeStation = useCallback(async (id: string) => setStations(await api.removeStation(id)), []);
  // Made playable unless it is saved (a saved one plays as it is); it stays the one being tried either way.
  const saved = useRef({ stations, channels });
  saved.current = { stations, channels };
  const tryStation = useCallback(async (st: Station) => {
    if (!saved.current.stations.some((x) => x.url === st.url)) await api.previewStation(st);
    setTryingStation(st);
  }, []);
  const saveChannel = useCallback(async (ch: Channel, lang: string) => setChannels(await api.saveChannel(ch, lang)), []);
  const removeChannel = useCallback(async (id: string) => setChannels(await api.removeChannel(id)), []);
  const tryChannel = useCallback(async (ch: Channel) => {
    if (!saved.current.channels.some((x) => x.url === ch.url)) await api.previewChannel(ch);
    setTryingChannel(ch);
  }, []);
  const [signIns, setSignIns] = useState(0);
  const signedIn = useCallback(() => {
    setFeedState({});
    setSignIns((n) => n + 1);
  }, []);

  const value = useMemo<LibraryValue>(
    () => ({
      sites, feeds, library, stations, channels, tryingStation, tryingChannel, ready,
      signedIn, signIns, refreshLibrary, refreshSources, saveStation, removeStation, tryStation, saveChannel, removeChannel, tryChannel,
    }),
    [sites, feeds, library, stations, channels, tryingStation, tryingChannel, ready, signedIn, signIns, refreshLibrary, refreshSources, saveStation, removeStation, tryStation, saveChannel, removeChannel, tryChannel],
  );
  const actions = useMemo<LibraryActions>(() => ({ tryStation, saveStation, tryChannel, saveChannel }), [tryStation, saveStation, tryChannel, saveChannel]);
  const startup = useMemo<LibraryStartup>(() => ({ libraryState, retryUpgrade, loadFailed }), [libraryState, retryUpgrade, loadFailed]);
  const stories = useMemo<FeedStories>(() => ({ feedState, loadFeed }), [feedState, loadFeed]);
  return (
    <LibraryContext.Provider value={value}>
      <LibraryActionsContext.Provider value={actions}>
        <LibraryStartupContext.Provider value={startup}>
          <FeedStoriesContext.Provider value={stories}>{children}</FeedStoriesContext.Provider>
        </LibraryStartupContext.Provider>
      </LibraryActionsContext.Provider>
    </LibraryContext.Provider>
  );
}

/** Saving and trying stations and channels, for what acts on the library without showing it. */
export function useLibraryActions(): LibraryActions {
  const value = useContext(LibraryActionsContext);
  if (!value) throw new Error("useLibraryActions outside LibraryProvider");
  return value;
}

/** How the library started: its upgrade's state, trying it again, and whether a list failed to load. */
export function useLibraryStartup(): LibraryStartup {
  const value = useContext(LibraryStartupContext);
  if (!value) throw new Error("useLibraryStartup outside LibraryProvider");
  return value;
}

/** Each feed's stories and whether it is being fetched; `loadFeed` fetches one again. */
export function useFeedStories(): FeedStories {
  const value = useContext(FeedStoriesContext);
  if (!value) throw new Error("useFeedStories outside LibraryProvider");
  return value;
}

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("useLibrary outside LibraryProvider");
  return value;
}

/** A page showing `feeds`' stories: each feed never fetched, or stale, is fetched (its stories stay up meanwhile),
 * and fetched again whenever what the feeds hold is reset, as signing in does. */
export function useLoadFeeds(feeds: Feed[]): void {
  const { feedState, loadFeed } = useFeedStories();
  useEffect(() => {
    feedsToLoad(feeds, feedState, Date.now()).forEach(loadFeed);
  }, [feeds, feedState, loadFeed]);
}
