// Types shared by the Electron main process and the React renderer.

export type Lang = "fr" | "en" | "ar";

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
  progress: number; // 0-100
  savedAt: string; // ISO
  favorite?: boolean;
  archived?: boolean;
  /** "video" articles are a YouTube video's captions, one sentence per cue. */
  kind?: "article" | "video";
  videoId?: string;
  /** [start, end] seconds for each sentence, parallel to blocks[].sentences. */
  cues?: [number, number][][];
}

/** Light version used in lists (no body). */
export type ArticleSummary = Omit<Article, "blocks" | "translations" | "cues">;

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
}

export interface Site {
  id: string;
  name: string;
  homepage: string;
  loginUrl: string;
  /** Hostnames this site's articles live on. */
  hosts: string[];
}

export interface DictSense {
  pos: string;
  glosses: string[];
  tags: string[]; // e.g. ["masculine"]
}

export interface LookupResult {
  word: string;
  lemma: string;
  pos: string; // spaCy UPOS
  morph: Record<string, string>; // Gender=Masc, Number=Sing, Tense=Pres...
  ipa: string;
  senses: DictSense[];
  /** Machine translation of the word alone, as a fallback gloss. */
  mtGloss: string;
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
  /** For words saved from a video: where the sentence starts, and media files
   * (names inside the library's media folder) for Anki. */
  videoTime?: number;
  image?: string;
  audio?: string;
}

/** Messages between the renderer and the embedded YouTube player. */
export interface VideoState {
  time: number;
  paused: boolean;
  ad: boolean;
  rate: number;
}

export type VideoKey = "prev" | "next" | "repeat" | "slower" | "faster" | "toggle";

export interface SidecarStatus {
  ok: boolean;
  translator: string; // "quickmt-fr-en" | "opus-mt-fr-en" | ""
  spacy: boolean;
  dictionary: boolean;
  message: string;
}

export interface ExtractResult {
  ok: boolean;
  article?: Article;
  /** True when the page looked like a paywall / login wall. */
  paywalled?: boolean;
  error?: string;
}

/** The API the preload script exposes on window.readr. */
export interface ReadrApi {
  sites(): Promise<Site[]>;
  login(siteId: string): Promise<void>;
  openOriginal(url: string): Promise<void>;
  feeds(): Promise<Feed[]>;
  fetchFeed(feedId: string): Promise<{ ok: boolean; items: FeedItem[]; error?: string }>;
  extract(url: string): Promise<ExtractResult>;
  library(): Promise<ArticleSummary[]>;
  getArticle(id: string): Promise<Article | null>;
  updateArticle(id: string, patch: Partial<Article>): Promise<void>;
  deleteArticle(id: string): Promise<void>;
  translate(articleId: string, sentences: string[]): Promise<Record<string, string>>;
  lookup(word: string, sentence: string): Promise<LookupResult | null>;
  sidecarStatus(): Promise<SidecarStatus>;
  vocab(): Promise<VocabEntry[]>;
  addVocab(entry: Omit<VocabEntry, "id" | "addedAt">): Promise<VocabEntry>;
  updateVocab(id: string, patch: Partial<VocabEntry>): Promise<void>;
  removeVocab(id: string): Promise<void>;
  exportVocab(): Promise<string | null>; // returns saved path
  /** Copy the news sites' logins from an everyday browser into Readr. */
  importBrowserLogins(browser: string): Promise<{ ok: boolean; imported: number; domains: string[]; error?: string }>;

  // Embedded YouTube player. Bounds are CSS pixels in the main window.
  videoShow(videoId: string, bounds: Bounds): Promise<void>;
  videoBounds(bounds: Bounds): void;
  videoHide(): void;
  videoSeek(time: number, play?: boolean): void;
  /** Play [start, end] once, then pause. */
  videoPlayRange(start: number, end: number): void;
  videoToggle(): void;
  videoRate(delta: number): void;
  videoOverlay(text: string, translation: string): void;
  /** Screenshot at `start` and an audio clip of [start, end]; returns media file names. */
  videoCapture(start: number, end: number): Promise<{ image: string; audio: string } | null>;
  onVideoState(cb: (s: VideoState) => void): () => void;
  onVideoKey(cb: (k: VideoKey) => void): () => void;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
