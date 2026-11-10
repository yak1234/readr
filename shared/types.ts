// Types shared by the Electron main process and the React renderer.

import type { ActivityToday, AddedCard, Card, CardCounts, CardExample, CardsExported, IntervalPreview, NewCard, ReviewRating } from "./cards";
import type { LiveSession, LiveTranscript } from "./live-history";
import type { Classification } from "./site-kinds";

/** An ISO 639-1 code ("fr", "ar", ...); see shared/languages.ts for what is known about each. */
export type Lang = string;

export interface Block {
  /** "p" paragraph, "h" subheading, "q" blockquote, "li" list item */
  type: "p" | "h" | "q" | "li";
  /** Sentences, already segmented. */
  sentences: string[];
}

export interface Article {
  id: string;
  url: string;
  source: string; // "Le Monde", "Courrier International", or hostname
  title: string;
  subtitle: string;
  author: string;
  date: string;
  readingTime: number; // minutes
  imageUrl: string;
  language: Lang;
  blocks: Block[];
  /** Sentence translations keyed by the sentence text. */
  translations: Record<string, string>;
  /** Translations by target language, then sentence text. Replaces the legacy `translations`, which is never read. */
  translationsTo?: Record<string, Record<string, string>>;
  progress: number; // 0-100
  savedAt: string; // ISO
  favorite?: boolean;
  archived?: boolean;
  /** "video" is a legacy kind from older versions; such articles are hidden. */
  kind?: "article" | "video" | "radio" | "tv";
  /** [start, end] seconds for each sentence, parallel to blocks[].sentences. */
  cues?: [number, number][][];
  /** Live: each sentence's id in the live history ("" when it has none), parallel to blocks[].sentences. */
  liveIds?: string[][];
  /** A live stream: no transcript yet, never saved or resumed. */
  live?: boolean;
  /** A past radio or TV transcript (read-only): its session, and the station or channel it was heard on. */
  past?: { sessionId: string; stationId: string | null };
}

/** Light version used in lists (no body). */
export type ArticleSummary = Omit<Article, "blocks" | "translations" | "translationsTo" | "cues">;

export interface FeedItem {
  title: string;
  link: string;
  date: string;
  description: string;
  imageUrl: string;
}

export interface Feed {
  id: string;
  name: string; // "Le Monde — À la une"
  source: string; // "Le Monde"
  url: string; // RSS URL, or empty to autodiscover from homepage
  homepage: string;
  lang: Lang;
  /** No RSS: list the article links on the homepage instead. */
  fromHomepage?: boolean;
}

/** One followable feed of a source ("Politique"). `id` doubles as the feed id. */
export interface Section {
  id: string;
  name: string;
  url: string; // "" means: the homepage's article links
}

/** A source the user added (by URL or from the catalogue). */
export interface UserSource {
  id: string;
  name: string;
  lang: Lang;
  homepage: string;
  hosts: string[];
  /** url "" means: no RSS, use the homepage's article links. */
  feeds: { name: string; url: string }[];
  /** "video" sources saved by older versions are ignored. */
  kind?: "news" | "video";
  catalogId?: string;
}

/** What Readr found on a site's homepage when adding it. */
export interface DiscoveredSource {
  name: string;
  lang: Lang | null;
  homepage: string;
  hosts: string[];
  feedUrl: string;
}

/** A free source Readr suggests (no login needed). */
export interface CatalogSource {
  id: string;
  name: string;
  lang: Lang;
  homepage: string;
  hosts: string[];
  feeds: { name: string; url: string }[];
  note: string;
  added?: boolean;
}

export interface Site {
  id: string;
  name: string;
  homepage: string;
  loginUrl: string;
  /** Hostnames this site's articles live on. */
  hosts: string[];
  lang: Lang;
  /** True for sources the user added; they can be removed. */
  user?: boolean;
  /** Free catalogue source: nothing to sign in to. */
  free?: boolean;
}

export interface DictSense {
  pos: string;
  glosses: string[];
  tags: string[]; // e.g. ["masculine"]
}

export interface WordPart {
  text: string;
  lemma: string;
  upos: string;
  feats: string | null;
}

/** A selection snapped to the dictionary phrase containing it; offsets are UTF-16 indices into the sentence. */
export interface PhraseResult {
  start: number;
  end: number;
  /** The dictionary form: the phrase's headword, or a single word's lemma. */
  form: string;
  definition: string;
  /** True when a multi-word dictionary entry was found. */
  snapped: boolean;
  /** False when neither the dictionary nor the word analysis is there for the language yet (a first run
   * still downloading): `form` is then only the text as selected. */
  ready: boolean;
}

/** A selection translated in its sentence, or why not: the language can't be translated, the translator
 * isn't running, or it answered with nothing. */
