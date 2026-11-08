import React, { useState } from "react";
import { Archive, BookOpen, Bookmark, Languages, Newspaper, Plus, RefreshCw, type LucideIcon } from "lucide-react";
import type { ArticleSummary, Feed, FeedItem } from "../../shared/types";
import type { ChromeTokens } from "../lib/theme";

export interface FeedState {
  loading: boolean;
  items: FeedItem[];
  error?: string;
}

interface Props {
  c: ChromeTokens;
  section: string;
  onSectionChange: (section: string) => void;
  library: ArticleSummary[];
  feeds: Feed[];
  feedState: Record<string, FeedState>;
  onRefreshFeed: (feedId: string) => void;
  selectedUrl: string | null;
  onOpenUrl: (url: string) => void;
  vocabCount: number;
}

const navItems = [
  { id: "reading-list", label: "Reading List", icon: BookOpen },
  { id: "favorites", label: "Favorites", icon: Bookmark },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "vocabulary", label: "Vocabulary", icon: Languages },
];

export function LeftSidebar(props: Props) {
  const { c, section, onSectionChange, library, feeds, feedState, onRefreshFeed, selectedUrl, onOpenUrl, vocabCount } = props;
  const [adding, setAdding] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");

  const submitUrl = () => {
    const url = draftUrl.trim();
    if (/^https?:\/\//.test(url)) {
      onOpenUrl(url);
      setDraftUrl("");
      setAdding(false);
    }
  };

  const navButton = (id: string, label: string, Icon: LucideIcon, badge?: number) => (
    <button
      key={id}
      onClick={() => onSectionChange(id)}
      className="readr-hover"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 16px",
        fontSize: 13,
        fontWeight: section === id ? 500 : 400,
        color: section === id ? c.text : c.body,
        background: section === id ? c.selected : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        ["--hover" as string]: c.hover,
      }}
    >
      <Icon size={14} strokeWidth={1.8} />
      <span style={{ flex: 1 }}>{label}</span>
      {badge ? <span style={{ fontSize: 10, color: c.muted }}>{badge}</span> : null}
    </button>
  );

  // Which list fills the lower half of the sidebar.
  let list: React.ReactNode = null;
  if (section.startsWith("feed:")) {
    const feedId = section.slice(5);
    const state = feedState[feedId];
    const libraryByUrl = new Map(library.map((a) => [a.url, a]));
    list = (
      <>
        <GroupLabel c={c}>
          <span style={{ flex: 1 }}>{feeds.find((f) => f.id === feedId)?.name}</span>
          <button
            title="Refresh"
            onClick={() => onRefreshFeed(feedId)}
            style={{ background: "none", border: "none", color: c.muted, cursor: "pointer", padding: 0, display: "flex" }}
          >
            <RefreshCw size={11} className={state?.loading ? "readr-spin" : undefined} />
          </button>
        </GroupLabel>
        {state?.error && <div style={{ padding: "6px 16px", fontSize: 11, color: c.body, lineHeight: 1.4 }}>{state.error}</div>}
        {state?.loading && !state.items.length && <SkeletonCards c={c} />}
        {state?.items.map((item) => (
          <ArticleCard
            key={item.link}
            c={c}
            title={item.title}
            meta={formatFeedDate(item.date)}
            imageUrl={item.imageUrl}
            progress={libraryByUrl.get(item.link)?.progress ?? 0}
            isSelected={selectedUrl === item.link}
            onClick={() => onOpenUrl(item.link)}
          />
        ))}
      </>
    );
  } else if (section !== "vocabulary") {
    const filtered = library.filter((a) =>
      section === "favorites" ? a.favorite : section === "archive" ? a.archived : !a.archived,
    );
    const today = new Date().toDateString();
    const todays = filtered.filter((a) => new Date(a.savedAt).toDateString() === today);
    const earlier = filtered.filter((a) => new Date(a.savedAt).toDateString() !== today);
    const card = (a: ArticleSummary) => (
      <ArticleCard
        key={a.id}
        c={c}
        title={a.title}
        meta={`${a.source} · ${a.readingTime} min`}
        imageUrl={a.imageUrl}
        progress={a.progress}
        isSelected={selectedUrl === a.url}
        onClick={() => onOpenUrl(a.url)}
      />
    );
    list = (
      <>
        {filtered.length === 0 && (
          <div style={{ padding: "10px 16px", fontSize: 11, color: c.muted, lineHeight: 1.5 }}>
            {section === "reading-list"
              ? "Nothing saved yet. Pick a story from Le Monde or Courrier International below, or paste a link."
              : "Nothing here yet."}
          </div>
        )}
        {todays.length > 0 && <GroupLabel c={c}>Today</GroupLabel>}
        {todays.map(card)}
        {earlier.length > 0 && <GroupLabel c={c}>Recently</GroupLabel>}
        {earlier.map(card)}
      </>
    );
  }

  const sources = [...new Set(feeds.map((f) => f.source))];

  return (
    <aside
      className="readr-no-select"
      style={{
        width: 220,
        minWidth: 220,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: c.panel,
        borderRight: `1px solid ${c.border}`,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ padding: "20px 16px 12px", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.3px", color: c.text }}>Readr</div>
      </div>

      <nav style={{ padding: "8px 0" }}>
        {navItems.map(({ id, label, icon }) => navButton(id, label, icon, id === "vocabulary" ? vocabCount : undefined))}
      </nav>

      <div style={{ height: 1, background: c.border, margin: "4px 0" }} />

      <nav style={{ padding: "4px 0 8px" }}>
        {sources.map((source) => (
          <div key={source}>
            <GroupLabel c={c}>{source}</GroupLabel>
            {feeds.filter((f) => f.source === source).map((f) => navButton(`feed:${f.id}`, f.name, Newspaper))}
          </div>
        ))}
      </nav>

      <div style={{ height: 1, background: c.border, margin: "0 0 4px" }} />

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 8px" }}>{list}</div>

      <div style={{ padding: "10px 16px 12px", borderTop: `1px solid ${c.border}` }}>
        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitUrl();
            }}
          >
            <input
              autoFocus
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onBlur={() => !draftUrl && setAdding(false)}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
              placeholder="Paste an article or YouTube link…"
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: 12,
                borderRadius: 5,
                border: `1px solid ${c.border}`,
                background: "transparent",
                color: c.text,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </form>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.muted, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
          >
            <Plus size={13} strokeWidth={2} />
            Add article
          </button>
        )}
      </div>
    </aside>
  );
}

