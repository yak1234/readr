// A story on a front page (Home, a source's page): its picture, title and standfirst in its own language,
// direction and script's face, and the line under it. Shared so every front page sets stories alike.

import { useState } from "react";
import { languageScope } from "../lib/language-scope";
import type { Story } from "../lib/stories";
import { UI_FONT, type ReadingTokens } from "../lib/theme";

interface StoryProps {
  story: Story;
  tokens: ReadingTokens;
  onOpen: (url: string) => void;
  /** Name the source under the title (Home mixes sources; a source's own page doesn't). */
  withSource?: boolean;
}

/** A picture over its title; `big` for a page's lead, with the standfirst. A picture that fails is left out. */
export function StoryCard({ story, tokens, big, withSource = true, onOpen }: StoryProps & { big?: boolean }) {
  const [imgOk, setImgOk] = useState(true);
  const content = languageScope(story.lang);
  const font = content.contentFont;
  return (
    <button data-story={big ? "lead" : "card"} onClick={() => onOpen(story.link)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "start", color: tokens.text, display: "block", width: "100%" }}>
      {story.imageUrl && imgOk && (
        <div style={{ aspectRatio: big ? "16/9" : "3/2", borderRadius: 6, overflow: "hidden", background: tokens.border, marginBottom: 10 }}>
          <img src={story.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setImgOk(false)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      )}
      <div data-story-title dir={content.dir} lang={story.lang} style={{ fontFamily: font, fontSize: (big ? 24 : 15) * content.contentScale, fontWeight: big ? 600 : 500, lineHeight: big ? 1.22 : 1.35, letterSpacing: big ? "-0.3px" : 0 }}>{story.title}</div>
      {big && story.description && (
        <div dir={content.dir} lang={story.lang} style={{ fontFamily: font, fontSize: 14 * content.contentScale, lineHeight: 1.5, color: tokens.secondary, marginTop: 8, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{story.description}</div>
      )}
      <StoryMeta story={story} tokens={tokens} withSource={withSource} marginTop={6} />
    </button>
  );
}

/** A headline alone, ruled off from the next: the column beside a lead. */
export function StoryLine({ story, tokens, withSource = true, onOpen }: StoryProps) {
  const content = languageScope(story.lang);
  return (
    <button data-story="line" onClick={() => onOpen(story.link)} style={{ background: "none", border: "none", borderBottom: `1px solid ${tokens.border}`, padding: "0 0 12px", cursor: "pointer", textAlign: "start", color: tokens.text }}>
      <div data-story-title dir={content.dir} lang={story.lang} style={{ fontFamily: content.contentFont, fontSize: 16 * content.contentScale, fontWeight: 500, lineHeight: 1.35 }}>{story.title}</div>
      <StoryMeta story={story} tokens={tokens} withSource={withSource} marginTop={4} />
    </button>
  );
}

/** The lead's column beside the headlines' column, for a block and its skeleton alike. */
const LEAD_COLUMNS = { display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: 28 } as const;

/** A front page's block: the lead beside a column of headlines, then a grid of cards. `lines` headlines go
 * beside the lead and up to `cards` stories under it. */
export function StoryBlock({ lead, rest, tokens, onOpen, withSource = true, bigLead = true, lines = 4, cards = 12 }: {
  lead: Story;
  rest: Story[];
  tokens: ReadingTokens;
  onOpen: (url: string) => void;
  withSource?: boolean;
  bigLead?: boolean;
  lines?: number;
  cards?: number;
}) {
  const grid = rest.slice(lines, lines + cards);
  return (
    <>
      <div style={{ ...LEAD_COLUMNS, marginBottom: grid.length ? 28 : 0 }}>
        <div data-story-lead>
          <StoryCard story={lead} tokens={tokens} big={bigLead} withSource={withSource} onOpen={onOpen} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rest.slice(0, lines).map((s) => (
            <StoryLine key={s.link} story={s} tokens={tokens} withSource={withSource} onOpen={onOpen} />
          ))}
        </div>
      </div>
      {grid.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 22, alignItems: "start" }}>
          {grid.map((s) => (
            <StoryCard key={s.link} story={s} tokens={tokens} withSource={withSource} onOpen={onOpen} />
          ))}
        </div>
      )}
    </>
  );
}

/** A block's shape while its stories load: a picture and headline beside four lines. */
export function StoryBlockSkeleton({ tokens }: { tokens: ReadingTokens }) {
  const bar = (width: string, height = 12) => <div className="readr-shimmer" style={{ height, width, background: tokens.border, borderRadius: 3, marginBottom: 10 }} />;
  return (
    <div data-story-skeleton style={LEAD_COLUMNS}>
      <div>
        <div className="readr-shimmer" style={{ aspectRatio: "16/9", background: tokens.border, borderRadius: 6, marginBottom: 12 }} />
        {bar("85%", 18)}
        {bar("60%", 18)}
      </div>
      <div>{[0, 1, 2, 3].map((i) => <div key={i} style={{ marginBottom: 18 }}>{bar("95%")}{bar("70%")}</div>)}</div>
    </div>
  );
}

/** "Le Monde · il y a 5 minutes": the source, and how long ago in the story's own locale (content, not chrome). */
function StoryMeta({ story, tokens, withSource, marginTop }: { story: Story; tokens: ReadingTokens; withSource: boolean; marginTop: number }) {
  const content = languageScope(story.lang);
  const parts = [withSource ? story.source : "", content.formatRelative(story.time)].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div dir={content.dir} lang={story.lang} style={{ fontSize: 11, color: tokens.secondary, marginTop, fontFamily: UI_FONT }}>
      {parts.join(" · ")}
    </div>
  );
}