export type SelectionTranslation = { ok: true; text: string } | { ok: false; reason: "unavailable" | "offline" | "empty" };

/** What the right-click menu asks the window to do with its selection. */
export type MenuAction = "translate" | "add-card";

export interface LookupResult {
  word: string;
  lemma: string;
  pos: string; // Stanza UPOS of the content part
  morph: Record<string, string>; // Gender=Masc, Number=Sing, Tense=Pres...
  /** The word's parts when it is more than one (و + مزارع): Stanza's split of attached clitics. */
  parts: WordPart[];
  /** State of this language's word-analysis models. */
  analysis: "ready" | "downloading" | "unavailable";
  ipa: string;
  senses: DictSense[];
  /** Machine translation of the word alone, as a fallback gloss. */
  mtGloss: string;
  /** The word's translation in context into the reader's target language; "" when that is English. */
  gloss_target: string;
  /** State of this language's dictionary: "downloading" means the first-use download is still running. */
  dictionary: "ready" | "downloading" | "unavailable";
  dictionaryAvailable: boolean;
}

export interface VocabEntry {
  id: string;
  word: string;
  lemma: string;
  gloss: string;
  sentence: string;
  sentenceTranslation: string;
  articleUrl: string;
  articleTitle: string;
  addedAt: string;
}

export interface SidecarStatus {
  ok: boolean;
  translator: string; // "Hy-MT2-1.8B" | ""
  stanza: boolean;
  dictionary: boolean;
  message: string;
}

export interface ExtractResult {
  ok: boolean;
  article?: Article;
  /** True when the page looked like a paywall / login wall. */
  paywalled?: boolean;
  /** True when the site showed a browser check that didn't pass by itself: the reader has to pass it (passBrowserCheck). */
  browserCheck?: boolean;
  error?: string;
}

/** Whether the library (articles and saved words) is usable: the one-time upgrade into the database may have failed. */
export type StartupState = { library: "ready" } | { library: "upgrade-failed"; message: string };