function GroupLabel({ children, c }: { children: React.ReactNode; c: ChromeTokens }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 16px 4px",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.08em",
        color: c.muted,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function ArticleCard({
  c,
  title,
  meta,
  imageUrl,
  progress,
  isSelected,
  onClick,
}: {
  c: ChromeTokens;
  title: string;
  meta: string;
  imageUrl: string;
  progress: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <button
      onClick={onClick}
      className="readr-hover"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        padding: "8px 16px",
        background: isSelected ? c.selected : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        ["--hover" as string]: c.hover,
      }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: c.border }}>
        {imageUrl && imgOk && (
          <img src={imageUrl} alt="" onError={() => setImgOk(false)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: c.text,
            lineHeight: 1.35,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 10, color: c.muted, marginTop: 3 }}>{meta}</div>
        {progress > 0 && (
          <div style={{ marginTop: 4, height: 2, background: c.border, borderRadius: 1, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: c.accent }} />
          </div>
        )}
      </div>
    </button>
  );
}

function SkeletonCards({ c }: { c: ChromeTokens }) {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: "flex", gap: 10, padding: "8px 16px" }}>
          <div className="readr-shimmer" style={{ width: 42, height: 42, borderRadius: 4, background: c.border }} />
          <div style={{ flex: 1 }}>
            <div className="readr-shimmer" style={{ height: 9, borderRadius: 3, background: c.border, marginBottom: 6 }} />
            <div className="readr-shimmer" style={{ height: 9, width: "60%", borderRadius: 3, background: c.border }} />
          </div>
        </div>
      ))}
    </>
  );
}

function formatFeedDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