/** The API the preload script exposes on window.readr. */
export interface ReadrApi {
  sites(): Promise<Site[]>;
  login(siteId: string): Promise<void>;
  openOriginal(url: string): Promise<void>;
  /** Show a site's browser check for the reader to pass (in the session articles are read in). Resolves when its window closes: by itself once passed, or by the reader. */
  passBrowserCheck(url: string): Promise<void>;
  feeds(): Promise<Feed[]>;
  /** Every section a source offers (discovered the first time for added sources) and which ones are followed. */
  sourceSections(sourceId: string): Promise<{ sections: Section[]; followed: string[] }>;
  followSections(sourceId: string, ids: string[]): Promise<void>;
  fetchFeed(feedId: string): Promise<{ ok: boolean; items: FeedItem[]; error?: string }>;
  extract(url: string): Promise<ExtractResult>;
  /** The library's state. The first call runs the one-time upgrade; `currentLang` is the app's language. */
  libraryState(currentLang: string): Promise<StartupState>;
  /** After a failed upgrade: run it again. */
  retryUpgrade(): Promise<StartupState>;
  /** Open the folder holding the old library files. */
  showLibraryFolder(): Promise<void>;
  library(): Promise<ArticleSummary[]>;
  getArticle(id: string): Promise<Article | null>;
  updateArticle(id: string, patch: Partial<Article>): Promise<void>;
  deleteArticle(id: string): Promise<void>;
  translate(articleId: string, sentences: string[], src: string, tgt: string): Promise<Record<string, string>>;
  /** `offset` is the word's character offset in `sentence`, where known. */
  lookup(word: string, sentence: string, lang: string, tgt: string, offset?: number): Promise<LookupResult | null>;
  /** Load a language's word-analysis models into memory ahead of the first click (never downloads). */
  warmAnalysis(lang: string): Promise<void>;
  sidecarStatus(): Promise<SidecarStatus>;
  /** Magpie read-aloud: voices and readiness, and WAV bytes for a text. */
  ttsStatus(): Promise<{ ready: boolean; voices: string[]; message: string }>;
  speak(text: string, lang: string, voice: string, quality: "fast" | "best"): Promise<Uint8Array>;
  /** The selection [start, end) of `sentence` widened to the dictionary phrase containing it; null when the server can't answer. */
  phrase(lang: string, sentence: string, start: number, end: number): Promise<PhraseResult | null>;
  /** Translates selected text with `context` (its sentence, or the sentences it spans); never cached. */
  translateSelection(lang: string, tgt: string, text: string, context: string): Promise<SelectionTranslation>;
  /** The current selection's text and whether it could become a card (a hint for the right-click menu). */
  selectionState(state: { text: string; add: boolean }): void;
  /** The right-click menu's Translate / Add to flashcards. */
  onMenu(cb: (action: MenuAction) => void): () => void;
  /** Flashcards. Adding is allowed from the floating window; the rest only from the main one. */
  cardsAdd(card: NewCard): Promise<AddedCard | null>;
  /** Gives a card the translation that arrived after it was added, unless it has one by now (main or floating window). */
  cardsFillTranslation(cardId: string, translation: string): Promise<boolean>;
  cardsDue(lang: string, newPerDay: number): Promise<Card[]>;
  /** The card as rescheduled; null if it was deleted. Rejects when the rating couldn't be saved. */
  cardsReview(cardId: string, rating: ReviewRating): Promise<Card | null>;
  cardsCounts(lang: string, newPerDay: number): Promise<CardCounts>;
  cardsList(lang: string, query?: string): Promise<Card[]>;
  cardsSuspend(cardId: string, suspended: boolean): Promise<void>;
  cardsDelete(cardId: string): Promise<void>;
  cardsEdit(cardId: string, patch: { translation?: string; definition?: string | null }): Promise<void>;
  /** A card's examples, most recent first, with their audio clips. */
  cardsExamples(cardId: string): Promise<CardExample[]>;
  /** How long each rating would keep the card away, if rated now; null if it no longer exists. */
  cardsPreviewIntervals(cardId: string): Promise<IntervalPreview | null>;
  /** The sentences heard on radio or TV that cards were made from. */
  cardsLiveSentences(): Promise<string[]>;
  /** What a language's cards mark as saved: their forms, and their one-word phrases as written, lowercased. */
  cardsSavedSurfaces(lang: string): Promise<string[]>;
  /** Exports a language's cards for Anki to a folder the reader picks (with their clips); null when cancelled. */
  cardsExport(lang: string): Promise<CardsExported | null>;
  /** A station's or channel's past sessions, newest first (by its id and its stream's address). */
  liveSessions(stationIds: string[]): Promise<LiveSession[]>;
  /** One past session's transcript; null when it is gone. */
  liveTranscript(sessionId: string): Promise<LiveTranscript | null>;
  /** Today's reviews and minutes listened (the day turns over at 4 AM). */
  activityToday(): Promise<ActivityToday>;
  /** Today's activity changed outside a review (a live session ended). */
  onActivityChanged(cb: () => void): () => void;
  discoverSource(input: string): Promise<{ ok: boolean; source?: DiscoveredSource; error?: string }>;
  addSource(src: DiscoveredSource & { lang: Lang }): Promise<UserSource>;
  removeSource(id: string): Promise<void>;
  catalog(): Promise<CatalogSource[]>;
  addCatalogSource(id: string): Promise<UserSource | null>;
  /** Saved radio stations (seeded on first run). */
  stations(): Promise<SavedStation[]>;
  saveStation(s: Station, lang: string): Promise<SavedStation[]>;
  removeStation(id: string): Promise<SavedStation[]>;
  /** Make an unsaved station playable for this session (the finder's play button). */
  previewStation(s: Station): Promise<void>;
  /** Radio Browser, through the Python server; rejects with its message when unreachable. */
  radioSearch(q: RadioQuery): Promise<Station[]>;
  radioCountries(): Promise<RadioFacet[]>;
  radioLanguages(): Promise<RadioFacet[]>;

  /** Saved TV channels (the built-ins are added once). */
  channels(): Promise<SavedChannel[]>;
  saveChannel(c: Channel, lang: string): Promise<SavedChannel[]>;
  removeChannel(id: string): Promise<SavedChannel[]>;
  /** Make an unsaved channel playable for this session (the finder's play button). */
  previewChannel(c: Channel): Promise<void>;
  /** The iptv-org index, official streams only (downloaded on first use, refreshed daily). */
  tvSearch(q: TvQuery): Promise<{ channels: Channel[]; countries: string[] }>;
  /** A known channel's audio-only variant, if its master playlist has one. */
  tvAudioOnly(url: string): Promise<string | null>;
  /** The main window was hidden or minimised (false), or shown again (true). */
  onWindowVisible(cb: (visible: boolean) => void): () => void;
  /** Import-logins dialog opened: starts the site-suggestion model; returns the remembered browser and sites. */
  importDialogOpen(): Promise<{ browser: string | null; chosen: string[] }>;
  /** Dialog closed: stops the model. */
  importDialogClose(): Promise<void>;
  /** Which sites an everyday browser holds logins for (names and counts only, never Google), with what Readr already knows about them. */
  browserSites(browser: string): Promise<{ ok: boolean; error?: string; sites: { site: string; cookies: number }[]; always: string[]; chosen: string[]; classes: Record<string, Classification> }>;
  /** "loading" while the suggestion model starts (the first run downloads it). */
  modelState(): Promise<"none" | "loading" | "ready">;
  /** The model's label for sites not seen before (empty when the model can't run). */
  classifySites(sites: string[]): Promise<Record<string, Classification>>;
  /** Copy the cookies of exactly these sites from the browser into Readr; remembers the choice. */
  importLogins(browser: string, sites: string[]): Promise<{ ok: boolean; imported: number; domains: string[]; error?: string }>;

  /** Live transcription of a radio stream: "page" means Readr's window sends the audio itself. */
  /** `about`: the stream's title and kind as the window shows them, naming its live history when main doesn't know the stream. */
  liveStart(lang: Lang, source: "page" | "ffmpeg", streamUrl?: string, sid?: number, about?: { title: string; kind: "radio" | "tv" }): Promise<void>;
  liveStop(): Promise<void>;
  livePcm(pcm: Int16Array, level: number, mediaTime: number): void;
  onLiveEvent(cb: (e: LiveEvent) => void): () => void;

  /** The floating player: opened from the radio bar; the main window pushes it what to show. */
  floatingOpen(): Promise<void>;
  floatingClose(): Promise<void>;
  /** Main window: the state the floating window draws. */
  floatingPush(state: FloatingState): void;
  /** Floating window: its first state (the last one pushed), then each push. */
  floatingReady(): Promise<FloatingState | null>;
  onFloatingState(cb: (s: FloatingState) => void): () => void;
  /** Floating window: asks the main window to do something. */
  floatingCommand(cmd: FloatingCommand): void;
  onFloatingCommand(cb: (cmd: FloatingCommand) => void): () => void;
  /** A live session started or ended (the Earlier lists change). */
  onHistoryChanged(cb: () => void): () => void;
  /** A card was added, changed or removed (from either window). */
  onCardsChanged(cb: () => void): () => void;
}

/** What the floating player shows: whatever is playing, a radio station or the
 * article being read aloud. The main window's sessions own the truth. */
export interface FloatingState {
  /** What is playing; null when nothing is (the window closes). */
  kind: "radio" | "tv" | "article" | null;
  /** The article's, station's or channel's id (where a card's example says it came from). */
  id: string;
  title: string;
  /** The publication (articles) or station (radio). */
  source: string;
  language: Lang;
  url: string;
  /** Language the translations are in. */
  target: string;
  playing: boolean;
  failed: boolean;
  /** Radio: the last few finished sentences. Article: the sentence being read, then the next few. */
  sentences: { key: string; text: string; liveId?: string }[];
  /** Article only: the sentence being read (0-based) and how many there are. */
  index?: number;
  total?: number;
  /** Radio only: the words being heard now (not yet final). */
  partial: string;
  error: string | null;
  translations: Record<string, string>;
  translationOn: boolean;
  /** A translation is on its way (else no placeholder is drawn). */
  translationExpected: boolean;
  /** The cards' forms, normalised (the words marked as saved). */
  savedWords: string[];
  dark: boolean;
}

export type FloatingCommand =
  | { type: "toggle-play" }
  | { type: "toggle-translation" }
  /** Read-aloud: back or forward one sentence. */
  | { type: "prev" }
  | { type: "next" }
  /** Focus the main window on what is playing, at the sentence being heard or read. */
  | { type: "open" }
  /** Show the full dictionary entry in the main window. */
  | { type: "more"; word: string; sentence: string };

export type LiveEvent = (
  | { type: "partial"; text: string }
  /** `id`: the sentence's row in the live history, when it was saved there (a card made from it gets its audio). */
  | { type: "final"; cues: { text: string; start: number; end: number; id?: string }[] }
  | { type: "error"; message: string }
  /** The main process started decoding the stream itself (ffmpeg); its clock starts now. */
  | { type: "ffmpeg-audio" }
) & { /** The id the renderer passed to liveStart. */ sid?: number };

/** A radio station from Radio Browser, as the Python server returns it. */
export interface Station {
  id: string;
  name: string;
  url: string;
  homepage: string;
  favicon: string;
  country: string;
  countrycode: string;
  /** ISO 639-1 codes. */
  languages: string[];
  tags: string[];
  codec: string;
  bitrate: number;
  hls: boolean;
}

/** A station the user saved, filed under a drawer language. */
export interface SavedStation extends Station {
  lang: string;
}

/** A live TV channel: an official HLS stream (built in, or from the iptv-org index). */
export interface Channel {
  id: string;
  name: string;
  url: string;
  website: string;
  /** ISO 3166 code ("FR"). */
  country: string;
  /** ISO 639-1 codes. */
  languages: string[];
  categories: string[];
  altNames?: string[];
}

/** A channel the user saved, filed under a language. */
export interface SavedChannel extends Channel {
  lang: string;
}

export interface TvQuery {
  language?: string;
  country?: string;
  name?: string;
}

export interface RadioQuery {
  country?: string;
  language?: string;
  name?: string;
  tag?: string;
}

export interface RadioFacet {
  code: string;
  name: string;
  count: number;
}
